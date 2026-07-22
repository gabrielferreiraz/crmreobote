import Link from "next/link";
import { Clock, CircleCheck, CircleDollarSign, FileWarning, MessageCircle } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { getContactsWithUnreadWhatsApp } from "@/lib/processes/whatsapp-signals";
import { isStale, STALE_DEAL_DAYS } from "@/lib/stale";
import { daysSince } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { BarRow } from "./bar-row";

/**
 * Relatório do Administrativo (pós-venda) — substitui o dashboard de
 * vendas (funil/metas não fazem sentido aqui). Foco no que o administrativo
 * precisa saber de relance: quantos processos em cada etapa, quantos
 * parados, quantos com pagamento/documentação pendente.
 */
export async function AdminReportsView() {
  const access = await requireProcessAccess();
  if (!access.ok) return null;

  return runWithTenant(access.organizationId, async () => {
  const scopeWhere = processScopeWhere(access);

  const [processes, contemplatedCount, paymentPendingCount, documentPendingCount] = await Promise.all([
    prisma.process.findMany({
      where: { organizationId: access.organizationId, ...scopeWhere },
      include: { stage: true, contact: { select: { id: true, name: true } } },
    }),
    prisma.process.count({ where: { organizationId: access.organizationId, ...scopeWhere, contemplated: true } }),
    prisma.process.count({ where: { organizationId: access.organizationId, ...scopeWhere, paymentPending: true } }),
    prisma.process.count({
      where: { organizationId: access.organizationId, ...scopeWhere, documentStatus: { not: "DELIVERED" } },
    }),
  ]);

  const unreadContactIds = await getContactsWithUnreadWhatsApp(
    access.organizationId,
    processes.map((p) => p.contact.id),
  );

  const stageCounts = new Map<string, { name: string; color: string | null; count: number }>();
  for (const p of processes) {
    const existing = stageCounts.get(p.stageId);
    if (existing) existing.count += 1;
    else stageCounts.set(p.stageId, { name: p.stage.name, color: p.stage.color, count: 1 });
  }
  const maxStageCount = Math.max(1, ...Array.from(stageCounts.values()).map((s) => s.count));

  const staleProcesses = processes
    .filter((p) => !p.stage.isFinal && isStale(p.stageEnteredAt))
    .sort((a, b) => a.stageEnteredAt.getTime() - b.stageEnteredAt.getTime());

  return (
    <div className="space-y-6 lg:space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
          Relatório do Administrativo
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Acompanhamento de pós-venda.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        <StatTile icon={CircleCheck} label="Contemplados" value={contemplatedCount} />
        <StatTile icon={CircleDollarSign} label="Com pagamento pendente" value={paymentPendingCount} />
        <StatTile icon={FileWarning} label="Com documentação pendente" value={documentPendingCount} />
        <StatTile icon={Clock} label={`Parados ${STALE_DEAL_DAYS}+ dias`} value={staleProcesses.length} />
        <StatTile icon={MessageCircle} label="Com mensagem não lida" value={unreadContactIds.size} />
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Processos por etapa</h2>
        {stageCounts.size === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum processo ainda.</p>
        ) : (
          <div className="space-y-3">
            {Array.from(stageCounts.values()).map((stage) => (
              <BarRow key={stage.name} label={stage.name} value={stage.count} max={maxStageCount} displayValue={String(stage.count)} />
            ))}
          </div>
        )}
      </div>

      {staleProcesses.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Processos parados (sem trocar de etapa há {STALE_DEAL_DAYS}+ dias)
          </h2>
          <div className="space-y-2">
            {staleProcesses.map((process) => (
              <Link
                key={process.id}
                href={`/processos/${process.id}`}
                className="card flex items-center justify-between p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <span className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
                  <Avatar name={process.contact.name} size="xs" />
                  {process.contact.name}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  {process.stage.name} · {daysSince(process.stageEnteredAt)}d
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  });
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: number }) {
  return (
    <div className="card p-3 lg:p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="truncate text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100 lg:text-2xl">{value}</p>
    </div>
  );
}
