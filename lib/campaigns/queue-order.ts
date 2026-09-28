/**
 * Ordem da FILA DE DISPARO de uma campanha — a lista dos destinatários
 * PENDENTES na sequência em que o motor (lib/campaigns/engine.ts) vai
 * mandando, e que a tela da campanha deixa reordenar
 * (app/(dashboard)/whatsapp/campanhas/[id]/campaign-queue.tsx).
 *
 * Existe UMA ordenação só, usada por todo mundo (motor no cron, botão "Enviar
 * agora", lista da tela, API de reordenar): se cada um ordenasse do seu jeito,
 * a tela mostraria uma fila e o motor mandaria em outra.
 *
 *   1. queuePosition crescente — quem foi posicionado à mão (ou por um
 *      "mover pro topo/fim"); menor = sai antes. null cai por último.
 *   2. createdAt e 3. id — a ordem de sempre pra quem nunca foi reordenado.
 *      O `id` como desempate FINAL é o que faltava: os destinatários de uma
 *      campanha são criados de uma vez só (createMany), então TODOS têm o
 *      mesmo createdAt, e só `createdAt` deixava o Postgres escolher entre os
 *      empatados sem nenhuma garantia (a ordem "de sempre" era, na prática,
 *      arbitrária). O id (cuid) cresce na ordem em que o Prisma gerou as
 *      linhas do lote — a ordem em que o público foi montado —, então é um
 *      desempate estável e ainda por cima o mais natural.
 */
import type { Prisma } from "@/app/generated/prisma/client";

export const CAMPAIGN_QUEUE_ORDER_BY: Prisma.CampaignRecipientOrderByWithRelationInput[] = [
  { queuePosition: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
];

/** Mesma ordenação de CAMPAIGN_QUEUE_ORDER_BY, em memória (ex.: numerar a fila que já veio carregada). */
export function compareQueueOrder(
  a: { queuePosition: number | null; createdAt: Date; id: string },
  b: { queuePosition: number | null; createdAt: Date; id: string },
): number {
  if (a.queuePosition !== b.queuePosition) {
    if (a.queuePosition === null) return 1;
    if (b.queuePosition === null) return -1;
    return a.queuePosition - b.queuePosition;
  }
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type PositionedId = { id: string; position: number };

/**
 * Reordena uma JANELA da fila sem mexer em ninguém fora dela.
 *
 * `current` = os destinatários da janela com a posição que têm HOJE;
 * `desiredIds` = os mesmos ids na ordem que a pessoa quer. As posições que a
 * janela ocupa (as mesmas, em ordem crescente) são redistribuídas na ordem
 * pedida — ou seja, cada um assume o "lugar" de quem estava naquela vez. Quem
 * está fora da janela nem entra na conta, e por isso continua exatamente onde
 * estava, mesmo com a fila tendo milhares de pendentes e a tela só mostrando
 * os primeiros 100.
 *
 * `ignored` = ids pedidos que não estão em `current` (já foram enviados nesse
 * meio-tempo, ou nem são da campanha) — nunca viram erro: a fila anda sozinha
 * enquanto a pessoa arrasta. Devolve só o que MUDOU de posição.
 */
export function reassignWindowPositions(
  current: PositionedId[],
  desiredIds: string[],
): { updates: PositionedId[]; ignored: string[] } {
  const known = new Map(current.map((c) => [c.id, c.position]));
  const seen = new Set<string>();
  const ids: string[] = [];
  const ignored: string[] = [];

  for (const id of desiredIds) {
    if (seen.has(id)) continue; // id repetido no pedido: vale a 1ª aparição
    seen.add(id);
    if (known.has(id)) ids.push(id);
    else ignored.push(id);
  }

  const slots = ids.map((id) => known.get(id)!).sort((a, b) => a - b);
  const updates: PositionedId[] = [];
  ids.forEach((id, i) => {
    if (known.get(id) !== slots[i]) updates.push({ id, position: slots[i] });
  });
  return { updates, ignored };
}
