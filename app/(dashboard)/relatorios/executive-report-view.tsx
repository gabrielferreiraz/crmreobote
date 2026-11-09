import {
  ArrowDownRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronDown,
  Gauge,
  Info,
  Minus,
  Trophy,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ExecutiveReportData } from "@/lib/reports/executive-data";
import {
  EXECUTIVE_MONTHS_LONG,
  formatExecutiveCurrency,
  formatSignedPercentage,
} from "@/lib/reports/executive-utils";
import { ExecutiveQuickActions } from "./executive-quick-actions";
import { ExecutiveMobileNav } from "./executive-mobile-nav";
import { ExecutivePeriodFilter } from "./executive-period-filter";
import { ExecutiveRankingTable } from "./executive-ranking-table";
import { ExecutiveSalesChart } from "./executive-sales-chart";

export function ExecutiveReportView({ data, exactValues }: { data: ExecutiveReportData; exactValues: boolean }) {
  const period = `jan–${data.throughMonthLabel}/${String(data.reportYear).slice(-2)}`;
  const previousPeriod = `jan–${data.throughMonthLabel}/${String(data.reportYear - 1).slice(-2)}`;
  const yearDirection = describeChange(data.yearToDate.changePct);
  const money = (value: number) => formatExecutiveCurrency(value, exactValues);
  const topNames = data.topTwo.names.join(" e ");
  const maxTeamTotal = Math.max(1, ...data.teams.map((team) => team.total));
  const targetProgress = data.annualScenario.monthlyRequired > 0
    ? (data.annualScenario.currentMonthlyPace / data.annualScenario.monthlyRequired) * 100
    : 0;
  const targetGap = data.annualScenario.monthlyRequired - data.annualScenario.currentMonthlyPace;

  return (
    <div className="pb-6 lg:pb-10">
      <header className="flex flex-col gap-7 border-b border-neutral-200 px-4 pb-7 dark:border-neutral-800 lg:px-0 lg:pb-8 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-5xl">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Visão executiva · {period}
          </div>
          <h1 className={`mt-4 leading-none font-semibold tabular-nums text-neutral-950 sm:text-5xl dark:text-white ${exactValues ? "text-3xl" : "text-4xl"}`}>
            {money(data.yearToDate.value)}
          </h1>
          <p className="mt-2 text-xl font-medium text-neutral-700 dark:text-neutral-200">em vendas líquidas no ano</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-base text-neutral-600 dark:text-neutral-300">
            <span><strong className={changeTextClass(data.yearToDate.changePct)}>{yearDirection}</strong> contra {data.reportYear - 1}</span>
            <span className="hidden h-5 w-px bg-neutral-200 sm:block dark:bg-neutral-800" aria-hidden="true" />
            <span><strong className="font-semibold text-neutral-950 dark:text-white">{data.sellerAverage.valuedSellers} responsáveis</strong> compõem a média de {data.throughMonthLabel}</span>
          </div>
        </div>
        <ExecutiveQuickActions data={data} />
      </header>

      <ExecutivePeriodFilter range={data.range} throughMonth={data.throughMonth} exactValues={exactValues} />
      <ExecutiveMobileNav />

      <section id="executive-overview" className="scroll-mt-16 overflow-hidden border-y border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:mt-10 lg:rounded-lg lg:border" aria-label="Resumo executivo">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          <ExecutiveMetric
            label="Variação no ano"
            value={formatSignedPercentage(data.yearToDate.changePct)}
            hint={`${previousPeriod}: ${money(data.yearToDate.previousValue)}`}
            tone="blue"
            className="sm:border-r"
          />
          <ExecutiveMetric
            label="Últimos 12 meses fechados"
            value={money(data.rolling12.value)}
            change={data.rolling12.changePct}
            hint={`12 meses anteriores: ${money(data.rolling12.previousValue)}`}
            tone="emerald"
          />
          <ExecutiveMetric
            label={`Média por vendedor com valor · ${EXECUTIVE_MONTHS_LONG[data.throughMonth].toLocaleLowerCase("pt-BR")}`}
            value={money(data.sellerAverage.value)}
            change={data.sellerAverage.changePct}
            hint={`Mesmo mês de ${data.reportYear - 1}: ${money(data.sellerAverage.previousValue)}`}
            tone="violet"
            className="sm:border-r sm:border-b-0"
          />
          <ExecutiveMetric
            label={`Concentração no top 2 · ${data.reportYear}`}
            value={`${formatPercent(data.topTwo.sharePct)}`}
            hint={topNames ? `${topNames}` : "Ainda sem base suficiente"}
            tone="amber"
            className="sm:border-b-0"
          />
        </div>
      </section>

      <section id="executive-sales" className="mt-8 scroll-mt-16 space-y-4 lg:mt-10" aria-labelledby="year-comparison-title">
        <SectionHeading
          id="year-comparison-title"
          title="Mês a mês, ano contra ano"
          detail={`${data.range.startYear} a ${data.range.endYear}, sempre até ${EXECUTIVE_MONTHS_LONG[data.throughMonth].toLocaleLowerCase("pt-BR")} para manter a mesma régua.`}
          icon={ChartNoAxesCombined}
          tone="blue"
        />
        <div className="border-y border-neutral-200 bg-white p-4 shadow-sm transition-[border-color,box-shadow] duration-300 hover:border-blue-200 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-blue-900 lg:rounded-lg lg:border lg:p-6">
          <ExecutiveSalesChart
            key={`${data.range.startYear}-${data.range.endYear}-${data.throughMonth}`}
            series={data.yearlySeries}
            exactValues={exactValues}
          />
        </div>
      </section>

      <section id="executive-team" className="mt-8 scroll-mt-16 space-y-4 lg:mt-10" aria-labelledby="productivity-title">
        <SectionHeading
          id="productivity-title"
          title="Produtividade do time"
          detail="Pessoas vendendo e média entre responsáveis com valor informado em cada mês."
          icon={UsersRound}
          tone="emerald"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <BarPanel
            title="Vendedores com venda no mês"
            data={data.productivity.slice(0, data.throughMonth + 1).map((month) => ({ label: month.label, value: month.sellers }))}
            format={(value) => String(value)}
            tone="emerald"
          />
          <BarPanel
            title="Média por vendedor com valor"
            data={data.productivity.slice(0, data.throughMonth + 1).map((month) => ({ label: month.label, value: month.average }))}
            format={money}
            barFormat={(value) => formatExecutiveCurrency(value, false)}
            tone="blue"
          />
        </div>
      </section>

      <section className="mt-8 grid items-stretch gap-4 lg:mt-10 xl:grid-cols-[1.35fr_0.65fr]" aria-label="Equipes e meta">
        <div className="border-y border-neutral-200 bg-white p-4 shadow-sm transition-shadow duration-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-950 lg:rounded-lg lg:border lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300">
                <UsersRound className="h-4.5 w-4.5" strokeWidth={2} />
              </span>
              <div>
              <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Equipes nos últimos 3 meses</h2>
              <p className="mt-1 text-base text-neutral-500 dark:text-neutral-400">Vendas pela composição atual das equipes.</p>
              </div>
            </div>
            <span className="text-sm text-neutral-400 dark:text-neutral-500">Equipe atual, não histórica</span>
          </div>
          {data.teams.length === 0 ? (
            <p className="mt-6 border-t border-neutral-200 pt-6 text-base text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              Nenhuma equipe teve venda com valor informado nesses três meses.
            </p>
          ) : (
            <>
              <div className="mt-5 divide-y divide-neutral-200 lg:hidden dark:divide-neutral-800">
                {data.teams.map((team) => (
                  <article key={team.name} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="min-w-0 truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{team.name}</h3>
                      <span className="shrink-0 text-lg font-semibold tabular-nums text-neutral-950 dark:text-white">{money(team.total)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      {team.values.map((value, index) => (
                        <div key={data.teamMonths[index] ? `${data.teamMonths[index].year}-${data.teamMonths[index].month}` : index}>
                          <p className="text-sm capitalize text-neutral-400 dark:text-neutral-500">{data.teamMonths[index]?.label}</p>
                          <p className="mt-0.5 text-base font-medium tabular-nums text-neutral-700 dark:text-neutral-300">{money(value)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(4, (team.total / maxTeamTotal) * 100)}%` }} />
                    </div>
                  </article>
                ))}
              </div>
              <div className="mt-5 hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[520px] text-base">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th className="pb-2 font-medium">Equipe</th>
                  {data.teamMonths.map((month) => (
                    <th key={`${month.year}-${month.month}`} className="pb-2 text-right font-medium capitalize">{month.label}</th>
                  ))}
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((team) => (
                  <tr key={team.name} className="group border-b border-neutral-100 transition-colors hover:bg-violet-50/50 last:border-0 dark:border-neutral-900 dark:hover:bg-violet-950/15">
                    <td className="py-3 font-medium text-neutral-900 dark:text-neutral-100">{team.name}</td>
                    {team.values.map((value, index) => (
                      <td key={index} className="py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-300">{money(value)}</td>
                    ))}
                    <td className="py-3 text-right">
                      <div className="ml-auto w-28">
                        <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{money(team.total)}</span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                          <span
                            className="block h-full rounded-full bg-violet-500 transition-[width] duration-500"
                            style={{ width: `${Math.max(4, (team.total / maxTeamTotal) * 100)}%` }}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="border-y border-amber-200 bg-amber-50/40 p-5 shadow-sm transition-shadow duration-300 hover:shadow-md dark:border-amber-950 dark:bg-amber-950/10 lg:rounded-lg lg:border lg:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <Gauge className="h-4.5 w-4.5" strokeWidth={2} />
            </span>
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Simulação estratégica · ritmo de {data.reportYear}</p>
              <h2 className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Cenário anual de R$ 1 bilhão</h2>
            </div>
          </div>
          <div className="mt-6">
            <div className="flex items-end justify-between gap-3">
              <p className="text-base text-neutral-600 dark:text-neutral-300">Ritmo atual frente ao necessário</p>
              <p className="text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatPercent(targetProgress)}</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-700"
                style={{ width: `${Math.min(100, Math.max(2, targetProgress))}%` }}
              />
            </div>
          </div>
          <div className="mt-6 space-y-5">
            <TargetLine label="Média necessária por mês" value={money(data.annualScenario.monthlyRequired)} />
            <TargetLine label={`Ritmo mensal em ${data.reportYear}`} value={money(data.annualScenario.currentMonthlyPace)} />
            <TargetLine
              label={targetGap > 0
                ? "Falta por mês para o ritmo necessário"
                : targetGap < 0
                  ? "Acima do ritmo necessário por mês"
                  : "Diferença para o ritmo necessário"}
              value={money(Math.abs(targetGap))}
              strong
            />
          </div>
          <div className="mt-6 border-t border-neutral-200 pt-4 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">Base histórica de pós-venda</p>
            <p className="mt-1 text-base">
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{data.clients.unique.toLocaleString("pt-BR")}</span> clientes únicos
              <span className="mx-2 text-neutral-300 dark:text-neutral-700">·</span>
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{data.clients.repeat.toLocaleString("pt-BR")}</span> com mais de uma venda
            </p>
            <p className="mt-2 text-sm">Esta simulação não altera as metas mensais do CRM.</p>
          </div>
        </div>
      </section>

      <section id="executive-ranking" className="mt-8 scroll-mt-16 space-y-4 lg:mt-10" aria-labelledby="seller-ranking-title">
        <SectionHeading
          id="seller-ranking-title"
          title={`Ranking de vendedores · ${period}`}
          detail="Considera o responsável atual. Negócios divididos aparecem para cada participante, somente com a parcela correspondente."
          icon={Trophy}
          tone="violet"
        />
        <div className="border-y border-neutral-200 bg-white p-4 shadow-sm transition-[border-color,box-shadow] duration-300 hover:border-violet-200 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-violet-900 lg:rounded-lg lg:border lg:p-6">
          <ExecutiveRankingTable
            rows={data.ranking}
            year={data.reportYear}
            throughMonthLabel={data.throughMonthLabel}
            exactValues={exactValues}
          />
        </div>
      </section>

      <footer className="mt-8 border-t border-neutral-200 px-4 pt-5 dark:border-neutral-800 lg:mt-10 lg:px-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 text-sm font-medium text-neutral-500 outline-none hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-neutral-400 dark:hover:text-neutral-100">
            <span className="inline-flex items-center gap-2">
              <Info className="h-4 w-4" strokeWidth={2} />
              Sobre os dados
              {(data.coverage.periodMissingValue > 0 || data.coverage.possibleDuplicateGroups > 0) && (
                <span className="font-normal text-amber-700 dark:text-amber-400">
                  · {data.coverage.periodMissingValue + data.coverage.possibleDuplicateGroups} pontos para revisar
                </span>
              )}
            </span>
            <span className="inline-flex items-center gap-2 font-normal">
              Gerado em {formatUpdatedAt(data.updatedAt)}
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" strokeWidth={2} />
            </span>
          </summary>
          <p className="mt-4 max-w-6xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            Base: negócios ganhos pela data de fechamento. Em {data.reportYear}, {data.coverage.periodWonDeals.toLocaleString("pt-BR")} negócios
            {data.coverage.periodMissingValue > 0 ? ` · ${data.coverage.periodMissingValue} sem valor líquido, contados nas quantidades mas fora dos totais monetários` : ""}.
            {data.coverage.possibleDuplicateGroups > 0
              ? ` ${data.coverage.possibleDuplicateGroups} coincidências de cliente, valor e data (${data.coverage.possibleDuplicateDeals} negócios) foram mantidas e precisam de conferência.`
              : ""}
            Série selecionada ({data.range.startYear}–{data.range.endYear}): {data.coverage.wonDeals.toLocaleString("pt-BR")} negócios
            {data.coverage.missingValue > 0 ? ` · ${data.coverage.missingValue} sem valor` : ""}. Administradoras e cotas ficam fora até o histórico estar completo.
          </p>
        </details>
      </footer>
    </div>
  );
}

function ExecutiveMetric({
  label,
  value,
  change,
  hint,
  tone,
  className = "",
}: {
  label: string;
  value: string;
  change?: number | null;
  hint: string;
  tone: "blue" | "emerald" | "violet" | "amber";
  className?: string;
}) {
  const tones = {
    blue: { line: "bg-blue-500", hover: "hover:bg-blue-50/50 dark:hover:bg-blue-950/15" },
    emerald: { line: "bg-emerald-500", hover: "hover:bg-emerald-50/50 dark:hover:bg-emerald-950/15" },
    violet: { line: "bg-violet-500", hover: "hover:bg-violet-50/50 dark:hover:bg-violet-950/15" },
    amber: { line: "bg-amber-500", hover: "hover:bg-amber-50/50 dark:hover:bg-amber-950/15" },
  }[tone];

  return (
    <div className={`group relative overflow-hidden border-b border-neutral-200 p-5 transition-colors duration-300 last:border-b-0 dark:border-neutral-800 xl:border-r xl:border-b-0 xl:last:border-r-0 ${tones.hover} ${className}`}>
      <span className={`absolute top-0 left-0 h-0.5 w-full origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100 ${tones.line}`} aria-hidden="true" />
      <p className="min-h-12 text-base leading-6 text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="text-3xl font-semibold tabular-nums text-neutral-950 transition-transform duration-300 group-hover:-translate-y-0.5 dark:text-white">{value}</p>
        {change !== undefined && <ChangeBadge value={change} />}
      </div>
      <p className="mt-2 text-sm leading-5 text-neutral-400 dark:text-neutral-500">{hint}</p>
    </div>
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="self-baseline text-sm text-neutral-400">sem comparação</span>;
  const positive = value > 0;
  const negative = value < 0;
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex shrink-0 self-baseline items-center gap-0.5 text-sm font-semibold tabular-nums ${positive ? "text-emerald-600 dark:text-emerald-400" : negative ? "text-red-600 dark:text-red-400" : "text-neutral-500"}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

function SectionHeading({
  id,
  title,
  detail,
  icon: Icon,
  tone,
}: {
  id: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  tone: "blue" | "emerald" | "violet";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300",
  }[tone];

  return (
    <div className="flex items-start gap-3 px-4 lg:px-0">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones}`} aria-hidden="true">
        <Icon className="h-4.5 w-4.5" strokeWidth={2} />
      </span>
      <div>
        <h2 id={id} className="text-xl font-semibold text-neutral-900 sm:text-2xl dark:text-neutral-100">{title}</h2>
        <p className="mt-1 text-base text-neutral-500 dark:text-neutral-400">{detail}</p>
      </div>
    </div>
  );
}

function BarPanel({
  title,
  data,
  format,
  barFormat = format,
  tone,
}: {
  title: string;
  data: { label: string; value: number }[];
  format: (value: number) => string;
  barFormat?: (value: number) => string;
  tone: "blue" | "emerald";
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const latest = data.at(-1)?.value ?? 0;
  const styles = tone === "blue"
    ? { bar: "bg-blue-500", border: "hover:border-blue-200 dark:hover:border-blue-900", text: "text-blue-600 dark:text-blue-400" }
    : { bar: "bg-emerald-500", border: "hover:border-emerald-200 dark:hover:border-emerald-900", text: "text-emerald-600 dark:text-emerald-400" };

  return (
    <div className={`border-y border-neutral-200 bg-white p-4 shadow-sm transition-[border-color,box-shadow] duration-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-950 lg:rounded-lg lg:border lg:p-5 ${styles.border}`}>
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        <p className={`shrink-0 text-base font-semibold tabular-nums ${styles.text}`}>{format(latest)} em {data.at(-1)?.label}</p>
      </div>
      <div className="mt-5 space-y-3 lg:hidden">
        {data.map((item) => (
          <div key={item.label} className="grid grid-cols-[2.25rem_1fr_auto] items-center gap-3">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">{item.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <span
                className={`block h-full rounded-full ${styles.bar}`}
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
              />
            </span>
            <span className="min-w-16 text-right text-sm font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">{format(item.value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 hidden overflow-x-auto pb-1 lg:block">
        <div className="flex h-48 min-w-[560px] items-end gap-2">
          {data.map((item) => (
            <div key={item.label} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${item.label}: ${format(item.value)}`}>
              <span className="text-xs font-medium tabular-nums text-neutral-500 transition-[color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-100">{barFormat(item.value)}</span>
              <div
                className={`w-full max-w-9 origin-bottom rounded-t-md transition-[transform,filter] duration-200 group-hover:scale-x-110 group-hover:brightness-110 ${styles.bar}`}
                style={{ height: `${Math.max(2, (item.value / max) * 132)}px` }}
              />
              <span className={`text-sm text-neutral-400 transition-colors group-hover:font-semibold dark:text-neutral-500 ${tone === "blue" ? "group-hover:text-blue-600 dark:group-hover:text-blue-400" : "group-hover:text-emerald-600 dark:group-hover:text-emerald-400"}`}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TargetLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-neutral-200 pb-3 last:border-0 last:pb-0 dark:border-neutral-800">
      <span className="text-base text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className={`${strong ? "text-2xl" : "text-lg"} shrink-0 font-semibold tabular-nums text-neutral-900 dark:text-neutral-100`}>{value}</span>
    </div>
  );
}

function describeChange(value: number | null): string {
  if (value === null) return "sem base comparável";
  if (Math.abs(value) < 0.05) return "estável";
  const amount = `${Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return value > 0 ? `alta de ${amount}` : `queda de ${amount}`;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function changeTextClass(value: number | null): string {
  if (value === null || Math.abs(value) < 0.05) return "font-semibold text-neutral-950 dark:text-white";
  return value > 0
    ? "font-semibold text-emerald-700 dark:text-emerald-400"
    : "font-semibold text-red-700 dark:text-red-400";
}

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Cuiaba",
  });
}
