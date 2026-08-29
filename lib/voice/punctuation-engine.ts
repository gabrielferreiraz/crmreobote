import type { LanguageProfile, PunctuationCandidateType } from "./types";
import { detectSentenceBoundary } from "./sentence-boundary-detector";
import { detectQuestion } from "./question-detector";
import { PROTECTED_CASING_TERMS } from "./vocabulary";

export type PunctuationResult = {
  text: string;
  candidateType: PunctuationCandidateType;
  isQuestion: boolean;
};

function firstWord(text: string): string {
  return text.split(/\s+/)[0] ?? "";
}

/** Maiúscula/minúscula da 1ª letra conforme a posição (início de frase ou
 * continuação da mesma) — nunca mexe num termo protegido (CRM, WhatsApp,
 * SDR...), que já está com a casing certa vinda do vocabulary.ts. */
function applyCasingForPosition(segment: string, isSentenceStart: boolean): string {
  if (!segment) return segment;
  if (PROTECTED_CASING_TERMS.has(firstWord(segment).toLowerCase())) return segment;
  const first = isSentenceStart ? segment.charAt(0).toUpperCase() : segment.charAt(0).toLowerCase();
  return first + segment.slice(1);
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?…]+\s*$/, "").trimEnd();
}

/** Só a ÚLTIMA oração ainda "aberta" (depois da última pontuação forte) —
 * detectQuestion precisa avaliar só o trecho corrente, não a transcrição
 * inteira acumulada (senão uma palavra interrogativa de uma frase antiga
 * continuaria pesando pra sempre no texto novo). */
function extractTrailingClause(text: string): string {
  const match = text.match(/[.!?…]\s+([^.!?…]*)$/);
  return match ? match[1] : text;
}

function closeSentence(text: string, profile: LanguageProfile): string {
  const trailingClause = extractTrailingClause(text);
  const question = detectQuestion(trailingClause, profile);
  return `${text}${question.isQuestion ? "?" : "."}`;
}

/**
 * Junta um segmento final NOVO (já normalizado, ver normalization-engine.ts)
 * ao texto já confirmado, decidindo pontuação por SCORE — nunca "toda pausa
 * vira vírgula". Composição:
 *
 *  - texto confirmado vazio → só capitaliza e devolve (1º segmento).
 *  - segmento novo começa com conectivo adversativo/consecutivo ("mas",
 *    "porém", "então"...) → reabre a frase anterior (remove o "." que
 *    tinha sido aplicado provisoriamente — ver abaixo) e emenda com
 *    vírgula, minúscula.
 *  - caso contrário → fecha o texto confirmado (ponto ou interrogação,
 *    conforme question-detector.ts) e começa o segmento novo com
 *    maiúscula.
 *
 * Cada chamada fecha PROVISORIAMENTE o resultado com "." — se o PRÓXIMO
 * segmento vier com conectivo, essa pontuação provisória é desfeita e a
 * frase é reaberta. Mesmo comportamento base que `appendDictatedText` já
 * tinha (fechar cada frase reconhecida com pontuação), só que agora capaz
 * de reabrir quando prova de continuação chega, e escolher "?" quando o
 * conteúdo pontua como pergunta.
 */
export function applyPunctuation(
  confirmedText: string,
  normalizedSegment: string,
  profile: LanguageProfile,
): PunctuationResult {
  const trimmedConfirmed = confirmedText.trim();
  if (!trimmedConfirmed) {
    // 1º segmento da sessão — closeSentence() abaixo SEMPRE fecha com "." ou
    // "?" (nunca "none": "none" é só pra quando de fato não há marca
    // nenhuma pra aplicar, o que não é o caso aqui).
    const text = closeSentence(applyCasingForPosition(normalizedSegment, true), profile);
    return { text, candidateType: text.endsWith("?") ? "question" : "period", isQuestion: text.endsWith("?") };
  }

  const boundary = detectSentenceBoundary(normalizedSegment, profile);

  let extended: string;
  let candidateType: PunctuationCandidateType;
  if (boundary.connector) {
    const reopened = stripTrailingPunctuation(trimmedConfirmed);
    extended = `${reopened}${boundary.connector.punctuation} ${applyCasingForPosition(normalizedSegment, false)}`;
    candidateType = "comma";
  } else {
    extended = `${trimmedConfirmed} ${applyCasingForPosition(normalizedSegment, true)}`;
    candidateType = "period";
  }

  const text = closeSentence(extended, profile);
  const isQuestion = text.endsWith("?");
  return { text, candidateType: isQuestion ? "question" : candidateType, isQuestion };
}
