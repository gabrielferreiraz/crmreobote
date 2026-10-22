/**
 * Ordem dos status de uma mensagem de WhatsApp: só se AVANÇA (enviada →
 * entregue → lida). O webhook pode entregar os eventos fora de ordem — um
 * "enviada" atrasado chegando depois do "lida" fazia a mensagem voltar de ✓✓
 * azul pra ✓. FAILED só vale enquanto a mensagem não tinha sido entregue; e
 * uma marcada como FAILED que depois foi entregue/lida passa a valer o status
 * novo (ela chegou de fato). Puro — usado pelo webhook (lib/whatsapp/events.ts).
 */

export type MessageStatus = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const STATUS_RANK: Record<MessageStatus, number> = { FAILED: -1, PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const ALL_STATUSES = Object.keys(STATUS_RANK) as MessageStatus[];

/** Status atuais que o status `next` pode substituir (o `where` do update). */
export function statusesReplaceableBy(next: MessageStatus): MessageStatus[] {
  if (next === "FAILED") return ["PENDING", "SENT"];
  return ALL_STATUSES.filter((s) => STATUS_RANK[s] < STATUS_RANK[next]);
}
