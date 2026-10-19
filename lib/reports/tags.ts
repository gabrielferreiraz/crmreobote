/**
 * Filtro de TAGS dos relatórios — o parâmetro de URL é `tag` REPETIDO
 * (?tag=Lead&tag=Cliente), nunca uma lista separada por vírgula: tag é texto
 * livre e existem de verdade tags como "DAXUS | IA11 #32" ou
 * "Chikabum - Clientes" (qualquer separador escolhido apareceria dentro de
 * alguma). Sem dependência de servidor — a página, a API do "Ver negócios" e
 * os componentes de filtro usam as mesmas regras.
 *
 * Semântica: o negócio entra se o CONTATO dele tem QUALQUER UMA das tags
 * escolhidas (Contact.tags é um array livre, sem tabela própria — ver
 * schema). Comparação exata, igual ao filtro de Tag de Clientes.
 */

/** Teto de tags escolhidas ao mesmo tempo — acima disso o filtro deixa de ser "filtro". */
export const MAX_REPORT_TAGS = 10;
const MAX_TAG_LENGTH = 80;

type SearchParamValue = string | string[] | undefined | null;

/** Valores da URL → lista limpa: sem vazio, sem repetido, no máximo MAX_REPORT_TAGS. */
export function normalizeReportTags(raw: SearchParamValue | SearchParamValue[]): string[] {
  const flat = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const seen = new Set<string>();
  for (const value of flat) {
    if (typeof value !== "string") continue;
    const tag = value.trim().slice(0, MAX_TAG_LENGTH);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_REPORT_TAGS) break;
  }
  return Array.from(seen);
}

/** Pedaço de `where` de Deal: "o contato tem alguma dessas tags". Vazio quando não há filtro. */
export function dealTagWhere(tags: string[]): { contact?: { tags: { hasSome: string[] } } } {
  return tags.length > 0 ? { contact: { tags: { hasSome: tags } } } : {};
}
