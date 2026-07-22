import type { ReactNode } from "react";
import { Trophy, XCircle, CalendarCheck, Percent, UsersRound, Clock, Activity } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, daysSince, formatDuration } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/avatar";
import { getDealScope, scopeWhere, whatsappScopeWhere, type DealScope } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilDateStringToUTC, brazilEndOfDayUTC, brazilStartOfMonth, brazilStartOfDay, brazilDateKey, getBrazilParts } from "@/lib/timezone";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendAreaChart } from "@/components/charts/trend-area-chart";
import { FunnelChart, FunnelSkeleton } from "@/components/charts/funnel-chart";
import { Leaderboard, type LeaderboardEntry } from "@/components/leaderboard";
import { ONLINE_THRESHOLD_MS } from "@/lib/user-activity";
import { TeamActivityList } from "./team-activity-list";
import { BarRow } from "./bar-row";
import { DateRangeFilter } from "./date-range-filter";
import { TeamOwnerFilter } from "./team-owner-filter";
import { GoalCard } from "./goal-card";
import { getCurrentUserArea } from "@/lib/user-area";
import { AdminReportsView } from "./admin-reports-view";

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string; from?: string; to?: string; who?: string }>;
}) {
  // Administrativo (pós-venda) vê um relatório próprio — funil/metas de
  // vendas não fazem sentido pra quem não vende.
  const area = await getCurrentUserArea();
  if (area === "ADMINISTRATIVO") return <AdminReportsView />;

  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const { pipelineId: pipelineIdParam, from: fromParam, to: toParam, who: whoParam } = await searchParams;

  return runWithTenant(organizationId, async () => {
  const scope = await getDealScope(organizationId, userId, session!.user.role);

  // Membros que esta pessoa já enxerga no escopo normal dela — vira tanto as
  // opções do filtro por equipe/responsável abaixo quanto a base do ranking
  // de equipes. O filtro só ESTREITA o que já era visível, nunca abre acesso
  // a mais gente do que o papel do usuário já permite.
  const visibleMembers = await prisma.organizationUser.findMany({
    where: { organizationId, active: true, ...(scope.type === "owners" ? { userId: { in: scope.ownerIds } } : {}) },
    select: {
      userId: true,
      teamId: true,
      team: { select: { id: true, name: true } },
      user: { select: { name: true } },
      lastActiveAt: true,
    },
  });
  const teamFilterOptions = Array.from(
    new Map(visibleMembers.filter((m) => m.teamId && m.team).map((m) => [m.teamId!, m.team!.name])),
    ([id, name]) => ({ id, name }),
  );
  const memberFilterOptions = visibleMembers.map((m) => ({ id: m.userId, name: m.user.name }));

  // "team:<id>" ou "owner:<id>" — um único parâmetro de URL pro dropdown
  // combinado (ver team-owner-filter.tsx), mais simples que dois selects que
  // precisariam se zerar um ao outro.
  const filterTeamId = whoParam?.startsWith("team:") ? whoParam.slice(5) : undefined;
  const filterOwnerId = whoParam?.startsWith("owner:") ? whoParam.slice(6) : undefined;

  let effectiveScope: DealScope = scope;
  if (filterTeamId) {
    const ids = visibleMembers.filter((m) => m.teamId === filterTeamId).map((m) => m.userId);
    effectiveScope = { type: "owners", ownerIds: ids };
  } else if (filterOwnerId && visibleMembers.some((m) => m.userId === filterOwnerId)) {
    effectiveScope = { type: "owners", ownerIds: [filterOwnerId] };
  }
  const ownerScopeWhere = effectiveScope.type === "owners" ? { userId: { in: effectiveScope.ownerIds } } : {};
  // Ranking de equipes exige a visão irrestrita de base — um líder de equipe
  // só veria a própria equipe sozinha (não é comparação de verdade), e um
  // filtro ativo (equipe/pessoa específica) já não faz sentido comparar times.
  const showTeamRanking = scope.type === "all" && !filterTeamId && !filterOwnerId;

  // Tempo no CRM e contagem de alterações são dados sensíveis de desempenho —
  // só Dono/Gerente vê (reaproveita os papéis existentes, sem tela de
  // permissão nova por pessoa).
  const showTeamActivity = session!.user.role === "OWNER" || session!.user.role === "MANAGER";

  // Período do relatório — só afeta negócios DECIDIDOS (ganhos/perdidos),
  // reuniões e WhatsApp. O pipeline em aberto continua sempre "agora": não
  // faz sentido dizer que um negócio ainda aberto "é de março".
  // fromParam/toParam são dias civis de Brasília (calculados no navegador do
  // usuário, ver date-range-filter.tsx) — o servidor roda em UTC (ver
  // lib/timezone.ts), então `new Date("YYYY-MM-DDT00:00:00")` direto
  // interpretaria como meia-noite UTC, 3h adiantada da meia-noite real de
  // Brasília, deslocando o filtro inteiro.
  const rangeFrom = fromParam ? brazilDateStringToUTC(fromParam) : null;
  const rangeTo = toParam ? brazilEndOfDayUTC(toParam) : null;
  const dateWhere = (field: "closedAt" | "createdAt" | "sentAt") =>
    rangeFrom || rangeTo
      ? { [field]: { ...(rangeFrom ? { gte: rangeFrom } : {}), ...(rangeTo ? { lte: rangeTo } : {}) } }
      : {};

  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const activePipeline =
    pipelines.find((p) => p.id === pipelineIdParam) ??
    pipelines.find((p) => p.isDefault) ??
    pipelines[0];

  // Janela do gráfico de evolução: exatamente o período escolhido; sem
  // filtro, cai pros últimos 6 meses (senão "Tudo" viraria um gráfico com
  // anos de histórico espremidos, ilegível).
  const trendEnd = rangeTo ?? new Date();
  const trendStart =
    rangeFrom ??
    (() => {
      // Dia 1 do mês (em Brasília) 5 meses antes do fim da janela — como o
      // resultado de brazilStartOfMonth já é sempre dia 1 (sem ambiguidade
      // de "dia inexistente" ao subtrair mês), dá pra usar setUTCMonth
      // direto, sem reintroduzir o problema de fuso.
      const d = brazilStartOfMonth(trendEnd);
      d.setUTCMonth(d.getUTCMonth() - 5);
      return d;
    })();

  // UserDailyActivity.date é string "YYYY-MM-DD" em Brasília — usa a mesma
  // janela trendStart/trendEnd do gráfico de evolução (convertida pra chave
  // de dia), pra "Atividade da equipe" ficar no mesmo período do resto da
  // página em vez de uma janela solta e inconsistente.
  const activityFrom = brazilDateKey(trendStart);
  const activityTo = brazilDateKey(trendEnd);

  const [
    openCount,
    stageValues,
    allByOwner,
    openByOwner,
    wonByOwner,
    lostByOwner,
    lostByReason,
    meetingsAndVisitsByOwner,
    wonDealsForTrend,
    wonByCreditType,
    dailyActivityRaw,
  ] = await Promise.all([
    prisma.deal.count({ where: { organizationId, status: "OPEN", ...scopeWhere(effectiveScope) } }),
    activePipeline
      ? prisma.deal.groupBy({
          by: ["stageId"],
          where: { organizationId, pipelineId: activePipeline.id, status: "OPEN", ...scopeWhere(effectiveScope) },
          _count: true,
          _sum: { value: true },
        })
      : Promise.resolve([]),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, ...scopeWhere(effectiveScope) },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "OPEN", ...scopeWhere(effectiveScope) },
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "WON", ...scopeWhere(effectiveScope), ...dateWhere("closedAt") },
      _count: true,
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "LOST", ...scopeWhere(effectiveScope), ...dateWhere("closedAt") },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["lossReasonId"],
      where: { organizationId, status: "LOST", ...scopeWhere(effectiveScope), ...dateWhere("closedAt") },
      _count: true,
    }),
    // Ranking de reuniões + visitas: as duas são "foi falar com o lead direto"
    // (reunião = online, visita = presencial), então o ranking soma as duas —
    // mas agrupado por type também, pra manter o detalhamento de quantas
    // foram de cada tipo (ver breakdown no card).
    prisma.activity.groupBy({
      by: ["userId", "type"],
      where: { organizationId, type: { in: ["MEETING", "VISIT"] }, ...ownerScopeWhere, ...dateWhere("createdAt") },
      _count: true,
    }),
    prisma.deal.findMany({
      where: { organizationId, status: "WON", closedAt: { gte: trendStart, lte: trendEnd }, ...scopeWhere(effectiveScope) },
      select: { closedAt: true, value: true },
    }),
    // Faturamento por tipo de crédito — imóvel e veículo têm ticket e ciclo
    // de decisão bem diferentes, vale ver separado, não só o total misturado.
    prisma.deal.groupBy({
      by: ["creditType"],
      where: { organizationId, status: "WON", ...scopeWhere(effectiveScope), ...dateWhere("closedAt") },
      _count: true,
      _sum: { value: true },
    }),
    showTeamActivity
      ? prisma.userDailyActivity.findMany({
          where: { organizationId, date: { gte: activityFrom, lte: activityTo }, ...ownerScopeWhere },
          select: { userId: true, date: true, activeSeconds: true, changeCount: true },
        })
      : Promise.resolve([]),
  ]);

  const wonCount = wonByOwner.reduce((sum, w) => sum + w._count, 0);
  const lostCount = lostByOwner.reduce((sum, l) => sum + l._count, 0);
  // Só conta negócio já decidido (ganho ou perdido) — um negócio ainda em
  // aberto não é nem acerto nem erro, incluir ele no denominador penaliza
  // artificialmente times com pipeline saudável e cheio de negócio recente.
  const closedCount = wonCount + lostCount;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

  const wonTotalValue = wonByOwner.reduce((sum, w) => sum + (w._sum.value ? Number(w._sum.value) : 0), 0);
  const openTotalValue = openByOwner.reduce((sum, o) => sum + (o._sum.value ? Number(o._sum.value) : 0), 0);
  const avgWonValue = wonCount > 0 ? wonTotalValue / wonCount : 0;

  // Imóvel e veículo entram em buckets próprios; qualquer outra coisa (null,
  // "OUTROS", ou um valor futuro ainda não previsto) cai junto em "Outros" —
  // nunca deixa um tipo de crédito sumir do total por não ter rótulo certo.
  const CREDIT_TYPE_LABELS: Record<string, string> = { "IMÓVEL": "Imóvel", "VEÍCULO": "Veículo" };
  const CREDIT_TYPE_COLORS: Record<string, string> = { "IMÓVEL": "#059669", "VEÍCULO": "#64748b" };
  const creditTypeTotals = new Map<string, { count: number; value: number }>();
  for (const c of wonByCreditType) {
    const key = c.creditType === "IMÓVEL" || c.creditType === "VEÍCULO" ? c.creditType : "OUTROS";
    const prev = creditTypeTotals.get(key) ?? { count: 0, value: 0 };
    prev.count += c._count;
    prev.value += c._sum.value ? Number(c._sum.value) : 0;
    creditTypeTotals.set(key, prev);
  }
  const creditTypeBreakdown = Array.from(creditTypeTotals.entries())
    .map(([key, t]) => ({
      key,
      label: CREDIT_TYPE_LABELS[key] ?? "Outros",
      color: CREDIT_TYPE_COLORS[key] ?? "#a3a3a3",
      count: t.count,
      value: t.value,
      avgValue: t.count > 0 ? t.value / t.count : 0,
    }))
    .sort((a, b) => b.value - a.value);
  const creditTypeTotalValue = creditTypeBreakdown.reduce((sum, c) => sum + c.value, 0);

  const stageData = (activePipeline?.stages ?? []).map((stage) => {
    const match = stageValues.find((s) => s.stageId === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      count: match?._count ?? 0,
      value: match?._sum.value ? Number(match._sum.value) : 0,
    };
  });

  // ─── Pessoas: junta quem tem negócio, quem registrou reunião e quem é
  // membro de organização, pra não deixar ninguém de fora do nome/avatar. ──
  const peopleIds = Array.from(
    new Set([
      ...allByOwner.map((o) => o.ownerId),
      ...meetingsAndVisitsByOwner.map((m) => m.userId),
      ...visibleMembers.map((m) => m.userId),
    ]),
  );
  const people = await prisma.user.findMany({
    where: { id: { in: peopleIds } },
    select: { id: true, name: true, image: true },
  });
  const avatarMap = await resolveAvatarUrlMap(people.map((p) => p.image));
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  const personPhoto = (id: string) => {
    const image = people.find((p) => p.id === id)?.image;
    return image ? (avatarMap.get(image) ?? null) : null;
  };

  // Soma por usuário os rollups diários de UserDailyActivity dentro da janela
  // — activeDayCount conta só dias com uso de verdade (activeSeconds > 0),
  // não dias em que só uma alteração via API bateu sem heartbeat nenhum.
  const activityByUser = new Map<string, { activeSeconds: number; changeCount: number; activeDayCount: number }>();
  for (const row of dailyActivityRaw) {
    const prev = activityByUser.get(row.userId) ?? { activeSeconds: 0, changeCount: 0, activeDayCount: 0 };
    prev.activeSeconds += row.activeSeconds;
    prev.changeCount += row.changeCount;
    if (row.activeSeconds > 0) prev.activeDayCount += 1;
    activityByUser.set(row.userId, prev);
  }

  // Reunião (online) e visita (presencial) contam junto no ranking — quem
  // mais foi falar com o lead direto, não importa o meio — mas cada tipo
  // continua contado à parte pra alimentar o "40 visitas e 10 reuniões" no
  // detalhamento do card.
  const meetingVisitByUser = new Map<string, { meetingCount: number; visitCount: number }>();
  for (const row of meetingsAndVisitsByOwner) {
    const prev = meetingVisitByUser.get(row.userId) ?? { meetingCount: 0, visitCount: 0 };
    if (row.type === "MEETING") prev.meetingCount += row._count;
    else if (row.type === "VISIT") prev.visitCount += row._count;
    meetingVisitByUser.set(row.userId, prev);
  }

  const ownerStats = peopleIds.map((id) => {
    const wonCountForOwner = wonByOwner.find((w) => w.ownerId === id)?._count ?? 0;
    const wonValueForOwner = wonByOwner.find((w) => w.ownerId === id)?._sum.value
      ? Number(wonByOwner.find((w) => w.ownerId === id)!._sum.value)
      : 0;
    const lostCountForOwner = lostByOwner.find((l) => l.ownerId === id)?._count ?? 0;
    const closedForOwner = wonCountForOwner + lostCountForOwner;
    const activity = activityByUser.get(id) ?? { activeSeconds: 0, changeCount: 0, activeDayCount: 0 };
    const meetingVisit = meetingVisitByUser.get(id) ?? { meetingCount: 0, visitCount: 0 };
    return {
      id,
      name: personName(id),
      photoUrl: personPhoto(id),
      wonCount: wonCountForOwner,
      wonValue: wonValueForOwner,
      lostCount: lostCountForOwner,
      winRate: closedForOwner > 0 ? Math.round((wonCountForOwner / closedForOwner) * 100) : null,
      meetingCount: meetingVisit.meetingCount,
      visitCount: meetingVisit.visitCount,
      meetingsAndVisitsCount: meetingVisit.meetingCount + meetingVisit.visitCount,
      activeSeconds: activity.activeSeconds,
      changeCount: activity.changeCount,
      activeDayCount: activity.activeDayCount,
      avgSecondsPerActiveDay:
        activity.activeDayCount > 0 ? Math.round(activity.activeSeconds / activity.activeDayCount) : 0,
    };
  });

  const dealsClosedRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.wonCount > 0)
    .sort((a, b) => b.wonCount - a.wonCount || b.wonValue - a.wonValue)
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.wonCount} negócio${o.wonCount === 1 ? "" : "s"}`,
      secondaryValue: formatCurrency(o.wonValue),
    }));

  const meetingsRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.meetingsAndVisitsCount > 0)
    .sort((a, b) => b.meetingsAndVisitsCount - a.meetingsAndVisitsCount)
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.meetingsAndVisitsCount} ${o.meetingsAndVisitsCount === 1 ? "reunião/visita" : "reuniões/visitas"}`,
      secondaryValue: `${o.visitCount} visita${o.visitCount === 1 ? "" : "s"} e ${o.meetingCount} reuni${o.meetingCount === 1 ? "ão" : "ões"}`,
    }));

  const conversionRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.winRate !== null)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0) || b.wonCount - a.wonCount)
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.winRate}%`,
      secondaryValue: `${o.wonCount + o.lostCount} decidido${o.wonCount + o.lostCount === 1 ? "" : "s"}`,
    }));

  const crmTimeRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.activeSeconds > 0)
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: formatDuration(o.activeSeconds * 1000),
      secondaryValue: `Média ${formatDuration(o.avgSecondsPerActiveDay * 1000)}/dia`,
    }));

  const crmChangesRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.changeCount > 0)
    .sort((a, b) => b.changeCount - a.changeCount)
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.changeCount} alteraç${o.changeCount === 1 ? "ão" : "ões"}`,
      secondaryValue: `${o.activeDayCount} dia${o.activeDayCount === 1 ? "" : "s"} ativo${o.activeDayCount === 1 ? "" : "s"}`,
    }));

  // Listagem completa (não só o top 8 dos rankings acima) de quem está de
  // fato cadastrado na organização — só membros ativos, mesmo os sem
  // nenhuma atividade no período aparecem aqui (o card fica recolhido por
  // padrão, ver team-activity-list.tsx).
  const lastActiveAtByUser = new Map(visibleMembers.map((m) => [m.userId, m.lastActiveAt]));
  const teamActivityList = showTeamActivity
    ? ownerStats
        .filter((o) => lastActiveAtByUser.has(o.id))
        .map((o) => {
          const lastActiveAt = lastActiveAtByUser.get(o.id) ?? null;
          return {
            id: o.id,
            name: o.name,
            photoUrl: o.photoUrl,
            online: lastActiveAt ? Date.now() - lastActiveAt.getTime() < ONLINE_THRESHOLD_MS : false,
            lastActiveAt,
            avgSecondsPerActiveDay: o.avgSecondsPerActiveDay,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    : [];

  const teamGroups = new Map<string, { name: string; memberIds: string[] }>();
  for (const m of showTeamRanking ? visibleMembers : []) {
    if (!m.teamId || !m.team) continue;
    if (!teamGroups.has(m.teamId)) teamGroups.set(m.teamId, { name: m.team.name, memberIds: [] });
    teamGroups.get(m.teamId)!.memberIds.push(m.userId);
  }
  const teamRanking: LeaderboardEntry[] = Array.from(teamGroups.entries())
    .map(([id, team]) => {
      const members = ownerStats.filter((o) => team.memberIds.includes(o.id));
      return {
        id,
        name: team.name,
        wonCount: members.reduce((sum, o) => sum + o.wonCount, 0),
        wonValue: members.reduce((sum, o) => sum + o.wonValue, 0),
      };
    })
    .sort((a, b) => b.wonCount - a.wonCount || b.wonValue - a.wonValue)
    .map((t) => ({
      id: t.id,
      name: t.name,
      primaryValue: `${t.wonCount} negócio${t.wonCount === 1 ? "" : "s"}`,
      secondaryValue: formatCurrency(t.wonValue),
    }));

  // ─── Evolução: valor ganho ao longo do período escolhido — por dia se o
  // período for curto (cabe uns 30 pontos legíveis), por mês se for longo.
  //
  // trendEnd pode ser fim de dia (23:59:59.999, ver brazilEndOfDayUTC acima)
  // — usar ele cru aqui contaria quase um dia inteiro a mais do que os dias
  // de calendário reais do período (ex.: "Este mês" em julho batia 31 em vez
  // de 30, e o array final (trendSpanDays + 1) saía com 32 baldes pra um mês
  // de 31 dias — o balde extra, 1º de agosto, sempre ficava zerado e
  // aparecia como o ÚLTIMO ponto do gráfico, parecendo uma queda pra zero
  // fora do período de verdade). brazilStartOfDay normaliza pro início do
  // dia de trendEnd antes de contar a diferença, então o resultado já é a
  // contagem exata de dias de calendário entre início de trendStart e início
  // do dia de trendEnd — o "+1" abaixo (fencepost, inclusivo dos dois
  // extremos) só precisa ser aplicado uma vez.
  const trendSpanDays = Math.max(
    0,
    Math.round((brazilStartOfDay(trendEnd).getTime() - trendStart.getTime()) / 86_400_000),
  );
  const bucketDaily = trendSpanDays <= 31;

  // Todo agrupamento por dia/mês abaixo usa o calendário de Brasília
  // (getBrazilParts), não os getters locais do servidor (UTC) — senão um
  // negócio fechado depois das 21h de Brasília "vaza" pro dia/mês seguinte
  // no gráfico. trendStart já é um instante alinhado à meia-noite de
  // Brasília (brazilDateStringToUTC/brazilStartOfMonth), então somar
  // múltiplos de 24h nele sempre cai em outra meia-noite de Brasília (sem
  // horário de verão no Brasil desde 2019, o offset é fixo).
  const monthTrend = bucketDaily
    ? Array.from({ length: trendSpanDays + 1 }, (_, i) => {
        const instant = new Date(trendStart.getTime() + i * 86_400_000);
        const { year, month, day } = getBrazilParts(instant);
        const showLabel = i === 0 || i === trendSpanDays || i % 7 === 0;
        const labelDate = new Date(Date.UTC(year, month, day));
        return {
          year,
          month,
          day: day as number | undefined,
          label: showLabel ? labelDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }) : "",
          // Sempre a data cheia, mesmo nos dias em que o eixo fica sem legenda
          // (só um a cada 7 imprime `label`, senão o eixo vira poluição visual)
          // — o tooltip do gráfico precisa saber de qual dia é o ponto de
          // qualquer forma, independente do que aparece embaixo do gráfico.
          tooltipLabel: labelDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }),
          value: 0,
        };
      })
    : (() => {
        const buckets: { year: number; month: number; day?: number; label: string; tooltipLabel: string; value: number }[] = [];
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
      })();

  for (const deal of wonDealsForTrend) {
    if (!deal.closedAt) continue;
    const parts = getBrazilParts(deal.closedAt);
    const bucket = bucketDaily
      ? monthTrend.find((b) => b.year === parts.year && b.month === parts.month && b.day === parts.day)
      : monthTrend.find((b) => b.year === parts.year && b.month === parts.month);
    if (bucket) bucket.value += deal.value ? Number(deal.value) : 0;
  }

  // Clona os buckets de monthTrend (mesmas datas/rótulos) pra uma segunda
  // série independente — tempo ativo da equipe em vez de valor ganho.
  const teamActivityTrend = monthTrend.map((b) => ({ ...b, value: 0, breakdown: [] as { label: string; value: number }[] }));
  // Por bucket, soma separado por consultor — vira o detalhamento do balão ao
  // passar o mouse (sem isso o gráfico só mostra o total do dia/mês, sem dar
  // pra saber quem puxou aquele número).
  const activityBreakdownByBucket = new Map<number, Map<string, number>>();
  for (const row of dailyActivityRaw) {
    const [y, m, d] = row.date.split("-").map(Number);
    const bucketIndex = bucketDaily
      ? teamActivityTrend.findIndex((b) => b.year === y && b.month === m - 1 && b.day === d)
      : teamActivityTrend.findIndex((b) => b.year === y && b.month === m - 1);
    if (bucketIndex === -1) continue;
    teamActivityTrend[bucketIndex].value += row.activeSeconds;
    if (row.activeSeconds > 0) {
      const perUser = activityBreakdownByBucket.get(bucketIndex) ?? new Map<string, number>();
      perUser.set(row.userId, (perUser.get(row.userId) ?? 0) + row.activeSeconds);
      activityBreakdownByBucket.set(bucketIndex, perUser);
    }
  }
  for (const [bucketIndex, perUser] of activityBreakdownByBucket) {
    teamActivityTrend[bucketIndex].breakdown = Array.from(perUser.entries())
      .map(([userId, seconds]) => ({ label: personName(userId), value: seconds }))
      .sort((a, b) => b.value - a.value);
  }

  const statusSlices = [
    { label: "Ganhos", value: wonCount, color: "#059669" },
    { label: "Perdidos", value: lostCount, color: "#dc2626" },
    { label: "Em aberto", value: openCount, color: "#a3a3a3" },
  ];

  const reasonIds = lostByReason.map((l) => l.lossReasonId).filter((id): id is string => !!id);
  const reasonsList = await prisma.lossReason.findMany({
    where: { id: { in: reasonIds } },
    select: { id: true, label: true },
  });
  const lossBreakdown = lostByReason
    .map((l) => ({
      id: l.lossReasonId ?? "none",
      label: reasonsList.find((r) => r.id === l.lossReasonId)?.label ?? "Sem motivo",
      count: l._count,
    }))
    .sort((a, b) => b.count - a.count);
  const maxLossCount = Math.max(1, ...lossBreakdown.map((l) => l.count));

  // ─── Negócios decididos por cargo do contato — Prisma não agrupa por
  // campo de relação (contact.jobTitle não é coluna de Deal), então busca os
  // negócios decididos no período e agrupa na mão. Respeita o mesmo filtro
  // de data das outras métricas "decididas" da página.
  const decidedDealsForJobTitle = await prisma.deal.findMany({
    where: { organizationId, status: { in: ["WON", "LOST"] }, ...scopeWhere(effectiveScope), ...dateWhere("closedAt") },
    select: { status: true, value: true, contact: { select: { jobTitle: true } } },
  });
  const jobTitleStats = new Map<string, { won: number; lost: number; wonValue: number }>();
  for (const deal of decidedDealsForJobTitle) {
    const key = deal.contact.jobTitle || "Sem cargo cadastrado";
    if (!jobTitleStats.has(key)) jobTitleStats.set(key, { won: 0, lost: 0, wonValue: 0 });
    const stat = jobTitleStats.get(key)!;
    if (deal.status === "WON") {
      stat.won += 1;
      stat.wonValue += deal.value ? Number(deal.value) : 0;
    } else {
      stat.lost += 1;
    }
  }
  const jobTitleBreakdown = Array.from(jobTitleStats.entries())
    .map(([label, s]) => ({
      label,
      won: s.won,
      lost: s.lost,
      wonValue: s.wonValue,
      winRate: s.won + s.lost > 0 ? Math.round((s.won / (s.won + s.lost)) * 100) : 0,
    }))
    .sort((a, b) => b.won + b.lost - (a.won + a.lost));

  // ─── WhatsApp: enviadas, responderam e conversão por vendedor ──────────
  // "Geral" nunca conta mensagem de disparo de lista fria (campaignId
  // setado por lib/campaigns/engine.ts) nem mensagem de thread já vinculada a
  // negócio (essa vira "Conversas de negócio"/"Prospecção manual" abaixo) —
  // sem essas exclusões, a mesma mensagem aparecia contada em mais de uma
  // categoria ao mesmo tempo.

  // ─── WhatsApp dos negócios: threads de contato que já viraram negócio
  // (aberto, ganho ou perdido) — precisa vir ANTES do bloco "Geral" abaixo,
  // que usa dealThreadIds pra excluir essas threads da contagem geral.
  const dealContacts = await prisma.deal.findMany({
    where: { organizationId, ...scopeWhere(effectiveScope) },
    select: { contactId: true },
    distinct: ["contactId"],
  });
  const dealContactIds = dealContacts.map((d) => d.contactId);

  const dealThreads = dealContactIds.length
    ? await prisma.whatsAppThread.findMany({
        where: { organizationId, contactId: { in: dealContactIds }, ...whatsappScopeWhere(effectiveScope) },
        select: { id: true, instanceId: true, contactId: true },
      })
    : [];
  const dealThreadIds = dealThreads.map((t) => t.id);

  // Prospecção manual: a mensagem de ABERTURA (a 1ª de toda a thread, sem
  // limite de período — precisa saber quem falou primeiro na história toda,
  // não só dentro do filtro de data) foi mandada pelo vendedor, não pelo
  // lead, numa thread que hoje tem negócio — abordagem fria feita na mão,
  // fora do motor de Campanhas. Só a mensagem de abertura conta aqui; o
  // resto da conversa (depois que o lead responde) é "Conversas de negócio".
  const dealThreadFirstMessages = dealThreadIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: { organizationId, threadId: { in: dealThreadIds } },
        orderBy: { createdAt: "asc" },
        distinct: ["threadId"],
        select: { threadId: true, instanceId: true, direction: true, campaignId: true, createdAt: true },
      })
    : [];
  const inRange = (d: Date) => (!rangeFrom || d >= rangeFrom) && (!rangeTo || d <= rangeTo);
  const manualProspectOpeners = dealThreadFirstMessages.filter(
    (m) => m.direction === "OUTBOUND" && !m.campaignId && inRange(m.createdAt),
  );
  const manualOpenerThreadIds = manualProspectOpeners.map((m) => m.threadId);
  const manualOpenerReplies = manualOpenerThreadIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: { organizationId, threadId: { in: manualOpenerThreadIds }, direction: "INBOUND" },
        select: { threadId: true },
        distinct: ["threadId"],
      })
    : [];
  const manualOpenerRepliedSet = new Set(manualOpenerReplies.map((m) => m.threadId));
  const manualProspectByInstance = new Map<string, { sent: number; replied: number }>();
  for (const m of manualProspectOpeners) {
    if (!manualProspectByInstance.has(m.instanceId)) manualProspectByInstance.set(m.instanceId, { sent: 0, replied: 0 });
    const stat = manualProspectByInstance.get(m.instanceId)!;
    stat.sent += 1;
    if (manualOpenerRepliedSet.has(m.threadId)) stat.replied += 1;
  }

  const [whatsappInstances, sentByInstance, organicOutboundPairs, campaignRecipients] = await Promise.all([
    prisma.whatsAppInstance.findMany({
      where: { organizationId, ...(effectiveScope.type === "owners" ? { userId: { in: effectiveScope.ownerIds } } : {}) },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId"],
      where: {
        organizationId,
        direction: "OUTBOUND",
        campaignId: null,
        threadId: { notIn: dealThreadIds },
        ...whatsappScopeWhere(effectiveScope),
        ...dateWhere("createdAt"),
      },
      _count: true,
    }),
    // Amplo de propósito (inclui thread de negócio) — alimenta "conversão em
    // venda", que precisa olhar todo contato abordado organicamente, não só
    // quem caiu no balde "Geral". A contagem de "enviadas" exibida usa
    // sentByInstance (acima), que já exclui thread de negócio.
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId", "threadId"],
      where: {
        organizationId,
        direction: "OUTBOUND",
        campaignId: null,
        ...whatsappScopeWhere(effectiveScope),
        ...dateWhere("createdAt"),
      },
    }),
    // Prospecção fria: listas importadas + disparo em massa (Campanhas) — cada
    // linha SENT é um lead que só existe na conversa porque o vendedor mandou
    // a primeira mensagem (o oposto de um lead orgânico que chamou primeiro).
    prisma.campaignRecipient.findMany({
      where: {
        campaign: { organizationId, ...(effectiveScope.type === "owners" ? { instance: { userId: { in: effectiveScope.ownerIds } } } : {}) },
        status: "SENT",
        ...dateWhere("sentAt"),
      },
      select: {
        repliedAt: true,
        scriptId: true,
        threadId: true,
        campaign: { select: { instanceId: true } },
        contact: { select: { jobTitle: true } },
      },
    }),
  ]);
  const outboundPairs = organicOutboundPairs;

  // Possíveis negociações de lista fria: lead abordado por disparo em massa
  // (a mesma base de "prospecção fria" acima) cuja conversa já passou de 5
  // mensagens DELE — sinal de que não é só um "oi" isolado, virou uma
  // conversa de verdade que vale olhar como oportunidade. Não usa
  // dateWhere aqui de propósito (mesmo padrão de manualOpenerReplies acima):
  // o que é limitado ao período é o ENVIO que originou o lead, não quantas
  // respostas ele já mandou desde então.
  const coldThreadIds = Array.from(
    new Set(campaignRecipients.map((r) => r.threadId).filter((id): id is string => !!id)),
  );
  const COLD_POSSIBLE_DEAL_MIN_REPLIES = 5;
  // type != CALL: chamada perdida/recusada também vira WhatsAppMessage
  // INBOUND (ver lib/whatsapp/events.ts:handleIncomingCall) — não é
  // "mensagem do cliente" no sentido que importa aqui, e contar isso infla
  // o número sem o lead ter escrito nada de verdade.
  const [coldThreadReplyCounts, coldThreads] = coldThreadIds.length
    ? await Promise.all([
        prisma.whatsAppMessage.groupBy({
          by: ["threadId"],
          where: { organizationId, direction: "INBOUND", type: { not: "CALL" }, threadId: { in: coldThreadIds } },
          _count: true,
        }),
        // Fonte da verdade de qual instância (vendedor) é dona da conversa —
        // de propósito NÃO usa campaign.instanceId nem
        // CampaignRecipient.instanceId pra isso: numa campanha PIPELINE_BULK
        // (envio em massa do Pipeline) cada destinatário pode ter sido
        // mandado por uma instância diferente da instanceId "principal" da
        // campanha (ver comentário em Campaign.source no schema) — a própria
        // thread nunca erra sobre isso.
        prisma.whatsAppThread.findMany({ where: { id: { in: coldThreadIds } }, select: { id: true, instanceId: true } }),
      ])
    : [[], []];
  const coldThreadInstanceId = new Map(coldThreads.map((t) => [t.id, t.instanceId]));
  const possibleColdDealThreadIds = new Set(
    coldThreadReplyCounts.filter((t) => t._count > COLD_POSSIBLE_DEAL_MIN_REPLIES).map((t) => t.threadId),
  );
  const possibleColdDealsByInstance = new Map<string, Set<string>>();
  for (const threadId of possibleColdDealThreadIds) {
    const instanceId = coldThreadInstanceId.get(threadId);
    if (!instanceId) continue; // thread não encontrada (ex.: apagada) — não deveria acontecer, mas não é motivo pra quebrar o relatório
    if (!possibleColdDealsByInstance.has(instanceId)) possibleColdDealsByInstance.set(instanceId, new Set());
    possibleColdDealsByInstance.get(instanceId)!.add(threadId);
  }

  // Resposta "geral" — mesma exclusão de thread de negócio que "enviadas"
  // acima, senão uma resposta numa conversa de negócio contava em dobro
  // (aqui e em "Conversas de negócio"). Também não conta resposta a disparo
  // de lista fria puro, já contada em "prospecção fria" via CampaignRecipient.repliedAt.
  const dealThreadIdSet = new Set(dealThreadIds);
  const organicThreadIds = Array.from(new Set(organicOutboundPairs.map((p) => p.threadId)));
  const generalThreadIds = organicThreadIds.filter((id) => !dealThreadIdSet.has(id));
  const inboundPairs = generalThreadIds.length
    ? await prisma.whatsAppMessage.groupBy({
        by: ["instanceId", "threadId"],
        where: {
          organizationId,
          direction: "INBOUND",
          threadId: { in: generalThreadIds },
          ...whatsappScopeWhere(effectiveScope),
          ...dateWhere("createdAt"),
        },
      })
    : [];

  const campaignStatsByInstance = new Map<string, { sent: number; replied: number }>();
  const campaignStatsByScript = new Map<string, { sent: number; replied: number }>();
  const campaignStatsByJobTitle = new Map<string, { sent: number; replied: number }>();
  for (const r of campaignRecipients) {
    const key = r.campaign.instanceId;
    if (!campaignStatsByInstance.has(key)) campaignStatsByInstance.set(key, { sent: 0, replied: 0 });
    const stat = campaignStatsByInstance.get(key)!;
    stat.sent += 1;
    if (r.repliedAt) stat.replied += 1;

    const scriptKey = r.scriptId ?? "sem-script";
    if (!campaignStatsByScript.has(scriptKey)) campaignStatsByScript.set(scriptKey, { sent: 0, replied: 0 });
    const scriptStat = campaignStatsByScript.get(scriptKey)!;
    scriptStat.sent += 1;
    if (r.repliedAt) scriptStat.replied += 1;

    const jobTitleKey = r.contact.jobTitle || "Sem cargo cadastrado";
    if (!campaignStatsByJobTitle.has(jobTitleKey)) campaignStatsByJobTitle.set(jobTitleKey, { sent: 0, replied: 0 });
    const jobTitleStat = campaignStatsByJobTitle.get(jobTitleKey)!;
    jobTitleStat.sent += 1;
    if (r.repliedAt) jobTitleStat.replied += 1;
  }

  const campaignScriptIds = Array.from(campaignStatsByScript.keys()).filter((id) => id !== "sem-script");
  const campaignScripts = campaignScriptIds.length
    ? await prisma.messageScript.findMany({ where: { id: { in: campaignScriptIds } }, select: { id: true, name: true } })
    : [];
  const scriptBreakdown = Array.from(campaignStatsByScript.entries())
    .map(([id, s]) => ({
      id,
      name: id === "sem-script" ? "Sem script identificado" : (campaignScripts.find((cs) => cs.id === id)?.name ?? "Script removido"),
      sent: s.sent,
      replied: s.replied,
      replyRate: s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0,
    }))
    .sort((a, b) => b.sent - a.sent);

  const cargoBreakdown = Array.from(campaignStatsByJobTitle.entries())
    .map(([label, s]) => ({
      label,
      sent: s.sent,
      replied: s.replied,
      replyRate: s.sent > 0 ? Math.round((s.replied / s.sent) * 100) : 0,
    }))
    .sort((a, b) => b.sent - a.sent);

  // groupBy não alcança campo de relação (thread.contactId) — resolve à
  // parte. Thread sem Contact vinculado (aba "Geral") não entra nas métricas
  // de resposta/conversão, só quem é lead de verdade mesmo.
  const allThreadIds = Array.from(
    new Set([...inboundPairs.map((p) => p.threadId), ...outboundPairs.map((p) => p.threadId)]),
  );
  const threads = await prisma.whatsAppThread.findMany({
    where: { id: { in: allThreadIds } },
    select: { id: true, contactId: true },
  });
  const contactIdByThread = new Map(threads.map((t) => [t.id, t.contactId]));

  const contactedContactIds = Array.from(
    new Set(outboundPairs.map((p) => contactIdByThread.get(p.threadId)).filter((id): id is string => !!id)),
  );
  // Atribuição por dono: só conta como "conversão" do vendedor se ele mesmo
  // for o dono do negócio ganho — senão um vendedor que só mandou uma
  // mensagem avulsa levaria crédito por venda fechada por outro colega.
  const wonDeals = contactedContactIds.length
    ? await prisma.deal.findMany({
        where: { organizationId, status: "WON", contactId: { in: contactedContactIds }, ...dateWhere("closedAt") },
        select: { contactId: true, ownerId: true },
      })
    : [];
  const wonOwnersByContact = new Map<string, Set<string>>();
  for (const d of wonDeals) {
    if (!wonOwnersByContact.has(d.contactId)) wonOwnersByContact.set(d.contactId, new Set());
    wonOwnersByContact.get(d.contactId)!.add(d.ownerId);
  }

  const whatsappStats = whatsappInstances.map((inst) => {
    const sent = sentByInstance.find((s) => s.instanceId === inst.id)?._count ?? 0;
    const outboundForInst = outboundPairs.filter((p) => p.instanceId === inst.id);
    // Denominador da taxa de resposta "Geral" precisa do MESMO universo do
    // numerador (inboundPairs, que exclui thread de negócio — ver
    // generalThreadIds acima) e de "sent" (sentByInstance, idem) — usar
    // outboundPairs inteiro aqui (que de propósito INCLUI thread de negócio,
    // pra alimentar conversão) infla o denominador com contato que nunca
    // pode aparecer no numerador, subestimando a taxa de resposta.
    const generalContactedContacts = new Set(
      outboundForInst
        .filter((p) => !dealThreadIdSet.has(p.threadId))
        .map((p) => contactIdByThread.get(p.threadId))
        .filter((id): id is string => !!id),
    );
    const repliedContacts = new Set(
      inboundPairs
        .filter((p) => p.instanceId === inst.id)
        .map((p) => contactIdByThread.get(p.threadId))
        .filter((id): id is string => !!id),
    ).size;
    const replyRate =
      generalContactedContacts.size > 0 ? Math.round((repliedContacts / generalContactedContacts.size) * 100) : 0;
    // Conversão em venda propositalmente olha TODO contato abordado
    // organicamente (inclusive quem já é thread de negócio) — ver comentário
    // na query de organicOutboundPairs.
    const allContactedContacts = new Set(
      outboundForInst.map((p) => contactIdByThread.get(p.threadId)).filter((id): id is string => !!id),
    );
    const convertedForInst = Array.from(allContactedContacts).filter((cid) => wonOwnersByContact.get(cid)?.has(inst.userId)).length;
    const conversionRate =
      allContactedContacts.size > 0 ? Math.round((convertedForInst / allContactedContacts.size) * 100) : 0;
    const campaignStats = campaignStatsByInstance.get(inst.id) ?? { sent: 0, replied: 0 };
    const campaignReplyRate =
      campaignStats.sent > 0 ? Math.round((campaignStats.replied / campaignStats.sent) * 100) : 0;
    const manualProspectStats = manualProspectByInstance.get(inst.id) ?? { sent: 0, replied: 0 };
    const manualProspectReplyRate =
      manualProspectStats.sent > 0 ? Math.round((manualProspectStats.replied / manualProspectStats.sent) * 100) : 0;
    const possibleColdDeals = possibleColdDealsByInstance.get(inst.id)?.size ?? 0;

    return {
      userId: inst.userId,
      name: inst.user.name,
      connected: inst.status === "CONNECTED",
      sent,
      contacted: generalContactedContacts.size,
      replied: repliedContacts,
      replyRate,
      conversionRate,
      campaignSent: campaignStats.sent,
      campaignReplied: campaignStats.replied,
      campaignReplyRate,
      manualProspectSent: manualProspectStats.sent,
      manualProspectReplied: manualProspectStats.replied,
      manualProspectReplyRate,
      possibleColdDeals,
    };
  });

  // ─── WhatsApp dos negócios: só conversa de contato que já virou negócio
  // (aberto, ganho ou perdido) — exclui "WhatsApp Geral". Aqui entram
  // métricas de tempo, que exigem olhar as mensagens em ordem, não só contar.
  // dealContactIds/dealThreads/dealThreadIds já calculados lá em cima (o
  // bloco "Geral" precisa deles pra excluir thread de negócio da contagem).
  const dealMessages = dealThreadIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: { organizationId, threadId: { in: dealThreadIds }, ...dateWhere("createdAt") },
        select: { threadId: true, instanceId: true, direction: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const dealMessagesByThread = new Map<string, typeof dealMessages>();
  for (const m of dealMessages) {
    if (!dealMessagesByThread.has(m.threadId)) dealMessagesByThread.set(m.threadId, []);
    dealMessagesByThread.get(m.threadId)!.push(m);
  }

  const dealThreadStats = dealThreads.map((t) => {
    const msgs = dealMessagesByThread.get(t.id) ?? [];
    const contacted = msgs.some((m) => m.direction === "OUTBOUND");
    const responded = msgs.some((m) => m.direction === "INBOUND");

    // Tempo até 1ª resposta do vendedor: só faz sentido quando o lead fala
    // primeiro — procura a 1ª mensagem OUTBOUND depois dessa 1ª INBOUND.
    let firstResponseMs: number | null = null;
    if (msgs.length > 0 && msgs[0].direction === "INBOUND") {
      const firstInboundAt = msgs[0].createdAt;
      const firstReply = msgs.find((m) => m.direction === "OUTBOUND" && m.createdAt > firstInboundAt);
      if (firstReply) firstResponseMs = firstReply.createdAt.getTime() - firstInboundAt.getTime();
    }

    // Duração: tempo entre a 1ª e a última mensagem — precisa de pelo menos
    // duas mensagens pra existir "conversa" de fato.
    const durationMs =
      msgs.length >= 2 ? msgs[msgs.length - 1].createdAt.getTime() - msgs[0].createdAt.getTime() : null;

    return { instanceId: t.instanceId, contactId: t.contactId, contacted, responded, firstResponseMs, durationMs };
  });

  // Teto do período pra "msgs/dia": o fim do filtro selecionado, não "agora"
  // — senão filtrar um período passado (ex.: um mês já fechado) dilui a
  // média dividindo por "dias até hoje" em vez de pelos dias do próprio
  // período, subestimando a métrica.
  const messagesPerDayPeriodEnd = new Date(Math.min(rangeTo?.getTime() ?? Date.now(), Date.now()));

  const dealWhatsappStats = whatsappInstances
    .map((inst) => {
      const instThreads = dealThreadStats.filter((t) => t.instanceId === inst.id);
      const contactedThreads = instThreads.filter((t) => t.contacted);
      const respondedThreads = contactedThreads.filter((t) => t.responded);
      const sentInScope = dealMessages.filter((m) => m.instanceId === inst.id && m.direction === "OUTBOUND");

      const responseRate =
        contactedThreads.length > 0 ? Math.round((respondedThreads.length / contactedThreads.length) * 100) : null;

      const contactIdsForInst = contactedThreads.map((t) => t.contactId).filter((id): id is string => !!id);
      const convertedForInst = contactIdsForInst.filter((cid) => wonOwnersByContact.get(cid)?.has(inst.userId)).length;
      const conversionRate =
        contactIdsForInst.length > 0 ? Math.round((convertedForInst / contactIdsForInst.length) * 100) : null;

      const responseTimes = instThreads.map((t) => t.firstResponseMs).filter((ms): ms is number => ms !== null);
      const avgFirstResponseMs =
        responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;

      const durations = instThreads.map((t) => t.durationMs).filter((ms): ms is number => ms !== null);
      const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

      const firstSentAt =
        sentInScope.length > 0
          ? sentInScope.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), sentInScope[0].createdAt)
          : null;
      const activeDays = firstSentAt ? daysSince(firstSentAt, messagesPerDayPeriodEnd) + 1 : 1;
      const messagesPerDay = sentInScope.length > 0 ? sentInScope.length / activeDays : 0;

      return {
        userId: inst.userId,
        name: inst.user.name,
        conversations: instThreads.length,
        sent: sentInScope.length,
        responseRate,
        conversionRate,
        avgFirstResponseMs,
        avgDurationMs,
        messagesPerDay,
      };
    })
    .filter((s) => s.conversations > 0);

  // Um card só por vendedor, juntando as duas fontes acima (mesma pessoa,
  // métricas complementares) — bem melhor de ler do que duas tabelas largas
  // que a pessoa tem que cruzar mentalmente pelo nome.
  const sellerWhatsappCards = whatsappStats.map((w) => ({
    ...w,
    deal: dealWhatsappStats.find((d) => d.userId === w.userId) ?? null,
  }));

  // ─── Meta mensal ────────────────────────────────────────────────────
  // Sempre o mês corrente (calendário de Brasília), independente do filtro
  // de período do resto do relatório acima — meta é "como estamos indo
  // agora", não uma pergunta sobre um período arbitrário escolhido. Também
  // sempre a organização inteira (ignora o filtro de equipe/responsável):
  // é uma meta só, do time todo, não uma por pessoa.
  const isOwner = session!.user.role === "OWNER";
  const nowParts = getBrazilParts(new Date());
  const currentMonthLabel = brazilStartOfMonth().toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const [monthlyGoal, goalWonAgg] = await Promise.all([
    prisma.monthlyGoal.findUnique({
      where: { organizationId_year_month: { organizationId, year: nowParts.year, month: nowParts.month + 1 } },
    }),
    prisma.deal.aggregate({
      where: { organizationId, status: "WON", closedAt: { gte: brazilStartOfMonth() } },
      _sum: { value: true },
    }),
  ]);
  const goalValue = monthlyGoal ? Number(monthlyGoal.value) : null;
  const goalAchievedValue = goalWonAgg._sum.value ? Number(goalWonAgg._sum.value) : 0;
  // Pro marcador de ritmo no GoalCard — "dia X de Y do mês", sempre em
  // calendário de Brasília (nowParts já é isso), nunca no fuso do navegador
  // de quem está vendo a tela.
  const goalDaysElapsed = nowParts.day;
  const goalDaysInMonth = new Date(Date.UTC(nowParts.year, nowParts.month + 1, 0)).getUTCDate();

  return (
    <div className="space-y-16 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-neutral-400 uppercase dark:text-neutral-500">
            Relatórios
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Panorama comercial
          </h1>
          <p className="mt-2 max-w-lg text-sm text-neutral-500 dark:text-neutral-400">
            Como o funil, o time e as conversas de WhatsApp estão performando no período selecionado.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TeamOwnerFilter teams={teamFilterOptions} members={memberFilterOptions} />
          <DateRangeFilter />
        </div>
      </div>

      {(isOwner || goalValue !== null) && (
        <GoalCard
          monthLabel={currentMonthLabel}
          goalValue={goalValue}
          achievedValue={goalAchievedValue}
          isOwner={isOwner}
          daysElapsed={goalDaysElapsed}
          daysInMonth={goalDaysInMonth}
        />
      )}

      {/* ─── Visão geral ────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading eyebrow="Visão geral" title="Como o funil está hoje" />
        <div className="grid grid-cols-12 items-start gap-5">
          <div className="card col-span-12 p-6 lg:col-span-5">
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Negócios por status</p>
            <div className="mt-4">
              <DonutChart slices={statusSlices} centerValue={`${winRate}%`} centerLabel="conversão" />
            </div>
          </div>
          <div className="col-span-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-7">
            <Stat
              label="Negócios decididos"
              value={String(closedCount)}
              hint={`${wonCount} ganho${wonCount === 1 ? "" : "s"} · ${lostCount} perdido${lostCount === 1 ? "" : "s"} no período`}
            />
            <Stat label="Pipeline em aberto" value={formatCurrency(openTotalValue)} hint={`${openCount} negócios · agora`} />
            <Stat label="Ticket médio" value={wonCount > 0 ? formatCurrency(avgWonValue) : "—"} />
            <Stat
              label="Total ganho"
              value={formatCurrency(wonTotalValue)}
              hint={`${wonCount} negócio${wonCount === 1 ? "" : "s"} fechado${wonCount === 1 ? "" : "s"} no período`}
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
                        {formatCurrency(c.value)}
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
            <p className="text-xs text-neutral-400 dark:text-neutral-500">Negócios abertos agora, de etapa em etapa — veja onde mais se perde volume.</p>
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
              <TrendAreaChart data={monthTrend} />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Ranking do time ────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading
          eyebrow="Time"
          title="Ranking do time"
          description="Quem mais fechou negócio, quem mais foi atrás do lead (reunião ou visita) e quem converte melhor."
        />
        <div className="grid grid-cols-12 gap-5">
          <div className="card col-span-12 p-6 md:col-span-6 lg:col-span-4">
            <div className="mb-1 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Negócios fechados</h3>
            </div>
            <Leaderboard entries={dealsClosedRanking} emptyLabel="Nenhum negócio ganho ainda" />
          </div>
          <div className="card col-span-12 p-6 md:col-span-6 lg:col-span-4">
            <div className="mb-1 flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Reuniões e visitas</h3>
            </div>
            <Leaderboard entries={meetingsRanking} emptyLabel="Nenhuma reunião ou visita registrada ainda" />
          </div>
          <div className="card col-span-12 p-6 md:col-span-6 lg:col-span-4">
            <div className="mb-1 flex items-center gap-2">
              <Percent className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Taxa de conversão</h3>
            </div>
            <Leaderboard entries={conversionRanking} emptyLabel="Nenhum negócio decidido ainda" />
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

      {/* ─── Atividade da equipe (só Dono/Gerente) ─────────────────────── */}
      {showTeamActivity && (
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
                <TrendAreaChart data={teamActivityTrend} formatValue={(v) => formatDuration(v * 1000)} />
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
            {lossBreakdown.length === 0 ? (
              <EmptyState icon={XCircle} title="Nenhum motivo registrado" />
            ) : (
              <div className="space-y-2.5">
                {lossBreakdown.map((l) => (
                  <BarRow key={l.id} label={l.label} value={l.count} max={maxLossCount} displayValue={String(l.count)} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── WhatsApp ───────────────────────────────────────────────── */}
      {sellerWhatsappCards.length > 0 && (
        <section className="space-y-6">
          <SectionHeading
            eyebrow="WhatsApp"
            title="Atividade por vendedor"
            description="Geral (fora de negócio), prospecção fria (campanhas), prospecção manual (1ª mensagem sua pra um lead novo) e conversas de negócio — cada mensagem conta numa categoria só."
          />

          <div className="space-y-3">
            {sellerWhatsappCards.map((w) => (
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
            desde o disparo (não é contagem do período, é a conversa toda). Prospecção manual = a
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
  });
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
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
