import Link from "next/link";
import { ListTodo, Inbox, Clock, MessageSquareWarning, StickyNote } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { isStale } from "@/lib/stale";
import { EmptyState } from "@/components/empty-state";
import { CountUpValue } from "@/components/count-up-value";

/**
 * Início do Administrativo — deliberadamente diferente do início de Vendas
 * (sem funil/metas, que não fazem sentido pra quem não vende): só as
 * próprias tarefas e as próprias anotações de Processo, mais um resumo de
 * quantos processos estão parados/com solicitação pendente.
 */
export async function HomeAdministrativo() {
  const access = await requireProcessAccess();
  if (!access.ok) return null; // layout já garante sessão ativa; defensivo

  return runWithTenant(access.organizationId, async () => {
  const scopeWhere = processScopeWhere(access);

  const [pendingTasks, notes, openProcesses, openRequestCount] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId: access.organizationId, ownerId: access.userId, completedAt: null },
      orderBy: { dueAt: "asc" },
      take: 8,
      include: { contact: true, deal: true },
    }),
    prisma.activity.findMany({
      where: { organizationId: access.organizationId, processId: { not: null }, userId: access.userId },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { process: { include: { contact: true } } },
    }),
    prisma.process.findMany({
      where: { organizationId: access.organizationId, ...scopeWhere, stage: { isFinal: false } },
      select: { id: true, stageEnteredAt: true },
    }),
    prisma.processRequest.count({
      where: { organizationId: access.organizationId, resolvedAt: null, process: scopeWhere },
    }),
  ]);

  const staleCount = openProcesses.filter((p) => isStale(p.stageEnteredAt)).length;

  return (
    <div className="space-y-6 lg:space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
          Painel administrativo
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Suas tarefas e os processos de pós-venda.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
        <StatTile icon={ListTodo} label="Tarefas pendentes" value={pendingTasks.length} />
        <StatTile icon={Clock} label="Processos parados" value={staleCount} href="/processos" />
        <StatTile icon={MessageSquareWarning} label="Solicitações pendentes" value={openRequestCount} href="/processos" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Minhas tarefas</h2>
          {pendingTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhuma tarefa pendente.</p>
          ) : (
            <div className="space-y-4">
              {pendingTasks.map((task) => (
                <Link
                  key={task.id}
                  href={task.contact ? `/clientes/${task.contact.id}` : "/agenda"}
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

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Minhas anotações</h2>
          {notes.length === 0 ? (
            <EmptyState icon={Inbox} title="Nenhuma anotação ainda" description="Registre notas a partir da página de um Processo." />
          ) : (
            <div className="space-y-2">
              {notes.map((note) => (
                <Link
                  key={note.id}
                  href={note.process ? `/processos/${note.process.id}` : "/processos"}
                  className="-mx-2 flex gap-3 rounded-md p-2 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <StickyNote className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {note.process?.contact.name ?? "Processo"}
                    </p>
                    {note.body && <p className="truncate text-neutral-500 dark:text-neutral-400">{note.body}</p>}
                    <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{note.createdAt.toLocaleString("pt-BR")}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  });
}

function StatTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof ListTodo;
  label: string;
  value: number;
  href?: string;
}) {
  const content = (
    <div className="card p-3 lg:p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="truncate text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100 lg:text-2xl">
        <CountUpValue value={value} format="number" />
      </p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
