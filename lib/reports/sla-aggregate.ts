/**
 * Versão ENXUTA do SLA — só os 4 números agregados do time inteiro (contato
 * em <1h, tempo médio até 1º contato, tempo médio de resposta, tempo médio
 * até qualificação), sem quebra por vendedor. Usada só pro período de
 * COMPARAÇÃO (ver compareSlaPromise em lib/reports/commercial-data.ts) — a
 * versão COMPLETA, com "SLA por vendedor" (slaSummaryRows), continua só em
 * commercial-data.ts, porque ali ela já reaproveita consultas que o resto
 * do relatório do período ATUAL também precisa (threads, instâncias);
 * refazer tudo isso aqui só pra 4 números seria bem mais caro que precisa.
 *
 * A LÓGICA de cada um dos 3 cálculos (A/B/C abaixo) é IDÊNTICA à versão
 * completa em commercial-data.ts — só sem agrupar por usuário no final. Se
 * um dos dois mudar, o outro precisa mudar junto (mesma métrica, dois
 * lugares — risco assumido conscientemente pelo custo de reaproveitar de
 * verdade num arquivo só, ver comentário lá).
 */

import { prisma } from "@/lib/prisma";
import { whatsappScopeWhere, type DealScope } from "@/lib/team-scope";
import { average } from "@/lib/reports/stats";

export type SlaAggregate = {
  overallFirstTouchWithin1h: number | null;
  avgFirstTouchMs: number | null;
  avgFirstReplyMs: number | null;
  avgQualificationMs: number | null;
};

const SLA_FIRST_TOUCH_TARGET_MS = 60 * 60 * 1000; // 1 hora — mesmo alvo da versão completa.

export async function computeSlaAggregate(
  organizationId: string,
  effectiveScope: DealScope,
  period: { from: Date; to: Date },
): Promise<SlaAggregate> {
  const scopeContactWhere = effectiveScope.type === "owners" ? { responsavelId: { in: effectiveScope.ownerIds } } : {};

  // 1ª mensagem de cada thread do período (todas — Geral, negócio e manual,
  // igual à versão completa) + leads qualificados no período — as duas
  // fontes que tudo abaixo deriva.
  const [threadsFirstMessages, qualifiedContacts] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      where: { organizationId, ...whatsappScopeWhere(effectiveScope), createdAt: { gte: period.from, lte: period.to } },
      orderBy: { createdAt: "asc" },
      distinct: ["threadId"],
      select: { threadId: true, instanceId: true, direction: true, createdAt: true },
    }),
    prisma.contact.findMany({
      where: {
        organizationId,
        leadQualification: "QUALIFIED",
        leadQualificationAt: { gte: period.from, lte: period.to },
        ...scopeContactWhere,
      },
      select: { createdAt: true, leadQualificationAt: true, responsavelId: true },
    }),
  ]);

  const threadIds = threadsFirstMessages.map((m) => m.threadId);
  const [threads, instances] = await Promise.all([
    threadIds.length
      ? prisma.whatsAppThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, contactId: true, createdAt: true } })
      : Promise.resolve([]),
    prisma.whatsAppInstance.findMany({
      where: { organizationId, ...(effectiveScope.type === "owners" ? { userId: { in: effectiveScope.ownerIds } } : {}) },
      select: { id: true, userId: true },
    }),
  ]);
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const userIdByInstanceId = new Map(instances.map((i) => [i.id, i.userId]));

  // Contato (t0 do "1º contato") de cada thread com 1ª mensagem no período —
  // consulta separada da de leads qualificados acima (filtro diferente:
  // aqui é "todo mundo com thread no período", lá é só quem foi qualificado).
  const contactIds = Array.from(
    new Set(threadsFirstMessages.map((m) => threadById.get(m.threadId)?.contactId).filter((id): id is string => !!id)),
  );
  const contacts = contactIds.length
    ? await prisma.contact.findMany({
        where: { organizationId, id: { in: contactIds }, ...scopeContactWhere },
        select: { id: true, createdAt: true, responsavelId: true },
      })
    : [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  // 1ª resposta OUTBOUND das threads onde o lead bateu primeiro (1ª mensagem INBOUND).
  const inboundFirstThreadIds = threadsFirstMessages.filter((m) => m.direction === "INBOUND").map((m) => m.threadId);
  const firstOutbound = inboundFirstThreadIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: { organizationId, threadId: { in: inboundFirstThreadIds }, direction: "OUTBOUND" },
        orderBy: { createdAt: "asc" },
        distinct: ["threadId"],
        select: { threadId: true, instanceId: true, createdAt: true },
      })
    : [];
  const firstOutboundByThread = new Map(firstOutbound.map((m) => [m.threadId, m]));

  const firstTouchMs: number[] = [];
  const firstReplyMs: number[] = [];
  const qualificationMs: number[] = [];
  let firstTouchUnderTarget = 0;
  let firstTouchTotal = 0;

  // A. 1º contato (vendedor chama primeiro) — mesma lógica de commercial-data.ts.
  for (const firstMsg of threadsFirstMessages) {
    if (firstMsg.direction !== "OUTBOUND") continue;
    const thread = threadById.get(firstMsg.threadId);
    if (!thread?.contactId) continue;
    const contact = contactById.get(thread.contactId);
    const userId = contact?.responsavelId ?? (firstMsg.instanceId ? userIdByInstanceId.get(firstMsg.instanceId) : undefined);
    if (!userId) continue;
    const t0 = contact && contact.createdAt > thread.createdAt ? contact.createdAt : thread.createdAt;
    const delta = firstMsg.createdAt.getTime() - t0.getTime();
    if (delta < 0) continue; // thread/msg fora de ordem (importação antiga) — ignora
    firstTouchMs.push(delta);
    firstTouchTotal += 1;
    if (delta <= SLA_FIRST_TOUCH_TARGET_MS) firstTouchUnderTarget += 1;
  }

  // B. Tempo de 1ª resposta do vendedor (lead bateu primeiro).
  for (const firstMsg of threadsFirstMessages) {
    if (firstMsg.direction !== "INBOUND") continue;
    const reply = firstOutboundByThread.get(firstMsg.threadId);
    if (!reply) continue;
    const userId = reply.instanceId ? userIdByInstanceId.get(reply.instanceId) : undefined;
    if (!userId) continue;
    const delta = reply.createdAt.getTime() - firstMsg.createdAt.getTime();
    if (delta < 0) continue;
    firstReplyMs.push(delta);
  }

  // C. Tempo até qualificação.
  for (const c of qualifiedContacts) {
    if (!c.leadQualificationAt || !c.responsavelId) continue;
    const delta = c.leadQualificationAt.getTime() - c.createdAt.getTime();
    if (delta < 0) continue;
    qualificationMs.push(delta);
  }

  return {
    overallFirstTouchWithin1h: firstTouchTotal > 0 ? Math.round((firstTouchUnderTarget / firstTouchTotal) * 100) : null,
    avgFirstTouchMs: average(firstTouchMs),
    avgFirstReplyMs: average(firstReplyMs),
    avgQualificationMs: average(qualificationMs),
  };
}
