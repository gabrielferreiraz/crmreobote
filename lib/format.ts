export function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Versão curta pra tiles de KPI (dashboard) — "R$ 1,2 mi" em vez de "R$ 1.234.567,89", pra nunca precisar truncar em telas estreitas. */
export function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (abs >= 100_000) {
    return `R$ ${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  }
  return formatCurrency(value);
}

export function daysSince(date: Date | string, referenceDate: Date = new Date()) {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = referenceDate.getTime() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/** Formata uma duração em ms como "12 min" / "3,5 h" / "2,1 d" — a menor unidade que ainda cabe em 1 dígito antes da vírgula. */
export function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1).replace(".", ",")} h`;
  const days = hours / 24;
  return `${days.toFixed(1).replace(".", ",")} d`;
}
