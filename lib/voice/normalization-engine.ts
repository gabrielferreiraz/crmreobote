import { applyVocabulary } from "./vocabulary";

/**
 * Primeira etapa sobre um segmento final CRU (exatamente como a
 * SpeechEngine reconheceu — minúsculo, sem pontuação, sem hífen em termo
 * composto). Só limpeza e vocabulário — de propósito NÃO capitaliza e NÃO
 * pontua aqui: quem decide maiúscula/minúscula da 1ª letra é
 * punctuation-engine.ts's `applyCasingForPosition`, que SEMPRE resolve a
 * casing certa por conta própria (início de frase → maiúscula, continuação
 * de vírgula → minúscula) não importa o que chegue aqui — capitalizar
 * também aqui não quebraria nada (seria só redundante, a decisão de lá
 * prevalece de qualquer jeito), mas espalharia a mesma responsabilidade em
 * 2 lugares à toa. Também NUNCA reescreve número (ver number-normalizer.ts
 * — uso deliberadamente conservador em prosa, "duzentos mil" continua
 * "duzentos mil"). Sem parâmetro de idioma de propósito — vocabulary.ts
 * hoje é language-agnostic (termos em inglês usados DENTRO de frase em
 * português ou inglês, a normalização é a mesma nos dois casos); se um
 * idioma futuro precisar de vocabulário próprio, adicionar o parâmetro
 * aqui é uma mudança pequena e local.
 */
export function normalizeSegment(rawText: string): string {
  const collapsed = rawText.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  return applyVocabulary(collapsed);
}
