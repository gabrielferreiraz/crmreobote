/**
 * Comparação de período do relatório Comercial — "Comparar período" (ver
 * compare-period-filter.tsx). Os 4 modos e seus significados EXATOS foram
 * confirmados um a um com o usuário antes de escrever qualquer código (a
 * pior coisa que uma comparação de números pode fazer é estar sutilmente
 * errada e ninguém perceber):
 *
 *   • "mirror" (Mesmo período) — período anterior de MESMA DURAÇÃO,
 *     espelhado pra trás. Ex.: atual 01/08–31/08 (31 dias) → compara com
 *     01/07–31/07 (31 dias imediatamente antes). Atual custom de 10 dias
 *     (20/08–29/08) → compara com 10/08–19/08.
 *   • "month" (Mês) — mês CIVIL anterior inteiro, sempre, independente da
 *     duração do período atual. Ex.: atual em Agosto/2026 (qualquer
 *     intervalo dentro desse mês) → compara com Julho/2026 inteiro
 *     (01/07–31/07), nunca "espelhado" pela duração do período atual.
 *   • "last3" (Últimos 3 meses) — os 3 meses CIVIS imediatamente antes do
 *     mês do início do período atual, somados como UM bloco só. Ex.: atual
 *     em Agosto/2026 → compara com Maio+Junho+Julho/2026 juntos
 *     (01/05–31/07).
 *   • "year" (Ano) — mesmas datas exatas, exatamente 1 ano atrás. Ex.: atual
 *     01/08/2026–31/08/2026 → compara com 01/08/2025–31/08/2025. 29/fev sem
 *     correspondente no ano anterior cai em 28/fev (nunca "transborda" pra
 *     1/mar).
 *   • "custom" (Personalizado) — datas escolhidas à mão no calendário (ver
 *     ?compareFrom=&compareTo= em compare-period-filter.tsx), sem NENHUMA
 *     relação matemática com o período atual — é literalmente o intervalo
 *     que a pessoa marcou. Datas ausentes/inválidas/invertidas (from > to)
 *     resolvem pra null (comparação fica desligada, silenciosamente, nunca
 *     um resultado inventado ou um intervalo virado do avesso).
 *
 * Todo cálculo é no calendário de Brasília (Campo Grande/MS, ver
 * lib/timezone.ts) — os mesmos limites de dia/mês que o resto do relatório
 * já usa pro período principal.
 */

import { BRAZIL_UTC_OFFSET_HOURS, getBrazilParts, brazilDateStringToUTC, brazilEndOfDayUTC } from "@/lib/timezone";

export type CompareMode = "mirror" | "month" | "last3" | "year" | "custom";

/** Ordem = ordem de exibição no seletor (ver compare-period-filter.tsx). */
export const COMPARE_MODES: { key: CompareMode; label: string }[] = [
  { key: "mirror", label: "Mesmo período" },
  { key: "month", label: "Mês" },
  { key: "last3", label: "Últimos 3 meses" },
  { key: "year", label: "Ano" },
  { key: "custom", label: "Personalizado" },
];

export function isCompareMode(value: string | undefined | null): value is CompareMode {
  return COMPARE_MODES.some((m) => m.key === value);
}

export type ComparePeriod = { from: Date; to: Date; rangeLabel: string };

/** Meia-noite local (Brasília) do dia 1 de um mês — `month` pode vir fora de
 * 0-11 de propósito (ex.: -1, 13): Date.UTC normaliza overflow sozinho
 * (mês -1 vira dezembro do ano anterior), então subtrair/somar meses de um
 * índice absoluto (ver `addMonths` abaixo) nunca precisa de lógica de
 * "vira o ano" separada. */
function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, BRAZIL_UTC_OFFSET_HOURS, 0, 0, 0));
}

/** Fim do dia (23:59:59.999 local) do ÚLTIMO dia de um mês — início do mês seguinte menos 1ms. */
function monthEnd(year: number, month: number): Date {
  return new Date(monthStart(year, month + 1).getTime() - 1);
}

/** `date` (já um instante UTC alinhado a meia-noite ou fim-de-dia local, ver
 * brazilDateStringToUTC/brazilEndOfDayUTC) deslocado em `years` anos,
 * preservando dia/mês/hora locais — 29/fev sem correspondente no ano de
 * destino cai em 28/fev (o dia válido mais próximo), nunca transborda pro
 * mês seguinte como `Date.setUTCFullYear` faria sozinho nesse caso. */
function shiftYears(date: Date, years: number): Date {
  const { year, month, day, hour, minute } = getBrazilParts(date);
  const targetYear = year + years;
  // Último dia do mês de destino (truque de overflow: dia 0 do mês seguinte
  // = último dia do mês atual) — cobre fev bissexto vs. não-bissexto.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, daysInTargetMonth);
  return new Date(
    Date.UTC(targetYear, month, safeDay, hour + BRAZIL_UTC_OFFSET_HOURS, minute, date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

// `date` aqui é um INSTANTE de verdade (com o offset de +4h de Campo Grande
// já embutido, ver monthStart/shiftYears acima) — diferente do truque de
// "UTC-meia-noite como carimbo de rótulo" que lib/reports/trend.ts usa (lá o
// Date É construído sem offset nenhum de propósito, só pra carregar
// ano/mês/dia). Formatar ESTE instante direto com timeZone:"UTC" leria o dia
// civil de Londres, não o de Campo Grande — pra um `to` de fim-de-dia
// (23:59:59.999 local), isso lia 1 dia A MAIS (ex.: 31/07 23:59:59 local ==
// 01/08 03:59:59 UTC, formatar em UTC direto mostrava "01/08" em vez de
// "31/07"). getBrazilParts primeiro extrai o dia civil CERTO, só então monta
// o carimbo pra formatar.
function toLabelCarrier(date: Date): Date {
  const { year, month, day } = getBrazilParts(date);
  return new Date(Date.UTC(year, month, day));
}
function shortDate(date: Date): string {
  return toLabelCarrier(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
function fullDate(date: Date): string {
  return toLabelCarrier(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

/** "01/07 – 31/07/2026" (mesmo ano, ano só no fim), "01/12/2025 – 31/01/2026"
 * (anos diferentes, ano nos dois lados — nunca ambíguo sobre qual ano cada
 * ponta é), ou só "28/02/2027" quando from/to caem no MESMO dia civil (ex.:
 * comparação de um único dia) — evitar repetir a mesma data duas vezes com
 * um travessão no meio. */
function rangeLabel(from: Date, to: Date): string {
  const fromParts = getBrazilParts(from);
  const toParts = getBrazilParts(to);
  const sameDay = fromParts.year === toParts.year && fromParts.month === toParts.month && fromParts.day === toParts.day;
  if (sameDay) return fullDate(to);
  return fromParts.year === toParts.year ? `${shortDate(from)} – ${fullDate(to)}` : `${fullDate(from)} – ${fullDate(to)}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve o período de comparação pro modo escolhido, a partir do período
 * ATUAL do relatório (rangeFrom/rangeTo — os mesmos limites já calculados
 * pelo filtro de data principal, ver lib/reports/trend.ts/commercial-data.ts).
 * `rangeFrom`/`rangeTo` precisam ser não-nulos (comparação não se aplica a
 * "Tudo" — ver getCommercialReportData, que só chama isto quando os dois
 * existem).
 *
 * `customRange` só é usado (e só precisa vir preenchido) quando `mode ===
 * "custom"` — "YYYY-MM-DD" no calendário de Brasília, mesmo formato que
 * ?from=&to= já usam pro período principal (ver date-range-filter.tsx).
 * Retorna null pra "custom" sem os dois dias válidos, ou com from depois de
 * to — nunca inventa um período nem inverte a ordem sozinho.
 */
export function resolveComparePeriod(
  mode: CompareMode,
  rangeFrom: Date,
  rangeTo: Date,
  customRange?: { from?: string; to?: string } | null,
): ComparePeriod | null {
  if (mode === "custom") {
    const fromStr = customRange?.from;
    const toStr = customRange?.to;
    if (!fromStr || !toStr || !ISO_DATE_RE.test(fromStr) || !ISO_DATE_RE.test(toStr)) return null;
    const from = brazilDateStringToUTC(fromStr);
    const to = brazilEndOfDayUTC(toStr);
    if (from.getTime() > to.getTime()) return null;
    return { from, to, rangeLabel: rangeLabel(from, to) };
  }

  if (mode === "mirror") {
    const spanMs = rangeTo.getTime() - rangeFrom.getTime();
    const from = new Date(rangeFrom.getTime() - spanMs - 1);
    const to = new Date(rangeFrom.getTime() - 1);
    return { from, to, rangeLabel: rangeLabel(from, to) };
  }

  if (mode === "year") {
    const from = shiftYears(rangeFrom, -1);
    const to = shiftYears(rangeTo, -1);
    return { from, to, rangeLabel: rangeLabel(from, to) };
  }

  // "month" e "last3" são âncorados no MÊS CIVIL do início do período atual
  // (não na duração dele) — um índice absoluto de mês (ano*12+mês) deixa
  // "subtrair N meses" uma soma inteira só, sem `if (mês < 0) { mês += 12;
  // ano -= 1 }` espalhado.
  const { year: startYear, month: startMonth } = getBrazilParts(rangeFrom);
  const currentMonthIndex = startYear * 12 + startMonth;
  const indexToParts = (idx: number) => ({ year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 });

  if (mode === "month") {
    const { year, month } = indexToParts(currentMonthIndex - 1);
    const from = monthStart(year, month);
    const to = monthEnd(year, month);
    return { from, to, rangeLabel: rangeLabel(from, to) };
  }

  // "last3"
  const startParts = indexToParts(currentMonthIndex - 3);
  const endParts = indexToParts(currentMonthIndex - 1);
  const from = monthStart(startParts.year, startParts.month);
  const to = monthEnd(endParts.year, endParts.month);
  return { from, to, rangeLabel: rangeLabel(from, to) };
}
