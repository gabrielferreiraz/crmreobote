import { prisma } from "@/lib/prisma";
import { computeDealShares, splitCentsByPercent } from "@/lib/deals/split-shares";
import { brazilDateKey, brazilDateStringToUTC, getBrazilParts } from "@/lib/timezone";
import { runWithTenant } from "@/lib/tenant-context";

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ANNUAL_SCENARIO = 1_000_000_000;

type YearMonth = { year: number; month: number };

export type ExecutiveRankingRow = {
  id: string;
  name: string;
  team: string;
  yearValue: number;
  recentValue: number;
  sales: number;
  activeMonths: number;
};

export type ExecutiveReportData = {
  reportYear: number;
  throughMonth: number;
  throughMonthLabel: string;
  updatedAt: string;
  yearToDate: { value: number; previousValue: number; changePct: number | null };
  rolling12: { value: number; previousValue: number; changePct: number | null };
  sellerAverage: { value: number; previousValue: number; changePct: number | null; sellers: number };
  topTwo: { sharePct: number; names: string[] };
  yearlySeries: { year: number; values: Array<number | null> }[];
  productivity: { month: number; label: string; sellers: number; average: number }[];
  teamMonths: { year: number; month: number; label: string }[];
  teams: { name: string; values: number[]; total: number }[];
  ranking: ExecutiveRankingRow[];
  annualScenario: {
    year: number;
    value: number;
    monthlyRequired: number;
    currentMonthlyPace: number;
    multiplier: number | null;
  };
  clients: { unique: number; repeat: number };
  coverage: {
    wonDeals: number;
    missingValue: number;
    periodWonDeals: number;
    periodMissingValue: number;
    possibleDuplicateGroups: number;
    possibleDuplicateDeals: number;
  };
};

function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function monthStart({ year, month }: YearMonth): Date {
  const normalized = addMonths({ year, month: 0 }, month);
  return brazilDateStringToUTC(`${normalized.year}-${String(normalized.month + 1).padStart(2, "0")}-01`);
}

function monthKey(date: Date): string {
  const { year, month } = getBrazilParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function keyOf({ year, month }: YearMonth): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function decimalToCents(value: { toString(): string } | number | null): number {
  return value == null ? 0 : Math.round(Number(value) * 100);
}

function centsToValue(cents: number): number {
  return cents / 100;
}

function inRange(date: Date, from: Date, to: Date): boolean {
  const value = date.getTime();
  return value >= from.getTime() && value < to.getTime();
}

export async function getExecutiveReportData(organizationId: string): Promise<ExecutiveReportData> {
  return runWithTenant(organizationId, async () => {
    const now = new Date();
    const nowParts = getBrazilParts(now);
    const reportYear = nowParts.month === 0 ? nowParts.year - 1 : nowParts.year;
    const throughMonth = nowParts.month === 0 ? 11 : nowParts.month - 1;
    const completeEnd = monthStart(addMonths({ year: reportYear, month: throughMonth }, 1));
    const currentYearStart = monthStart({ year: reportYear, month: 0 });
    const previousYearStart = monthStart({ year: reportYear - 1, month: 0 });
    const previousComparableEnd = monthStart({ year: reportYear - 1, month: throughMonth + 1 });
    const rolling12Start = monthStart(addMonths({ year: reportYear, month: throughMonth + 1 }, -12));
    const previousRolling12Start = monthStart(addMonths({ year: reportYear, month: throughMonth + 1 }, -24));
    const lastMonthStart = monthStart({ year: reportYear, month: throughMonth });
    const lastMonthPreviousStart = monthStart({ year: reportYear - 1, month: throughMonth });
    const lastMonthPreviousEnd = monthStart({ year: reportYear - 1, month: throughMonth + 1 });
    const recentStart = monthStart(addMonths({ year: reportYear, month: throughMonth + 1 }, -3));
    const chartStart = monthStart({ year: reportYear - 2, month: 0 });

    const [deals, memberships, wonContacts] = await Promise.all([
      prisma.deal.findMany({
        where: {
          organizationId,
          status: "WON",
          closedAt: { gte: chartStart, lt: completeEnd },
        },
        select: {
          ownerId: true,
          contactId: true,
          value: true,
          closedAt: true,
          owner: { select: { name: true } },
          participants: {
            select: {
              userId: true,
              sharePercent: true,
              user: { select: { name: true } },
            },
          },
        },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId },
        select: {
          userId: true,
          team: { select: { name: true } },
          user: { select: { name: true } },
        },
      }),
      prisma.deal.groupBy({
        by: ["contactId"],
        where: { organizationId, status: "WON" },
        _count: { _all: true },
      }),
    ]);

    const membershipByUser = new Map(
      memberships.map((membership) => [
        membership.userId,
        {
          name: membership.user.name,
          team: membership.team?.name ?? "Sem equipe",
        },
      ]),
    );
    const personNames = new Map(memberships.map((membership) => [membership.userId, membership.user.name]));
    // Todo valor monetário permanece em centavos até a borda de saída. Além
    // de evitar ruído de ponto flutuante em somas longas, o rateio por pessoa
    // usa splitCentsByPercent, cuja soma é garantidamente igual ao negócio.
    const companyByMonth = new Map<string, number>();
    const peopleByMonth = new Map<string, Map<string, { valueCents: number; sales: number }>>();
    let missingValue = 0;
    let periodWonDeals = 0;
    let periodMissingValue = 0;
    const possibleDuplicateKeys = new Map<string, number>();

    for (const deal of deals) {
      if (!deal.closedAt) continue;
      const key = monthKey(deal.closedAt);
      const valueCents = decimalToCents(deal.value);
      if (deal.value == null) missingValue += 1;
      if (inRange(deal.closedAt, currentYearStart, completeEnd)) {
        periodWonDeals += 1;
        if (deal.value == null) periodMissingValue += 1;
        if (deal.value != null) {
          const duplicateKey = `${deal.contactId}:${valueCents}:${brazilDateKey(deal.closedAt)}`;
          possibleDuplicateKeys.set(duplicateKey, (possibleDuplicateKeys.get(duplicateKey) ?? 0) + 1);
        }
      }
      companyByMonth.set(key, (companyByMonth.get(key) ?? 0) + valueCents);

      personNames.set(deal.ownerId, deal.owner.name);
      for (const participant of deal.participants) personNames.set(participant.userId, participant.user.name);

      const monthPeople = peopleByMonth.get(key) ?? new Map<string, { valueCents: number; sales: number }>();
      const shares = computeDealShares(deal.ownerId, deal.participants);
      const allocatedCents = splitCentsByPercent(valueCents, shares);
      shares.forEach((share, index) => {
        const current = monthPeople.get(share.userId) ?? { valueCents: 0, sales: 0 };
        current.valueCents += allocatedCents[index];
        current.sales += 1;
        monthPeople.set(share.userId, current);
      });
      peopleByMonth.set(key, monthPeople);
    }

    const sumCompany = (from: Date, to: Date) => {
      let totalCents = 0;
      let cursor = { year: getBrazilParts(from).year, month: getBrazilParts(from).month };
      const end = getBrazilParts(to);
      while (cursor.year < end.year || (cursor.year === end.year && cursor.month < end.month)) {
        totalCents += companyByMonth.get(keyOf(cursor)) ?? 0;
        cursor = addMonths(cursor, 1);
      }
      return totalCents;
    };

    const personTotals = (from: Date, to: Date) => {
      const totals = new Map<string, { valueCents: number; sales: number; months: Set<string> }>();
      let cursor = { year: getBrazilParts(from).year, month: getBrazilParts(from).month };
      const end = getBrazilParts(to);
      while (cursor.year < end.year || (cursor.year === end.year && cursor.month < end.month)) {
        const key = keyOf(cursor);
        for (const [userId, result] of peopleByMonth.get(key) ?? []) {
          const current = totals.get(userId) ?? { valueCents: 0, sales: 0, months: new Set<string>() };
          current.valueCents += result.valueCents;
          current.sales += result.sales;
          current.months.add(key);
          totals.set(userId, current);
        }
        cursor = addMonths(cursor, 1);
      }
      return totals;
    };

    const currentYearCents = sumCompany(currentYearStart, completeEnd);
    const previousYearCents = sumCompany(previousYearStart, previousComparableEnd);
    const rolling12Cents = sumCompany(rolling12Start, completeEnd);
    const previousRolling12Cents = sumCompany(previousRolling12Start, rolling12Start);
    const lastMonthCents = sumCompany(lastMonthStart, completeEnd);
    const lastMonthPreviousCents = sumCompany(lastMonthPreviousStart, lastMonthPreviousEnd);
    const currentYearValue = centsToValue(currentYearCents);
    const previousYearValue = centsToValue(previousYearCents);
    const rolling12Value = centsToValue(rolling12Cents);
    const previousRolling12Value = centsToValue(previousRolling12Cents);
    const lastMonthPeople = personTotals(lastMonthStart, completeEnd);
    const lastMonthPreviousPeople = personTotals(lastMonthPreviousStart, lastMonthPreviousEnd);
    const sellerAverage = lastMonthPeople.size > 0 ? centsToValue(lastMonthCents) / lastMonthPeople.size : 0;
    const previousSellerAverage = lastMonthPreviousPeople.size > 0 ? centsToValue(lastMonthPreviousCents) / lastMonthPreviousPeople.size : 0;

    const yearPeople = personTotals(currentYearStart, completeEnd);
    const recentPeople = personTotals(recentStart, completeEnd);
    const topTwoPeople = Array.from(yearPeople.entries())
      .filter(([, result]) => result.valueCents > 0)
      .sort((a, b) => b[1].valueCents - a[1].valueCents)
      .slice(0, 2);

    const yearlySeries = [reportYear - 2, reportYear - 1, reportYear].map((year) => ({
      year,
      values: Array.from({ length: 12 }, (_, month) => {
        if (year === reportYear && month > throughMonth) return null;
        return centsToValue(companyByMonth.get(keyOf({ year, month })) ?? 0);
      }),
    }));

    const productivity = Array.from({ length: 12 }, (_, month) => {
      const people = peopleByMonth.get(keyOf({ year: reportYear, month })) ?? new Map();
      const valueCents = companyByMonth.get(keyOf({ year: reportYear, month })) ?? 0;
      return {
        month,
        label: MONTH_LABELS[month],
        sellers: month <= throughMonth ? people.size : 0,
        average: month <= throughMonth && people.size > 0 ? centsToValue(valueCents) / people.size : 0,
      };
    }).slice(0, throughMonth + 1);

    const teamMonths = Array.from({ length: 3 }, (_, index) => addMonths({ year: reportYear, month: throughMonth - 2 }, index)).map(
      ({ year, month }) => ({ year, month, label: MONTH_LABELS[month] }),
    );
    const teamMap = new Map<string, number[]>();
    teamMonths.forEach(({ year, month }, index) => {
      for (const [userId, result] of peopleByMonth.get(keyOf({ year, month })) ?? []) {
        const team = membershipByUser.get(userId)?.team ?? "Sem equipe";
        const values = teamMap.get(team) ?? [0, 0, 0];
        values[index] += result.valueCents;
        teamMap.set(team, values);
      }
    });
    const teams = Array.from(teamMap.entries())
      .map(([name, valuesInCents]) => ({
        name,
        values: valuesInCents.map(centsToValue),
        total: centsToValue(valuesInCents.reduce((sum, value) => sum + value, 0)),
      }))
      .filter((team) => team.total > 0)
      .sort((a, b) => b.total - a.total);

    const ranking: ExecutiveRankingRow[] = Array.from(yearPeople.entries())
      .filter(([, result]) => result.sales > 0)
      .map(([userId, result]) => ({
        id: userId,
        name: personNames.get(userId) ?? membershipByUser.get(userId)?.name ?? "Sem nome",
        team: membershipByUser.get(userId)?.team ?? "Sem equipe",
        yearValue: centsToValue(result.valueCents),
        recentValue: centsToValue(recentPeople.get(userId)?.valueCents ?? 0),
        sales: result.sales,
        activeMonths: result.months.size,
      }))
      .sort((a, b) => b.yearValue - a.yearValue || b.sales - a.sales);

    const completedMonths = throughMonth + 1;
    const currentMonthlyPace = completedMonths > 0 ? currentYearValue / completedMonths : 0;
    const monthlyRequired = ANNUAL_SCENARIO / 12;
    const possibleDuplicateCounts = Array.from(possibleDuplicateKeys.values()).filter((count) => count > 1);

    return {
      reportYear,
      throughMonth,
      throughMonthLabel: MONTH_LABELS[throughMonth],
      updatedAt: now.toISOString(),
      yearToDate: {
        value: currentYearValue,
        previousValue: previousYearValue,
        changePct: pctChange(currentYearValue, previousYearValue),
      },
      rolling12: {
        value: rolling12Value,
        previousValue: previousRolling12Value,
        changePct: pctChange(rolling12Value, previousRolling12Value),
      },
      sellerAverage: {
        value: sellerAverage,
        previousValue: previousSellerAverage,
        changePct: pctChange(sellerAverage, previousSellerAverage),
        sellers: lastMonthPeople.size,
      },
      topTwo: {
        sharePct: currentYearCents > 0 ? (topTwoPeople.reduce((sum, [, result]) => sum + result.valueCents, 0) / currentYearCents) * 100 : 0,
        names: topTwoPeople.map(([userId]) => personNames.get(userId) ?? "Sem nome"),
      },
      yearlySeries,
      productivity,
      teamMonths,
      teams,
      ranking,
      annualScenario: {
        year: reportYear + 1,
        value: ANNUAL_SCENARIO,
        monthlyRequired,
        currentMonthlyPace,
        multiplier: currentMonthlyPace > 0 ? monthlyRequired / currentMonthlyPace : null,
      },
      clients: {
        unique: wonContacts.length,
        repeat: wonContacts.filter((contact) => contact._count._all > 1).length,
      },
      coverage: {
        wonDeals: deals.length,
        missingValue,
        periodWonDeals,
        periodMissingValue,
        possibleDuplicateGroups: possibleDuplicateCounts.length,
        possibleDuplicateDeals: possibleDuplicateCounts.reduce((sum, count) => sum + count, 0),
      },
    };
  });
}
