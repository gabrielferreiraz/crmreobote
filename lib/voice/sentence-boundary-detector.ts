import type { LanguageProfile, SentenceConnector } from "./types";
import { foldAccents } from "./number-normalizer";
import { VOICE_CONFIG } from "./config";

export type SentenceBoundaryResult = {
  /** Conectivo reconhecido no início do segmento novo (ex.: "mas"), se houver — usado pelo punctuation-engine pra reabrir a frase anterior e emendar com vírgula em vez de fechar com ponto. */
  connector: SentenceConnector | null;
  /** true quando a frase que SERIA fechada termina numa palavra que não
   * consegue terminar uma frase sozinha em português (ver danglingEndings em
   * types.ts/language-profile.ts) — reabre mesmo sem NENHUM conectivo no
   * segmento novo, só com espaço (sem vírgula: é a MESMA oração continuando,
   * não uma oração nova emendada). Mutuamente exclusivo com `connector`
   * (ver detectSentenceBoundary): um conectivo reconhecido já resolve a
   * reabertura sozinho, esse sinal só é consultado quando não há conectivo. */
  forcedByDanglingEnd: boolean;
};

function startsWithConnector(text: string, connectors: SentenceConnector[]): SentenceConnector | null {
  const folded = foldAccents(text.trim());
  for (const c of connectors) {
    const pattern = new RegExp(`^${c.word.replace(/\s+/g, "\\s+")}\\b`);
    if (pattern.test(folded)) return c;
  }
  return null;
}

/** Remove pontuação forte final (.!?…) de um fechamento provisório —
 * compartilhado com punctuation-engine.ts, que usa isso tanto pra reabrir
 * uma frase (comma/dangling-end) quanto (via extractTrailingClause abaixo)
 * pra recortar só a oração ainda aberta. */
export function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?…]+\s*$/, "").trimEnd();
}

/** Só a ÚLTIMA oração ainda "aberta" (depois da última pontuação forte) —
 * usado tanto por detectQuestion (avaliar só o trecho corrente, não a
 * transcrição inteira acumulada) quanto por detectSentenceBoundary abaixo
 * (contar quantas palavras a frase nova já tem, pro limite de reanálise).
 *
 * `\s*` (não `\s+`) de propósito — cobre o caso de detectSentenceBoundary
 * chamando isto bem no instante em que o "." provisório acabou de ser
 * aplicado e NADA foi dito depois dele ainda (texto termina exatamente no
 * "."): sem essa flexibilidade o regex não casava, caindo no fallback
 * "devolve o texto INTEIRO" — o que faria a frase nova já "nascer" contada
 * como se tivesse todo o texto anterior de palavras, estourando o limite de
 * reanálise (VOICE_CONFIG.sentenceReanalysisWordLimit) na primeira
 * oportunidade. Com `\s*`, esse caso casa e devolve "" (0 palavras) —
 * exatamente o que a frase nova tem no instante em que ainda não ganhou
 * nenhuma palavra própria. Não muda nada pro uso em closeSentence() (texto
 * ali sempre tem conteúdo de verdade depois do "." mais recente). */
export function extractTrailingClause(text: string): string {
  const match = text.match(/[.!?…]\s*([^.!?…]*)$/);
  return match ? match[1] : text;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Verdade quando a ÚLTIMA palavra antes do fechamento provisório é uma
 * preposição/artigo/conjunção (ver danglingEndings) — nenhuma delas termina
 * uma frase sozinha em português. Se apareceu bem no fim de um segmento
 * reconhecido, o mais provável não é "a pessoa terminou a ideia numa
 * preposição", é "a pessoa fez uma pausa no MEIO da frase (pra pensar/
 * respirar) e a SpeechRecognition fechou o segmento ali por causa da pausa,
 * não porque a frase de fato acabou".
 */
function endsWithDanglingWord(trimmedConfirmed: string, danglingEndings: string[]): boolean {
  const stripped = stripTrailingPunctuation(trimmedConfirmed);
  if (!stripped) return false;
  const words = foldAccents(stripped).trim().split(/\s+/);
  const lastWord = words[words.length - 1];
  return danglingEndings.includes(lastWord);
}

/**
 * Decide se o SEGMENTO NOVO (uma frase que acabou de fechar na
 * SpeechRecognition) começa uma oração DENTRO da frase já confirmada (via
 * conectivo adversativo/consecutivo — "mas", "porém", "então"...), continua
 * a MESMA oração de antes (final capenga — ver endsWithDanglingWord), ou uma
 * frase nova de vez. Não insere pontuação sozinho — só classifica; quem
 * decide o caractere é o punctuation-engine.ts.
 *
 * Pausa de voz sozinha NUNCA basta aqui — cada frase que a SpeechRecognition
 * fecha já é, por definição, separada por uma pausa (é assim que ela decide
 * fechar a frase); usar só isso pra pontuar faria TODA frase nova virar
 * vírgula/ponto automaticamente, o que o pedido explicitamente não quer.
 *
 * A checagem de final capenga só roda enquanto a frase que ACABOU de fechar
 * (a candidata a reabrir) ainda é "jovem" — poucas palavras, ver
 * VOICE_CONFIG.sentenceReanalysisWordLimit: reabrir uma frase que já cresceu
 * muito reescreveria texto que o usuário já viu/pode ter mexido, e a essa
 * altura o próprio tamanho dela já é evidência de que era mesmo separada.
 * Repara que essa contagem NUNCA é feita em cima do que já foi dito DEPOIS
 * do "." (isso é sempre vazio bem no instante em que ele acabou de fechar —
 * ninguém falou nada ainda), e sim em cima da própria frase que fechou.
 *
 * Sem conectivo nem final capenga, todo segmento novo é tratado como frase
 * nova (fecha o anterior com "."/"?", começa este com maiúscula) — decisão
 * deliberada de simplicidade pro resto dos casos: uma heurística por tamanho
 * ("frase curta ainda não parece terminada, não fecha ainda") foi cogitada e
 * descartada — ela empurraria a decisão de fechar a ÚLTIMA frase da sessão
 * pra um gatilho de "sessão terminou" que não existe hoje (nenhum dos pontos
 * de ditado passa `onListeningChange` pro pipeline), e o ganho (evitar um
 * ponto cedo demais num início de frase curto tipo "o cliente") não pagava a
 * complexidade — o pior caso já era o comportamento ANTERIOR ao subsistema
 * de voz inteiro (appendDictatedText original também fechava toda frase
 * reconhecida com ponto, sem exceção).
 */
export function detectSentenceBoundary(
  trimmedConfirmed: string,
  newSegment: string,
  profile: LanguageProfile,
): SentenceBoundaryResult {
  const connector = startsWithConnector(newSegment, profile.sentenceConnectors);
  if (connector) return { connector, forcedByDanglingEnd: false };

  // Tamanho da frase que ACABOU de ser fechada — a candidata a reabrir —
  // não o que já foi dito DEPOIS dela (isso é sempre "" bem no instante em
  // que ela fechou, ninguém falou nada ainda; olhar pra isso faria o limite
  // nunca travar nada). stripTrailingPunctuation tira o "." dela pra
  // extractTrailingClause conseguir recortar só ela (o texto ENTRE a
  // penúltima pontuação forte e essa última que acabou de sair).
  const lastClosedSentenceWordCount = countWords(extractTrailingClause(stripTrailingPunctuation(trimmedConfirmed)));
  if (lastClosedSentenceWordCount > VOICE_CONFIG.sentenceReanalysisWordLimit) {
    return { connector: null, forcedByDanglingEnd: false };
  }

  if (endsWithDanglingWord(trimmedConfirmed, profile.danglingEndings)) {
    return { connector: null, forcedByDanglingEnd: true };
  }

  return { connector: null, forcedByDanglingEnd: false };
}
