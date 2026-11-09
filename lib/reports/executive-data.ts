import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDealShares, splitCentsByPercent } from "@/lib/deals/split-shares";
import { calculatePercentageChange, EXECUTIVE_MONTHS_SHORT } from "@/lib/reports/executive-utils";
import { brazilDateKey, brazilDateStringToUTC, getBrazilParts } from "@/lib/timezone";
import { runWithTenant } from "@/lib/tenant-context";

const ANNUAL_SCENARIO = 1_000_000_000;

type YearMonth = { year: number; month: number };
type PersonMonthStats = { valueCents: number; sales: number; valuedSales: number };
type PersonPeriodStats = PersonMonthStats & { months: Set<string> };

export type ExecutiveRankingRow = {
  id: string;
  name: string;
  team: string;
  yearValue: number;
  recentValue: number;
  sales: number;
  activeMonths: number;
};

export type ExecutiveComparisonRankingRow = {
  id: string;
  name: string;
  team: string;
  yearlyValues: { year: number; value: number }[];
  totalValue: number;
  sales: number;
  activeMonths: number;
};

export type ExecutiveReportSelection = {
  startYear?: number;
  endYear?: number;
  throughMonth?: number;
};

export type ExecutiveReportData = {
  reportYear: number;
  throughMonth: number;
  throughMonthLabel: string;
  updatedAt: string;
  range: {
    availableYears: number[];
    startYear: number;
    endYear: number;
    maxThroughMonth: number;
    latestClosedMonth: number;
  };
  yearToDate: { value: number; previousValue: number; changePct: number | null };
  rolling12: { value: number; previousValue: number; changePct: number | null };
  sellerAverage: { value: number; previousValue: number; changePct: number | null; valuedSellers: number };
  topTwo: { sharePct: number; names: string[] };
  yearlySeries: { year: number; values: Array<number | null> }[];
  productivity: { month: number; label: string; sellers: number; average: number }[];
  teamMonths: { year: number; month: number; label: string }[];
  teams: { name: string; values: number[]; total: number }[];
  ranking: ExecutiveRankingRow[];
  comparisonRanking: ExecutiveComparisonRankingRow[];
  annualScenario: {
    monthlyRequired: number;
    currentMonthlyPace: number;
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

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function decimalToCents(value: Prisma.Decimal | null): number {
  if (value === null) return 0;
  const fixed = value.toFixed(2);
  const negative = fixed.startsWith("-");
  const [whole, fraction = "00"] = fixed.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -cents : cents;
}

function centsToValue(cents: number): number {
  return cents / 100;
}

function countValuedSellers(people: Iterable<PersonMonthStats>): number {
  let total = 0;
  for (const person of people) {
    if (person.valuedSales > 0) total += 1;
  }
  return total;
}

function inRange(date: Date, from: Date, to: Date): boolean {
  const value = date.getTime();
  return value >= from.getTime() && value < to.getTime();
}

export async function getExecutiveReportData(
  organizationId: string,
  selection: ExecutiveReportSelection = {},
): Promise<ExecutiveReportData> {
  return runWithTenant(organizationId, async () => {
    const now = new Date();
    const nowParts = getBrazilParts(now);
    const currentReportYear = nowParts.month === 0 ? nowParts.year - 1 : nowParts.year;
    const latestClosedMonth = nowParts.month === 0 ? 11 : nowParts.month - 1;
    const dateCoverage = await prisma.deal.aggregate({
      where: { organizationId, status: "WON", closedAt: { not: null }, value: { not: null } },
      _min: { closedAt: true },
    });
    const earliestDataYear = dateCoverage._min.closedAt
      ? Math.min(currentReportYear, getBrazilParts(dateCoverage._min.closedAt).year)
      : currentReportYear;
    const availableYears = Array.from(
      { length: currentReportYear - earliestDataYear + 1 },
      (_, index) => earliestDataYear + index,
    );
    const requestedEndYear = clampInteger(selection.endYear ?? currentReportYear, earliestDataYear, currentReportYear);
    const requestedStartYear = clampInteger(selection.startYear ?? earliestDataYear, earliestDataYear, currentReportYear);
    const reportYear = requestedEndYear;
    const startYear = Math.min(requestedStartYear, reportYear);
    const maxThroughMonth = reportYear === currentReportYear ? latestClosedMonth : 11;
    const throughMonth = clampInteger(selection.throughMonth ?? maxThroughMonth, 0, maxThroughMonth);
    const completeEnd = monthStart(addMonths({ year: reportYear, month: throughMonth }, 1));
    const historyStart = monthStart({ year: startYear, month: 0 });
    const currentYearStart = monthStart({ year: reportYear, month: 0 });
    const previousYearStart = monthStart({ year: reportYear - 1, month: 0 });
    const previousComparableEnd = monthStart({ year: reportYear - 1, month: throughMonth + 1 });
    const rolling12Start = monthStart(addMonths({ year: reportYear, month: throughMonth + 1 }, -12));
    const previousRolling12Start = monthStart(addMonths({ year: reportYear, month: throughMonth + 1 }, -24));
    const lastMonthStart = monthStart({ year: reportYear, month: throughMonth });
    const lastMonthPreviousStart = monthStart({ year: reportYear - 1, month: throughMonth });
    const lastMonthPreviousEnd = monthStart({ year: reportYear - 1, month: throughMonth + 1 });
    const recentStart = monthStart(addMonths({ year: reportYear, month: throughMonth + 1 }, -3));
    const queryStart = monthStart({ year: Math.min(startYear, reportYear - 2), month: 0 });

    const [deals, memberships, wonContacts] = await Promise.all([
      prisma.deal.findMany({
        where: {
          organizationId,
          status: "WON",
          closedAt: { gte: queryStart, lt: completeEnd },
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
    const peopleByMonth = new Map<string, Map<string, PersonMonthStats>>();
    let historyWonDeals = 0;
    let historyMissingValue = 0;
    let periodWonDeals = 0;
    let periodMissingValue = 0;
    const possibleDuplicateKeys = new Map<string, number>();

    for (const deal of deals) {
      if (!deal.closedAt) continue;
      const key = monthKey(deal.closedAt);
      const valueCents = decimalToCents(deal.value);
      if (inRange(deal.closedAt, historyStart, completeEnd)) {
        historyWonDeals += 1;
        if (deal.value == null) historyMissingValue += 1;
      }
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

      const monthPeople = peopleByMonth.get(key) ?? new Map<string, PersonMonthStats>();
      const shares = computeDealShares(deal.ownerId, deal.participants);
      const allocatedCents = splitCentsByPercent(valueCents, shares);
      shares.forEach((share, index) => {
        const current = monthPeople.get(share.userId) ?? { valueCents: 0, sales: 0, valuedSales: 0 };
        current.valueCents += allocatedCents[index];
        current.sales += 1;
        if (deal.value !== null) current.valuedSales += 1;
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
      const totals = new Map<string, PersonPeriodStats>();
      let cursor = { year: getBrazilParts(from).year, month: getBrazilParts(from).month };
      const end = getBrazilParts(to);
      while (cursor.year < end.year || (cursor.year === end.year && cursor.month < end.month)) {
        const key = keyOf(cursor);
        for (const [userId, result] of peopleByMonth.get(key) ?? []) {
          const current = totals.get(userId) ?? { valueCents: 0, sales: 0, valuedSales: 0, months: new Set<string>() };
          current.valueCents += result.valueCents;
          current.sales += result.sales;
          current.valuedSales += result.valuedSales;
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
    const lastMonthValuedSellers = countValuedSellers(lastMonthPeople.values());
    const previousMonthValuedSellers = countValuedSellers(lastMonthPreviousPeople.values());
    const sellerAverage = lastMonthValuedSellers > 0 ? centsToValue(lastMonthCents) / lastMonthValuedSellers : 0;
    const previousSellerAverage = previousMonthValuedSellers > 0
      ? centsToValue(lastMonthPreviousCents) / previousMonthValuedSellers
      : 0;

    const yearPeople = personTotals(currentYearStart, completeEnd);
    const recentPeople = personTotals(recentStart, completeEnd);
    const topTwoPeople = Array.from(yearPeople.entries())
      .filter(([, result]) => result.valueCents > 0)
      .sort((a, b) => b[1].valueCents - a[1].valueCents)
      .slice(0, 2);

    const selectedYears = availableYears.filter((year) => year >= startYear && year <= reportYear);
    const yearlySeries = selectedYears.map((year) => ({
      year,
      values: Array.from({ length: 12 }, (_, month) => {
        if (month > throughMonth) return null;
        return centsToValue(companyByMonth.get(keyOf({ year, month })) ?? 0);
      }),
    }));

    const productivity = Array.from({ length: 12 }, (_, month) => {
      const people = peopleByMonth.get(keyOf({ year: reportYear, month })) ?? new Map<string, PersonMonthStats>();
      const valueCents = companyByMonth.get(keyOf({ year: reportYear, month })) ?? 0;
      const valuedSellers = countValuedSellers(people.values());
      return {
        month,
        label: EXECUTIVE_MONTHS_SHORT[month],
        sellers: month <= throughMonth ? people.size : 0,
        average: month <= throughMonth && valuedSellers > 0 ? centsToValue(valueCents) / valuedSellers : 0,
      };
    }).slice(0, throughMonth + 1);

    const teamMonths = Array.from({ length: 3 }, (_, index) => addMonths({ year: reportYear, month: throughMonth - 2 }, index)).map(
      ({ year, month }) => ({ year, month, label: EXECUTIVE_MONTHS_SHORT[month] }),
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

    const comparisonPeople = new Map<string, {
      yearlyCents: Map<number, number>;
      totalCents: number;
      sales: number;
      months: Set<string>;
    }>();
    for (const year of selectedYears) {
      const yearlyPeople = personTotals(
        monthStart({ year, month: 0 }),
        monthStart({ year, month: throughMonth + 1 }),
      );
      for (const [userId, result] of yearlyPeople) {
        const current = comparisonPeople.get(userId) ?? {
          yearlyCents: new Map<number, number>(),
          totalCents: 0,
          sales: 0,
          months: new Set<string>(),
        };
        current.yearlyCents.set(year, result.valueCents);
        current.totalCents += result.valueCents;
        current.sales += result.sales;
        for (const month of result.months) current.months.add(month);
        comparisonPeople.set(userId, current);
      }
    }
    const comparisonRanking: ExecutiveComparisonRankingRow[] = Array.from(comparisonPeople.entries())
      .filter(([, result]) => result.sales > 0)
      .map(([userId, result]) => ({
        id: userId,
        name: personNames.get(userId) ?? membershipByUser.get(userId)?.name ?? "Sem nome",
        team: membershipByUser.get(userId)?.team ?? "Sem equipe",
        yearlyValues: selectedYears.map((year) => ({
          year,
          value: centsToValue(result.yearlyCents.get(year) ?? 0),
        })),
        totalValue: centsToValue(result.totalCents),
        sales: result.sales,
        activeMonths: result.months.size,
      }))
      .sort((a, b) => b.totalValue - a.totalValue || b.sales - a.sales || a.name.localeCompare(b.name, "pt-BR"));

    const completedMonths = throughMonth + 1;
    const currentMonthlyPace = completedMonths > 0 ? currentYearValue / completedMonths : 0;
    const monthlyRequired = ANNUAL_SCENARIO / 12;
    const possibleDuplicateCounts = Array.from(possibleDuplicateKeys.values()).filter((count) => count > 1);

    return {
      reportYear,
      throughMonth,
      throughMonthLabel: EXECUTIVE_MONTHS_SHORT[throughMonth],
      updatedAt: now.toISOString(),
      range: {
        availableYears,
        startYear,
        endYear: reportYear,
        maxThroughMonth,
        latestClosedMonth,
      },
      yearToDate: {
        value: currentYearValue,
        previousValue: previousYearValue,
        changePct: calculatePercentageChange(currentYearValue, previousYearValue),
      },
      rolling12: {
        value: rolling12Value,
        previousValue: previousRolling12Value,
        changePct: calculatePercentageChange(rolling12Value, previousRolling12Value),
      },
      sellerAverage: {
        value: sellerAverage,
        previousValue: previousSellerAverage,
        changePct: calculatePercentageChange(sellerAverage, previousSellerAverage),
        valuedSellers: lastMonthValuedSellers,
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
      comparisonRanking,
      annualScenario: {
        monthlyRequired,
        currentMonthlyPace,
      },
      clients: {
        unique: wonContacts.length,
        repeat: wonContacts.filter((contact) => contact._count._all > 1).length,
      },
      coverage: {
        wonDeals: historyWonDeals,
        missingValue: historyMissingValue,
        periodWonDeals,
        periodMissingValue,
        possibleDuplicateGroups: possibleDuplicateCounts.length,
        possibleDuplicateDeals: possibleDuplicateCounts.reduce((sum, count) => sum + count, 0),
      },
    };
  });
}
