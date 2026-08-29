import type { LanguageProfile, SentenceConnector } from "./types";
import { foldAccents } from "./number-normalizer";

export type SentenceBoundaryResult = {
  /** Conectivo reconhecido no início do segmento novo (ex.: "mas"), se houver — usado pelo punctuation-engine pra reabrir a frase anterior e emendar com vírgula em vez de fechar com ponto. */
  connector: SentenceConnector | null;
};

function startsWithConnector(text: string, connectors: SentenceConnector[]): SentenceConnector | null {
  const folded = foldAccents(text.trim());
  for (const c of connectors) {
    const pattern = new RegExp(`^${c.word.replace(/\s+/g, "\\s+")}\\b`);
    if (pattern.test(folded)) return c;
  }
  return null;
}

/**
 * Decide se o SEGMENTO NOVO (uma frase que acabou de fechar na
 * SpeechRecognition) começa uma oração DENTRO da frase já confirmada (via
 * conectivo adversativo/consecutivo — "mas", "porém", "então"...) ou uma
 * frase nova de vez. Não insere pontuação sozinho — só classifica; quem
 * decide o caractere é o punctuation-engine.ts.
 *
 * Pausa de voz sozinha NUNCA basta aqui — cada frase que a SpeechRecognition
 * fecha já é, por definição, separada por uma pausa (é assim que ela decide
 * fechar a frase); usar só isso pra pontuar faria TODA frase nova virar
 * vírgula/ponto automaticamente, o que o pedido explicitamente não quer.
 *
 * Sem conectivo, todo segmento novo é tratado como frase nova (fecha o
 * anterior com "."/"?", começa este com maiúscula) — decisão deliberada de
 * simplicidade: uma heurística por tamanho ("frase curta ainda não parece
 * terminada, não fecha ainda") foi cogitada e descartada — ela empurraria a
 * decisão de fechar a ÚLTIMA frase da sessão pra um gatilho de "sessão
 * terminou" que não existe hoje (nenhum dos pontos de ditado passa
 * `onListeningChange` pro pipeline), e o ganho (evitar um ponto cedo demais
 * num início de frase curto tipo "o cliente") não pagava a complexidade — o
 * pior caso já era o comportamento ANTERIOR ao subsistema de voz inteiro
 * (appendDictatedText original também fechava toda frase reconhecida com
 * ponto, sem exceção).
 */
export function detectSentenceBoundary(newSegment: string, profile: LanguageProfile): SentenceBoundaryResult {
  return { connector: startsWithConnector(newSegment, profile.sentenceConnectors) };
}
