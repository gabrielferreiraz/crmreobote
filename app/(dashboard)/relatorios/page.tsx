import type { ReactNode } from "react";
import { Trophy, XCircle, CalendarCheck, Percent, UsersRound, Clock, Activity, UserCheck, Wallet, PhoneCall, FileText, FileCheck2, ListTodo } from "lucide-react";
import { auth } from "@/lib/auth";
import { formatCurrency, formatDuration } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/avatar";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendAreaChart, DrillableTrendChart } from "@/components/charts/trend-area-chart";
import { PersonalHero, findRankingPosition } from "./personal-hero";
import { WonDealsButton } from "./won-deals-button";
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
import { getCurrentMembership } from "@/lib/current-membership";
import { resolveAvatarUrl } from "@/lib/r2";
import { AdminReportsView } from "./admin-reports-view";
import { MetaAdsReportView } from "./meta-ads-view";
import { ReportTabs } from "./report-tabs";
import { getCommercialReportData } from "@/lib/reports/commercial-data";
import { AutoInsights, DeltaBadge } from "./auto-insights";
import { WeekdayHeatmap } from "./weekday-heatmap";
import { RankingCardsGrid, type RankingCardData } from "./ranking-cards-grid";

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
  const membership = await getCurrentMembership();
  const currentUserPhotoUrl = await resolveAvatarUrl(membership?.photoKey ?? session!.user.image);

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
    rangeFromIso,
    rangeToIso,
    openCount,
    wonCount,
    lostCount,
    closedCount,
    winRate,
    wonTotalValue,
    wonGrossTotalValue,
    openTotalValue,
    avgWonValue,
    compareData,
    creditTypeBreakdown,
    creditTypeTotalValue,
    stageData,
    dealsClosedRanking,
    topSellerRevenueShare,
    meetingsRanking,
    funnelActivityRanking,
    completedTasksRanking,
    attendanceRanking,
    attendanceSummary,
    attendanceRateOverall,
    conversionRanking,
    proposalsSentRanking,
    proposalsConversionRanking,
    proposalsSummary,
    proposalsConversionRate,
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
    sellerWhatsappCards,
    currentMonthLabel,
    selectedMonthLabel,
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

  // Rótulo do período no painel "Ver negócios" do card "Negócios fechados" —
  // mês por extenso quando o período é um mês civil inteiro (mesmo selo do
  // título), senão as datas, senão "Todo o histórico".
  const fmtDay = (d: string) => d.split("-").reverse().join("/");
  const periodLabel =
    selectedMonthLabel ??
    (fromParam && toParam ? `${fmtDay(fromParam)} – ${fmtDay(toParam)}` : rangeParam === "all" ? "Todo o histórico" : "Período selecionado");
  // Cada linha do ranking ganha "Ver negócios" — os limites são os JÁ
  // resolvidos pelo relatório (rangeFromIso/rangeToIso) e o mesmo funil, pra
  // lista de cada pessoa somar exatamente o número que está no card.
  const dealsClosedRankingWithAction = dealsClosedRanking.map((entry) => ({
    ...entry,
    action: (
      <WonDealsButton
        ownerId={entry.id}
        ownerName={entry.name}
        photoUrl={entry.photoUrl ?? null}
        fromIso={rangeFromIso}
        toIso={rangeToIso}
        pipelineId={pipelineFilter.pipelineId ?? null}
        periodLabel={periodLabel}
      />
    ),
  }));

  // Dados necessários pro PersonalHero — extraídos dos rankings já computados.
  const personalRankingPos = isPersonalView
    ? findRankingPosition(dealsClosedRanking, currentUserName)
    : null;

  // Cards do ranking do time (ver RankingCardsGrid) — array em vez de JSX solto
  // de propósito: é o que deixa a pessoa arrastar pra reordenar (a grade
  // precisa de um id estável por card pra isso). Ordem aqui = ordem padrão até
  // alguém mexer pela 1ª vez (guardada só no navegador dela).
  const rankingCards: RankingCardData[] = [
    {
      id: "dealsClosed",
      icon: <Trophy className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Negócios fechados",
      body: (
        // Time inteiro, não só o top 8 (ver comentário em
        // lib/reports/commercial-data.ts) — rola dentro do card em vez de
        // esticar o card (e a fileira inteira, já que os cards dividem altura
        // por serem da mesma fileira) até o tamanho do time.
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={dealsClosedRankingWithAction} emptyLabel="Nenhum negócio ganho ainda" />
        </div>
      ),
    },
    {
      id: "meetings",
      icon: <CalendarCheck className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Videochamadas e visitas",
      body: (
        // Só conta quem o cliente de fato COMPARECEU — agendada que virou
        // no-show ou remarcação não é videochamada realizada (ver comentário
        // em lib/reports/commercial-data.ts). O detalhamento por consultor
        // (agendadas/no-show/remarcadas) mostra onde cada um está perdendo
        // videochamada, não só o número final.
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={meetingsRanking} emptyLabel="Nenhuma videochamada ou visita realizada ainda" />
        </div>
      ),
    },
    {
      id: "funnelActivity",
      icon: <PhoneCall className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Movimentação no funil",
      body: (
        // Ligação + proposta + WhatsApp registrados (ver comentário em
        // lib/reports/commercial-data.ts) — diferente do card de
        // videochamadas/visitas, esses 3 tipos não têm "resultado" pra
        // separar: a própria Activity existir já é o registro de que a ação
        // aconteceu.
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={funnelActivityRanking} emptyLabel="Nenhuma ligação, proposta ou WhatsApp registrado ainda" />
        </div>
      ),
    },
    {
      id: "completedTasks",
      icon: <ListTodo className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Tarefas concluídas",
      body: (
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={completedTasksRanking} emptyLabel="Nenhuma tarefa concluída ainda" />
        </div>
      ),
    },
    {
      id: "attendance",
      icon: <UserCheck className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Taxa de comparecimento",
      // Total do time (não por consultor) — bate o olho na taxa geral antes de
      // abrir o detalhamento por pessoa logo abaixo. Mesma régua do ranking:
      // só conta quem já teve videochamada/visita com resultado final
      // (compareceu ou no-show), remarcado fica de fora — ver comentário em
      // lib/reports/commercial-data.ts.
      headerExtra:
        attendanceRateOverall !== null ? (
          <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">{attendanceRateOverall}%</span>
        ) : null,
      subheader:
        attendanceRateOverall !== null ? (
          <p className="mb-2 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {attendanceSummary.attended} de {attendanceSummary.attended + attendanceSummary.noShow} encontros realizados
            {attendanceSummary.noShow > 0 ? ` · ${attendanceSummary.noShow} no-show` : ""}
          </p>
        ) : null,
      body: (
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={attendanceRanking} emptyLabel="Nenhuma videochamada ou visita com resultado registrado ainda" />
        </div>
      ),
    },
    {
      id: "conversion",
      icon: <Percent className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Taxa de conversão",
      body: (
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={conversionRanking} emptyLabel="Nenhum negócio na carteira ainda" />
        </div>
      ),
    },
    // Propostas comerciais (módulo Proposal, ver lib/proposals). Dois cards
    // com o MESMO resumo no topo — volume enviado e conversão contam a mesma
    // coorte (propostas com data de envio no período), só ordenam diferente:
    // quem manda mais × quem aceita mais. O resumo mostra TODOS os desfechos
    // (recusada, refeita, cancelada, pendente), não só aceitas: porcentagem
    // sozinha engana e "pendente" é o que denuncia proposta que ninguém
    // acompanhou.
    {
      id: "proposalsSent",
      icon: <FileText className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Propostas enviadas",
      headerExtra:
        proposalsSummary.sent > 0 ? (
          <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">{proposalsSummary.sent}</span>
        ) : null,
      subheader:
        proposalsSummary.sent > 0 ? (
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <ProposalMetric label="Aceitas" value={proposalsSummary.accepted} tone="success" />
            <ProposalMetric label="Pendentes" value={proposalsSummary.pending} tone={proposalsSummary.pending > 0 ? "warn" : "neutral"} />
            <ProposalMetric label="Recusadas" value={proposalsSummary.declined} tone="danger" />
            <ProposalMetric label="Refeitas" value={proposalsSummary.superseded} tone="info" />
          </div>
        ) : null,
      body: (
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={proposalsSentRanking} emptyLabel="Nenhuma proposta enviada no período" />
        </div>
      ),
    },
    {
      id: "proposalsConversion",
      icon: <FileCheck2 className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
      title: "Conversão de propostas",
      headerExtra:
        proposalsConversionRate !== null ? (
          <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">{proposalsConversionRate}%</span>
        ) : null,
      subheader:
        proposalsConversionRate !== null ? (
          <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {proposalsSummary.accepted} de {proposalsSummary.sent} enviadas foram aceitas
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, proposalsConversionRate)}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              {proposalsSummary.pending > 0
                ? `${proposalsSummary.pending} ainda sem resposta. Pendências não contam como aceita nem como recusa.`
                : "Sem pendências no período."}
            </p>
          </div>
        ) : null,
      body: (
        <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
          <Leaderboard entries={proposalsConversionRanking} emptyLabel="Nenhuma proposta enviada no período" />
        </div>
      ),
    },
    // Ranking de equipes (só quando existe mais de uma configurada, ver
    // showTeamRanking) — pedido explícito: "o ranking [de equipes] dá pra
    // entrar nesse scroll lateral também". Antes era um card full-width
    // solto abaixo da fileira; agora é só mais um card dela, arrastável e
    // alcançável pelo mesmo scroll lateral que os outros.
    ...(showTeamRanking && teamRanking.length > 0
      ? [
          {
            id: "teamRanking",
            icon: <UsersRound className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />,
            title: "Ranking de equipes",
            body: (
              <div className="scrollbar-thin max-h-[360px] overflow-x-hidden overflow-y-auto pr-1">
                <Leaderboard entries={teamRanking} emptyLabel="Nenhuma equipe configurada ainda" />
              </div>
            ),
          } satisfies RankingCardData,
        ]
      : []),
  ];

  return (
    <div className="space-y-10 pb-8 sm:space-y-16">
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
              {/* Nome do mês em destaque ao lado do título quando o período
                  selecionado bate com um mês civil inteiro (ver
                  selectedMonthLabel em lib/reports/commercial-data.ts) —
                  pedido explícito: o botão do filtro ("Há 2 meses") sozinho
                  não diz QUAL mês é. flex-wrap: no celular (título grande +
                  selo já não cabem lado a lado) o selo desce pra própria
                  linha em vez de espremer o título. */}
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl dark:text-neutral-100">
                  {isManager ? "Panorama da operação" : "Panorama comercial"}
                </h1>
                {selectedMonthLabel && (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand sm:px-3 sm:py-1 sm:text-sm dark:bg-brand/20">
                    {selectedMonthLabel}
                  </span>
                )}
              </div>
              {/* Some no celular: o título + filtros já dizem o que é a tela, e o parágrafo empurrava o conteúdo pra fora da primeira tela. */}
              <p className="mt-2 hidden max-w-lg text-sm text-neutral-500 sm:block dark:text-neutral-400">
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
          {/* Celular: grade 2 colunas (era flex-wrap, cada filtro só
              ocupando a própria largura fixa — 4 caixas de tamanhos
              diferentes empilhadas, uma por linha, sem alinhar entre si —
              pedido explícito, "não parece harmônico"). Cada filtro vira
              w-full DENTRO da célula abaixo de sm (ver className de cada um
              — Select recebe isso via prop, DateRangeFilter/
              ComparePeriodFilter têm o próprio botão ajustado). A partir de
              sm volta a ser a fileira flex de sempre, cada um com a própria
              largura — nunca teve relato de problema lá, sobra espaço de
              sobra pra não precisar de grade. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center xl:shrink-0">
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
            photoUrl={currentUserPhotoUrl}
            role={isMember ? "MEMBER" : "SUPERVISOR"}
            wonCount={wonCount}
            wonTotalValue={wonTotalValue}
            avgWonValue={avgWonValue}
            winRate={winRate}
            rankingPosition={personalRankingPos}
            totalRankingMembers={dealsClosedRanking.length}
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
        lossBreakdown={lossBreakdown}
        topSellerRevenueShare={topSellerRevenueShare}
        revenueTrendDaily={revenueTrendDaily}
      />

      {/* ─── Visão geral ────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading eyebrow="Visão geral" title="Como o funil está hoje" />
        <div className="grid grid-cols-12 items-start gap-5">
          <div className="card col-span-12 p-6 lg:col-span-4">
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
          {/* Grid de 6 (não flex-wrap nem grid-cols-2) de propósito — são
              sempre exatamente 5 stats fixos (não uma lista dinâmica), então
              dá pra travar o desenho hard-coded: os 3 primeiros com 2/6
              (fecham a 1ª fileira, 2+2+2=6) e os 2 últimos com 3/6 (fecham a
              2ª fileira sozinhos, 3+3=6) — 3 em cima, 2 embaixo, as duas
              fileiras SEMPRE cheias, sem vão vazio (pedido explícito) e sem
              depender de flex-wrap decidir quantos cabem por fileira (isso
              variava com a largura disponível e deixava "Vendas líquidas"
              apertado demais quando cabiam 4 por fileira em vez de 3). */}
          <div className="col-span-12 grid grid-cols-1 gap-5 lg:col-span-8 lg:grid-cols-6">
            <Stat
              label="Vendas líquidas"
              value={formatCurrency(wonTotalValue)}
              hint={`${wonCount} negócio${wonCount === 1 ? "" : "s"} fechado${wonCount === 1 ? "" : "s"} no período`}
              emphasize
              delta={<DeltaBadge current={wonTotalValue} previous={compareData?.wonTotalValue ?? null} compareLabel={compareData?.rangeLabel} />}
              className="lg:col-span-2"
            />
            {/* Pedido explícito: card próprio ao lado de "Vendas líquidas" —
                mesmo período/escopo/funil, só troca Deal.value por
                Deal.grossValue na soma (ver wonGrossTotalValue em
                lib/reports/commercial-data.ts). Sem `emphasize` de
                propósito — esse destaque (fundo/borda esmeralda) é
                reservado a UM card só (ver comentário em Stat mais abaixo),
                senão os dois lado a lado tiram o destaque um do outro. */}
            <Stat
              label="Vendas brutas"
              value={formatCurrency(wonGrossTotalValue)}
              hint={`${wonCount} negócio${wonCount === 1 ? "" : "s"} fechado${wonCount === 1 ? "" : "s"} no período`}
              delta={<DeltaBadge current={wonGrossTotalValue} previous={compareData?.wonGrossTotalValue ?? null} compareLabel={compareData?.rangeLabel} />}
              className="lg:col-span-2"
            />
            <Stat
              label="Ticket médio"
              value={wonCount > 0 ? formatCurrency(avgWonValue) : "—"}
              delta={<DeltaBadge current={avgWonValue} previous={compareData?.avgWonValue ?? null} compareLabel={compareData?.rangeLabel} />}
              className="lg:col-span-2"
            />
            <Stat
              label="Pipeline em aberto"
              value={formatCurrency(openTotalValue)}
              hint={`${openCount} negócios · agora`}
              className="lg:col-span-3"
            />
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
              className="lg:col-span-3"
            />
          </div>
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Ganhos e perdidos consideram o período selecionado acima; pipeline em aberto sempre reflete o momento atual.
        </p>
      </section>

      {/* ─── Ranking do time — consultor vê só a própria posição no hero;
           supervisor vê o ranking da própria equipe; gerente/dono veem tudo.
           Pedido explícito: "deixar em uma posição mais privilegiada" — uma
           das informações mais importantes do relatório, então sobe pra
           logo depois da Visão geral, antes de Faturamento por tipo de
           crédito e Funil (só estavam mais acima antes por ordem histórica
           de quando cada seção foi escrita, nunca por prioridade real). ── */}
      {/* Consultor também vê a seção — mas o escopo dele (getDealScope) é só
          ele mesmo, então cada card traz apenas os PRÓPRIOS números (nunca os
          de colegas): pedido explícito, "cada consultor deve ver quantas
          tarefas e tudo o que ele fez". */}
      <section className="space-y-6">
        <SectionHeading
          eyebrow={isMember ? "Meu desempenho" : isSupervisor ? "Minha equipe" : "Time"}
          title={isMember ? "O que eu fiz no período" : isSupervisor ? "Ranking da equipe" : "Ranking do time"}
          description={isMember
            ? "Suas tarefas concluídas, negócios fechados, videochamadas e visitas, ligações, propostas e WhatsApp, comparecimento e conversão no período selecionado."
            : isSupervisor
            ? "Desempenho de cada membro da sua equipe no período."
            : "Quem mais fechou negócio, concluiu tarefas, foi atrás do lead (videochamada ou visita), movimentou o funil, teve comparecimento e converteu melhor."
          }
        />
        <RankingCardsGrid cards={rankingCards} />
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
            description="Geral (fora de negócio), prospecção fria (campanhas), prospecção manual (1ª mensagem sua pra um lead novo) e conversas de negócio — as 3 primeiras nunca compartilham mensagem entre si; conversas de negócio é a exceção que repete o que já apareceu em prospecção manual (ver nota completa no fim da seção)."
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
                        <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100" title={s.preview ?? undefined}>{s.name}</td>
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
            Conversão em venda = percentual dos contatos organicamente contatados que fecharam negócio dentro do período
            do filtro. Não significa que uma mensagem específica virou venda; é o resultado final do contato. Geral =
            conversa fora de negócio. Prospecção fria = disparo em massa via Campanhas; possível negociação é o lead que
            já respondeu mais de {COLD_POSSIBLE_DEAL_MIN_REPLIES} mensagens desde o disparo e ainda não virou negócio.
            Prospecção manual = a primeira mensagem de uma thread nova foi sua e hoje ela tem negócio. Conversas de
            negócio = toda troca de contato já vinculado a um negócio. Alguns tempos dependem da conversa completa.
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
 * pra UM stat só (hoje "Vendas líquidas", antes chamado "Total ganho"), pra
 * continuar chamando atenção; virar padrão em todo card tiraria o próprio
 * destaque (por isso "Vendas brutas", ao lado, não usa).
 * `delta`: badge opcional de variação vs período anterior (ver DeltaBadge). */
function Stat({ label, value, hint, emphasize, delta, className = "" }: { label: string; value: string; hint?: string; emphasize?: boolean; delta?: ReactNode; className?: string }) {
  if (emphasize) {
    return (
      <div className={`card border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/60 dark:bg-emerald-500/10 ${className}`}>
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
    <div className={`card p-5 ${className}`}>
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

function ProposalMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warn" | "danger" | "info" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
        : tone === "danger"
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
          : tone === "info"
            ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400"
            : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400";

  return (
    <div className={`rounded-md border px-2.5 py-2 ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
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
