/**
 * Converte texto de planilha em número — decide o separador decimal pela
 * ÚLTIMA ocorrência entre "," e "." em vez de assumir vírgula sempre. Sem
 * isso, "R$ 1.234,56" (formato padrão de moeda em pt-BR, o mesmo que
 * formatCurrency usa pra EXIBIR) virava "1.234.56" → NaN — o valor sumia em
 * silêncio em qualquer importação com separador de milhar.
 */
export function parseBrazilianCurrency(raw: string): number | undefined {
  const stripped = raw.replace(/[^\d,.-]/g, "").trim();
  if (!stripped) return undefined;

  const hasComma = stripped.includes(",");
  const hasDot = stripped.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    normalized =
      stripped.lastIndexOf(",") > stripped.lastIndexOf(".")
        ? stripped.replace(/\./g, "").replace(",", ".")
        : stripped.replace(/,/g, "");
  } else if (hasComma) {
    normalized = stripped.replace(",", ".");
  } else if (hasDot) {
    const parts = stripped.split(".");
    const looksLikeThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = looksLikeThousands ? stripped.replace(/\./g, "") : stripped;
  } else {
    normalized = stripped;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
