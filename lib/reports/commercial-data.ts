/**
 * Busca e computa TODOS os dados do relatório Comercial (funil, faturamento,
 * ranking do time, WhatsApp/SLA, meta do mês) — extraído de
 * app/(dashboard)/relatorios/page.tsx, que antes fazia essa conta inteira
 * (~1350 linhas) misturada com a montagem do JSX no mesmo arquivo de ~2200
 * linhas. page.tsx agora só resolve roteamento (Administrativo/Processos/
 * Facebook/Comercial) e renderiza — toda a orquestração de query fica aqui,
 * testável e navegável separada da apresentação.
 *
 * Retorna só os campos que a UI de fato usa (ver page.tsx) — as dezenas de
 * variáveis intermediárias usadas só pra CALCULAR esses campos (ex.:
 * ownerFilterSql, threadById, slaByUser) continuam privadas da função, não
 * vazam pro chamador.
 */

import { prisma, prismaRaw } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { formatCurrency, daysSince, formatDuration } from "@/lib/format";
import { getDealScope, scopeWhere, whatsappScopeWhere, type DealScope } from "@/lib/team-scope";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import {
  brazilDateStringToUTC,
  brazilEndOfDayUTC,
  brazilStartOfMonth,
  brazilDateKey,
  getBrazilParts,
} from "@/lib/timezone";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { type LeaderboardEntry } from "@/components/leaderboard";
import { ONLINE_THRESHOLD_MS } from "@/lib/user-activity";
import { RISK_WINDOW_MS, RISK_THRESHOLD } from "@/lib/whatsapp/health-check";
import { buildQuickRanges } from "@/lib/date-ranges";
import { countActiveSellers, suggestedGoalValue } from "@/lib/goals/suggestion";
import { defaultTrendWindow, buildDailyOrMonthlyBuckets, findBucket, findBucketIndex } from "@/lib/reports/trend";
import { average, percentile } from "@/lib/reports/stats";
import type { Session } from "next-auth";

export async function getCommercialReportData(params: {
  organizationId: string;
  userId: string;
  session: Session;
  pipelineIdParam?: string;
  fromParam?: string;
  toParam?: string;
  whoParam?: string;
}) {
  const { organizationId, userId, session, pipelineIdParam, fromParam, toParam, whoParam } = params;

  return runWithTenant(organizationId, async () => {
  // `pipelines` não depende de `scope`/`visibleMembers` (só de organizationId)
  // — roda em paralelo com a resolução do escopo em vez de esperar ela
  // terminar à toa (getDealScope faz sua própria consulta pra Gerente/
  // Supervisor, ver lib/team-scope.ts).
  const [scope, pipelines] = await Promise.all([
    getDealScope(organizationId, userId, session!.user.role),
    prisma.pipeline.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" } } },
    }),
  ]);

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
  // Sem from/to na URL: cai no mesmo padrão "Este mês" do atalho do filtro
  // (buildQuickRanges()[0]) em vez de "Tudo" (histórico inteiro). Sem isso, a
  // 1ª visita (e qualquer navegação com a URL "em branco", antes do redirect
  // client-side de FiltersUrlRestore restaurar o último filtro salvo) varria
  // Deal/Contact/WhatsAppMessage inteiros sem filtro de data nenhum — com a
  // escala real da organização, isso sozinho já explicava a tela travar ao
  // abrir. "Tudo" continua escolhível de propósito no filtro, só não é mais
  // o padrão de quem nunca escolheu nada.
  const defaultRange = fromParam || toParam ? null : buildQuickRanges().find((q) => q.key === "this-month")!.range();
  const rangeFrom = fromParam
    ? brazilDateStringToUTC(fromParam)
    : defaultRange
      ? brazilDateStringToUTC(defaultRange.from)
      : null;
  const rangeTo = toParam
    ? brazilEndOfDayUTC(toParam)
    : defaultRange
      ? brazilEndOfDayUTC(defaultRange.to)
      : null;
  const dateWhere = (field: "closedAt" | "createdAt" | "sentAt") =>
    rangeFrom || rangeTo
      ? { [field]: { ...(rangeFrom ? { gte: rangeFrom } : {}), ...(rangeTo ? { lte: rangeTo } : {}) } }
      : {};

  const activePipeline =
    pipelines.find((p) => p.id === pipelineIdParam) ??
    pipelines.find((p) => p.isDefault) ??
    pipelines[0];

  // Filtro de funil pro RESTO do relatório (receita, ranking, cargo, motivo
  // de perda, etc.) — diferente de `activePipeline` acima (que sempre
  // resolve pra UM funil, porque o gráfico de etapas não tem como misturar
  // etapas de funis diferentes num funil só). Aqui, sem `pipelineId` na URL
  // = "todos os funis" (comportamento de sempre, nada muda pra quem não usa
  // o filtro nesta sessão) — só estreita quando o valor bate um funil de
  // verdade. Índice em Deal.pipelineId já existe (mesma coluna usada pelo
  // Kanban/Lista do Pipeline), então isso é um `WHERE` a mais barato, não
  // um filtro em memória.
  const pipelineFilter: { pipelineId?: string } =
    pipelineIdParam && pipelines.some((p) => p.id === pipelineIdParam) ? { pipelineId: pipelineIdParam } : {};

  // Janela do gráfico de evolução: exatamente o período escolhido; sem
  // filtro, cai pros últimos 6 meses (senão "Tudo" viraria um gráfico com
  // anos de histórico espremidos, ilegível).
  const { trendStart, trendEnd } = defaultTrendWindow(rangeFrom, rangeTo);

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
    prisma.deal.count({ where: { organizationId, status: "OPEN", ...scopeWhere(effectiveScope), ...pipelineFilter } }),
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
      where: { organizationId, ...scopeWhere(effectiveScope), ...pipelineFilter },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "OPEN", ...scopeWhere(effectiveScope), ...pipelineFilter },
      _count: true,
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "WON", ...scopeWhere(effectiveScope), ...dateWhere("closedAt"), ...pipelineFilter },
      _count: true,
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "LOST", ...scopeWhere(effectiveScope), ...dateWhere("closedAt"), ...pipelineFilter },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["lossReasonId"],
      where: { organizationId, status: "LOST", ...scopeWhere(effectiveScope), ...dateWhere("closedAt"), ...pipelineFilter },
      _count: true,
    }),
    // Ranking de reuniões + visitas: as duas são "foi falar com o lead direto"
    // (reunião = online, visita = presencial), então o ranking soma as duas —
    // mas agrupado por type também, pra manter o detalhamento de quantas
    // foram de cada tipo (ver breakdown no card). Activity não tem
    // pipelineId direto (pode nem estar ligada a negócio nenhum), então não
    // aplica esse filtro — é uma métrica de pessoa, não de funil.
    // meetingOutcome entra no agrupamento pra alimentar também a taxa de
    // comparecimento (ver meetingVisitByUser abaixo) — mesma consulta,
    // sem custo extra de ida ao banco só pra isso.
    prisma.activity.groupBy({
      by: ["userId", "type", "meetingOutcome"],
      where: { organizationId, type: { in: ["MEETING", "VISIT"] }, ...ownerScopeWhere, ...dateWhere("createdAt") },
      _count: true,
    }),
    prisma.deal.findMany({
      where: { organizationId, status: "WON", closedAt: { gte: trendStart, lte: trendEnd }, ...scopeWhere(effectiveScope), ...pipelineFilter },
      select: { closedAt: true, value: true },
    }),
    // Faturamento por tipo de crédito — imóvel e veículo têm ticket e ciclo
    // de decisão bem diferentes, vale ver separado, não só o total misturado.
    prisma.deal.groupBy({
      by: ["creditType"],
      where: { organizationId, status: "WON", ...scopeWhere(effectiveScope), ...dateWhere("closedAt"), ...pipelineFilter },
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
  // Map em vez de .find() a cada chamada — personName/personPhoto rodam uma
  // vez por owner em vários rankings abaixo, então um scan linear por
  // chamada vira O(n²) sem necessidade nenhuma.
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const personName = (id: string) => peopleById.get(id)?.name ?? "—";
  const personPhoto = (id: string) => {
    const image = peopleById.get(id)?.image;
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
  //
  // Taxa de comparecimento (attended/noShow) usa a MESMA régua já
  // estabelecida em lib/meta-ads/attribution.ts: outcome null (histórico
  // anterior à coluna existir) conta como compareceu, nunca como no-show;
  // RESCHEDULED fica de fora da taxa (não é um resultado final — o
  // encontro só foi remarcado, ainda não se sabe se vai comparecer ou não).
  const meetingVisitByUser = new Map<
    string,
    { meetingCount: number; visitCount: number; attendedCount: number; noShowCount: number }
  >();
  for (const row of meetingsAndVisitsByOwner) {
    const prev = meetingVisitByUser.get(row.userId) ?? { meetingCount: 0, visitCount: 0, attendedCount: 0, noShowCount: 0 };
    if (row.type === "MEETING") prev.meetingCount += row._count;
    else if (row.type === "VISIT") prev.visitCount += row._count;
    if (row.meetingOutcome === "NO_SHOW") prev.noShowCount += row._count;
    else if (row.meetingOutcome !== "RESCHEDULED") prev.attendedCount += row._count;
    meetingVisitByUser.set(row.userId, prev);
  }

  const wonByOwnerMap = new Map(wonByOwner.map((w) => [w.ownerId, w]));
  const lostByOwnerMap = new Map(lostByOwner.map((l) => [l.ownerId, l]));
  const openByOwnerMap = new Map(openByOwner.map((o) => [o.ownerId, o]));
  const ownerStats = peopleIds.map((id) => {
    const wonForOwner = wonByOwnerMap.get(id);
    const wonCountForOwner = wonForOwner?._count ?? 0;
    const wonValueForOwner = wonForOwner?._sum.value ? Number(wonForOwner._sum.value) : 0;
    const lostCountForOwner = lostByOwnerMap.get(id)?._count ?? 0;
    const openCountForOwner = openByOwnerMap.get(id)?._count ?? 0;
    // Denominador da conversão = TUDO que a pessoa está/esteve com a mão —
    // aberto (agora, nunca do período — mesmo raciocínio de "pipeline em
    // aberto continua sempre 'agora'" usado no resto do relatório) + ganho e
    // perdido do período. De propósito NÃO é só ganho+perdido: isso fazia um
    // consultor com pouquíssimos negócios DECIDIDOS (o resto ainda aberto)
    // aparecer com 100% só por nunca ter marcado nada como perdido, e
    // penalizava quem tem a higiene de marcar perda de verdade — a taxa
    // precisa refletir conversão em VENDA sobre o que a pessoa de fato
    // carrega, não um placar de "ganhos entre decisões".
    const dealsHandledForOwner = wonCountForOwner + lostCountForOwner + openCountForOwner;
    const activity = activityByUser.get(id) ?? { activeSeconds: 0, changeCount: 0, activeDayCount: 0 };
    const meetingVisit = meetingVisitByUser.get(id) ?? { meetingCount: 0, visitCount: 0, attendedCount: 0, noShowCount: 0 };
    // Denominador da taxa = só resultados finais (compareceu ou no-show) —
    // RESCHEDULED fica de fora (ver comentário em meetingVisitByUser acima).
    const attendanceResolved = meetingVisit.attendedCount + meetingVisit.noShowCount;
    return {
      id,
      name: personName(id),
      photoUrl: personPhoto(id),
      wonCount: wonCountForOwner,
      wonValue: wonValueForOwner,
      lostCount: lostCountForOwner,
      dealsHandled: dealsHandledForOwner,
      conversionRate: dealsHandledForOwner > 0 ? Math.round((wonCountForOwner / dealsHandledForOwner) * 100) : null,
      meetingCount: meetingVisit.meetingCount,
      visitCount: meetingVisit.visitCount,
      meetingsAndVisitsCount: meetingVisit.meetingCount + meetingVisit.visitCount,
      attendedCount: meetingVisit.attendedCount,
      noShowCount: meetingVisit.noShowCount,
      attendanceRate: attendanceResolved > 0 ? Math.round((meetingVisit.attendedCount / attendanceResolved) * 100) : null,
      activeSeconds: activity.activeSeconds,
      changeCount: activity.changeCount,
      activeDayCount: activity.activeDayCount,
      avgSecondsPerActiveDay:
        activity.activeDayCount > 0 ? Math.round(activity.activeSeconds / activity.activeDayCount) : 0,
    };
  });

  // Sem slice(0, 8) de propósito — os 4 cards de "Ranking do time" mostram o
  // time inteiro (rola dentro do card, ver page.tsx), não só o top 8.
  const dealsClosedRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.wonCount > 0)
    .sort((a, b) => b.wonCount - a.wonCount || b.wonValue - a.wonValue)
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
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.meetingsAndVisitsCount} ${o.meetingsAndVisitsCount === 1 ? "reunião/visita" : "reuniões/visitas"}`,
      secondaryValue: `${o.visitCount} visita${o.visitCount === 1 ? "" : "s"} e ${o.meetingCount} reuni${o.meetingCount === 1 ? "ão" : "ões"}`,
    }));

  // Taxa de comparecimento por consultor — de quem marcou reunião/visita
  // (attendedCount + noShowCount > 0, ver ownerStats acima), quantos % de
  // fato compareceram. Ordenado pelo total de encontros RESOLVIDOS (não
  // pela taxa em si) — sem isso, um consultor com 1 reunião e 100% de
  // comparecimento apareceria acima de outro com 40 reuniões e 85%, o que
  // não ajuda a achar quem realmente tem volume suficiente pra a taxa
  // significar algo.
  const attendanceRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.attendedCount + o.noShowCount > 0)
    .sort((a, b) => b.attendedCount + b.noShowCount - (a.attendedCount + a.noShowCount))
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.attendanceRate}% de comparecimento`,
      secondaryValue: `${o.attendedCount} compareceu${o.attendedCount === 1 ? "" : "ram"} · ${o.noShowCount} no-show`,
    }));

  // Mesmo total, sem quebrar por pessoa — alimenta o resumo no topo do card
  // (ver page.tsx), pra bater o olho na taxa geral do time antes de abrir o
  // detalhamento por consultor.
  const attendanceSummary = ownerStats.reduce(
    (acc, o) => ({ attended: acc.attended + o.attendedCount, noShow: acc.noShow + o.noShowCount }),
    { attended: 0, noShow: 0 },
  );
  const attendanceRateOverall =
    attendanceSummary.attended + attendanceSummary.noShow > 0
      ? Math.round((attendanceSummary.attended / (attendanceSummary.attended + attendanceSummary.noShow)) * 100)
      : null;

  // "Vendas ÷ tudo que a pessoa carrega" (aberto + ganho + perdido do
  // período, ver dealsHandled em ownerStats acima) — não "ganho ÷ decidido".
  // Só entra quem tem pelo menos 1 negócio na mão; não exige ter decidido
  // nada ainda (diferente da régua antiga).
  const conversionRanking: LeaderboardEntry[] = ownerStats
    .filter((o) => o.conversionRate !== null)
    .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0) || b.wonCount - a.wonCount)
    .map((o) => ({
      id: o.id,
      name: o.name,
      photoUrl: o.photoUrl,
      primaryValue: `${o.conversionRate}%`,
      secondaryValue: `${o.wonCount} venda${o.wonCount === 1 ? "" : "s"} de ${o.dealsHandled} negócio${o.dealsHandled === 1 ? "" : "s"}`,
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
  // Ver lib/reports/trend.ts pro porquê do fencepost e do cuidado com fuso.
  const { buckets: monthTrend, bucketDaily } = buildDailyOrMonthlyBuckets(trendStart, trendEnd);

  for (const deal of wonDealsForTrend) {
    if (!deal.closedAt) continue;
    const parts = getBrazilParts(deal.closedAt);
    const bucket = findBucket(monthTrend, bucketDaily, parts);
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
    const bucketIndex = findBucketIndex(teamActivityTrend, bucketDaily, { year: y, month: m - 1, day: d });
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
  // campo de relação (contact.jobTitle não é coluna de Deal), então antes
  // isso buscava TODO negócio decidido (WON+LOST) da organização inteira pra
  // agrupar na mão em JS. Numa organização com histórico migrado (dezenas de
  // milhares de negócios já decididos), isso significava trazer todas essas
  // linhas pro Node em TODA visita ao relatório sem filtro de data (o padrão
  // da página, "Tudo"). Reescrito como agregação SQL (GROUP BY já em
  // Postgres) — só os poucos grupos por cargo trafegam de volta, não uma
  // linha por negócio. Precisa de `prismaRaw.$transaction` + `setTenantOnTx`
  // porque `$queryRaw` não passa pela extensão de RLS de lib/prisma.ts (que
  // só intercepta operações de modelo, não consultas cruas) — sem isso a
  // policy de RLS (FORCE ROW LEVEL SECURITY) bloquearia tudo em silêncio.
  // Validado bit-a-bit contra o resultado da versão antiga (agrupamento em
  // JS) antes de substituir, com e sem filtro de responsável/período.
  const ownerFilterSql =
    effectiveScope.type === "owners"
      ? effectiveScope.ownerIds.length > 0
        ? Prisma.sql`AND d."ownerId" IN (${Prisma.join(effectiveScope.ownerIds)})`
        : Prisma.sql`AND false`
      : Prisma.empty;
  const pipelineFilterSql = pipelineFilter.pipelineId ? Prisma.sql`AND d."pipelineId" = ${pipelineFilter.pipelineId}` : Prisma.empty;
  const jobTitleAgg = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRaw<{ label: string; won: number; lost: number; wonValue: Prisma.Decimal }[]>`
      SELECT
        COALESCE(NULLIF(c."jobTitle", ''), 'Sem cargo cadastrado') AS label,
        COUNT(*) FILTER (WHERE d.status = 'WON')::int AS won,
        COUNT(*) FILTER (WHERE d.status = 'LOST')::int AS lost,
        COALESCE(SUM(d.value) FILTER (WHERE d.status = 'WON'), 0) AS "wonValue"
      FROM "Deal" d
      JOIN "Contact" c ON c.id = d."contactId"
      WHERE d."organizationId" = ${organizationId}
        AND d.status IN ('WON', 'LOST')
        ${ownerFilterSql}
        ${pipelineFilterSql}
        ${rangeFrom ? Prisma.sql`AND d."closedAt" >= ${rangeFrom}` : Prisma.empty}
        ${rangeTo ? Prisma.sql`AND d."closedAt" <= ${rangeTo}` : Prisma.empty}
      GROUP BY 1
    `;
  });
  const jobTitleBreakdown = jobTitleAgg
    .map((row) => ({
      label: row.label,
      won: row.won,
      lost: row.lost,
      wonValue: Number(row.wonValue),
      winRate: row.won + row.lost > 0 ? Math.round((row.won / (row.won + row.lost)) * 100) : 0,
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
  //
  // Antes: uma consulta buscava TODO contactId distinto entre os negócios da
  // organização (até ~113 mil linhas numa organização com histórico
  // migrado) só pra devolver essa lista pro Node, que então mandava ela de
  // volta como um IN(...) gigante pra achar as threads — o próprio ida-e-
  // volta de ~113 mil ids já custava perto de 1s antes de sequer olhar pra
  // WhatsAppThread. Reescrito como EXISTS direto no SQL (o "está vinculado a
  // um negócio no escopo" nunca precisa sair do Postgres) — validado contra
  // a versão antiga com dados sintéticos (revertidos, nunca persistidos)
  // cobrindo escopo "all", escopo por dono (via Deal.ownerId) e o escopo
  // separado de whatsappScopeWhere (via WhatsAppInstance.userId), inclusive
  // o caso em que os dois escopos apontam pra donos DIFERENTES (a thread só
  // deve aparecer quando as duas condições batem, nunca só uma).
  const dealOwnerFilterSql =
    effectiveScope.type === "owners"
      ? effectiveScope.ownerIds.length > 0
        ? Prisma.sql`AND d."ownerId" IN (${Prisma.join(effectiveScope.ownerIds)})`
        : Prisma.sql`AND false`
      : Prisma.empty;
  const instanceOwnerFilterSql =
    effectiveScope.type === "owners"
      ? effectiveScope.ownerIds.length > 0
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "WhatsAppInstance" i WHERE i.id = t."instanceId" AND i."userId" IN (${Prisma.join(effectiveScope.ownerIds)}))`
        : Prisma.sql`AND false`
      : Prisma.empty;
  const dealThreads = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRaw<{ id: string; instanceId: string | null; contactId: string | null }[]>`
      SELECT t.id, t."instanceId", t."contactId"
      FROM "WhatsAppThread" t
      WHERE t."organizationId" = ${organizationId}
        AND EXISTS (
          SELECT 1 FROM "Deal" d
          WHERE d."contactId" = t."contactId" AND d."organizationId" = ${organizationId} ${dealOwnerFilterSql}
        )
        ${instanceOwnerFilterSql}
    `;
  });
  const dealThreadIds = dealThreads.map((t) => t.id);
  const dealThreadIdSet = new Set(dealThreadIds);

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
    if (m.instanceId) {
      if (!manualProspectByInstance.has(m.instanceId)) manualProspectByInstance.set(m.instanceId, { sent: 0, replied: 0 });
      const stat = manualProspectByInstance.get(m.instanceId)!;
      stat.sent += 1;
      if (m.threadId && manualOpenerRepliedSet.has(m.threadId)) stat.replied += 1;
    }
  }

  const [whatsappInstances, sentByInstance, organicOutboundPairs, campaignRecipients, slaContactsQualified, slaAllThreadsFirstMessages] = await Promise.all([
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
    // ─── SLA: leads QUALIFIED no período — tempo entre criação e qualificação,
    // e quem qualificou. `responsavelId` mapeia pro vendedor (dono do contato),
    // `leadQualificationBy` pra quem clicou no botão. No ranking de SLA usamos
    // o responsável (é o operacional do vendedor, não a pessoa de gestão que
    // eventualmente qualificou um lead pra alguém).
    prisma.contact.findMany({
      where: {
        organizationId,
        leadQualification: "QUALIFIED",
        leadQualificationAt: {
          ...(rangeFrom ? { gte: rangeFrom } : {}),
          ...(rangeTo ? { lte: rangeTo } : {}),
        },
        ...(effectiveScope.type === "owners" ? { responsavelId: { in: effectiveScope.ownerIds } } : {}),
      },
      select: {
        id: true,
        createdAt: true,
        leadQualificationAt: true,
        responsavelId: true,
      },
    }),
    // ─── SLA: 1ª mensagem DE TODAS as threads do período (inclui "Geral",
    // negócios e manual) — usada pra calcular:
    //   • % de contato em <1h: 1ª OUTBOUND do vendedor menos quando o contato
    //     entrou no CRM / quando a thread foi criada (o que for mais próximo).
    //   • Tempo de 1ª resposta do vendedor em 100% das threads, não só de
    //     negócio — quando a 1ª mensagem foi INBOUND (lead bateu primeiro).
    prisma.whatsAppMessage.findMany({
      where: {
        organizationId,
        ...whatsappScopeWhere(effectiveScope),
        ...dateWhere("createdAt"),
      },
      orderBy: { createdAt: "asc" },
      distinct: ["threadId"],
      select: {
        threadId: true,
        instanceId: true,
        direction: true,
        campaignId: true,
        createdAt: true,
      },
    }),
  ]);
  const outboundPairs = organicOutboundPairs;

  // Instabilidade de instância (risco de banimento) — recentDisconnectCount/
  // riskWindowStartedAt já são calculados e usados pra pausar campanha
  // automaticamente (ver lib/whatsapp/health-check.ts); aqui só EXPÕE esse
  // sinal que já existe, cruzado com quanto a instância disparou de campanha
  // na mesma janela de risco. Não é filtrado pelo período do relatório de
  // propósito — é "estado de risco agora", igual ao badge Conectado/
  // Desconectado dos cards acima, não uma métrica histórica do intervalo
  // escolhido.
  const instanceIds = whatsappInstances.map((i) => i.id);
  const riskWindowStart = new Date(new Date().getTime() - RISK_WINDOW_MS);
  const [pausedCampaignCounts, recentCampaignSentCounts] = instanceIds.length
    ? await Promise.all([
        prisma.campaign.groupBy({
          by: ["instanceId"],
          where: { organizationId, instanceId: { in: instanceIds }, status: "PAUSED" },
          _count: true,
        }),
        prisma.whatsAppMessage.groupBy({
          by: ["instanceId"],
          where: {
            organizationId,
            instanceId: { in: instanceIds },
            direction: "OUTBOUND",
            campaignId: { not: null },
            createdAt: { gte: riskWindowStart },
          },
          _count: true,
        }),
      ])
    : [[], []];
  const pausedCampaignsByInstance = new Map(pausedCampaignCounts.map((c) => [c.instanceId, c._count]));
  const recentCampaignSentByInstance = new Map(recentCampaignSentCounts.map((c) => [c.instanceId, c._count]));
  // Contagem simples de conexões Evolution ativas — sinal antecipado de carga
  // no servidor (cada uma é uma sessão Baileys ao vivo) antes de precisar de
  // alerta por e-mail de verdade (que exigiria decidir um destinatário
  // "dono da infra", conceito que não existe ainda, só dono de organização).
  const connectedEvolutionCount = whatsappInstances.filter((i) => i.provider === "EVOLUTION" && i.status === "CONNECTED").length;
  // Só instância com sinal de verdade pra olhar — a maioria fica saudável
  // (recentDisconnectCount 0) e não deveria poluir o relatório.
  const instabilityRows = whatsappInstances
    .filter((i) => i.recentDisconnectCount > 0)
    .map((i) => ({
      userId: i.userId,
      name: i.user.name,
      phoneNumber: i.phoneNumber,
      provider: i.provider,
      recentDisconnectCount: i.recentDisconnectCount,
      disconnectAlertLevel: i.disconnectAlertLevel,
      riskWindowStartedAt: i.riskWindowStartedAt,
      atRisk: i.recentDisconnectCount >= RISK_THRESHOLD,
      pausedCampaigns: pausedCampaignsByInstance.get(i.id) ?? 0,
      recentCampaignSent: recentCampaignSentByInstance.get(i.id) ?? 0,
    }))
    .sort((a, b) => b.recentDisconnectCount - a.recentDisconnectCount);

  // Possíveis negociações de lista fria: lead abordado por disparo em massa
  // (a mesma base de "prospecção fria" acima) cuja conversa já passou de 5
  // mensagens DELE — sinal de que não é só um "oi" isolado, virou uma
  // conversa de verdade que vale olhar como oportunidade. Exclui thread que
  // JÁ virou negócio (dealThreadIdSet) — senão um lead que já é negócio de
  // verdade (aberto, ganho ou até perdido) continuava contado como "possível",
  // quando na prática já deixou de ser possível pra ser um negócio real (ou
  // já decidido). Não usa dateWhere aqui de propósito (mesmo padrão de
  // manualOpenerReplies acima): o que é limitado ao período é o ENVIO que
  // originou o lead, não quantas respostas ele já mandou desde então.
  const coldThreadIds = Array.from(
    new Set(
      campaignRecipients
        .map((r) => r.threadId)
        .filter((id): id is string => !!id && !dealThreadIdSet.has(id)),
    ),
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
  // (dealThreadIdSet já declarado lá em cima, reaproveitado aqui.)
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
  // `createdAt` da thread aqui também alimenta o SLA: é o teto mínimo do
  // "tempo até o 1º contato" (a 1ª mensagem não pode ser antes da thread
  // existir, mesmo que o Contact seja mais novo que a thread).
  const slaAllThreadIds = Array.from(
    new Set([...inboundPairs.map((p) => p.threadId), ...outboundPairs.map((p) => p.threadId), ...slaAllThreadsFirstMessages.map((m) => m.threadId)]),
  );
  const threads = await prisma.whatsAppThread.findMany({
    where: { id: { in: slaAllThreadIds } },
    select: { id: true, contactId: true, createdAt: true },
  });
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const contactIdByThread = new Map(threads.map((t) => [t.id, t.contactId]));

  // ─── SLA: Contatos (Contact) abordados no período — createdAt de contato
  // é o "t0" do SLA. Busca só quem tem responsavelId e thread vinculada,
  // pra poder quebrar por vendedor no ranking.
  const slaContactThreadIds = Array.from(new Set(slaAllThreadsFirstMessages.map((m) => threadById.get(m.threadId)?.contactId).filter((id): id is string => !!id)));
  const slaContactsForFirstTouch = slaContactThreadIds.length
    ? await prisma.contact.findMany({
        where: {
          organizationId,
          id: { in: slaContactThreadIds },
          ...(effectiveScope.type === "owners" ? { responsavelId: { in: effectiveScope.ownerIds } } : {}),
        },
        select: { id: true, createdAt: true, responsavelId: true },
      })
    : [];
  const slaContactById = new Map(slaContactsForFirstTouch.map((c) => [c.id, c]));

  // ─── SLA: Para cada thread onde a 1ª mensagem foi INBOUND (lead bateu
  // primeiro), pega a 1ª OUTBOUND do vendedor — calcula o tempo atém a
  // resposta, por thread.
  const slaLeadFirstThreadsIds = slaAllThreadsFirstMessages
    .filter((m) => m.direction === "INBOUND")
    .map((m) => m.threadId);
  const slaFirstReplyOutbound = slaLeadFirstThreadsIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: {
          organizationId,
          threadId: { in: slaLeadFirstThreadsIds },
          direction: "OUTBOUND",
        },
        orderBy: { createdAt: "asc" },
        distinct: ["threadId"],
        select: { threadId: true, instanceId: true, createdAt: true },
      })
    : [];
  const slaFirstOutboundByThread = new Map(slaFirstReplyOutbound.map((m) => [m.threadId, m]));

  // ─── SLA: Cálculo agregado e por vendedor ───────────────────────────────
  // Horário de SLA comercial: intervalo que conta como "dentro do horário"
  // pro SLA de 1h. Por enquanto 100% do tempo conta (sla simples de tempo
  // real, não horário comercial restrito) — fica um placeholder pra trocar
  // depois se o cliente quiser apenas 9h-18h.
  const SLA_FIRST_TOUCH_TARGET_MS = 60 * 60 * 1000; // 1 hora
  const slaByUser = new Map<
    string,
    {
      firstTouchMs: number[];
      firstReplyMs: number[];
      qualificationMs: number[];
      firstTouchUnderTarget: number;
      firstTouchTotal: number;
    }
  >();
  const ensureSlaUser = (userId: string) => {
    if (!slaByUser.has(userId)) {
      slaByUser.set(userId, {
        firstTouchMs: [],
        firstReplyMs: [],
        qualificationMs: [],
        firstTouchUnderTarget: 0,
        firstTouchTotal: 0,
      });
    }
    return slaByUser.get(userId)!;
  };

  // Dono (userId) de cada instância — os dois loops abaixo consultam isso por
  // mensagem (podem ser milhares no período), então um Map em vez de
  // whatsappInstances.find() por mensagem evita um scan linear repetido.
  const userIdByInstanceId = new Map(whatsappInstances.map((i) => [i.id, i.userId]));

  // A. 1º contato (vendedor chama primeiro): tempo entre a entrada do
  // contato no CRM (ou criação da thread, o que for MAIS RECENTE — é o t0
  // mais correto, um contato importado ontem não penaliza quem abordou hoje)
  // e a 1ª mensagem OUTBOUND.
  for (const firstMsg of slaAllThreadsFirstMessages) {
    if (firstMsg.direction !== "OUTBOUND") continue;
    const thread = threadById.get(firstMsg.threadId);
    if (!thread?.contactId) continue;
    const contact = slaContactById.get(thread.contactId);
    const userId = contact?.responsavelId ?? (firstMsg.instanceId ? userIdByInstanceId.get(firstMsg.instanceId) : undefined);
    if (!userId) continue;
    const t0 = contact && contact.createdAt > thread.createdAt ? contact.createdAt : thread.createdAt;
    const delta = firstMsg.createdAt.getTime() - t0.getTime();
    if (delta < 0) continue; // thread/msg fora de ordem (importação antiga) — ignora
    const bucket = ensureSlaUser(userId);
    bucket.firstTouchMs.push(delta);
    bucket.firstTouchTotal += 1;
    if (delta <= SLA_FIRST_TOUCH_TARGET_MS) bucket.firstTouchUnderTarget += 1;
  }

  // B. Tempo de 1ª resposta do vendedor (lead bateu primeiro): INBOUND 1ª
  // -> OUTBOUND mais antiga depois dela.
  for (const firstMsg of slaAllThreadsFirstMessages) {
    if (firstMsg.direction !== "INBOUND") continue;
    const reply = slaFirstOutboundByThread.get(firstMsg.threadId);
    if (!reply) continue;
    const userId = reply.instanceId ? userIdByInstanceId.get(reply.instanceId) : undefined;
    if (!userId) continue;
    const delta = reply.createdAt.getTime() - firstMsg.createdAt.getTime();
    if (delta < 0) continue;
    ensureSlaUser(userId).firstReplyMs.push(delta);
  }

  // C. Tempo até qualificação: Contact.createdAt -> leadQualificationAt.
  for (const c of slaContactsQualified) {
    if (!c.leadQualificationAt || !c.responsavelId) continue;
    const delta = c.leadQualificationAt.getTime() - c.createdAt.getTime();
    if (delta < 0) continue;
    ensureSlaUser(c.responsavelId).qualificationMs.push(delta);
  }

  const slaSummaryRows = visibleMembers
    .map((m) => ({ userId: m.userId, name: m.user.name, photoUrl: personPhoto(m.userId) }))
    .map((u) => {
      const s = slaByUser.get(u.userId);
      const totalLeadsQualified = slaContactsQualified.filter((c) => c.responsavelId === u.userId).length;
      return {
        id: u.userId,
        name: u.name,
        photoUrl: u.photoUrl,
        avgFirstTouchMs: average(s?.firstTouchMs ?? []),
        firstTouchWithin1h: s && s.firstTouchTotal > 0 ? Math.round((s.firstTouchUnderTarget / s.firstTouchTotal) * 100) : null,
        firstTouchTotal: s?.firstTouchTotal ?? 0,
        avgFirstReplyMs: average(s?.firstReplyMs ?? []),
        p95FirstReplyMs: percentile(s?.firstReplyMs ?? [], 95),
        firstReplyCount: s?.firstReplyMs.length ?? 0,
        avgQualificationMs: average(s?.qualificationMs ?? []),
        qualificationCount: totalLeadsQualified,
      };
    })
    // Vendedor que não tem nenhuma interação no período não aparece no
    // ranking de SLA — não há dados para mostrar, e a tabela já tem
    // "Atividade da equipe" pra ver quem ficou parado mesmo.
    .filter((r) => r.firstTouchTotal > 0 || r.firstReplyCount > 0 || r.qualificationCount > 0);

  // Totais agregados do time todo (para os 4 cards no topo da seção).
  const slaAllFirstTouch = slaSummaryRows.flatMap((r) => {
    const s = slaByUser.get(r.id);
    return s?.firstTouchMs ?? [];
  });
  const slaAllFirstReplies = slaSummaryRows.flatMap((r) => {
    const s = slaByUser.get(r.id);
    return s?.firstReplyMs ?? [];
  });
  const slaAllQual = slaSummaryRows.flatMap((r) => {
    const s = slaByUser.get(r.id);
    return s?.qualificationMs ?? [];
  });
  const slaTotalFirstTouch = slaSummaryRows.reduce((a, r) => a + r.firstTouchTotal, 0);
  const slaWithin1hCount = Array.from(slaByUser.values()).reduce((a, s) => a + s.firstTouchUnderTarget, 0);
  const slaOverallFirstTouchWithin1h = slaTotalFirstTouch > 0 ? Math.round((slaWithin1hCount / slaTotalFirstTouch) * 100) : null;
  const slaTotalAvgFirstTouchMs = average(slaAllFirstTouch);
  const slaTotalAvgFirstReplyMs = average(slaAllFirstReplies);
  const slaTotalP95FirstReplyMs = percentile(slaAllFirstReplies, 95);
  const slaTotalAvgQualificationMs = average(slaAllQual);
  const slaTotalQualified = slaContactsQualified.length;

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
  const dealWhatsappStatsByUser = new Map(dealWhatsappStats.map((d) => [d.userId, d]));
  const sellerWhatsappCards = whatsappStats.map((w) => ({
    ...w,
    deal: dealWhatsappStatsByUser.get(w.userId) ?? null,
  }));

  // ─── Meta mensal ────────────────────────────────────────────────────
  // Sempre o mês corrente (calendário de Brasília), independente do filtro
  // de período do resto do relatório acima — meta é "como estamos indo
  // agora", não uma pergunta sobre um período arbitrário escolhido. Também
  // sempre a organização inteira (ignora o filtro de equipe/responsável):
  // é uma meta só, do time todo, não uma por pessoa. `isOwner` já foi
  // calculado lá em cima (decide a aba "Processos").
  const nowParts = getBrazilParts(new Date());
  const currentMonthLabel = brazilStartOfMonth().toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const [monthlyGoal, goalWonAgg, activeSellerCount] = await Promise.all([
    prisma.monthlyGoal.findUnique({
      where: { organizationId_year_month: { organizationId, year: nowParts.year, month: nowParts.month + 1 } },
    }),
    prisma.deal.aggregate({
      where: { organizationId, status: "WON", closedAt: { gte: brazilStartOfMonth() } },
      _sum: { value: true },
    }),
    countActiveSellers(organizationId),
  ]);
  const goalValue = monthlyGoal ? Number(monthlyGoal.value) : null;
  const goalAchievedValue = goalWonAgg._sum.value ? Number(goalWonAgg._sum.value) : 0;
  const goalSuggestedValue = suggestedGoalValue(activeSellerCount);
  // Só sugere atualizar quando dá pra comparar com uma base conhecida —
  // meta sem `basedOnSellerCount` (salva antes desse campo existir) nunca
  // dispara a sugestão, só quando o time muda DEPOIS de uma meta que já
  // tinha uma base registrada (ver migration 20260803110000).
  const goalBasisChanged =
    monthlyGoal?.basedOnSellerCount != null && monthlyGoal.basedOnSellerCount !== activeSellerCount;
  // Pro marcador de ritmo no GoalCard — "dia X de Y do mês", sempre em
  // calendário de Brasília (nowParts já é isso), nunca no fuso do navegador
  // de quem está vendo a tela.
  const goalDaysElapsed = nowParts.day;
  const goalDaysInMonth = new Date(Date.UTC(nowParts.year, nowParts.month + 1, 0)).getUTCDate();

  return {
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
    monthTrend,
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
  };
  });
}
