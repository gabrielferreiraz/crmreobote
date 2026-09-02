import type { LanguageProfile, QuestionScore } from "./types";
import { foldAccents } from "./number-normalizer";
import { VOICE_CONFIG } from "./config";

function tokenize(text: string): string[] {
  return foldAccents(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Posição (índice de palavra, 0-based) da PRIMEIRA ocorrência de uma frase
 * (1 ou mais palavras) dentro dos tokens — null se não achar. Frase de N
 * palavras testada em toda janela de N tokens consecutivos, não só token a
 * token, pra reconhecer "por que"/"tem como"/"não sei" como uma unidade só. */
function findPhrasePosition(tokens: string[], phrase: string): number | null {
  const phraseWords = phrase.split(/\s+/);
  for (let i = 0; i <= tokens.length - phraseWords.length; i++) {
    let matches = true;
    for (let j = 0; j < phraseWords.length; j++) {
      if (tokens[i + j] !== phraseWords[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return null;
}

function startsWithPhrase(tokens: string[], phrase: string): boolean {
  return findPhrasePosition(tokens, phrase) === 0;
}

/** true se a ÚLTIMA ocorrência da frase termina dentro dos `tolerance`
 * tokens finais — usado pelo sinal de tag question (ver detectQuestion):
 * "né"/"combinado"/"ou não" precisam estar perto do FIM pra contar, não em
 * qualquer lugar do meio da frase (onde seriam só coincidência léxica, ex.:
 * "ele falou que tá certo mas..." não é pergunta só porque contém "certo"). */
function endsNearPhrase(tokens: string[], phrase: string, tolerance: number): boolean {
  const phraseWords = phrase.split(/\s+/);
  // Varre de trás pra frente pra achar a ÚLTIMA ocorrência (uma frase pode
  // repetir a mesma expressão; só a mais próxima do fim importa aqui).
  for (let i = tokens.length - phraseWords.length; i >= 0; i--) {
    let matches = true;
    for (let j = 0; j < phraseWords.length; j++) {
      if (tokens[i + j] !== phraseWords[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const endIndex = i + phraseWords.length - 1;
      return tokens.length - 1 - endIndex <= tolerance;
    }
  }
  return false;
}

/**
 * Score determinístico de "isso é uma pergunta?" — NUNCA `text.includes()`
 * cego (pedido explícito). Cinco sinais somados, cada um pensado pra um
 * padrão REAL de como pergunta soa em português falado (não só o "livro de
 * gramática" quem/qual/quando):
 *
 * 1. Palavra interrogativa — quanto mais perto do INÍCIO da frase, maior o
 *    peso; decai 1 ponto por palavra de distância (antes decaía 2 —
 *    afrouxado porque a abertura educada mais comum em pt-BR falado,
 *    "eu queria saber quando...", já empurra a palavra interrogativa pra
 *    posição 3+ sozinha, e um decaimento agressivo zerava esse caso mesmo
 *    sendo claramente uma pergunta).
 * 2. Abertura modal/cortesia no INÍCIO ("pode", "poderia", "tem como",
 *    "queria saber", "dá pra"...) — construção que em pt-BR falado é quase
 *    sempre pergunta quando abre a frase; peso menor se aparecer no meio.
 * 3. Marcador de pergunta INDIRETA ("não sei", "sei lá"...) ANTES da palavra
 *    interrogativa na mesma frase — anula o sinal 1 ("eu não sei quanto ele
 *    pretende investir" não é pergunta, é afirmação sobre não saber).
 * 4. Marcador de TAG QUESTION perto do FIM da frase ("né", "combinado",
 *    "ou não", "fechado?"...) — o jeito mais comum de perguntar sim/não no
 *    português falado NÃO usa nenhuma palavra interrogativa, quem carrega
 *    a pergunta é a entonação; como texto não carrega entonação, esses
 *    marcadores lexicais são o substituto. Sinal forte o bastante pra
 *    sozinho cruzar o threshold (não depende dos outros 4).
 * 5. Verbo de confirmação sem sujeito abrindo a frase ("Fechou o negócio?",
 *    "Confirmou a reunião?") — pretérito perfeito de verbo de fechamento de
 *    venda largado sem sujeito no início quase sempre é pergunta nesse
 *    registro (um relato mantém o sujeito: "ele fechou..."). Dois níveis
 *    (ver subjectlessQuestionVerbsStrong/Moderate em language-profile.ts):
 *    verbo de ação sem uso declarativo plausível decide sozinho; verbo-
 *    resultado (que também abre declarativa legítima, "rolou uma reunião")
 *    só ajuda a cruzar o threshold combinado com outro sinal.
 */
export function detectQuestion(text: string, profile: LanguageProfile): QuestionScore {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { isQuestion: false, score: 0, reason: "texto vazio" };

  let score = 0;
  const reasons: string[] = [];

  // Sinal 1 — palavra interrogativa por posição (perto do INÍCIO pesa mais)
  // + bônus separado se ela aparecer colada no FINAL da frase ("ele não
  // quis fechar, por quê?"): "por quê" isolado no fim é um padrão tão forte
  // de pergunta em português falado quanto uma palavra interrogativa logo
  // no início — sem esse bônus, uma frase inteira antes do "por que" final
  // já zerava o score posicional (decai com a DISTÂNCIA do início, que é
  // grande justamente quando a interrogativa está no fim).
  let questionWordPosition: number | null = null;
  let endsWithQuestionWord = false;
  for (const word of profile.questionWords) {
    const pos = findPhrasePosition(tokens, word);
    if (pos === null) continue;
    if (questionWordPosition === null || pos < questionWordPosition) questionWordPosition = pos;
    const wordTokenCount = word.split(/\s+/).length;
    if (pos + wordTokenCount === tokens.length) endsWithQuestionWord = true;
  }
  if (questionWordPosition !== null) {
    const positionScore = Math.max(0, 6 - questionWordPosition);
    score += positionScore;
    if (positionScore > 0) reasons.push(`palavra interrogativa na posição ${questionWordPosition} (+${positionScore})`);
  }
  if (endsWithQuestionWord) {
    score += 6;
    reasons.push(`palavra interrogativa colada no final da frase (+6)`);
  }

  // Sinal 2 — abertura modal/cortesia.
  let openerBonus = 0;
  for (const opener of profile.questionOpeners) {
    if (startsWithPhrase(tokens, opener)) {
      openerBonus = Math.max(openerBonus, 6);
      reasons.push(`abre com "${opener}" (+6)`);
    } else if (findPhrasePosition(tokens, opener) !== null) {
      openerBonus = Math.max(openerBonus, 3);
      reasons.push(`contém "${opener}" fora do início (+3)`);
    }
  }
  score += openerBonus;

  // Sinal 3 — pergunta indireta anula o sinal 1 quando o marcador vem ANTES
  // da palavra interrogativa (mesma oração).
  if (questionWordPosition !== null) {
    for (const marker of profile.indirectQuestionMarkers) {
      const markerPos = findPhrasePosition(tokens, marker);
      if (markerPos !== null && markerPos < questionWordPosition) {
        score -= 6;
        reasons.push(`"${marker}" antes da palavra interrogativa (-6)`);
        break;
      }
    }
  }

  // Sinal 4 — tag question perto do fim ("né", "combinado", "ou não"...).
  // Forte o bastante pra cruzar o threshold sozinho (ver VOICE_CONFIG.
  // questionThreshold) — em português falado, esses marcadores no fim quase
  // nunca aparecem fora de uma pergunta de confirmação.
  for (const tag of profile.questionTagMarkers) {
    if (endsNearPhrase(tokens, tag, VOICE_CONFIG.questionTagNearEndTolerance)) {
      score += 8;
      reasons.push(`termina perto de "${tag}" (+8, tag question)`);
      break; // um marcador já basta — não empilha por ter mais de um coincidindo.
    }
  }

  // Sinal 5 — verbo de confirmação sem sujeito abrindo a frase (2 níveis).
  if (tokens.length > 0) {
    const firstWord = tokens[0];
    if (profile.subjectlessQuestionVerbsStrong.includes(firstWord)) {
      score += 7;
      reasons.push(`abre com verbo de confirmação sem sujeito "${firstWord}" (+7, forte)`);
    } else if (profile.subjectlessQuestionVerbsModerate.includes(firstWord)) {
      score += 4;
      reasons.push(`abre com verbo-resultado sem sujeito "${firstWord}" (+4, moderado)`);
    }
  }

  score = Math.max(0, score);
  const isQuestion = score >= VOICE_CONFIG.questionThreshold;
  return { isQuestion, score, reason: reasons.join("; ") || "nenhum sinal de pergunta" };
}
