import Link from "next/link";
import { ArrowUpRight, Briefcase, TrendingUp, Users, Inbox, Clock, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STALE_DEAL_DAYS } from "@/lib/stale";
import { formatCurrency, daysSince } from "@/lib/format";
import { ACTIVITY_ICON, ACTIVITY_LABEL } from "@/lib/activity-icons";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";

export default async function HomePage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const firstName = (session!.user.name ?? "").split(" ")[0] || "";

  return runWithTenant(organizationId, async () => {
  const scope = await getDealScope(organizationId, userId, session!.user.role);
  const staleBefore = new Date(Date.now() - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(new Date().setDate(1));

  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId, isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const [openDeals, pipelineValue, wonThisMonth, activeClients, staleDeals, stageValues, upcomingTasks, recentActivities] =
    await Promise.all([
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
      prisma.contact.count({ where: { organizationId } }),
      prisma.deal.findMany({
        where: { organizationId, status: "OPEN", stageEnteredAt: { lte: staleBefore }, ...scopeWhere(scope) },
        orderBy: { stageEnteredAt: "asc" },
        include: { contact: true, stage: true },
      }),
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
    ]);

  const stageData = (pipeline?.stages ?? []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    count: stageValues.find((s) => s.stageId === stage.id)?._count ?? 0,
    value: stageValues.find((s) => s.stageId === stage.id)?._sum.value
      ? Number(stageValues.find((s) => s.stageId === stage.id)!._sum.value)
      : 0,
  }));
  const maxStageValue = Math.max(1, ...stageData.map((s) => s.value));
  const activityAvatarMap = await resolveAvatarUrlMap(recentActivities.map((a) => a.user.image));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Resumo do seu funil e das próximas atividades.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatTile icon={Briefcase} label="Negócios abertos" value={String(openDeals)} />
        <StatTile icon={ArrowUpRight} label="Pipeline aberto" value={formatCurrency(pipelineValue._sum.value ? Number(pipelineValue._sum.value) : 0)} />
        <StatTile icon={TrendingUp} label="Fechado no mês" value={formatCurrency(wonThisMonth._sum.value ? Number(wonThisMonth._sum.value) : 0)} hint={`${wonThisMonth._count} negócio${wonThisMonth._count === 1 ? "" : "s"}`} />
        <StatTile icon={Users} label="Clientes ativos" value={String(activeClients)} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="card col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Funil de vendas</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Distribuição de valor por etapa</p>
            </div>
            <Link
              href="/pipeline"
              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Abrir pipeline <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>

          {stageData.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum negócio em aberto.</p>
          ) : (
            <div className="space-y-3">
              {stageData.map((stage) => (
                <div key={stage.id} className="flex items-center gap-4">
                  <span className="w-32 shrink-0 truncate text-sm text-neutral-700 dark:text-neutral-300">
                    {stage.name} <span className="text-neutral-400 dark:text-neutral-500">· {stage.count}</span>
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-neutral-900 dark:bg-white"
                      style={{ width: `${Math.max(4, (stage.value / maxStageValue) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm tabular-nums text-neutral-500 dark:text-neutral-400">
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
            <div className="space-y-4">
              {upcomingTasks.map((task) => (
                <Link
                  key={task.id}
                  href={
                    task.deal
                      ? `/negocios/${task.deal.id}?highlightTask=${task.id}`
                      : task.contact
                        ? `/clientes/${task.contact.id}`
                        : "/agenda"
                  }
                  className="-mx-2 flex gap-3 rounded-md p-2 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <div className="w-11 shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                    {task.dueAt && (
                      <>
                        <div>{new Date(task.dueAt).toLocaleDateString("pt-BR", { day: "2-digit" })}</div>
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
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {staleDeals.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Negócios parados (sem trocar de etapa há {STALE_DEAL_DAYS}+ dias)
          </h2>
          <div className="space-y-2">
            {staleDeals.map((deal) => (
              <Link
                key={deal.id}
                href={`/negocios/${deal.id}`}
                className="card flex items-center justify-between p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <span className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
                  <Avatar name={deal.contact.name} size="xs" />
                  {deal.name} <span className="text-neutral-500 dark:text-neutral-400">· {deal.contact.name}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  {deal.stage.name} · {daysSince(deal.stageEnteredAt)}d
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

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
                  className="card flex gap-3 p-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <Icon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-neutral-800 dark:text-neutral-200">
                      {ACTIVITY_LABEL[activity.type] ?? activity.type}
                      {" — "}
                      {activity.deal?.name ?? activity.contact?.name ?? ""}
                    </p>
                    {activity.body && <p className="mt-1 text-neutral-500 dark:text-neutral-400">{activity.body}</p>}
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                      <Avatar
                        name={activity.user.name}
                        src={activity.user.image ? activityAvatarMap.get(activity.user.image) : null}
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
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Briefcase;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <Icon className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}
