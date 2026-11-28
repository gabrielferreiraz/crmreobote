import { getBrazilParts } from "@/lib/timezone";

/**
 * "MM/AA - Cliente FONTE". O mês/ano vem do calendário de Campo Grande: o
 * servidor roda em UTC e, com getters locais, o negócio criado no último dia
 * do mês depois das 20h de MS nascia com o mês seguinte no nome.
 */
export function buildDealName(contactName: string, source?: string | null) {
  const { year, month } = getBrazilParts(new Date());
  const mm = String(month + 1).padStart(2, "0");
  const yy = String(year).slice(-2);
  const suffix = source ? ` ${source.toUpperCase()}` : "";
  return `${mm}/${yy} - ${contactName}${suffix}`;
}
