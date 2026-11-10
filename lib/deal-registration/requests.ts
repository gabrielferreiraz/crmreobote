/**
 * Pedidos de documento do administrativo ao consultor — leitura, criação,
 * atendimento por item e avisos. Sempre chamado dentro de runWithTenant (RLS
 * por organização) e sempre filtrando por organizationId.
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { logAudit } from "@/lib/audit-log";
import {
  REQUEST_MAX_ITEMS,
  REQUEST_MESSAGE_MAX,
  REQUEST_NOTE_MAX,
  REQUEST_TASK_TITLE_PREFIX,
  buildRequestItem,
  isRequestComplete,
  parseRequestItems,
  summarizeRequestItems,
  type RequestItem,
} from "./request-rules";

export type DocumentRequestDTO = {
  id: string;
  status: "OPEN" | "FULFILLED" | "CANCELLED";
  items: RequestItem[];
  message: string | null;
  requestedByName: string;
  createdAt: string;
  resolvedAt: string | null;
};

export class DocumentRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Conflito de gravação simultânea: vale tentar de novo com o estado atual. */
    public retryable = false,
  ) {
    super(message);
  }
}

type Row = {
  id: string;
  status: "OPEN" | "FULFILLED" | "CANCELLED";
  items: unknown;
  message: string | null;
  requestedByName: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

function toDTO(row: Row): DocumentRequestDTO {
  return {
    id: row.id,
    status: row.status,
    items: parseRequestItems(row.items),
    message: row.message,
    requestedByName: row.requestedByName,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

const SELECT = { id: true, status: true, items: true, message: true, requestedByName: true, createdAt: true, resolvedAt: true } as const;

/** Do mais novo ao mais antigo; pedidos abertos sempre primeiro. */
export async function listDealRequests(organizationId: string, dealId: string): Promise<DocumentRequestDTO[]> {
  const rows = await prisma.dealDocumentRequest.findMany({
    where: { organizationId, dealId },
    orderBy: { createdAt: "desc" },
    select: SELECT,
    take: 50,
  });
  const dtos = rows.map(toDTO);
  return [...dtos.filter((r) => r.status === "OPEN"), ...dtos.filter((r) => r.status !== "OPEN")];
}

async function dealPeople(organizationId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      id: true,
      status: true,
      ownerId: true,
      contactId: true,
      contact: { select: { name: true } },
      participants: { select: { userId: true } },
    },
  });
  return deal;
}

/** Fecha a tarefa do consultor quando não sobra nenhum pedido aberto naquele negócio. */
async function closeConsultantTasksIfDone(organizationId: string, dealId: string): Promise<void> {
  const stillOpen = await prisma.dealDocumentRequest.count({ where: { organizationId, dealId, status: "OPEN" } });
  if (stillOpen > 0) return;
  await prisma.task.updateMany({
    where: { organizationId, dealId, completedAt: null, title: { startsWith: REQUEST_TASK_TITLE_PREFIX } },
    data: { completedAt: new Date() },
  });
}

export async function createDocumentRequest(params: {
  organizationId: string;
  dealId: string;
  actor: { userId: string; name: string };
  items: { key: string; label?: string }[];
  message?: string | null;
}): Promise<DocumentRequestDTO> {
  const { organizationId, dealId, actor } = params;
  const deal = await dealPeople(organizationId, dealId);
  if (!deal) throw new DocumentRequestError("Negócio não encontrado", 404);
  if (deal.status !== "WON") throw new DocumentRequestError("Só dá para pedir documentos de uma venda já ganha.", 400);

  const seen = new Set<string>();
  const items: RequestItem[] = [];
  for (const input of params.items) {
    if (seen.has(input.key)) continue;
    seen.add(input.key);
    const item = buildRequestItem(input);
    if (item) items.push(item);
  }
  if (items.length === 0) throw new DocumentRequestError("Escolha pelo menos um item para pedir.", 400);
  if (items.length > REQUEST_MAX_ITEMS) throw new DocumentRequestError(`No máximo ${REQUEST_MAX_ITEMS} itens por pedido.`, 400);
  const message = params.message?.trim().slice(0, REQUEST_MESSAGE_MAX) || null;

  const created = await prisma.dealDocumentRequest.create({
    data: {
      organizationId,
      dealId,
      requestedById: actor.userId,
      requestedByName: actor.name,
      items: items as unknown as object,
      message,
    },
    select: SELECT,
  });

  const summary = summarizeRequestItems(items, 3);
  const recipients = Array.from(new Set([deal.ownerId, ...deal.participants.map((p) => p.userId)])).filter((id) => id !== actor.userId);
  const title = `${REQUEST_TASK_TITLE_PREFIX} ${deal.contact.name}`;
  const description = `${actor.name} pediu: ${summary}.${message ? ` “${message}”` : ""} Abra a venda e envie pelo cartão “Pedido do administrativo”.`;
  for (const userId of recipients) {
    // O pedido já está salvo: uma falha ao avisar (tarefa ou push) nunca pode derrubar a resposta
    // (o administrativo refaria o pedido e o consultor receberia duplicado).
    try {
      const open = await prisma.task.findFirst({ where: { organizationId, dealId, ownerId: userId, title, completedAt: null }, select: { id: true } });
      if (open) {
        await prisma.task.update({ where: { id: open.id }, data: { description } });
      } else {
        await prisma.task.create({
          data: { organizationId, dealId, contactId: deal.contactId, ownerId: userId, type: "OTHER", title, description, dueAt: new Date() },
        });
      }
    } catch (err) {
      console.error("[deal-registration] falha ao criar a tarefa do pedido", err);
    }
    await sendPushToUser(userId, {
      title: "Documento pedido pelo administrativo",
      body: `${deal.contact.name} · ${summary}`,
      url: `/negocios/${dealId}`,
    }).catch((err) => console.error("[deal-registration] falha no push do pedido", err));
  }

  void logAudit({
    organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    action: "DEAL_DOCUMENT_REQUESTED",
    targetType: "Deal",
    targetId: dealId,
    detail: summary,
  });
  return toDTO(created);
}

async function completeRequestItemOnce(params: {
  organizationId: string;
  dealId: string;
  requestId: string;
  itemKey: string;
  actor: { userId: string; name: string };
  documentIds?: string[];
  note?: string | null;
}): Promise<{ request: DocumentRequestDTO; fulfilled: boolean }> {
  const { organizationId, dealId, requestId, itemKey, actor } = params;
  const row = await prisma.dealDocumentRequest.findFirst({
    where: { id: requestId, organizationId, dealId },
    select: { ...SELECT, updatedAt: true, requestedById: true },
  });
  if (!row) throw new DocumentRequestError("Pedido não encontrado", 404);
  if (row.status !== "OPEN") throw new DocumentRequestError("Este pedido já foi encerrado.", 409);

  const items = parseRequestItems(row.items);
  const item = items.find((i) => i.key === itemKey);
  if (!item) throw new DocumentRequestError("Item não encontrado neste pedido.", 404);

  const note = params.note?.trim().slice(0, REQUEST_NOTE_MAX) || null;
  if (item.needsFile) {
    const ids = Array.from(new Set(params.documentIds ?? []));
    if (ids.length === 0) throw new DocumentRequestError("Envie o arquivo para atender este item.", 400);
    const docs = await prisma.dealRegistrationDocument.findMany({
      where: { id: { in: ids }, organizationId, registration: { dealId } },
      select: { id: true },
    });
    if (docs.length !== ids.length) throw new DocumentRequestError("Arquivo não encontrado neste cadastro.", 400);
    for (const doc of docs) if (!item.documentIds.includes(doc.id)) item.documentIds.push(doc.id);
  } else if (!note) {
    throw new DocumentRequestError("Escreva a resposta para atender este item.", 400);
  }
  item.doneAt = new Date().toISOString();
  if (note) item.note = note;

  const fulfilled = isRequestComplete(items);
  const result = await prisma.dealDocumentRequest.updateMany({
    // updatedAt na condição: dois envios simultâneos não se sobrescrevem.
    where: { id: requestId, organizationId, status: "OPEN", updatedAt: row.updatedAt },
    data: { items: items as unknown as object, ...(fulfilled ? { status: "FULFILLED" as const, resolvedAt: new Date() } : {}) },
  });
  if (result.count === 0) throw new DocumentRequestError("O pedido mudou agora há pouco. Atualize a página e tente de novo.", 409, true);

  if (fulfilled) {
    // Já está salvo: tarefa e aviso são acessórios e não derrubam a resposta.
    try {
      await closeConsultantTasksIfDone(organizationId, dealId);
      const deal = await dealPeople(organizationId, dealId);
      if (row.requestedById !== actor.userId) {
        await sendPushToUser(row.requestedById, {
          title: "Consultor atendeu o pedido",
          body: `${deal?.contact.name ?? "Cliente"} · ${items.map((i) => i.label).join(", ")}`,
          url: `/cadastros/${dealId}`,
        });
      }
    } catch (err) {
      console.error("[deal-registration] falha ao avisar que o pedido foi atendido", err);
    }
  }

  const updated = await prisma.dealDocumentRequest.findFirst({ where: { id: requestId, organizationId }, select: SELECT });
  return { request: toDTO(updated ?? row), fulfilled };
}

export async function cancelDocumentRequest(params: {
  organizationId: string;
  dealId: string;
  requestId: string;
  actor: { userId: string; name: string };
}): Promise<DocumentRequestDTO> {
  const { organizationId, dealId, requestId, actor } = params;
  const row = await prisma.dealDocumentRequest.findFirst({ where: { id: requestId, organizationId, dealId }, select: SELECT });
  if (!row) throw new DocumentRequestError("Pedido não encontrado", 404);
  if (row.status !== "OPEN") throw new DocumentRequestError("Este pedido já foi encerrado.", 409);

  const result = await prisma.dealDocumentRequest.updateMany({
    where: { id: requestId, organizationId, status: "OPEN" },
    data: { status: "CANCELLED", resolvedAt: new Date() },
  });
  if (result.count === 0) throw new DocumentRequestError("Este pedido já foi encerrado.", 409);
  await closeConsultantTasksIfDone(organizationId, dealId).catch((err) => console.error("[deal-registration] falha ao fechar a tarefa do pedido", err));
  void logAudit({
    organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    action: "DEAL_DOCUMENT_REQUEST_CANCELLED",
    targetType: "Deal",
    targetId: dealId,
    detail: summarizeRequestItems(parseRequestItems(row.items), 3),
  });
  const updated = await prisma.dealDocumentRequest.findFirst({ where: { id: requestId, organizationId }, select: SELECT });
  return toDTO(updated ?? row);
}

/**
 * Atende um item. Dois envios quase juntos (ex.: frente e verso em itens
 * diferentes) disputam a mesma linha: quem perde a corrida relê o estado atual
 * e tenta de novo, em vez de devolver erro com o arquivo já enviado.
 */
export async function completeRequestItem(params: Parameters<typeof completeRequestItemOnce>[0]): Promise<{ request: DocumentRequestDTO; fulfilled: boolean }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await completeRequestItemOnce(params);
    } catch (err) {
      if (err instanceof DocumentRequestError && err.retryable && attempt < 3) continue;
      throw err;
    }
  }
}
