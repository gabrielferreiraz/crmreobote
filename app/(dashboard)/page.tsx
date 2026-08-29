import Link from "next/link";
import { ArrowUpRight, Briefcase, TrendingUp, Users, Inbox, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STALE_DEAL_DAYS, STALE_DEAL_ALERT_DAYS } from "@/lib/stale";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { ACTIVITY_ICON, ACTIVITY_LABEL } from "@/lib/activity-icons";
import { TASK_TYPE_COLOR } from "@/lib/task-icons";
import { getDealScope, scopeWhere, contactScopeWhere } from "@/lib/team-scope";
import { brazilGreeting, brazilStartOfMonth } from "@/lib/timezone";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { fetchDealsList, countDeals } from "@/lib/deals/list-query";
import { getCurrentMonthGoalProgress } from "@/lib/goals/suggestion";
import { countUnreadThreads } from "@/lib/whatsapp/conversations";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { CountUpValue } from "@/components/count-up-value";
import { getCurrentUserArea } from "@/lib/user-area";
import { HomeAdministrativo } from "./home-administrativo";
import { StaleDealsList } from "./stale-deals-list";
import { ActionRequiredCard } from "./action-required-card";

const STALE_DEALS_PAGE_SIZE = 10;

/** Each stat tile gets a distinct color identity — makes them scannable at a glance.
 * `bg` virou um degradê de 2 tons da MESMA família (não uma cor nova) — pedido
 * explícito de dar mais sofisticação ao Início sem fugir da identidade de cor
 * de cada métrica; mesma técnica que a barra de etapa do funil logo abaixo já
 * usa (degradê dentro do próprio tom, nunca uma cor emprestada de outro lugar). */
const STAT_COLORS = {
  pipeline: { bg: "bg-gradient-to-br from-brand-light to-brand-light-hover", icon: "text-brand dark:text-brand" },
  value: {
    bg: "bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-500/10 dark:to-blue-500/20",
    icon: "text-blue-600 dark:text-blue-400",
  },
  // Cinza-azulado (slate) em vez do verde padrão de "ganho" — pedido
  // explícito pro tile "Fechado no mês", pra combinar com o tom do card
  // "Exige ação" logo abaixo em vez do verde-dinheiro genérico de sempre.
  won: {
    bg: "bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-500/15 dark:to-slate-500/25",
    icon: "text-slate-600 dark:text-slate-300",
  },
  clients: {
    bg: "bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-500/10 dark:to-violet-500/20",
    icon: "text-violet-600 dark:text-violet-400",
  },
} as const;

export default async function HomePage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const firstName = (session!.user.name ?? "").split(" ")[0] || "";

  // Administrativo (pós-venda) tem um início próprio — sem funil/metas de
  // vendas, que não fazem sentido pra quem não vende (ver conversa que
  // definiu o módulo de Processos).
  const area = await getCurrentUserArea();
  if (area === "ADMINISTRATIVO") return <HomeAdministrativo />;

  return runWithTenant(organizationId, async () => {
  const scope = await getDealScope(organizationId, userId, session!.user.role);
  const staleBefore = new Date(Date.now() - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000);
  const startOfMonth = brazilStartOfMonth();

  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId, isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const staleDealsParams = { organizationId, scope, status: "OPEN" as const, stageEnteredBefore: staleBefore };
  // "% da meta" no KPI "Fechado no mês" (ver getCurrentMonthGoalProgress) só
  // faz sentido pra quem vê o funil inteiro — meta é sempre organização
  // inteira, dividir um "fechado" já ESCOPADO pela meta do time todo daria
  // uma % sem significado real pra quem não vê tudo (mesma decisão do
  // Pipeline, ver pipeline/page.tsx).
  const isOwnerForGoal = session!.user.role === "OWNER";
  const alertBefore = new Date(Date.now() - STALE_DEAL_ALERT_DAYS * 24 * 60 * 60 * 1000);

  const [
    openDeals,
    pipelineValue,
    wonThisMonth,
    activeClients,
    staleDeals,
    staleDealsCount,
    stageValues,
    upcomingTasks,
    recentActivities,
    semTarefaCount,
    parados14dCount,
    unreadCount,
    goalProgress,
  ] = await Promise.all([
    prisma.deal.count({ where: { organizationId, status: "OPEN", ...scopeWhere(scope) } }),
    prisma.deal.aggregate({
      where: { organizationId, status: "OPEN", ...scopeWhere(scope) },
      _sum: { value: true },
    }),
    prisma.deal.aggregate({
      where: { organizationId, status: "WON", closedAt: { gte: startOfMonth }, ...scopeWhere(scope) },
      _sum: { value: true },
      _count: true,
    }),
    // Antes hardcoded pro usuário logado (responsavelId: userId) — não
    // respeitava escopo de equipe. contactScopeWhere (ver lib/team-scope.ts)
    // segue o mesmo escopo do resto do Início: tudo pro Dono, só a própria
    // carteira do time pra Gerente/Supervisor, só o próprio pro Consultor.
    prisma.contact.count({ where: { organizationId, ...contactScopeWhere(scope) } }),
    fetchDealsList({ ...staleDealsParams, take: STALE_DEALS_PAGE_SIZE, sortDir: "asc" }),
    countDeals(staleDealsParams),
    pipeline
      ? prisma.deal.groupBy({
          by: ["stageId"],
          where: { organizationId, pipelineId: pipeline.id, status: "OPEN", ...scopeWhere(scope) },
          _count: true,
          _sum: { value: true },
        })
      : Promise.resolve([]),
    prisma.task.findMany({
      where: { organizationId, ownerId: userId, completedAt: null, dueAt: { gte: new Date() } },
      orderBy: { dueAt: "asc" },
      take: 5,
      include: { deal: true, contact: true },
    }),
    prisma.activity.findMany({
      where: { organizationId, ...(scope.type === "owners" ? { userId: { in: scope.ownerIds } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { user: true, deal: true, contact: true },
    }),
    // Card "Exige ação" (ver action-required-card.tsx) — mesmo builder de
    // filtro do Pipeline (countDeals/buildDealsWhere em lib/deals/list-query.ts),
    // nunca duplicado à mão, pra nunca sair de sincronia com o que o link
    // "?filter=..." de cada linha realmente mostra ao chegar lá.
    countDeals({ organizationId, scope, status: "OPEN", hasNoOpenTask: true }),
    countDeals({ organizationId, scope, status: "OPEN", stageEnteredBefore: alertBefore }),
    countUnreadThreads(organizationId, scope),
    isOwnerForGoal ? getCurrentMonthGoalProgress(organizationId) : Promise.resolve(null),
  ]);

  const stageData = (pipeline?.stages ?? []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color ?? "#6366f1",
    count: stageValues.find((s) => s.stageId === stage.id)?._count ?? 0,
    value: stageValues.find((s) => s.stageId === stage.id)?._sum.value
      ? Number(stageValues.find((s) => s.stageId === stage.id)!._sum.value)
      : 0,
  }));
  const maxStageValue = Math.max(1, ...stageData.map((s) => s.value));
  const avatarMap = await resolveAvatarUrlMap([...recentActivities.map((a) => a.user.image), session!.user.image]);
  const ownPhotoUrl = session!.user.image ? (avatarMap.get(session!.user.image) ?? null) : null;

  const goalPct =
    goalProgress?.goalValue && goalProgress.goalValue > 0
      ? Math.min(100, Math.round((goalProgress.achievedValue / goalProgress.goalValue) * 100))
      : null;
  const wonHint =
    goalPct !== null
      ? `${goalPct}% da meta de ${formatCurrencyCompact(goalProgress!.goalValue)}`
      : `${wonThisMonth._count} negócio${wonThisMonth._count === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6 lg:space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Resumo do seu funil e das próximas atividades.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <StatTile icon={Briefcase} label="Negócios abertos" value={openDeals} colorSet={STAT_COLORS.pipeline} />
        <StatTile
          icon={ArrowUpRight}
          label="Pipeline aberto"
          value={pipelineValue._sum.value ? Number(pipelineValue._sum.value) : 0}
          format="currency"
          colorSet={STAT_COLORS.value}
        />
        <StatTile
          icon={TrendingUp}
          label="Fechado no mês"
          value={wonThisMonth._sum.value ? Number(wonThisMonth._sum.value) : 0}
          format="currency"
          hint={wonHint}
          colorSet={STAT_COLORS.won}
        />
        <StatTile icon={Users} label="Clientes ativos" value={activeClients} colorSet={STAT_COLORS.clients} />
      </div>

      <ActionRequiredCard
        semTarefaCount={semTarefaCount}
        parados14dCount={parados14dCount}
        unreadCount={unreadCount}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Funil de vendas</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Distribuição de valor por etapa</p>
            </div>
            <Link
              href="/pipeline"
              className="group inline-flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover dark:text-brand dark:hover:text-brand-hover"
            >
              Abrir pipeline <ArrowRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>

          {stageData.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum negócio em aberto.</p>
          ) : (
            <div className="space-y-3">
              {stageData.map((stage) => (
                <div key={stage.id} className="flex items-center gap-4">
                  <span className="flex w-32 shrink-0 items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="truncate">{stage.name}</span>
                    <span className="text-neutral-400 dark:text-neutral-500">· {stage.count}</span>
                  </span>
                  <div className="group/bar h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full transition-all duration-300 group-hover/bar:opacity-100"
                      style={{
                        width: `${Math.max(4, (stage.value / maxStageValue) * 100)}%`,
                        // Degradê na própria cor da etapa (não uma cor fixa
                        // pra todo mundo) — vai da cor cheia até uma versão
                        // clareada dela mesma, então cada etapa continua
                        // reconhecível pela cor (mesmo código da bolinha ao
                        // lado do nome), só ganha profundidade.
                        background: `linear-gradient(90deg, ${stage.color} 0%, color-mix(in srgb, ${stage.color} 55%, white) 100%)`,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-right text-sm whitespace-nowrap tabular-nums text-neutral-500 dark:text-neutral-400">
                    {formatCurrency(stage.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Próximas atividades</h2>
          {upcomingTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhuma tarefa agendada.</p>
          ) : (
            <div className="space-y-1">
              {upcomingTasks.map((task) => {
                const colors = TASK_TYPE_COLOR[task.type] ?? TASK_TYPE_COLOR.OTHER;
                return (
                  <Link
                    key={task.id}
                    href={
                      task.deal
                        ? `/negocios/${task.deal.id}?highlightTask=${task.id}`
                        : task.contact
                          ? `/clientes/${task.contact.id}`
                          : "/agenda"
                    }
                    className="-mx-2 flex gap-3 rounded-lg p-2.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  >
                    <div className="w-11 shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                      {task.dueAt && (
                        <>
                          <div className="font-semibold">{new Date(task.dueAt).toLocaleDateString("pt-BR", { day: "2-digit" })}</div>
                          <div className="uppercase">{new Date(task.dueAt).toLocaleDateString("pt-BR", { month: "short" })}</div>
                        </>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{task.title}</p>
                      <p className="truncate text-neutral-500 dark:text-neutral-400">
                        {task.deal?.name ?? task.contact?.name ?? ""}
                        {task.dueAt && ` · ${new Date(task.dueAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                      </p>
                    </div>
                    <Avatar name={session!.user.name ?? "?"} src={ownPhotoUrl} size="xs" className="shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <StaleDealsList
        initialDeals={staleDeals}
        initialTotalCount={staleDealsCount}
        staleBefore={staleBefore.toISOString()}
        staleDays={STALE_DEAL_DAYS}
      />

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">Atividades recentes</h2>
        {recentActivities.length === 0 ? (
          <div className="card">
            <EmptyState icon={Inbox} title="Nenhuma atividade ainda" description="Registre notas, ligações e e-mails a partir de um negócio." />
          </div>
        ) : (
          <div className="space-y-2">
            {recentActivities.map((activity) => {
              const Icon = ACTIVITY_ICON[activity.type] ?? Inbox;
              const colors = TASK_TYPE_COLOR[activity.type] ?? TASK_TYPE_COLOR.OTHER;
              return (
                <Link
                  key={activity.id}
                  href={
                    activity.deal
                      ? `/negocios/${activity.deal.id}?highlightActivity=${activity.id}`
                      : activity.contact
                        ? `/clientes/${activity.contact.id}`
                        : "/pipeline"
                  }
                  className="card flex gap-3 p-3 text-sm transition-all duration-150 hover:shadow-md hover:-translate-y-px dark:hover:shadow-none"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colors.bg}`}>
                    <Icon className={`h-4 w-4 ${colors.text}`} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-neutral-800 dark:text-neutral-200">
                      <span className="font-medium">{ACTIVITY_LABEL[activity.type] ?? activity.type}</span>
                      {" — "}
                      {activity.deal?.name ?? activity.contact?.name ?? ""}
                    </p>
                    {activity.body && <p className="mt-1 text-neutral-500 dark:text-neutral-400">{activity.body}</p>}
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                      <Avatar
                        name={activity.user.name}
                        src={activity.user.image ? avatarMap.get(activity.user.image) : null}
                        size="xs"
                      />
                      {activity.user.name} · {activity.createdAt.toLocaleString("pt-BR")}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
  });
}

function greeting() {
  return brazilGreeting();
}

function StatTile({
  icon: Icon,
  label,
  value,
  format = "number",
  hint,
  colorSet,
}: {
  icon: typeof Briefcase;
  label: string;
  value: number;
  format?: "number" | "currency";
  hint?: string;
  colorSet: { bg: string; icon: string };
}) {
  return (
    <div className="card p-3 transition-all duration-150 hover:shadow-md hover:-translate-y-px dark:hover:shadow-none lg:p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="truncate text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colorSet.bg}`}>
          <Icon className={`h-4 w-4 ${colorSet.icon}`} strokeWidth={2} />
        </div>
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100 lg:text-2xl">
        <CountUpValue value={value} format={format} />
      </p>
      {hint && <p className="mt-1 truncate text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}
