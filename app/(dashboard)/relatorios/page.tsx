import { BarChart3, Trophy, XCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, daysSince, formatDuration } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { getDealScope, scopeWhere, whatsappScopeWhere } from "@/lib/team-scope";
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

  const [statusCounts, stageValues, allByOwner, openByOwner, wonByOwner, lostByOwner, lostByReason] = await Promise.all([
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
      by: ["ownerId"],
      where: { organizationId, status: "LOST", ...scopeWhere(scope) },
      _count: true,
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
  // Só conta negócio já decidido (ganho ou perdido) — um negócio ainda em
  // aberto não é nem acerto nem erro, incluir ele no denominador penaliza
  // artificialmente times com pipeline saudável e cheio de negócio recente.
  const closedCount = wonCount + lostCount;
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;

  const wonTotalValue = wonByOwner.reduce((sum, w) => sum + (w._sum.value ? Number(w._sum.value) : 0), 0);
  const avgWonValue = wonCount > 0 ? wonTotalValue / wonCount : 0;

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
  const maxStageValue = Math.max(1, ...stageData.map((s) => s.value));
  const ownerIds = allByOwner.map((o) => o.ownerId);
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true },
  });

  const performance = allByOwner
    .map((o) => {
      const wonCountForOwner = wonByOwner.find((w) => w.ownerId === o.ownerId)?._count ?? 0;
      const lostCountForOwner = lostByOwner.find((l) => l.ownerId === o.ownerId)?._count ?? 0;
      const closedForOwner = wonCountForOwner + lostCountForOwner;
      return {
        ownerId: o.ownerId,
        name: owners.find((u) => u.id === o.ownerId)?.name ?? "—",
        deals: o._count,
        pipeline: openByOwner.find((p) => p.ownerId === o.ownerId)?._sum.value
          ? Number(openByOwner.find((p) => p.ownerId === o.ownerId)!._sum.value)
          : 0,
        won: wonByOwner.find((w) => w.ownerId === o.ownerId)?._sum.value
          ? Number(wonByOwner.find((w) => w.ownerId === o.ownerId)!._sum.value)
          : 0,
        lostCount: lostCountForOwner,
        winRate: closedForOwner > 0 ? Math.round((wonCountForOwner / closedForOwner) * 100) : null,
      };
    })
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
      where: { organizationId, direction: "OUTBOUND", ...whatsappScopeWhere(scope) },
      _count: true,
    }),
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId", "threadId"],
      where: { organizationId, direction: "INBOUND", ...whatsappScopeWhere(scope) },
    }),
    prisma.whatsAppMessage.groupBy({
      by: ["instanceId", "threadId"],
      where: { organizationId, direction: "OUTBOUND", ...whatsappScopeWhere(scope) },
    }),
  ]);

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
        where: { organizationId, status: "WON", contactId: { in: contactedContactIds } },
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
    const repliedContacts = new Set(
      inboundPairs
        .filter((p) => p.instanceId === inst.id)
        .map((p) => contactIdByThread.get(p.threadId))
        .filter((id): id is string => !!id),
    ).size;
    const contactedForInst = outboundPairs
      .filter((p) => p.instanceId === inst.id)
      .map((p) => contactIdByThread.get(p.threadId))
      .filter((id): id is string => !!id);
    const convertedForInst = contactedForInst.filter((cid) => wonOwnersByContact.get(cid)?.has(inst.userId)).length;
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

  // ─── WhatsApp dos negócios: só conversa de contato que já virou negócio
  // (aberto, ganho ou perdido) — exclui "WhatsApp Geral". Aqui entram
  // métricas de tempo, que exigem olhar as mensagens em ordem, não só contar.
  const dealContacts = await prisma.deal.findMany({
    where: { organizationId, ...scopeWhere(scope) },
    select: { contactId: true },
    distinct: ["contactId"],
  });
  const dealContactIds = dealContacts.map((d) => d.contactId);

  const dealThreads = dealContactIds.length
    ? await prisma.whatsAppThread.findMany({
        where: { organizationId, contactId: { in: dealContactIds }, ...whatsappScopeWhere(scope) },
        select: { id: true, instanceId: true, contactId: true },
      })
    : [];
  const dealThreadIds = dealThreads.map((t) => t.id);

  const dealMessages = dealThreadIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: { organizationId, threadId: { in: dealThreadIds } },
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
      const activeDays = firstSentAt ? daysSince(firstSentAt) + 1 : 1;
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Relatórios</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Panorama do desempenho comercial no período</p>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <Stat label="Total de negócios" value={String(totalDeals)} />
        <Stat label="Em aberto" value={String(openCount)} />
        <Stat label="Ganhos" value={String(wonCount)} />
        <Stat label="Taxa de conversão" value={closedCount > 0 ? `${winRate}%` : "—"} hint="negócios já fechados" />
        <Stat label="Ticket médio" value={wonCount > 0 ? formatCurrency(avgWonValue) : "—"} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Valor por etapa</h2>
          {stageData.length === 0 ? (
            <EmptyState icon={BarChart3} title="Nenhum negócio em aberto" />
          ) : (
            <div className="flex items-end gap-4">
              {stageData.map((stage) => (
                <div key={stage.id} className="flex flex-1 flex-col items-center gap-2">
                  <p className="text-xs font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                    {formatCurrency(stage.value)}
                  </p>
                  <div className="flex h-20 w-full items-end">
                    <div
                      className="w-full rounded-t-sm"
                      style={{
                        backgroundColor: stage.color ?? "#a3a3a3",
                        height: `${Math.max(4, (stage.value / maxStageValue) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{stage.name}</p>
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    {stage.count} negócio{stage.count === 1 ? "" : "s"}
                  </p>
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
                  <th className="pb-2 text-right font-medium">Perdidos</th>
                  <th className="pb-2 text-right font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {performance.map((p) => (
                  <tr key={p.ownerId} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                    <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{p.name}</td>
                    <td className="py-2.5 text-neutral-500 dark:text-neutral-400">{p.deals}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(p.pipeline)}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(p.won)}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{p.lostCount}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {p.winRate === null ? "—" : `${p.winRate}%`}
                    </td>
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

      {dealWhatsappStats.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">WhatsApp dos negócios</h2>
          <div className="card overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-xs text-neutral-400 dark:text-neutral-500">
                  <th className="pb-2 font-medium">Vendedor</th>
                  <th className="pb-2 text-right font-medium">Conversas</th>
                  <th className="pb-2 text-right font-medium">Enviadas</th>
                  <th className="pb-2 text-right font-medium">Resposta</th>
                  <th className="pb-2 text-right font-medium">Conversão</th>
                  <th className="pb-2 text-right font-medium">1ª resposta</th>
                  <th className="pb-2 text-right font-medium">Duração</th>
                  <th className="pb-2 text-right font-medium">Msgs/dia</th>
                </tr>
              </thead>
              <tbody>
                {dealWhatsappStats.map((w) => (
                  <tr key={w.userId} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                    <td className="py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{w.name}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{w.conversations}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{w.sent}</td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {w.responseRate === null ? "—" : `${w.responseRate}%`}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {w.conversionRate === null ? "—" : `${w.conversionRate}%`}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {w.avgFirstResponseMs === null ? "—" : formatDuration(w.avgFirstResponseMs)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {w.avgDurationMs === null ? "—" : formatDuration(w.avgDurationMs)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {w.messagesPerDay.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
              Só conversas de contatos que já viraram negócio (aberto, ganho ou perdido). Resposta = % de conversas em
              que o lead respondeu. 1ª resposta = tempo médio até o vendedor responder a 1ª mensagem do lead. Duração
              = tempo médio entre a 1ª e a última mensagem da conversa.
            </p>
          </div>
        </div>
      )}
    </div>
  );
  });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}
