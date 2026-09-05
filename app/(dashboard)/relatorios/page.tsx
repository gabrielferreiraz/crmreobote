import type { ReactNode } from "react";
import { Trophy, XCircle, CalendarCheck, Percent, UsersRound, Clock, Activity, Timer, Target, Zap, UserCheck, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatCurrency, formatDuration } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/avatar";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendAreaChart, DrillableTrendChart } from "@/components/charts/trend-area-chart";
import { PersonalHero, findRankingPosition } from "./personal-hero";
import { FunnelChart, FunnelSkeleton } from "@/components/charts/funnel-chart";
import { Leaderboard } from "@/components/leaderboard";
import { RISK_THRESHOLD } from "@/lib/whatsapp/health-check";
import { TeamActivityList } from "./team-activity-list";
import { BarRow } from "./bar-row";
import { DateRangeFilter } from "./date-range-filter";
import { ComparePeriodFilter } from "./compare-period-filter";
import { TeamOwnerFilter } from "./team-owner-filter";
import { PipelineFilter } from "./pipeline-filter";
import { FiltersUrlRestore } from "./filters-url-restore";
import { GoalCard } from "./goal-card";
import { getCurrentUserArea } from "@/lib/user-area";
import { AdminReportsView } from "./admin-reports-view";
import { MetaAdsReportView } from "./meta-ads-view";
import { ReportTabs } from "./report-tabs";
import { getCommercialReportData } from "@/lib/reports/commercial-data";
import { AutoInsights, DeltaBadge } from "./auto-insights";
import { WeekdayHeatmap } from "./weekday-heatmap";

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{
    pipelineId?: string;
    from?: string;
    to?: string;
    /** "all" = Tudo escolhido explicitamente no filtro (ver date-range-filter.tsx) — precisa ser distinguível de "nunca escolheu nada", ver lib/reports/commercial-data.ts. */
    range?: string;
    who?: string;
    view?: string;
    processPipelineId?: string;
    /** "mirror" | "month" | "last3" | "year" | "custom" — ver lib/reports/period-compare.ts. */
    compare?: string;
    /** "YYYY-MM-DD" — só usado quando compare === "custom" (ver compare-period-filter.tsx). */
    compareFrom?: string;
    compareTo?: string;
  }>;
}) {
  const {
    pipelineId: pipelineIdParam,
    from: fromParam,
    to: toParam,
    range: rangeParam,
    who: whoParam,
    view: viewParam,
    processPipelineId: processPipelineIdParam,
    compare: compareParam,
    compareFrom: compareFromParam,
    compareTo: compareToParam,
  } = await searchParams;

  // Administrativo (pós-venda) vê um relatório próprio — funil/metas de
  // vendas não fazem sentido pra quem não vende. Sem aba: Administrativo
  // sempre cai direto aqui, nunca alterna pro comercial. from/to/who viram
  // o filtro de período/responsável do próprio relatório de processos (ver
  // admin-reports-view.tsx) — não tem relação com o filtro do comercial,
  // só reaproveita os mesmos nomes de parâmetro de URL.
  const area = await getCurrentUserArea();
  if (area === "ADMINISTRATIVO")
    return <AdminReportsView from={fromParam} to={toParam} who={whoParam} pipelineId={processPipelineIdParam} />;

  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;

  // Só o Dono ganha a aba "Processos" — consultor/gerente/supervisor nunca
  // tiveram acesso ao módulo de Processos pra começo de conversa (ver
  // lib/processes/access.ts), então oferecer a aba pra eles não faz
  // sentido. Reaproveita o mesmo relatório do Administrativo: como quem tá
  // pedindo é Dono, `requireProcessAccess()` já devolve acesso total (sem
  // filtro de dono), então nem precisa de uma versão própria pra isso.
  // Roda ANTES de qualquer query do comercial abaixo — sem isso, a aba
  // "Processos" ficaria esperando o relatório de vendas inteiro carregar à
  // toa antes de mostrar algo completamente diferente.
  const isOwner = session!.user.role === "OWNER";
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");
  const isSupervisor = session!.user.role === "SUPERVISOR";
  const isMember = session!.user.role === "MEMBER";
  // Consultor e supervisor têm uma visão pessoal (hero de "Meu desempenho")
  // em vez do "Panorama comercial" genérico — isPersonalView é o flag central.
  const isPersonalView = isMember || isSupervisor;
  const currentUserName = session!.user.name ?? "";
  if (isOwner && viewParam === "processos") {
    return (
      <div className="space-y-6">
        <ReportTabs active="processos" />
        <AdminReportsView from={fromParam} to={toParam} who={whoParam} pipelineId={processPipelineIdParam} />
      </div>
    );
  }

  // Mesma lógica da aba "Processos" acima — roda antes de qualquer query do
  // comercial, e por conta própria (MetaAdsReportView busca os próprios
  // dados, ver meta-ads-view.tsx). Antes vivia sozinho em /relatorios/meta-ads
  // sem nenhum link pra lá; agora é só mais uma aba.
  if (isOwner && viewParam === "facebook") {
    return (
      <div className="space-y-6">
        <ReportTabs active="facebook" />
        {/* Mesmo mecanismo de restauração/padrão "Este mês" do relatório Comercial
            (ver lib/reports/commercial-data.ts) — sem isso, "Tudo" escolhido aqui
            não sobrevivia a um reload/nova aba, voltando pro "Este mês" sozinho. */}
        <FiltersUrlRestore />
        <MetaAdsReportView organizationId={organizationId} from={fromParam} to={toParam} range={rangeParam} />
      </div>
    );
  }

  const {
    pipelines,
    teamFilterOptions,
    memberFilterOptions,
    showTeamRanking,
    showTeamActivity,
    activePipeline,
    pipelineFilter,
    openCount,
    wonCount,
    lostCount,
    closedCount,
    winRate,
    wonTotalValue,
    openTotalValue,
    avgWonValue,
    compareData,
    creditTypeBreakdown,
    creditTypeTotalValue,
    stageData,
    dealsClosedRanking,
    meetingsRanking,
    attendanceRanking,
    attendanceSummary,
    attendanceRateOverall,
    conversionRanking,
    crmTimeRanking,
    crmChangesRanking,
    teamActivityList,
    teamRanking,
    revenueTrendDaily,
    teamActivityTrend,
    statusSlices,
    lossBreakdown,
    maxLossCount,
    jobTitleBreakdown,
    whatsappInstances,
    connectedEvolutionCount,
    instabilityRows,
    COLD_POSSIBLE_DEAL_MIN_REPLIES,
    scriptBreakdown,
    cargoBreakdown,
    slaSummaryRows,
    slaTotalFirstTouch,
    slaWithin1hCount,
    slaOverallFirstTouchWithin1h,
    slaTotalAvgFirstTouchMs,
    slaTotalAvgFirstReplyMs,
    slaTotalP95FirstReplyMs,
    slaTotalAvgQualificationMs,
    slaTotalQualified,
    sellerWhatsappCards,
    currentMonthLabel,
    activeSellerCount,
    goalValue,
    goalAchievedValue,
    goalSuggestedValue,
    goalBasisChanged,
    goalDaysElapsed,
    goalDaysInMonth,
  } = await getCommercialReportData({
    organizationId,
    userId,
    session: session!,
    pipelineIdParam,
    fromParam,
    toParam,
    rangeParam,
    whoParam,
    compareParam,
    compareFromParam,
    compareToParam,
  });

  // Dados necessários pro PersonalHero — extraídos dos rankings já computados.
  const personalRankingPos = isPersonalView
    ? findRankingPosition(dealsClosedRanking, currentUserName)
    : null;
  const personalSlaRow = isPersonalView
    ? slaSummaryRows.find((r) => r.name === currentUserName) ?? null
    : null;

  return (
    <div className="space-y-16 pb-8">
      <div className="space-y-4">
        {isOwner && <ReportTabs active="comercial" />}
        {/* flex-col + xl:flex-row/flex-nowrap (não flex-wrap+justify-between
            de antes) — com justify-between, o bloco de filtros (que só
            CRESCE conforme escolhe filtro: nome de responsável, comparação
            de período com data por extenso etc.) passava de "colado na
            direita" pra "colado na esquerda" assim que deixava de caber ao
            lado do título, um salto visual pro outro lado da tela bem no
            meio de usar o filtro (pedido explícito pra corrigir). Abaixo de
            xl sempre empilhado (título em cima, filtros embaixo, nunca
            ambíguo); a partir de xl a fileira NUNCA quebra como um todo —
            só o título encolhe/quebra o próprio texto (min-w-0), os filtros
            ficam com largura própria (shrink-0) sempre grudados na direita,
            não importa o quanto cresçam. */}
        <div className="flex flex-col gap-4 xl:flex-row xl:flex-nowrap xl:items-end xl:justify-between">
          {!isPersonalView && (
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
                Relatórios
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {isManager ? "Panorama da operação" : "Panorama comercial"}
              </h1>
              <p className="mt-2 max-w-lg text-sm text-neutral-500 dark:text-neutral-400">
                Como o funil, o time e as conversas de WhatsApp estão performando no período selecionado.
              </p>
            </div>
          )}
          {isPersonalView && (
            // Filtros compactos (sem o bloco de título) — o PersonalHero ocupa o topo
            <p className="min-w-0 text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
              Relatórios
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
            <FiltersUrlRestore />
            <PipelineFilter pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} />
            {!isPersonalView && (
              <TeamOwnerFilter teams={teamFilterOptions} members={memberFilterOptions} currentUserId={userId} />
            )}
            <DateRangeFilter />
            <ComparePeriodFilter />
          </div>
        </div>

        {/* Hero personalizado por cargo — visível só pra consultor/supervisor */}
        {isPersonalView && (
          <PersonalHero
            name={currentUserName}
            photoUrl={session!.user.image}
            role={isMember ? "MEMBER" : "SUPERVISOR"}
            wonCount={wonCount}
            wonTotalValue={wonTotalValue}
            avgWonValue={avgWonValue}
            winRate={winRate}
            rankingPosition={personalRankingPos}
            totalRankingMembers={dealsClosedRanking.length}
            slaFirstTouchWithin1h={personalSlaRow?.firstTouchWithin1h ?? null}
            avgFirstReplyMs={personalSlaRow?.avgFirstReplyMs ?? null}
            currentMonthLabel={currentMonthLabel}
          />
        )}
      </div>

      {(isOwner || goalValue !== null) && (
        <GoalCard
          monthLabel={currentMonthLabel}
          goalValue={goalValue}
          achievedValue={goalAchievedValue}
          isOwner={isOwner}
          daysElapsed={goalDaysElapsed}
          daysInMonth={goalDaysInMonth}
          sellerCount={activeSellerCount}
          suggestedValue={goalSuggestedValue}
          goalBasisChanged={goalBasisChanged}
        />
      )}

      {/* Insights automáticos — resumo das observações mais relevantes do período */}
      <AutoInsights
        wonCount={wonCount}
        wonTotalValue={wonTotalValue}
        compareData={compareData}
        winRate={winRate}
        dealsClosedRanking={dealsClosedRanking}
        slaOverallFirstTouchWithin1h={slaOverallFirstTouchWithin1h}
        revenueTrendDaily={revenueTrendDaily}
      />

      {/* ─── Visão geral ────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading eyebrow="Visão geral" title="Como o funil está hoje" />
        <div className="grid grid-cols-12 items-start gap-5">
          <div className="card col-span-12 p-6 lg:col-span-5">
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Negócios por status</p>
            <div className="mt-4">
              <DonutChart slices={statusSlices} centerValue={`${winRate}%`} centerLabel="conversão" />
            </div>
            {compareData && (
              <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  Comparando com o período selecionado: {compareData.rangeLabel}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
                    Ganhos
                    <DeltaBadge current={wonCount} previous={compareData.wonCount} compareLabel={compareData.rangeLabel} />
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
                    Perdidos
                    <DeltaBadge current={lostCount} previous={compareData.lostCount} compareLabel={compareData.rangeLabel} invert />
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
                    Conversão
                    <DeltaBadge current={winRate} previous={compareData.winRate} compareLabel={compareData.rangeLabel} />
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="col-span-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-7">
            <Stat
              label="Total ganho"
              value={formatCurrency(wonTotalValue)}
              hint={`${wonCount} negócio${wonCount === 1 ? "" : "s"} fechado${wonCount === 1 ? "" : "s"} no período`}
              emphasize
              delta={<DeltaBadge current={wonTotalValue} previous={compareData?.wonTotalValue ?? null} compareLabel={compareData?.rangeLabel} />}
            />
            <Stat
              label="Ticket médio"
              value={wonCount > 0 ? formatCurrency(avgWonValue) : "—"}
              delta={<DeltaBadge current={avgWonValue} previous={compareData?.avgWonValue ?? null} compareLabel={compareData?.rangeLabel} />}
            />
            <Stat label="Pipeline em aberto" value={formatCurrency(openTotalValue)} hint={`${openCount} negócios · agora`} />
            <Stat
              label="Negócios decididos"
              value={String(closedCount)}
              hint={`${wonCount} ganho${wonCount === 1 ? "" : "s"} · ${lostCount} perdido${lostCount === 1 ? "" : "s"} no período`}
              delta={
                compareData ? (
                  <DeltaBadge current={closedCount} previous={compareData.closedCount} compareLabel={compareData.rangeLabel} />
                ) : closedCount > 0 ? (
                  <ConversionBadge rate={winRate} />
                ) : null
              }
            />
          </div>
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Ganhos e perdidos consideram o período selecionado acima; pipeline em aberto sempre reflete o momento atual.
        </p>
      </section>

      {/* ─── Faturamento por tipo de crédito ───────────────────────────── */}
      {creditTypeBreakdown.length > 0 && (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="Carteira"
            title="Faturamento por tipo de crédito"
            description="Imóvel e veículo têm ticket e ciclo de decisão bem diferentes — vale ver o que puxa o resultado."
          />
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="card col-span-12 p-6 lg:col-span-5">
              <DonutChart
                slices={creditTypeBreakdown.map((c) => ({ label: c.label, value: c.value, color: c.color }))}
                centerValue={formatCurrency(creditTypeTotalValue)}
                centerLabel="faturamento"
              />
            </div>
            <div className="card col-span-12 overflow-x-auto p-6 lg:col-span-7">
              {compareData && (
                <p className="mb-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                  Comparando com o período selecionado: {compareData.rangeLabel}
                </p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                    <th className="pb-2 font-medium">Tipo</th>
                    <th className="pb-2 text-right font-medium">Negócios</th>
                    <th className="pb-2 text-right font-medium">Faturamento</th>
                    <th className="pb-2 text-right font-medium">Ticket médio</th>
                  </tr>
                </thead>
                <tbody>
                  {creditTypeBreakdown.map((c) => (
                    <tr key={c.key} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                      <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.label}
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{c.count}</td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                        <span className="inline-flex items-center gap-1.5">
                          {formatCurrency(c.value)}
                          {c.compareValue != null && (
                            <DeltaBadge current={c.value} previous={c.compareValue} compareLabel={compareData?.rangeLabel} />
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                        {formatCurrency(c.avgValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ─── Funil e evolução ───────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading eyebrow="Funil" title="Onde o valor está parado e como evoluiu" />
        <div className="grid grid-cols-12 gap-5">
          <div className="card col-span-12 p-6 lg:col-span-7">
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Funil por etapa</h3>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Negócios abertos agora, de etapa em etapa — veja onde mais se perde volume.
              {!pipelineFilter.pipelineId && activePipeline && (
                <> Mostrando <strong className="font-medium text-neutral-500 dark:text-neutral-400">{activePipeline.name}</strong> — etapas de funis diferentes não têm como somar num funil só; escolha um funil específico no filtro pra ver outro.</>
              )}
            </p>
            {stageData.length === 0 ? (
              <div className="mt-6">
                <FunnelSkeleton message="Nenhum negócio em aberto nesse período" />
              </div>
            ) : (
              <div className="mt-6">
                <FunnelChart
                  stages={stageData.map((s) => ({ id: s.id, label: s.name, count: s.count, value: s.value, color: s.color }))}
                />
              </div>
            )}
          </div>
          <div className="card col-span-12 p-6 lg:col-span-5">
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Evolução do valor ganho</h3>
            <div className="mt-6">
              <DrillableTrendChart dailyData={revenueTrendDaily} />
            </div>
            {revenueTrendDaily.some((d) => d.value > 0) && (
              <div className="mt-6 border-t border-neutral-100 pt-5 dark:border-neutral-800">
                <h4 className="mb-3 text-xs font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                  Por dia da semana
                </h4>
                <WeekdayHeatmap dailyData={revenueTrendDaily} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── Ranking do time — consultor vê só a própria posição no hero;
           supervisor vê o ranking da própria equipe; gerente/dono veem tudo ── */}
      {!isMember && (
      <section className="space-y-6">
        <SectionHeading
          eyebrow={isSupervisor ? "Minha equipe" : "Time"}
          title={isSupervisor ? "Ranking da equipe" : "Ranking do time"}
          description={isSupervisor
            ? "Desempenho de cada membro da sua equipe no período."
            : "Quem mais fechou negócio, quem mais foi atrás do lead (reunião ou visita), a taxa de comparecimento desses encontros e quem converte melhor."
          }
        />
        <div className="grid grid-cols-12 gap-5">
          <div className="card col-span-12 flex flex-col p-6 md:col-span-6 lg:col-span-3">
            <div className="mb-1 flex shrink-0 items-center gap-2">
              <Trophy className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Negócios fechados</h3>
            </div>
            {/* Time inteiro, não só o top 8 (ver comentário em
                lib/reports/commercial-data.ts) — rola dentro do card em vez
                de esticar o card (e a fileira inteira, já que os 4 dividem
                altura por causa do grid) até o tamanho do time. */}
            <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
              <Leaderboard entries={dealsClosedRanking} emptyLabel="Nenhum negócio ganho ainda" />
            </div>
          </div>
          <div className="card col-span-12 flex flex-col p-6 md:col-span-6 lg:col-span-3">
            <div className="mb-1 flex shrink-0 items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Reuniões e visitas realizadas</h3>
            </div>
            {/* Só conta quem o cliente de fato COMPARECEU — agendada que
                virou no-show ou remarcação não é reunião realizada (ver
                comentário em lib/reports/commercial-data.ts). O detalhamento
                por consultor (agendadas/no-show/remarcadas) mostra onde cada
                um está perdendo reunião, não só o número final. */}
            <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
              <Leaderboard entries={meetingsRanking} emptyLabel="Nenhuma reunião ou visita realizada ainda" />
            </div>
          </div>
          <div className="card col-span-12 flex flex-col p-6 md:col-span-6 lg:col-span-3">
            <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Taxa de comparecimento</h3>
              </div>
              {/* Total do time (não por consultor) — bate o olho na taxa
                  geral antes de abrir o detalhamento por pessoa logo abaixo.
                  Mesma régua do ranking: só conta quem já teve reunião/visita
                  com resultado final (compareceu ou no-show), remarcado fica
                  de fora — ver comentário em lib/reports/commercial-data.ts. */}
              {attendanceRateOverall !== null && (
                <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                  {attendanceRateOverall}%
                </span>
              )}
            </div>
            {attendanceRateOverall !== null && (
              <p className="mb-2 shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                {attendanceSummary.attended} compareceu{attendanceSummary.attended === 1 ? "" : "ram"} de{" "}
                {attendanceSummary.attended + attendanceSummary.noShow} marcado
                {attendanceSummary.attended + attendanceSummary.noShow === 1 ? "" : "s"} ({attendanceSummary.noShow} no-show)
              </p>
            )}
            <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
              <Leaderboard entries={attendanceRanking} emptyLabel="Nenhuma reunião ou visita com resultado registrado ainda" />
            </div>
          </div>
          <div className="card col-span-12 flex flex-col p-6 md:col-span-6 lg:col-span-3">
            <div className="mb-1 flex shrink-0 items-center gap-2">
              <Percent className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Taxa de conversão</h3>
            </div>
            <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
              <Leaderboard entries={conversionRanking} emptyLabel="Nenhum negócio na carteira ainda" />
            </div>
          </div>
        </div>

        {showTeamRanking && teamRanking.length > 0 && (
          <div className="card p-6">
            <div className="mb-1 flex items-center gap-2">
              <UsersRound className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Ranking de equipes</h3>
            </div>
            <Leaderboard entries={teamRanking} emptyLabel="Nenhuma equipe configurada ainda" />
          </div>
        )}
      </section>
      )}

      {/* ─── SLA e Health de equipe — gerente/dono veem a tabela completa;
           supervisor vê a equipe dele (já filtrada pelo escopo do servidor);
           consultor vê só os próprios números (já no PersonalHero) ── */}
      {(isManager || isSupervisor) && (slaSummaryRows.length > 0 || slaTotalFirstTouch > 0 || slaTotalQualified > 0) && (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="SLA do time"
            title="Tempo de resposta & Health da operação"
            description="Métricas operacionais que dono de operação de vendas paga pra ver: quanto tempo demora pro lead receber a 1ª mensagem, pra uma mensagem do lead ser respondida e pra um lead ser qualificado."
          />
          {compareData && (
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              Comparando com o período selecionado: {compareData.rangeLabel}
            </p>
          )}
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-12">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div className="card p-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-emerald-500" strokeWidth={2} />
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Contato em menos de 1 hora
                      </p>
                    </span>
                    {/* current=null (sem dado no período ATUAL) nunca vira 0
                        fingido aqui — isso faria parecer "caiu 100%" quando
                        na verdade é "não tem o que comparar ainda". */}
                    {compareData && slaOverallFirstTouchWithin1h !== null && (
                      <DeltaBadge
                        current={slaOverallFirstTouchWithin1h}
                        previous={compareData.slaFirstTouchWithin1h}
                        compareLabel={compareData.rangeLabel}
                      />
                    )}
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {slaOverallFirstTouchWithin1h !== null ? `${slaOverallFirstTouchWithin1h}%` : "—"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    {slaTotalFirstTouch > 0
                      ? `${slaWithin1hCount} de ${slaTotalFirstTouch} lead${slaTotalFirstTouch === 1 ? "" : "s"} abordado${slaTotalFirstTouch === 1 ? "" : "s"} no período`
                      : "Sem contatos abordados no período"}
                  </p>
                </div>
                <div className="card p-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Timer className="h-4 w-4 text-sky-500" strokeWidth={2} />
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Tempo médio até o 1º contato
                      </p>
                    </span>
                    {compareData && slaTotalAvgFirstTouchMs !== null && (
                      <DeltaBadge
                        current={slaTotalAvgFirstTouchMs}
                        previous={compareData.slaAvgFirstTouchMs}
                        compareLabel={compareData.rangeLabel}
                        invert
                      />
                    )}
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {slaTotalAvgFirstTouchMs !== null ? formatDuration(slaTotalAvgFirstTouchMs) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    {slaTotalFirstTouch > 0
                      ? `Média do tempo entre o lead entrar no CRM e receber a 1ª mensagem OUTBOUND`
                      : "Sem contatos abordados no período"}
                  </p>
                </div>
                <div className="card p-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-violet-500" strokeWidth={2} />
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Tempo médio de resposta do vendedor
                      </p>
                    </span>
                    {compareData && slaTotalAvgFirstReplyMs !== null && (
                      <DeltaBadge
                        current={slaTotalAvgFirstReplyMs}
                        previous={compareData.slaAvgFirstReplyMs}
                        compareLabel={compareData.rangeLabel}
                        invert
                      />
                    )}
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {slaTotalAvgFirstReplyMs !== null ? formatDuration(slaTotalAvgFirstReplyMs) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    {slaTotalP95FirstReplyMs !== null
                      ? `P95 ${formatDuration(slaTotalP95FirstReplyMs)} — tempo que 95% dos leads esperam no máximo`
                      : "Nenhuma resposta enviada no período (lead não chamou primeiro)"}
                  </p>
                </div>
                <div className="card p-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-amber-500" strokeWidth={2} />
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        Tempo médio até qualificação
                      </p>
                    </span>
                    {compareData && slaTotalAvgQualificationMs !== null && (
                      <DeltaBadge
                        current={slaTotalAvgQualificationMs}
                        previous={compareData.slaAvgQualificationMs}
                        compareLabel={compareData.rangeLabel}
                        invert
                      />
                    )}
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                    {slaTotalAvgQualificationMs !== null ? formatDuration(slaTotalAvgQualificationMs) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                    {slaTotalQualified > 0
                      ? `${slaTotalQualified} lead${slaTotalQualified === 1 ? "" : "s"} QUALIFICADO${slaTotalQualified === 1 ? "" : "S"} no período`
                      : "Nenhum lead qualificado no período"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {slaSummaryRows.length > 0 && (
            <div className="card overflow-x-auto p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  SLA por vendedor
                </h3>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Tempo real 24/7 — não conta apenas horário comercial (configurável).
                </p>
              </div>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                    <th className="pb-2 font-medium">Vendedor</th>
                    <th className="pb-2 text-right font-medium">Contato &lt;1h</th>
                    <th className="pb-2 text-right font-medium">Médio p/ 1º contato</th>
                    <th className="pb-2 text-right font-medium">Médio p/ responder</th>
                    <th className="pb-2 text-right font-medium">P95 responder</th>
                    <th className="pb-2 text-right font-medium">Médio p/ qualificar</th>
                    <th className="pb-2 text-right font-medium">Leads qualificados</th>
                  </tr>
                </thead>
                <tbody>
                  {slaSummaryRows
                    // Ordena por "quem atende mais em <1h" primeiro, depois por
                    // menor tempo médio de primeira resposta. Critério de ranking
                    // de SLA operacional: quem fecha a janela de 1h do lead com
                    // mais frequência.
                    .sort((a, b) => {
                      const apct = a.firstTouchWithin1h ?? -1;
                      const bpct = b.firstTouchWithin1h ?? -1;
                      if (bpct !== apct) return bpct - apct;
                      const at = a.avgFirstReplyMs ?? Infinity;
                      const bt = b.avgFirstReplyMs ?? Infinity;
                      if (at !== bt) return at - bt;
                      return a.name.localeCompare(b.name, "pt-BR");
                    })
                    .map((r) => (
                      <tr key={r.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                        <td className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={r.name} src={r.photoUrl ?? null} size="xs" />
                            <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {r.firstTouchWithin1h !== null ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                r.firstTouchWithin1h >= 70
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                                  : r.firstTouchWithin1h >= 40
                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                                    : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                              }`}
                            >
                              {r.firstTouchWithin1h}%
                              <span className="text-[10px] font-normal opacity-75">
                                ({r.firstTouchTotal})
                              </span>
                            </span>
                          ) : (
                            <span className="text-neutral-400 dark:text-neutral-500">—</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {r.avgFirstTouchMs !== null ? formatDuration(r.avgFirstTouchMs) : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {r.avgFirstReplyMs !== null ? formatDuration(r.avgFirstReplyMs) : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {r.p95FirstReplyMs !== null ? formatDuration(r.p95FirstReplyMs) : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {r.avgQualificationMs !== null ? formatDuration(r.avgQualificationMs) : "—"}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {r.qualificationCount > 0 ? r.qualificationCount : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Contato em menos de 1 hora: % dos leads abordados (1ª mensagem OUTBOUND do vendedor)
            que receberam a 1ª mensagem até 60 min depois de entrar no CRM (ou da thread ser
            criada, o que for mais recente — um contato importado ontem não penaliza quem
            abordou hoje). Tempo de resposta: lead chamou primeiro (mensagem INBOUND na 1ª
            posição da thread) → tempo até a 1ª mensagem OUTBOUND do vendedor; P95 = 95% dos
            casos demoram no máximo esse valor — serve pra identificar quem tem &apos;pico de
            espera&apos; escondido na média. Tempo até qualificação: tempo entre a criação do
            contato e a marcação QUALIFIED. Vendedores sem nenhum dado no período não
            aparecem aqui — o card &apos;Atividade da equipe&apos; abaixo já mostra tempo no CRM por
            pessoa, inclusive quem ficou parado.
          </p>
        </section>
      )}

      {/* ─── Atividade da equipe (só Dono/Gerente) ─────────────────────── */}
      {isManager && showTeamActivity && (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="Equipe"
            title="Atividade da equipe"
            description="Tempo com a aba do CRM em primeiro plano e quantidade de alterações no período — visível só pra Dono e Gerente. Mede a aba aberta, não clique/teclado: não exige foco da janela no sistema, então uma aba deixada aberta sem uso ainda soma tempo."
          />
          <div className="grid grid-cols-12 gap-5">
            <div className="card col-span-12 p-6 md:col-span-6">
              <div className="mb-1 flex items-center gap-2">
                <Clock className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Tempo com o CRM aberto</h3>
              </div>
              <Leaderboard entries={crmTimeRanking} emptyLabel="Sem uso registrado nesse período" />
            </div>
            <div className="card col-span-12 p-6 md:col-span-6">
              <div className="mb-1 flex items-center gap-2">
                <Activity className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Mais alterações</h3>
              </div>
              <Leaderboard entries={crmChangesRanking} emptyLabel="Nenhuma alteração registrada nesse período" />
            </div>
            <div className="card col-span-12 p-6">
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Tempo ativo da equipe por dia</h3>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Soma do tempo com a aba do CRM em primeiro plano, todo mundo junto, dia a dia.
              </p>
              <div className="mt-6">
                <TrendAreaChart data={teamActivityTrend} format={{ type: "duration" }} />
              </div>
            </div>
          </div>

          <TeamActivityList members={teamActivityList} />
        </section>
      )}

      {/* ─── Cargo do lead ──────────────────────────────────────────── */}
      {jobTitleBreakdown.length > 0 && (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="Perfil do lead"
            title="Conversão por cargo"
            description="Quais cargos mais fecham negócio no período — ajuda a saber onde focar a prospecção."
          />
          <div className="card overflow-x-auto p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                  <th className="pb-2 font-medium">Cargo</th>
                  <th className="pb-2 text-right font-medium">Ganhos</th>
                  <th className="pb-2 text-right font-medium">Perdidos</th>
                  <th className="pb-2 text-right font-medium">Conversão</th>
                  <th className="pb-2 text-right font-medium">Valor ganho</th>
                </tr>
              </thead>
              <tbody>
                {jobTitleBreakdown.map((j) => (
                  <tr key={j.label} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                    <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{j.label}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{j.won}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{j.lost}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{j.winRate}%</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {formatCurrency(j.wonValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── Motivos de perda ───────────────────────────────────────── */}
      {lostCount > 0 && (
        <section className="space-y-6">
          <SectionHeading eyebrow="Perdas" title={`Por que perdemos negócios (${lostCount} ao todo)`} />
          <div className="card p-6">
            {compareData && (
              <p className="mb-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                Comparando com o período selecionado: {compareData.rangeLabel}
              </p>
            )}
            {lossBreakdown.length === 0 ? (
              <EmptyState icon={XCircle} title="Nenhum motivo registrado" />
            ) : (
              <div className="space-y-2.5">
                {lossBreakdown.map((l) => (
                  <BarRow
                    key={l.id}
                    label={l.label}
                    value={l.count}
                    max={maxLossCount}
                    displayValue={String(l.count)}
                    wrapLabel
                    extra={
                      l.compareCount != null ? (
                        <DeltaBadge current={l.count} previous={l.compareCount} compareLabel={compareData?.rangeLabel} invert />
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── WhatsApp — consultor vê só o próprio card; gerente/dono veem todos ── */}
      {sellerWhatsappCards.length > 0 && (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="WhatsApp"
            title="Atividade por vendedor"
            description="Geral (fora de negócio), prospecção fria (campanhas), prospecção manual (1ª mensagem sua pra um lead novo) e conversas de negócio — cada mensagem conta numa categoria só."
          />

          <div className="space-y-3">
            {sellerWhatsappCards
              // Consultor vê só o próprio card; supervisor e gerente/dono veem toda a equipe
              .filter((w) => isManager || isSupervisor || w.userId === userId)
              .map((w) => (
              <div key={w.userId} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={w.name} size="sm" />
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{w.name}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Métrica de resultado (venda fechada), não de atividade — por isso fica
                        no cabeçalho do card, fora dos painéis abaixo (que são só volume de
                        mensagem por categoria). Ela soma contato de qualquer categoria, então
                        dentro de um painel específico ia parecer que só aquela categoria conta. */}
                    <span className="inline-flex items-baseline gap-1.5 text-sm" title="% dos contatos abordados organicamente que fecharam negócio no período">
                      <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{w.conversionRate}%</span>
                      <span className="text-xs text-neutral-400 dark:text-neutral-500">conversão em venda</span>
                    </span>
                    <span className="h-4 w-px shrink-0 bg-neutral-200 dark:bg-neutral-800" />
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        w.connected
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${w.connected ? "bg-emerald-500" : "bg-neutral-400"}`} />
                      {w.connected ? "Conectado" : "Desconectado"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2.5">
                  <SellerStatPanel title="Geral" dot="neutral">
                    <MiniStat value={w.sent} label="enviadas" />
                    <MiniStat value={`${w.replyRate}%`} label="resposta" />
                  </SellerStatPanel>

                  {w.campaignSent > 0 && (
                    <SellerStatPanel title="Prospecção fria" dot="violet">
                      <MiniStat value={w.campaignSent} label="enviadas" />
                      <MiniStat value={`${w.campaignReplyRate}%`} label="resposta" />
                      <MiniStat
                        value={w.possibleColdDeals}
                        label={w.possibleColdDeals === 1 ? "possível negociação" : "possíveis negociações"}
                      />
                    </SellerStatPanel>
                  )}

                  {w.manualProspectSent > 0 && (
                    <SellerStatPanel title="Prospecção manual" dot="amber">
                      <MiniStat value={w.manualProspectSent} label="enviadas" />
                      <MiniStat value={`${w.manualProspectReplyRate}%`} label="resposta" />
                    </SellerStatPanel>
                  )}

                  {w.deal && (
                    <SellerStatPanel title="Conversas de negócio" dot="emerald">
                      <MiniStat value={w.deal.conversations} label="conversas" />
                      <MiniStat value={w.deal.responseRate === null ? "—" : `${w.deal.responseRate}%`} label="resposta" />
                      {w.deal.avgFirstResponseMs !== null && (
                        <MiniStat value={formatDuration(w.deal.avgFirstResponseMs)} label="1ª resposta" />
                      )}
                      {w.deal.avgDurationMs !== null && <MiniStat value={formatDuration(w.deal.avgDurationMs)} label="duração" />}
                      <MiniStat
                        value={w.deal.messagesPerDay.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                        label="msgs/dia"
                      />
                    </SellerStatPanel>
                  )}
                </div>
              </div>
            ))}
          </div>

          {whatsappInstances.length > 0 && (
            <div className="card overflow-x-auto p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Instabilidade de número (risco de banimento)</h3>
                <span className="inline-flex items-baseline gap-1.5 text-sm" title="Cada uma é uma sessão ao vivo no servidor Evolution — sinal antecipado de carga antes de sentir lentidão de verdade">
                  <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{connectedEvolutionCount}</span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    conexão{connectedEvolutionCount === 1 ? "" : "ões"} Evolution ativa{connectedEvolutionCount === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                Instância que caiu {RISK_THRESHOLD}+ vezes numa janela de 7 dias entra automaticamente em risco (a
                campanha que dispara por ela é pausada sozinha) — a tabela abaixo só mostra quem já tem alguma queda
                recente, pra acompanhar antes de virar risco de verdade.
              </p>
              {instabilityRows.length === 0 ? (
                <p className="mt-4 text-sm text-neutral-400 dark:text-neutral-500">Nenhuma instância com queda recente agora.</p>
              ) : (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                    <th className="pb-2 font-medium">Vendedor</th>
                    <th className="pb-2 font-medium">Número</th>
                    <th className="pb-2 text-right font-medium">Quedas (7d)</th>
                    <th className="pb-2 text-right font-medium">Campanhas pausadas</th>
                    <th className="pb-2 text-right font-medium">Msgs de campanha (7d)</th>
                    <th className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {instabilityRows.map((r) => (
                    <tr key={r.userId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                      <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{r.name}</td>
                      <td className="py-2.5 text-neutral-500 dark:text-neutral-400">
                        {r.phoneNumber ?? "—"} <span className="text-xs text-neutral-400 dark:text-neutral-500">({r.provider})</span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{r.recentDisconnectCount}</td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{r.pausedCampaigns}</td>
                      <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{r.recentCampaignSent}</td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            r.atRisk
                              ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${r.atRisk ? "bg-red-500" : "bg-amber-500"}`} />
                          {r.atRisk ? "Em risco" : "Observar"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          )}

          {scriptBreakdown.length > 0 && (
            <div className="grid grid-cols-12 gap-5">
              <div className="card col-span-12 overflow-x-auto p-6 lg:col-span-6">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Prospecção fria por script</h3>
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                      <th className="pb-2 font-medium">Script</th>
                      <th className="pb-2 text-right font-medium">Enviadas</th>
                      <th className="pb-2 text-right font-medium">Responderam</th>
                      <th className="pb-2 text-right font-medium">Taxa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scriptBreakdown.map((s) => (
                      <tr key={s.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                        <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{s.name}</td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{s.sent}</td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{s.replied}</td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{s.replyRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card col-span-12 overflow-x-auto p-6 lg:col-span-6">
                <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Prospecção fria por cargo</h3>
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                      <th className="pb-2 font-medium">Cargo</th>
                      <th className="pb-2 text-right font-medium">Enviadas</th>
                      <th className="pb-2 text-right font-medium">Responderam</th>
                      <th className="pb-2 text-right font-medium">Taxa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cargoBreakdown.map((c) => (
                      <tr key={c.label} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                        <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{c.label}</td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{c.sent}</td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{c.replied}</td>
                        <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{c.replyRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Conversão em venda = % dos contatos organicamente contatados (qualquer categoria) que fecharam negócio
            (ganho) dentro do período do filtro — nunca é "essa mensagem virou venda", é o resultado final do contato.
            Geral = conversa fora de negócio. Prospecção fria = disparo em massa via Campanhas — dentro dela,
            “possível negociação” é o lead que já respondeu mais de {COLD_POSSIBLE_DEAL_MIN_REPLIES} mensagens
            desde o disparo (não é contagem do período, é a conversa toda) e AINDA não virou negócio — quem já é
            negócio (aberto, ganho ou perdido) sai da lista de "possível" e passa a aparecer em "conversas de
            negócio". Prospecção manual = a
            1ª mensagem de uma thread nova foi sua (não do lead) e ela hoje tem negócio — abordagem fria feita na mão.
            Conversas de negócio = toda a troca (inclusive a de abertura, se for o caso) de contato já vinculado a um
            negócio. Geral, prospecção fria e prospecção manual nunca compartilham mensagem entre si; conversas de
            negócio é a única exceção — repete a troca inteira, incluindo a mensagem de abertura já contada em
            prospecção manual quando for o caso, porque precisa da conversa completa pra calcular tempo de resposta e
            duração. Resposta = % que o lead respondeu; 1ª resposta e duração são médias de tempo.
          </p>
        </section>
      )}
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{title}</h2>
      {description && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>}
    </div>
  );
}

/** `emphasize`: destaque visual (fundo/borda esmeralda, valor maior) — reservado
 * pra UM stat por linha no máximo (hoje só "Total ganho"), pra continuar
 * chamando atenção; virar padrão em todo card tiraria o próprio destaque.
 * `delta`: badge opcional de variação vs período anterior (ver DeltaBadge). */
function Stat({ label, value, hint, emphasize, delta }: { label: string; value: string; hint?: string; emphasize?: boolean; delta?: ReactNode }) {
  if (emphasize) {
    return (
      <div className="card border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/60 dark:bg-emerald-500/10">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Wallet className="h-4 w-4 shrink-0" strokeWidth={2} />
            {label}
          </p>
          {delta}
        </div>
        <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{value}</p>
        {hint && <p className="mt-1 text-xs text-emerald-700/70 dark:text-emerald-400/70">{hint}</p>}
      </div>
    );
  }
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
        {delta}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}

/**
 * Taxa de conversão (ganhos ÷ decididos, mesmo winRate já usado no centro do
 * donut "Negócios por status" e nos Insights automáticos — nunca um cálculo
 * duplicado à parte) ao lado do total de "Negócios decididos". Mesmas 2
 * faixas de leitura já usadas em auto-insights.tsx (≥60% positivo, <20%
 * alerta) — não invento um 3º limiar novo só pra esse badge, meio-termo fica
 * neutro/cinza, sem alarme nem elogio.
 */
function ConversionBadge({ rate }: { rate: number }) {
  const tone =
    rate >= 60
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      : rate < 20
        ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>
      <Percent className="h-3 w-3" strokeWidth={2.5} />
      {rate}% conversão
    </span>
  );
}

const PANEL_DOT: Record<"neutral" | "emerald" | "violet" | "amber", string> = {
  neutral: "bg-neutral-400 dark:bg-neutral-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
};

/**
 * Agrupa as estatísticas de uma categoria (Geral / Prospecção fria /
 * Prospecção manual / Conversas de negócio) num bloco próprio — a cor entra
 * só como um "chip" ao lado do título (identidade da categoria), nunca
 * tingindo o número: um texto colorido é mais difícil de ler e a mesma cor
 * usada em várias categorias diferentes deixa de significar algo único.
 */
function SellerStatPanel({
  title,
  dot,
  children,
}: {
  title: string;
  dot: "neutral" | "emerald" | "violet" | "amber";
  children: ReactNode;
}) {
  return (
    <div className="min-w-[168px] flex-1 basis-[168px] rounded-lg border border-neutral-100 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/40">
      <div className="mb-2 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PANEL_DOT[dot]}`} />
        <p className="text-[11px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">{title}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">{children}</div>
    </div>
  );
}

/** "234 enviadas" — número em destaque seguido do rótulo, dentro de um SellerStatPanel. */
function MiniStat({ value, label }: { value: string | number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm">
      <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</span>
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
    </span>
  );
}
