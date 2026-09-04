/**
 * O servidor roda em UTC (padrão em container Docker) — qualquer
 * `new Date().getHours()/getDay()/getDate()` direto dá a hora de Londres,
 * não a de Campo Grande/MS, onde a operação de verdade fica (4h de
 * diferença). Isso já causou bug real: a saudação "Bom dia"/"Boa tarde"
 * errada, e a automação de horário fixo (SCHEDULED) disparando mais cedo
 * do que o configurado. Sempre usar as funções abaixo em vez dos getters
 * nativos quando o resultado depender de "que horas são agora" ou "que dia
 * é hoje".
 *
 * Importante: NÃO é "America/Sao_Paulo" (UTC-3) — Mato Grosso do Sul fica
 * em "America/Campo_Grande" (UTC-4), um fuso diferente do de São Paulo
 * mesmo os dois sendo "horário do Brasil". Usar Sao_Paulo aqui deixava tudo
 * 1h adiantado (relógio da TV, virada de dia/mês/ano, janela de campanha).
 * Nenhum dos dois observa horário de verão desde a extinção nacional em 2019
 * — os offsets abaixo (Date.UTC com hora fixa) são seguros o ano inteiro.
 */

const BRAZIL_TZ = "America/Campo_Grande";
/** Offset fixo de America/Campo_Grande em relação a UTC (sem horário de verão desde 2019). */
export const BRAZIL_UTC_OFFSET_HOURS = 4;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getBrazilParts(date: Date) {
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
    month: Number(get("month")) - 1,
    day: Number(get("day")),
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

export function brazilStartOfMonth(date: Date = new Date()): Date {
  const { year, month } = getBrazilParts(date);
  return new Date(Date.UTC(year, month, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

/** Meia-noite de hoje, no calendário local. */
export function brazilStartOfDay(date: Date = new Date()): Date {
  const { year, month, day } = getBrazilParts(date);
  return new Date(Date.UTC(year, month, day, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

/** Alias para brazilStartOfDay() — compatível com o sistema de dicas. */
export function startOfDay(date: Date = new Date()): Date {
  return brazilStartOfDay(date);
}

/** Horário atual como Date, com getHours() retornando a hora em Campo Grande/MS. */
export function brazilNow(): Date {
  const parts = getBrazilParts(new Date());
  return new Date(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  );
}

export function brazilStartOfYear(date: Date = new Date()): Date {
  const { year } = getBrazilParts(date);
  return new Date(Date.UTC(year, 0, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

export function brazilDateStringToUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

export function brazilEndOfDayUTC(dateStr: string): Date {
  return new Date(brazilDateStringToUTC(dateStr).getTime() + 86_400_000 - 1);
}

export function brazilDateStringWithNowTimeToUTC(dateStr: string, now: Date = new Date()): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const { hour, minute } = getBrazilParts(now);
  return new Date(
    Date.UTC(year, month - 1, day, hour + BRAZIL_UTC_OFFSET_HOURS, minute, now.getUTCSeconds(), now.getUTCMilliseconds()),
  );
}

export function brazilDateTimeStringToUTC(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + BRAZIL_UTC_OFFSET_HOURS, minute, 0, 0));
}

export function parseBrazilDateTime(raw: string): Date {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) return new Date(raw);
  const [datePart, timePart] = raw.split("T");
  if (!datePart || !timePart) return new Date(raw);
  const [hour, minute] = timePart.split(":");
  return brazilDateTimeStringToUTC(datePart, `${hour}:${minute}`);
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: BRAZIL_TZ,
});

export function brazilDateTime(date: Date): string {
  return DATE_TIME_FORMATTER.format(date);
}
