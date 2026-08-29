import type { VocabularyTerm } from "./types";

/**
 * Vocabulário contextual de CRM/vendas/marketing — o vendedor mistura termo
 * em inglês no meio da fala em português ("vou fazer o follow-up desse
 * lead", "precisamos revisar o budget da campanha") e a Web Speech API
 * transcreve isso de jeitos inconsistentes (com/sem hífen, junto/separado,
 * minúsculo). Aqui só NORMALIZA forma/hífen/caixa de um termo já
 * reconhecido — nunca traduz, nunca troca por sinônimo em português (pedido
 * explícito: "lead" não vira "líder", "budget" não vira "orçamento").
 *
 * Aplicado com fronteira de palavra (`\b`) sempre — nunca substring cega
 * (ver applyVocabulary), pra "crm" dentro de outra palavra não disparar.
 */
const TERMS: VocabularyTerm[] = [
  { preferred: "CRM", aliases: ["crm"], protectedFromCasing: true },
  { preferred: "follow-up", aliases: ["follow up", "followup"] },
  { preferred: "lead", aliases: ["leed"] },
  { preferred: "leads", aliases: ["leeds"] },
  { preferred: "remarketing", aliases: ["re-marketing"] },
  { preferred: "rapport", aliases: [] },
  { preferred: "budget", aliases: [] },
  { preferred: "pipeline", aliases: [] },
  { preferred: "feedback", aliases: ["feed back"] },
  { preferred: "branding", aliases: [] },
  { preferred: "briefing", aliases: ["brienfing"] },
  { preferred: "meeting", aliases: [] },
  { preferred: "copy", aliases: [] },
  { preferred: "target", aliases: [] },
  { preferred: "performance", aliases: [] },
  { preferred: "insight", aliases: [] },
  { preferred: "deadline", aliases: ["dead line"] },
  { preferred: "prospect", aliases: [] },
  { preferred: "SDR", aliases: ["sdr", "esse dê erre"], protectedFromCasing: true },
  { preferred: "closer", aliases: [] },
  { preferred: "ticket", aliases: [] },
  { preferred: "conversão", aliases: [] },
  { preferred: "campanha", aliases: [] },
  { preferred: "CAC", aliases: ["cac"], protectedFromCasing: true },
  { preferred: "LTV", aliases: ["ltv"], protectedFromCasing: true },
  { preferred: "ROI", aliases: ["roi"], protectedFromCasing: true },
  { preferred: "ROAS", aliases: ["roas"], protectedFromCasing: true },
  { preferred: "WhatsApp", aliases: ["whatsapp", "whats app"], protectedFromCasing: true },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chave de busca no mapa forma→preferida — minúsculo, hífen/espaço
 * colapsados num separador só, pra "follow-up"/"follow up"/"followup"
 * caírem na MESMA entrada não importa como o trecho casado veio escrito. */
function normalizeForLookup(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, " ").trim();
}

// forma normalizada → forma preferida do termo. Um mapa só (não N regex
// soltas, uma por forma) é o que faz applyVocabulary ficar O(tamanho do
// texto) e não O(nº de termos × tamanho do texto) — importa conforme o
// vocabulário cresce (pensado pra eventualmente ser customizável por
// organização, não só esta lista fixa).
const FORM_TO_PREFERRED = new Map<string, string>();
for (const term of TERMS) {
  for (const form of [term.preferred, ...term.aliases]) {
    FORM_TO_PREFERRED.set(normalizeForLookup(form), term.preferred);
  }
}

// Todas as formas (preferida + aliases) de todo termo, numa alternância SÓ
// — ordenadas da mais longa pra mais curta (importa: numa alternância `|`,
// o regex tenta cada opção da ESQUERDA pra direita na mesma posição e para
// na primeira que casar, então "follow up" precisa vir antes de qualquer
// opção mais curta que também casasse ali). `[\s-]?` entre palavras de uma
// forma composta cobre junto/separado/hifenizado com uma entrada só.
const ALL_FORMS = Array.from(new Set(TERMS.flatMap((t) => [t.preferred, ...t.aliases]))).sort(
  (a, b) => b.length - a.length,
);
const VOCABULARY_REGEX = new RegExp(
  `\\b(?:${ALL_FORMS.map((form) => form.split(/\s+/).map(escapeRegExp).join("[\\s-]?")).join("|")})\\b`,
  "gi",
);

/** Termos que outras heurísticas (ex.: capitalização de início de frase) não devem re-capitalizar por conta própria. */
export const PROTECTED_CASING_TERMS = new Set(
  TERMS.filter((t) => t.protectedFromCasing).map((t) => t.preferred.toLowerCase()),
);

/**
 * Substitui cada alias reconhecido pela forma preferida, sempre por
 * fronteira de palavra — "vou fazer o follow up desse lead" →
 * "vou fazer o follow-up desse lead". Não mexe em nada fora da lista de
 * termos: o resto do texto sai IDÊNTICO ao que entrou. Uma passada só pelo
 * texto (`VOCABULARY_REGEX.replace`, não um loop de N `.replace()` — ver
 * comentário acima), então o custo não cresce com o tamanho do vocabulário.
 */
export function applyVocabulary(text: string): string {
  return text.replace(VOCABULARY_REGEX, (match) => FORM_TO_PREFERRED.get(normalizeForLookup(match)) ?? match);
}
