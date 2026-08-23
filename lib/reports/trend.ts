/**
 * Bucketing de gráfico de evolução (dia a dia ou mês a mês, calendário de
 * Brasília) — reaproveitado pelo relatório Comercial
 * (lib/reports/commercial-data.ts) e pelo relatório do Administrativo
 * (relatorios/admin-reports-view.tsx). Os dois calculavam essa mesma lógica
 * em separado antes (inclusive o mesmo comentário explicando o bug do
 * "balde extra" copiado quase palavra por palavra nos dois lugares) — uma
 * correção feita num não se propagava pro outro.
 */

import { brazilStartOfDay, brazilStartOfMonth, getBrazilParts } from "@/lib/timezone";

export type MonthBucket = { year: number; month: number; label: string; tooltipLabel: string; value: number };
export type DayOrMonthBucket = MonthBucket & { day?: number };

/**
 * trendEnd = fim do período escolhido (ou agora, sem filtro); trendStart =
 * início do período escolhido, ou `monthsBack` meses (calendário de
 * Brasília) antes de trendEnd quando não há filtro — evita que "Tudo" vire
 * um gráfico com anos de histórico espremidos e ilegíveis.
 */
export function defaultTrendWindow(
  rangeFrom: Date | null,
  rangeTo: Date | null,
  monthsBack = 5,
): { trendStart: Date; trendEnd: Date } {
  const trendEnd = rangeTo ?? new Date();
  const trendStart =
    rangeFrom ??
    (() => {
      // Dia 1 do mês (em Brasília) `monthsBack` meses antes do fim da janela
      // — como o resultado de brazilStartOfMonth já é sempre dia 1 (sem
      // ambiguidade de "dia inexistente" ao subtrair mês), dá pra usar
      // setUTCMonth direto, sem reintroduzir o problema de fuso.
      const d = brazilStartOfMonth(trendEnd);
      d.setUTCMonth(d.getUTCMonth() - monthsBack);
      return d;
    })();
  return { trendStart, trendEnd };
}

/** Um balde por mês (calendário de Brasília) entre trendStart e trendEnd, inclusive dos dois extremos. */
export function buildMonthlyBuckets(trendStart: Date, trendEnd: Date): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const startParts = getBrazilParts(trendStart);
  const endParts = getBrazilParts(trendEnd);
  let year = startParts.year;
  let month = startParts.month;
  while (year < endParts.year || (year === endParts.year && month <= endParts.month)) {
    const labelDate = new Date(Date.UTC(year, month, 1));
    buckets.push({
      year,
      month,
      label: labelDate.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }),
      tooltipLabel: labelDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
      value: 0,
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return buckets;
}

/** Quantos dias de calendário (Brasília) cabem entre trendStart e trendEnd,
 * inclusive dos dois extremos — ver comentário em buildDailyBuckets sobre o
 * porquê de usar brazilStartOfDay(trendEnd) em vez de trendEnd cru. */
function countTrendSpanDays(trendStart: Date, trendEnd: Date): number {
  return Math.max(0, Math.round((brazilStartOfDay(trendEnd).getTime() - trendStart.getTime()) / 86_400_000));
}

/**
 * Um balde por DIA, incondicional — cada dia de calendário entre trendStart
 * e trendEnd, inclusive dos dois extremos.
 *
 * trendEnd pode ser fim de dia (23:59:59.999, ver brazilEndOfDayUTC em
 * lib/timezone.ts) — usar ele cru pra contar dias contaria quase um dia
 * inteiro a mais do que os dias de calendário reais do período (ex.: "Este
 * mês" em julho batia 31 em vez de 30, e o array final saía com 32 baldes
 * pra um mês de 31 dias — o balde extra, 1º de agosto, sempre ficava zerado
 * e aparecia como o ÚLTIMO ponto do gráfico, parecendo uma queda pra zero
 * fora do período de verdade). brazilStartOfDay normaliza pro início do dia
 * de trendEnd antes de contar a diferença, então o resultado já é a
 * contagem exata de dias de calendário entre início de trendStart e início
 * do dia de trendEnd — o "+1" abaixo (fencepost, inclusivo dos dois
 * extremos) só precisa ser aplicado uma vez.
 */
export function buildDailyBuckets(trendStart: Date, trendEnd: Date): DayOrMonthBucket[] {
  const trendSpanDays = countTrendSpanDays(trendStart, trendEnd);
  // Todo agrupamento por dia abaixo usa o calendário de Brasília
  // (getBrazilParts), não os getters locais do servidor (UTC) — senão um
  // evento depois das 21h de Brasília "vaza" pro dia seguinte no gráfico.
  // trendStart já é um instante alinhado à meia-noite de Brasília
  // (brazilDateStringToUTC/brazilStartOfMonth), então somar múltiplos de
  // 24h nele sempre cai em outra meia-noite de Brasília (sem horário de
  // verão no Brasil desde 2019, o offset é fixo).
  return Array.from({ length: trendSpanDays + 1 }, (_, i) => {
    const instant = new Date(trendStart.getTime() + i * 86_400_000);
    const { year, month, day } = getBrazilParts(instant);
    const showLabel = i === 0 || i === trendSpanDays || i % 7 === 0;
    const labelDate = new Date(Date.UTC(year, month, day));
    return {
      year,
      month,
      day,
      label: showLabel ? labelDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }) : "",
      // Sempre a data cheia, mesmo nos dias em que o eixo fica sem legenda
      // (só um a cada 7 imprime `label`, senão o eixo vira poluição visual)
      // — o tooltip do gráfico precisa saber de qual dia é o ponto de
      // qualquer forma, independente do que aparece embaixo do gráfico.
      tooltipLabel: labelDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }),
      value: 0,
    };
  });
}

/** Um balde por DIA se o período cabe uns 30 pontos legíveis (<=31 dias de
 * calendário), senão cai pra um balde por MÊS (ver buildMonthlyBuckets). */
export function buildDailyOrMonthlyBuckets(
  trendStart: Date,
  trendEnd: Date,
): { buckets: DayOrMonthBucket[]; bucketDaily: boolean; trendSpanDays: number } {
  const trendSpanDays = countTrendSpanDays(trendStart, trendEnd);
  const bucketDaily = trendSpanDays <= 31;
  const buckets = bucketDaily ? buildDailyBuckets(trendStart, trendEnd) : buildMonthlyBuckets(trendStart, trendEnd);
  return { buckets, bucketDaily, trendSpanDays };
}

/** Acha o balde de `buckets` (diário ou mensal) que contém a data já quebrada em partes de Brasília. */
export function findBucket<T extends { year: number; month: number; day?: number }>(
  buckets: T[],
  bucketDaily: boolean,
  parts: { year: number; month: number; day: number },
): T | undefined {
  return bucketDaily
    ? buckets.find((b) => b.year === parts.year && b.month === parts.month && b.day === parts.day)
    : buckets.find((b) => b.year === parts.year && b.month === parts.month);
}

/** Mesma lógica de findBucket, mas devolvendo o índice — usado quando o balde precisa ser mutado por índice num array clonado (ver teamActivityTrend em lib/reports/commercial-data.ts). */
export function findBucketIndex<T extends { year: number; month: number; day?: number }>(
  buckets: T[],
  bucketDaily: boolean,
  parts: { year: number; month: number; day: number },
): number {
  return bucketDaily
    ? buckets.findIndex((b) => b.year === parts.year && b.month === parts.month && b.day === parts.day)
    : buckets.findIndex((b) => b.year === parts.year && b.month === parts.month);
}
