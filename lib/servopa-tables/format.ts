/**
 * Formatação pt-BR das tabelas Servopa a partir dos decimais em texto
 * ("1075.69") — sem passar por float: o que o site mostra é a verdade, e a
 * tela/PDF têm de mostrar os mesmos centavos.
 */

function group3(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "1075.69" → "R$ 1.075,69". */
export function formatBRL(value: string): string {
  const [int, dec = "00"] = value.split(".");
  return `R$ ${group3(int)},${dec.padEnd(2, "0").slice(0, 2)}`;
}

/** "0.9458" → "0,9458%"; com `trim`, "13.0000" → "13%" e "9.9000" → "9,9%". */
export function formatPercent(value: string, opts: { trim?: boolean } = {}): string {
  const [int, dec = ""] = value.split(".");
  let d = dec;
  if (opts.trim) d = d.replace(/0+$/, "");
  return `${int}${d ? `,${d}` : ""}%`;
}

/** Data em Brasília: "23/11/2026". */
export function formatDateBR(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export const SEGMENT_LABEL = { REAL_ESTATE: "Imóvel", MOVABLE: "Móvel" } as const;
