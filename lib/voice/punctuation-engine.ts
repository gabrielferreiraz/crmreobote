import type { LanguageProfile, PunctuationCandidateType } from "./types";
import { detectSentenceBoundary, stripTrailingPunctuation, extractTrailingClause } from "./sentence-boundary-detector";
import { detectQuestion } from "./question-detector";
import { PROTECTED_CASING_TERMS } from "./vocabulary";
import { applyPorQueForm } from "./por-que-correction";

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

function closeSentence(text: string, profile: LanguageProfile): string {
  const trailingClause = extractTrailingClause(text);
  const question = detectQuestion(trailingClause, profile);
  return `${text}${question.isQuestion ? "?" : "."}`;
}

/** Aplica applyPorQueForm só na oração RECÉM-fechada (`beforeClose`, o texto
 * ainda sem o "."/"?" final) — nunca reprocessa frases antigas já
 * assentadas. `closedText` é o mesmo texto já com o fechamento aplicado
 * (ver closeSentence acima); usa o "?"/"." dele pra saber isQuestion e
 * devolve o texto final já com a forma certa de "por que" emendada de
 * volta no lugar. */
function applyPorQueToClosedText(beforeClose: string, closedText: string, profile: LanguageProfile): string {
  const isQuestion = closedText.endsWith("?");
  const newClause = extractTrailingClause(beforeClose);
  const correctedClause = applyPorQueForm(newClause, isQuestion, profile);
  if (correctedClause === newClause) return closedText;
  const prefix = beforeClose.slice(0, beforeClose.length - newClause.length);
  return prefix + correctedClause + closedText.slice(-1);
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
 *  - sem conectivo, mas a frase anterior termina numa palavra que não
 *    consegue terminar frase sozinha em português (preposição, artigo,
 *    conjunção — ver danglingEndings/endsWithDanglingWord em
 *    sentence-boundary-detector.ts) → reabre igual, só que sem vírgula
 *    nenhuma (é a MESMA oração continuando, a pausa foi só hesitação no
 *    meio dela). Essa reabertura só é tentada enquanto a frase nova ainda
 *    tem poucas palavras (VOICE_CONFIG.sentenceReanalysisWordLimit) — é a
 *    "reanálise depois de um certo limite de palavras": no instante exato
 *    da pausa só dá pra olhar o que veio ANTES dela, então a decisão fica
 *    em aberto por mais alguns segmentos até a frase nova crescer o
 *    bastante pra confirmar que era separada mesmo.
 *  - caso contrário → fecha o texto confirmado (ponto ou interrogação,
 *    conforme question-detector.ts) e começa o segmento novo com
 *    maiúscula.
 *
 * Cada chamada fecha PROVISORIAMENTE o resultado com "." — se o PRÓXIMO
 * segmento vier com conectivo (ou a frase anterior tiver final capenga
 * dentro do limite de reanálise), essa pontuação provisória é desfeita e a
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
    const cased = applyCasingForPosition(normalizedSegment, true);
    const closed = closeSentence(cased, profile);
    const text = applyPorQueToClosedText(cased, closed, profile);
    return { text, candidateType: text.endsWith("?") ? "question" : "period", isQuestion: text.endsWith("?") };
  }

  const boundary = detectSentenceBoundary(trimmedConfirmed, normalizedSegment, profile);

  let extended: string;
  let candidateType: PunctuationCandidateType;
  if (boundary.connector) {
    const reopened = stripTrailingPunctuation(trimmedConfirmed);
    extended = `${reopened}${boundary.connector.punctuation} ${applyCasingForPosition(normalizedSegment, false)}`;
    candidateType = "comma";
  } else if (boundary.forcedByDanglingEnd) {
    // Sem vírgula de propósito (diferente do ramo do conectivo acima) — não
    // é uma oração nova emendada na anterior, é a MESMA oração que a pausa
    // cortou no meio; "vou ligar para" + "o cliente amanhã" vira "vou ligar
    // para o cliente amanhã", nunca "vou ligar para, o cliente amanhã".
    const reopened = stripTrailingPunctuation(trimmedConfirmed);
    extended = `${reopened} ${applyCasingForPosition(normalizedSegment, false)}`;
    candidateType = "none";
  } else {
    extended = `${trimmedConfirmed} ${applyCasingForPosition(normalizedSegment, true)}`;
    candidateType = "period";
  }

  const closed = closeSentence(extended, profile);
  const text = applyPorQueToClosedText(extended, closed, profile);
  const isQuestion = text.endsWith("?");
  return { text, candidateType: isQuestion ? "question" : candidateType, isQuestion };
}
