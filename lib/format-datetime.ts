/**
 * Data e hora no horário de Campo Grande/MS (America/Campo_Grande), igual no
 * servidor (UTC) e no navegador — sem isso a hora mostrada muda conforme onde a
 * tela foi desenhada. Ver lib/timezone.ts.
 */

const TZ = "America/Campo_Grande";

const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "10/11/2026" */
export function formatDateBR(value: string | Date): string {
  return dateFmt.format(new Date(value));
}

/** "14:32" */
export function formatTimeBR(value: string | Date): string {
  return timeFmt.format(new Date(value));
}

/** "10/11/2026 às 14:32" */
export function formatDateTimeBR(value: string | Date): string {
  return `${formatDateBR(value)} às ${formatTimeBR(value)}`;
}

/** Duração em português curto: "15 min", "3 h 20 min", "2 dias". Negativo vira 0. */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 dia" : `${days} dias`;
}
