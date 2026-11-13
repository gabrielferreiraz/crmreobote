/**
 * Backup de mensagens de WhatsApp — leituras do servidor. Só o Dono usa
 * (conversa privada de outra pessoa): quem chama confere o papel antes.
 *
 * "Backup" = toda conversa que tem `ownerUserId` (quem era o dono dela), ativa
 * ou congelada (instância apagada quando o usuário foi desativado — ver
 * lib/whatsapp/instance-cleanup.ts). Nada aqui marca mensagem como lida.
 */

import { prisma, prismaRaw } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import { messagePreview } from "@/lib/whatsapp/message-preview";

export type BackupMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
  area: "VENDAS" | "ADMINISTRATIVO" | "FINANCEIRO" | "POS_CONTEMPLACAO";
  active: boolean;
  threads: number;
  /** Conversas congeladas (a instância foi apagada junto com a desativação). */
  archivedThreads: number;
  messages: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
};

type RawAggregate = {
  userId: string;
  threads: number;
  archived: number;
  messages: number;
  fst: Date | null;
  lst: Date | null;
};

/**
 * Uma linha por pessoa que tem pelo menos uma mensagem guardada. Uma consulta
 * SQL só (agregado por dono) — contar mensagem por conversa via Prisma seria
 * uma ida ao banco por conversa. SQL cru precisa do tenant na transação, senão
 * a RLS devolve vazio sem avisar.
 */
export async function listBackupMembers(organizationId: string, onlyUserId?: string): Promise<BackupMember[]> {
  const aggregates = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRaw<RawAggregate[]>`
      SELECT t."ownerUserId" AS "userId",
             COUNT(*)::int AS threads,
             (COUNT(*) FILTER (WHERE t."instanceId" IS NULL))::int AS archived,
             SUM(mc.cnt)::int AS messages,
             MIN(mc.fst) AS fst,
             MAX(mc.lst) AS lst
        FROM "WhatsAppThread" t
        CROSS JOIN LATERAL (
          SELECT COUNT(*) AS cnt, MIN(m."createdAt") AS fst, MAX(m."createdAt") AS lst
            FROM "WhatsAppMessage" m
           WHERE m."threadId" = t.id AND m."organizationId" = t."organizationId"
        ) mc
       WHERE t."organizationId" = ${organizationId}
         AND t."ownerUserId" IS NOT NULL
         AND mc.cnt > 0
         ${onlyUserId ? Prisma.sql`AND t."ownerUserId" = ${onlyUserId}` : Prisma.empty}
       GROUP BY t."ownerUserId"`;
  });
  if (aggregates.length === 0) return [];

  const members = await runWithTenant(organizationId, () =>
    prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: aggregates.map((a) => a.userId) } },
      select: { userId: true, role: true, area: true, active: true, user: { select: { name: true, email: true, image: true } } },
    }),
  );
  const byId = new Map(members.map((m) => [m.userId, m]));

  const result: BackupMember[] = [];
  for (const a of aggregates) {
    const m = byId.get(a.userId);
    // Dono da conversa que não é mais membro desta organização: não há como abrir a tela dele.
    if (!m) continue;
    result.push({
      userId: a.userId,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: m.role,
      area: m.area,
      active: m.active,
      threads: a.threads,
      archivedThreads: a.archived,
      messages: a.messages,
      firstMessageAt: a.fst ? a.fst.toISOString() : null,
      lastMessageAt: a.lst ? a.lst.toISOString() : null,
    });
  }
  // Mais recente primeiro: quem conversou por último fica no topo.
  result.sort((x, y) => (y.lastMessageAt ?? "").localeCompare(x.lastMessageAt ?? ""));
  return result;
}

export type BackupThread = {
  id: string;
  displayName: string;
  phoneFormatted: string;
  contactId: string | null;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: Date;
  firstMessageAt: Date;
};

/** Conversas de UMA pessoa (só as que têm mensagem), da mais recente para a mais antiga. */
export async function listBackupThreads(organizationId: string, userId: string): Promise<BackupThread[]> {
  const threads = await runWithTenant(organizationId, () =>
    prisma.whatsAppThread.findMany({
      where: { organizationId, ownerUserId: userId },
      include: {
        contact: { select: { id: true, name: true } },
        instance: { select: { status: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, type: true, direction: true, createdAt: true } },
        _count: { select: { messages: true } },
      },
    }),
  );

  const withMessages = threads.filter((t) => t.messages.length > 0);
  withMessages.sort((a, b) => b.messages[0].createdAt.getTime() - a.messages[0].createdAt.getTime());

  // Data da primeira mensagem de cada conversa: uma consulta agregada só.
  const firsts = withMessages.length
    ? await runWithTenant(organizationId, () =>
        prisma.whatsAppMessage.groupBy({
          by: ["threadId"],
          where: { organizationId, threadId: { in: withMessages.map((t) => t.id) } },
          _min: { createdAt: true },
        }),
      )
    : [];
  const firstByThread = new Map(firsts.map((f) => [f.threadId, f._min.createdAt]));

  return withMessages.map((t) => {
    const last = t.messages[0];
    const phone = formatBrazilianPhone(t.phoneNormalized) ?? t.phoneNormalized;
    return {
      id: t.id,
      displayName: t.contact?.name ?? t.customName ?? t.whatsappName ?? phone,
      phoneFormatted: phone,
      contactId: t.contact?.id ?? null,
      // Instância ainda existe = conversa "viva"; sem instância = histórico congelado.
      archived: !t.instance,
      messageCount: t._count.messages,
      lastMessagePreview: messagePreview(last.body, last.type, "—"),
      lastMessageDirection: last.direction,
      lastMessageAt: last.createdAt,
      firstMessageAt: firstByThread.get(t.id) ?? last.createdAt,
    };
  });
}

export type BackupExportMessage = {
  id: string;
  threadId: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  metadata: { amount?: number; key?: string; name?: string; phone?: string } | null;
  createdAt: Date;
};

const BATCH = 1000;

/**
 * Todas as mensagens das conversas dadas, em ordem, em lotes (paginação por
 * cursor de id: estável mesmo com várias mensagens no mesmo instante). Gerador
 * porque o arquivo sai em fluxo — nunca carrega o histórico inteiro na memória.
 * Cada lote abre o próprio contexto de tenant: o gerador é consumido depois que
 * a rota já respondeu.
 */
export async function* iterateBackupMessages(organizationId: string, threadIds: string[]): AsyncGenerator<BackupExportMessage> {
  for (const threadId of threadIds) {
    let cursor: string | undefined;
    for (;;) {
      const batch = await runWithTenant(organizationId, () =>
        prisma.whatsAppMessage.findMany({
          where: { organizationId, threadId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, threadId: true, direction: true, type: true, body: true, metadata: true, createdAt: true },
        }),
      );
      if (batch.length === 0) break;
      for (const m of batch) {
        yield { ...m, metadata: (m.metadata as BackupExportMessage["metadata"]) ?? null };
      }
      if (batch.length < BATCH) break;
      cursor = batch[batch.length - 1].id;
    }
  }
}
