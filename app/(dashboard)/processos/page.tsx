import { redirect } from "next/navigation";
import { Layers, CircleDollarSign, MessageSquareWarning } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { fetchProcessList, countProcessesByStage } from "@/lib/processes/list-query";
import { CountUpValue } from "@/components/count-up-value";
import { ProcessesView } from "./processes-view";
import type { ProcessItem } from "./process-kanban-board";

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string }>;
}) {
  const access = await requireProcessAccess();
  if (!access.ok) redirect("/");

  const { pipelineId: pipelineIdParam } = await searchParams;

  return runWithTenant(access.organizationId, async () => {
    const categoriesRaw = await prisma.processCategory.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { order: "asc" },
      include: {
        pipelines: {
          orderBy: { order: "asc" },
          include: {
            stages: { orderBy: { order: "asc" }, include: { _count: { select: { processes: true } } } },
            _count: { select: { processes: true } },
          },
        },
      },
    });

    const allPipelines = categoriesRaw.flatMap((c) => c.pipelines);
    const activePipeline =
      allPipelines.find((p) => p.id === pipelineIdParam) ?? allPipelines.find((p) => p.isDefault) ?? allPipelines[0];

    if (!activePipeline) {
      return (
        <p className="text-neutral-400 dark:text-neutral-500">
          Nenhuma categoria/subcategoria de processos configurada ainda.
        </p>
      );
    }

    const categories = categoriesRaw.map((c) => ({
      id: c.id,
      name: c.name,
      pipelines: c.pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        stages: p.stages,
        _count: p._count,
      })),
    }));

    // Kanban busca limitado (não o pipeline inteiro) — mesmo motivo/mesmo
    // padrão de app/(dashboard)/pipeline/page.tsx: uma consulta só, com teto,
    // agrupada por etapa em memória; countProcessesByStage abaixo dá o total
    // de verdade de cada coluna, e "carregar mais" (process-kanban-board.tsx)
    // busca só a etapa que precisa quando o usuário rola até lá.
    const PROCESS_INITIAL_CAP = 400;
    const kanbanFilterParams = {
      organizationId: access.organizationId,
      pipelineId: activePipeline.id,
      ownerId: access.isAdmin ? undefined : access.userId,
    };

    const [processCountByStage, processesFlat, orgStats] = await Promise.all([
      countProcessesByStage(kanbanFilterParams),
      fetchProcessList({ ...kanbanFilterParams, take: PROCESS_INITIAL_CAP }),
      // Estatísticas do topo são visão geral (todas Categorias/Subcategorias
      // juntas, mesmo escopo de "Lista") — diferente do Kanban abaixo, que é
      // sempre só a Subcategoria ativa.
      prisma.process.aggregate({
        where: { organizationId: access.organizationId, ...processScopeWhere(access) },
        _count: true,
      }),
    ]);

    const [pendingCount, dealValueSum] = await Promise.all([
      prisma.process.count({
        where: {
          organizationId: access.organizationId,
          ...processScopeWhere(access),
          requests: { some: { resolvedAt: null } },
        },
      }),
      // Soma agregada no banco (não busca 1 linha por processo só pra somar
      // em memória) — mesma ideia de aggregateDealValues em lib/deals/list-query.ts.
      prisma.deal.aggregate({
        where: { process: { organizationId: access.organizationId, ...processScopeWhere(access) } },
        _sum: { value: true },
      }),
    ]);
    const totalValue = dealValueSum._sum.value ? Number(dealValueSum._sum.value) : 0;

    // fetchProcessList já devolve tudo enriquecido (avatar, WhatsApp não
    // lido) — só falta agrupar por etapa pro Kanban.
    const initialProcessesByStage: Record<string, ProcessItem[]> = {};
    for (const p of processesFlat) {
      (initialProcessesByStage[p.stageId] ??= []).push(p);
    }

    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Processos</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {access.isAdmin
                ? "Acompanhamento de pós-venda — administrativo"
                : "Acompanhamento de pós-venda dos seus clientes (somente leitura)"}
            </p>
          </div>
        </div>

        {orgStats._count > 0 && (
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
            <ProcessStat icon={Layers} label="Processos" value={orgStats._count} />
            <ProcessStat icon={CircleDollarSign} label="Valor total" value={totalValue} format="currency" />
            <ProcessStat icon={MessageSquareWarning} label="Com pendências" value={pendingCount} />
          </div>
        )}

        <ProcessesView
          pipelineId={activePipeline.id}
          categories={categories}
          stages={activePipeline.stages}
          initialProcessesByStage={initialProcessesByStage}
          initialCountByStage={processCountByStage}
          isAdmin={access.isAdmin}
        />
      </div>
    );
  });
}

function ProcessStat({
  icon: Icon,
  label,
  value,
  format = "number",
}: {
  icon: typeof Layers;
  label: string;
  value: number;
  format?: "number" | "currency";
}) {
  return (
    <div className="card p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="truncate text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums whitespace-nowrap text-neutral-900 dark:text-neutral-100">
        <CountUpValue value={value} format={format} />
      </p>
    </div>
  );
}
