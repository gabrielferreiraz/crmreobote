import type { LanguageProfile } from "./types";
import { normalizeSegment } from "./normalization-engine";
import { applyWordChoiceCorrections } from "./word-choice-correction";
import { insertMidSentenceCommas } from "./mid-sentence-comma";
import { applyPunctuation, type PunctuationResult } from "./punctuation-engine";
import { getLanguageProfile } from "./language-profile";

/**
 * Ponto único de troca entre reconhecimento e interpretação — este é o
 * lugar em que, futuramente, uma camada de IA poderia entrar (substituindo
 * só esta função, sem tocar SpeechEngine/VoiceSessionManager/
 * TranscriptEngine, que continuam iguais). Hoje é 100% determinístico, em 4
 * estágios sobre o segmento CRU antes de virar texto confirmado:
 *
 *  1. Normalization (vocabulário/limpeza — normalization-engine.ts).
 *  2. Word-choice correction (esta/está, a/há — word-choice-correction.ts):
 *     escolha entre palavras que soam quase igual mas têm grafia diferente.
 *  3. Mid-sentence comma (mid-sentence-comma.ts): vírgula em conectivo que
 *     apareceu no MEIO do segmento, sem pausa nenhuma ali.
 *  4. Punctuation (punctuation-engine.ts): decide fronteira de frase, junta
 *     com o texto confirmado, fecha com "."/"?" e resolve "por que"/"porque"
 *     na oração que acabou de fechar (por-que-correction.ts, embutido ali).
 *
 * `prevCommitted` é o texto já confirmado (pode já ter pontuação própria);
 * `rawFinalText` é a frase CRUA que a SpeechEngine acabou de reconhecer
 * (sem processamento nenhum). Devolve o novo texto confirmado inteiro.
 */
export function processFinalSegment(
  prevCommitted: string,
  rawFinalText: string,
  language: string = "pt-BR",
): string {
  const profile = getLanguageProfile(language);
  const normalized = prepareSegment(rawFinalText, profile);
  if (!normalized) return prevCommitted;
  return applyPunctuation(prevCommitted, normalized, profile).text;
}

/** Variante que também devolve o que foi decidido (usado pelo VoiceMetrics — ver metrics.ts). */
export function processFinalSegmentWithDetail(
  prevCommitted: string,
  rawFinalText: string,
  language: string = "pt-BR",
): PunctuationResult | null {
  const profile = getLanguageProfile(language);
  const normalized = prepareSegment(rawFinalText, profile);
  if (!normalized) return null;
  return applyPunctuation(prevCommitted, normalized, profile);
}

/** Estágios 1–3 (ver docstring acima) — tudo que roda sobre o segmento
 * ISOLADO, antes de decidir como ele se junta ao texto confirmado. */
function prepareSegment(rawFinalText: string, profile: LanguageProfile): string {
  const normalized = normalizeSegment(rawFinalText);
  if (!normalized) return "";
  const withWordChoiceFixed = applyWordChoiceCorrections(normalized, profile);
  return insertMidSentenceCommas(withWordChoiceFixed, profile);
}

export type { LanguageProfile };
