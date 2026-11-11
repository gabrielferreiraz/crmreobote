/**
 * Valores repetidos de `who` na URL dos relatórios comerciais.
 *
 * Equipes e consultores compartilham o mesmo parâmetro porque a seleção é
 * uma união: todos os membros das equipes escolhidas mais os consultores
 * escolhidos individualmente. A validação contra o escopo visível continua
 * no servidor, em commercial-data.ts.
 */
export const MAX_REPORT_PEOPLE_FILTERS = 30;

const MAX_FILTER_VALUE_LENGTH = 140;

export function normalizeReportPeople(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const normalized = new Set<string>();

  for (const item of values) {
    if (typeof item !== "string") continue;
    const value = item.trim().slice(0, MAX_FILTER_VALUE_LENGTH);
    if (!value.startsWith("team:") && !value.startsWith("owner:")) continue;
    const separator = value.indexOf(":");
    if (!value.slice(separator + 1).trim()) continue;
    normalized.add(value);
    if (normalized.size >= MAX_REPORT_PEOPLE_FILTERS) break;
  }

  return Array.from(normalized);
}
