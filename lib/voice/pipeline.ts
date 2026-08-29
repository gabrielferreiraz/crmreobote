import type { LanguageProfile } from "./types";
import { normalizeSegment } from "./normalization-engine";
import { applyPunctuation, type PunctuationResult } from "./punctuation-engine";
import { getLanguageProfile } from "./language-profile";

/**
 * Ponto único de troca entre reconhecimento e interpretação — este é o
 * lugar em que, futuramente, uma camada de IA poderia entrar (substituindo
 * só esta função, sem tocar SpeechEngine/VoiceSessionManager/
 * TranscriptEngine, que continuam iguais). Hoje é 100% determinístico:
 * Normalization (vocabulário/limpeza) → Punctuation (que já embute
 * SentenceBoundary + Question por dentro).
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
  const normalized = normalizeSegment(rawFinalText);
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
  const normalized = normalizeSegment(rawFinalText);
  if (!normalized) return null;
  return applyPunctuation(prevCommitted, normalized, profile);
}

export type { LanguageProfile };
