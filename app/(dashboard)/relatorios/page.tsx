import { BarChart3, Trophy, XCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { BarRow } from "./bar-row";

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string }>;
}) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const { pipelineId: pipelineIdParam } = await searchParams;

  return runWithTenant(organizationId, async () => {
  const scope = await getDealScope(organizationId, userId, session!.user.role);

  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const activePipeline =
    pipelines.find((p) => p.id === pipelineIdParam) ??
    pipelines.find((p) => p.isDefault) ??
    pipelines[0];

  const [statusCounts, stageValues, allByOwner, openByOwner, wonByOwner, lostByReason] = await Promise.all([
    prisma.deal.groupBy({
      by: ["status"],
      where: { organizationId, ...scopeWhere(scope) },
      _count: true,
    }),
    activePipeline
      ? prisma.deal.groupBy({
          by: ["stageId"],
          where: { organizationId, pipelineId: activePipeline.id, status: "OPEN", ...scopeWhere(scope) },
          _count: true,
          _sum: { value: true },
        })
      : Promise.resolve([]),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, ...scopeWhere(scope) },
      _count: true,
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "OPEN", ...scopeWhere(scope) },
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId, status: "WON", ...scopeWhere(scope) },
      _count: true,
      _sum: { value: true },
    }),
    prisma.deal.groupBy({
      by: ["lossReasonId"],
      where: { organizationId, status: "LOST", ...scopeWhere(scope) },
      _count: true,
    }),
  ]);

  const totalDeals = statusCounts.reduce((sum, s) => sum + s._count, 0);
  const wonCount = statusCounts.find((s) => s.status === "WON")?._count ?? 0;
  const lostCount = statusCounts.find((s) => s.status === "LOST")?._count ?? 0;
  const openCount = statusCounts.find((s) => s.status === "OPEN")?._count ?? 0;
  const winRate = totalDeals > 0 ? Math.round((wonCount / totalDeals) * 100) : 0;

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
  const ownerIds = allByOwner.map((o) => o.ownerId);
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true },
  });

  const performance = allByOwner
    .map((o) => ({
      ownerId: o.ownerId,
      name: owners.find((u) => u.id === o.ownerId)?.name ?? "—",
      deals: o._count,
      pipeline: openByOwner.find((p) => p.ownerId === o.ownerId)?._sum.value
        ? Number(openByOwner.find((p) => p.ownerId === o.ownerId)!._sum.value)
        : 0,
      won: wonByOwner.find((w) => w.ownerId === o.ownerId)?._sum.value
        ? Number(wonByOwner.find((w) => w.ownerId === o.ownerId)!._sum.value)
        : 0,
    }))
    .sort((a, b) => b.pipeline + b.won - (a.pipeline + a.won));

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

  // ─── WhatsApp: enviadas, responderam e conversão por vendedor ──────────
  const [whatsappInstances, sentByInstance, inboundPairs, outboundPairs] = await Promise.all([
    prisma.whatsAppInstance.findMany({
      where: { organizationId, ...(scope.type === "owners" ? { userId: { in: scope.ownerIds } } : {}) },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId"],
      where: { organizationId, direction: "OUTBOUND" },
      _count: true,
    }),
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId", "contactId"],
      where: { organizationId, direction: "INBOUND" },
    }),
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId", "contactId"],
      where: { organizationId, direction: "OUTBOUND" },
    }),
  ]);

  const contactedContactIds = Array.from(new Set(outboundPairs.map((p) => p.contactId)));
  const wonContacts = contactedContactIds.length
    ? await prisma.deal.findMany({
        where: { organizationId, status: "WON", contactId: { in: contactedContactIds } },
        select: { contactId: true },
        distinct: ["contactId"],
      })
    : [];
  const wonContactIdSet = new Set(wonContacts.map((d) => d.contactId));

  const whatsappStats = whatsappInstances.map((inst) => {
    const sent = sentByInstance.find((s) => s.instanceId === inst.id)?._count ?? 0;
    const repliedContacts = new Set(
      inboundPairs.filter((p) => p.instanceId === inst.id).map((p) => p.contactId),
    ).size;
    const contactedForInst = outboundPairs.filter((p) => p.instanceId === inst.id).map((p) => p.contactId);
    const convertedForInst = contactedForInst.filter((cid) => wonContactIdSet.has(cid)).length;
    const conversionRate =
      contactedForInst.length > 0 ? Math.round((convertedForInst / contactedForInst.length) * 100) : 0;

    return {
      userId: inst.userId,
      name: inst.user.name,
      connected: inst.status === "CONNECTED",
      sent,
      replied: repliedContacts,
      conversionRate,
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Relatórios</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Panorama do desempenho comercial no período</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Total de negócios" value={String(totalDeals)} />
        <Stat label="Em aberto" value={String(openCount)} />
        <Stat label="Ganhos" value={String(wonCount)} />
        <Stat label="Taxa de conversão" value={`${winRate}%`} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Valor por etapa</h2>
          {stageData.length === 0 ? (
            <EmptyState icon={BarChart3} title="Nenhum negócio em aberto" />
          ) : (
            <div className="flex items-end gap-4">
              {stageData.map((stage) => (
                <div key={stage.id} className="flex-1 space-y-2 text-center">
                  <p className="text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                    {formatCurrency(stage.value)}
                  </p>
                  <div className="h-1.5 rounded-full" style={{ backgroundColor: stage.color ?? "#a3a3a3" }} />
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{stage.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Desempenho por responsável</h2>
          {performance.length === 0 ? (
            <EmptyState icon={Trophy} title="Nenhum negócio registrado ainda" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs text-neutral-400 dark:text-neutral-500">
                  <th className="pb-2 font-medium">Vendedor</th>
                  <th className="pb-2 font-medium">Negócios</th>
                  <th className="pb-2 text-right font-medium">Pipeline</th>
                  <th className="pb-2 text-right font-medium">Ganhos</th>
                </tr>
              </thead>
              <tbody>
                {performance.map((p) => (
                  <tr key={p.ownerId} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                    <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{p.name}</td>
                    <td className="py-2.5 text-neutral-500 dark:text-neutral-400">{p.deals}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(p.pipeline)}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(p.won)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {lostCount > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Motivos de perda ({lostCount} negócios perdidos)
          </h2>
          <div className="card p-4">
            {lossBreakdown.length === 0 ? (
              <EmptyState icon={XCircle} title="Nenhum motivo registrado" />
            ) : (
              <div className="space-y-2">
                {lossBreakdown.map((l) => (
                  <BarRow
                    key={l.id}
                    label={l.label}
                    value={l.count}
                    max={maxLossCount}
                    displayValue={String(l.count)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {whatsappStats.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">WhatsApp por vendedor</h2>
          <div className="card overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs text-neutral-400 dark:text-neutral-500">
                  <th className="pb-2 font-medium">Vendedor</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Enviadas</th>
                  <th className="pb-2 text-right font-medium">Responderam</th>
                  <th className="pb-2 text-right font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {whatsappStats.map((w) => (
                  <tr key={w.userId} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                    <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{w.name}</td>
                    <td className="py-2.5 text-neutral-500 dark:text-neutral-400">
                      {w.connected ? "Conectado" : "Desconectado"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{w.sent}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{w.replied}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {w.conversionRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
              Conversão = % dos contatos que receberam WhatsApp e fecharam negócio (ganho).
            </p>
          </div>
        </div>
      )}
    </div>
  );
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
    </div>
  );
}
