import { redirect } from "next/navigation";
import { Layers, CircleDollarSign, CircleCheck, MessageSquareWarning } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { getContactsWithUnreadWhatsApp } from "@/lib/processes/whatsapp-signals";
import { CountUpValue } from "@/components/count-up-value";
import { ProcessesView } from "./processes-view";

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string }>;
}) {
  const access = await requireProcessAccess();
  if (!access.ok) redirect("/");

  const { pipelineId: pipelineIdParam } = await searchParams;

  return runWithTenant(access.organizationId, async () => {
    const pipelines = await prisma.processPipeline.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" } } },
    });

    const activePipeline =
      pipelines.find((p) => p.id === pipelineIdParam) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];

    if (!activePipeline) {
      return (
        <p className="text-neutral-400 dark:text-neutral-500">
          Nenhuma pipeline de processos configurada ainda.
        </p>
      );
    }

    const processesRaw = await prisma.process.findMany({
      where: {
        organizationId: access.organizationId,
        pipelineId: activePipeline.id,
        ...processScopeWhere(access),
      },
      orderBy: { stageEnteredAt: "desc" },
      include: {
        contact: { select: { id: true, name: true, phone: true, whatsapp: true } },
        owner: { select: { id: true, name: true, image: true } },
        stage: { select: { id: true, name: true, color: true } },
        deal: { select: { id: true, name: true, value: true } },
        _count: { select: { requests: { where: { resolvedAt: null } } } },
      },
    });

    const avatarMap = await resolveAvatarUrlMap(processesRaw.map((p) => p.owner.image));
    const unreadContactIds = await getContactsWithUnreadWhatsApp(
      access.organizationId,
      processesRaw.map((p) => p.contact.id),
    );

    const processes = processesRaw.map((p) => ({
      id: p.id,
      pipelineId: p.pipelineId,
      stageId: p.stageId,
      stage: p.stage,
      contemplated: p.contemplated,
      paymentPending: p.paymentPending,
      documentStatus: p.documentStatus,
      quotaNumber: p.quotaNumber,
      groupNumber: p.groupNumber,
      stageEnteredAt: p.stageEnteredAt,
      contact: p.contact,
      owner: {
        id: p.owner.id,
        name: p.owner.name,
        photoUrl: p.owner.image ? (avatarMap.get(p.owner.image) ?? null) : null,
      },
      deal: { id: p.deal.id, name: p.deal.name, value: p.deal.value != null ? Number(p.deal.value) : null },
      openRequestCount: p._count.requests,
      hasUnreadWhatsApp: unreadContactIds.has(p.contact.id),
    }));

    const totalValue = processes.reduce((sum, p) => sum + (p.deal.value ?? 0), 0);
    const contemplatedCount = processes.filter((p) => p.contemplated).length;
    const pendingCount = processes.filter((p) => p.openRequestCount > 0).length;

    return (
      <div className="flex h-full flex-col gap-4">
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

        {processes.length > 0 && (
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
            <ProcessStat icon={Layers} label="Processos" value={processes.length} />
            <ProcessStat icon={CircleDollarSign} label="Valor total" value={totalValue} format="currency" />
            <ProcessStat icon={CircleCheck} label="Contemplados" value={contemplatedCount} />
            <ProcessStat icon={MessageSquareWarning} label="Com pendências" value={pendingCount} />
          </div>
        )}

        <ProcessesView
          pipelineId={activePipeline.id}
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
          stages={activePipeline.stages}
          initialProcesses={processes}
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
