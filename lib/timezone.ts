/**
 * O servidor roda em UTC (padrão em container Docker) — qualquer
 * `new Date().getHours()/getDay()/getDate()` direto dá a hora de Londres,
 * não a de Brasília (3h de diferença). Isso já causou bug real: a saudação
 * "Bom dia"/"Boa tarde" errada, e a automação de horário fixo (SCHEDULED)
 * disparando 3h mais cedo do que o configurado. Sempre usar as funções
 * abaixo em vez dos getters nativos quando o resultado depender de "que
 * horas são agora" ou "que dia é hoje" no Brasil.
 */

const BRAZIL_TZ = "America/Sao_Paulo";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getBrazilParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")) - 1, // igual Date.getMonth(): 0-indexado
    day: Number(get("day")),
    // O Intl às vezes devolve "24" pra meia-noite em vez de "00".
    hour: get("hour") === "24" ? 0 : Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

export function brazilHour(date: Date = new Date()): number {
  return getBrazilParts(date).hour;
}

export function brazilWeekday(date: Date = new Date()): number {
  return getBrazilParts(date).weekday;
}

export function brazilDayOfMonth(date: Date = new Date()): number {
  return getBrazilParts(date).day;
}

/** "2026-07-13" no calendário de Brasília — usar em vez de toISOString().slice(0,10), que é UTC. */
export function brazilDateKey(date: Date = new Date()): string {
  const { year, month, day } = getBrazilParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function brazilGreeting(date: Date = new Date()): "Bom dia" | "Boa tarde" | "Boa noite" {
  const hour = brazilHour(date);
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Meia-noite do dia 1 do mês corrente, no calendário de Brasília — meia-noite
 * em Brasília (UTC-3, sem horário de verão desde 2019) é 03:00 UTC do mesmo
 * dia civil. Usar isso em vez de `new Date().setDate(1)`, que nem zera a
 * hora (deixa passar deals fechados de madrugada no dia 1) nem considera que
 * o UTC já pode estar num dia/mês diferente do de Brasília perto da virada.
 */
export function brazilStartOfMonth(date: Date = new Date()): Date {
  const { year, month } = getBrazilParts(date);
  return new Date(Date.UTC(year, month, 1, 3, 0, 0, 0));
}

/** Meia-noite de hoje, no calendário de Brasília — mesma lógica de brazilStartOfMonth, granularidade dia. */
export function brazilStartOfDay(date: Date = new Date()): Date {
  const { year, month, day } = getBrazilParts(date);
  return new Date(Date.UTC(year, month, day, 3, 0, 0, 0));
}
