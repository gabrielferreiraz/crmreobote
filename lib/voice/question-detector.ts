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

/**
 * Score determinístico de "isso é uma pergunta?" — NUNCA `text.includes()`
 * cego (pedido explícito). Três sinais somados:
 *
 * 1. Palavra interrogativa (quem/qual/quando/onde/como/por que/quanto...) —
 *    quanto mais perto do INÍCIO da frase, maior o peso; longe do início
 *    (position >= 3) já não soma nada sozinha. Isso sozinho já resolve o
 *    par de exemplos do pedido: "qual o valor da parcela" ("qual" na
 *    posição 0 → score alto) vs. "eu não sei QUANTO ele pretende investir"
 *    ("quanto" na posição 3 → já quase zero, mesmo sem o sinal 3 abaixo).
 * 2. Abertura modal/cortesia no INÍCIO ("pode", "poderia", "tem como",
 *    "você consegue", "será que") — construção que em pt-BR falado é quase
 *    sempre pergunta quando abre a frase; peso menor se aparecer no meio.
 * 3. Marcador de pergunta INDIRETA ("não sei", "sei lá", "duvido que"...)
 *    ANTES da palavra interrogativa na mesma frase — anula o sinal 1
 *    ("eu não sei quanto..." não é pergunta, é afirmação sobre não saber).
 */
export function detectQuestion(text: string, profile: LanguageProfile): QuestionScore {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { isQuestion: false, score: 0, reason: "texto vazio" };

  let score = 0;
  const reasons: string[] = [];

  // Sinal 1 — palavra interrogativa por posição.
  let questionWordPosition: number | null = null;
  for (const word of profile.questionWords) {
    const pos = findPhrasePosition(tokens, word);
    if (pos !== null && (questionWordPosition === null || pos < questionWordPosition)) {
      questionWordPosition = pos;
    }
  }
  if (questionWordPosition !== null) {
    const positionScore = Math.max(0, 6 - questionWordPosition * 2);
    score += positionScore;
    if (positionScore > 0) reasons.push(`palavra interrogativa na posição ${questionWordPosition} (+${positionScore})`);
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

  score = Math.max(0, score);
  const isQuestion = score >= VOICE_CONFIG.questionThreshold;
  return { isQuestion, score, reason: reasons.join("; ") || "nenhum sinal de pergunta" };
}
