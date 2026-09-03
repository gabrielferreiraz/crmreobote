import { prisma } from "@/lib/prisma";
import type { UndoActionType, FieldUpdatePayload, FieldUpdateTarget, TaskBulkMovePayload, DeleteSnapshotPayload } from "./types";

export type UndoResult = { type: UndoActionType; description: string; payload: unknown };

function fieldDelegate(model: FieldUpdateTarget["model"]) {
  return prisma[model] as unknown as {
    findUniqueOrThrow: (args: { where: { id: string } }) => Promise<Record<string, unknown>>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * Handler genérico pra qualquer ação que só troca valor de campo — cobre
 * task.update, contact.update, deal.update e deal.move (mover de etapa é,
 * no fundo, trocar pipelineId/stageId/stageEnteredAt). `entities` pode ter
 * mais de um alvo (ex.: reatribuir dono do negócio sincroniza
 * Contact.responsavelId, ver FieldUpdateTarget) — reverte TODOS juntos,
 * nunca só o primeiro, senão a própria sincronização que motivou isso
 * ficaria quebrada depois de um Ctrl+Z. Lê o valor ATUAL de cada campo
 * antes de sobrescrever, escreve `previousValues` de volta, e devolve os
 * valores atuais (o que ESTAVA antes desta reversão) como o payload do
 * próximo passo — o mesmo par undo/redo alterna pra sempre entre os dois
 * estados sem duplicar lógica.
 *
 * O cast de delegate é necessário: task/contact/deal têm shapes de
 * update() bem diferentes entre si, e este handler despacha por NOME de
 * campo em tempo de execução (não dá pra tipar estaticamente "um objeto
 * com só os campos que mudaram, quaisquer que sejam"). A validação de
 * verdade — que campos existem, que tipos são aceitáveis — já aconteceu na
 * rota original antes dela gravar o UndoableAction; aqui é só devolver o
 * que já estava lá.
 */
async function revertFieldUpdate(type: UndoActionType, payload: FieldUpdatePayload): Promise<UndoResult> {
  const redoEntities: FieldUpdateTarget[] = [];
  for (const target of payload.entities) {
    const delegate = fieldDelegate(target.model);
    const current = await delegate.findUniqueOrThrow({ where: { id: target.entityId } });
    const redoValues: Record<string, unknown> = {};
    for (const key of Object.keys(target.previousValues)) redoValues[key] = current[key];

    await delegate.update({ where: { id: target.entityId }, data: target.previousValues });
    redoEntities.push({ model: target.model, entityId: target.entityId, previousValues: redoValues });
  }

  return {
    type,
    description: payload.descriptions.afterRevert,
    payload: {
      entities: redoEntities,
      descriptions: { afterRevert: payload.descriptions.original, original: payload.descriptions.afterRevert },
    } satisfies FieldUpdatePayload,
  };
}

async function revertTaskBulkMove(payload: TaskBulkMovePayload): Promise<UndoResult> {
  const redoMoves: TaskBulkMovePayload["moves"] = [];
  for (const move of payload.moves) {
    const current = await prisma.task.findUnique({ where: { id: move.taskId }, select: { dueAt: true } });
    if (!current?.dueAt) continue; // tarefa apagada/sem data depois do arraste — não tem mais o que reverter, ignora
    redoMoves.push({ taskId: move.taskId, previousDueAt: current.dueAt.toISOString() });
    await prisma.task.update({ where: { id: move.taskId }, data: { dueAt: new Date(move.previousDueAt) } });
  }
  return {
    type: "task.bulkMove",
    description: payload.descriptions.afterRevert,
    payload: {
      moves: redoMoves,
      descriptions: { afterRevert: payload.descriptions.original, original: payload.descriptions.afterRevert },
    } satisfies TaskBulkMovePayload,
  };
}

/**
 * Recria uma linha apagada preservando o MESMO `id` — nunca gera id novo,
 * senão qualquer referência por FK que ainda apontasse pra ela (ex.: uma
 * Activity/Task ligada por dealId/contactId que sobreviveu ao delete
 * porque a relação era SetNull, não cascade) ficaria "solta", sem voltar a
 * apontar pro registro restaurado. Cascata (CampaignRecipient/Process)
 * volta primeiro pro pai existir antes de qualquer FK que dependa dele.
 */
async function revertDelete<T extends Record<string, unknown> & { id: string }>(
  model: "task" | "contact" | "deal",
  type: UndoActionType,
  payload: DeleteSnapshotPayload<T>,
): Promise<UndoResult> {
  await prisma.$transaction(async (tx) => {
    const txDelegate = (tx as unknown as Record<string, { create: (args: { data: Record<string, unknown> }) => Promise<unknown> }>)[model];
    await txDelegate.create({ data: payload.snapshot });
    for (const group of payload.cascaded ?? []) {
      const childDelegate = (tx as unknown as Record<string, { create: (args: { data: Record<string, unknown> }) => Promise<unknown> }>)[
        group.model
      ];
      for (const row of group.rows) await childDelegate.create({ data: row });
    }
  });

  return {
    type,
    description: payload.descriptions.afterRevert,
    // Redo = apagar de novo — a linha que acabou de ser restaurada (com o
    // mesmo id de sempre) é o snapshot do próximo "delete" (ver
    // redeleteRow/dispatchDelete abaixo, que decide em runtime qual dos
    // dois caminhos rodar).
    payload: {
      snapshot: payload.snapshot,
      cascaded: payload.cascaded,
      descriptions: { afterRevert: payload.descriptions.original, original: payload.descriptions.afterRevert },
    } satisfies DeleteSnapshotPayload<T>,
  } satisfies UndoResult;
}

/** Volta a apagar uma linha que tinha sido restaurada por revertDelete —
 * reaproveita o MESMO snapshot (a linha restaurada é idêntica ao snapshot
 * original, mesmo id), então não precisa reler nada antes de apagar. */
async function redeleteRow<T extends Record<string, unknown> & { id: string }>(
  model: "task" | "contact" | "deal",
  type: UndoActionType,
  payload: DeleteSnapshotPayload<T>,
): Promise<UndoResult> {
  await prisma.$transaction(async (tx) => {
    for (const group of payload.cascaded ?? []) {
      const childDelegate = (tx as unknown as Record<string, { deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown> }>)[
        group.model
      ];
      await childDelegate.deleteMany({ where: { id: { in: group.rows.map((r) => r.id as string) } } });
    }
    const txDelegate = (tx as unknown as Record<string, { delete: (args: { where: { id: string } }) => Promise<unknown> }>)[model];
    await txDelegate.delete({ where: { id: payload.snapshot.id } });
  });

  return {
    type,
    description: payload.descriptions.afterRevert,
    payload: {
      snapshot: payload.snapshot,
      cascaded: payload.cascaded,
      descriptions: { afterRevert: payload.descriptions.original, original: payload.descriptions.afterRevert },
    } satisfies DeleteSnapshotPayload<T>,
  };
}

/**
 * Registry — um handler por `type`. app/api/undo/[id]/route.ts só chama
 * `reverse(action.type, action.payload)`; adicionar undo a uma ação NOVA
 * no futuro é só um novo par (type → handler) aqui, quase sempre
 * reaproveitando revertFieldUpdate/revertDelete em vez de escrever handler
 * do zero.
 *
 * task.delete/contact.delete/deal.delete aparecem duas vezes de propósito:
 * a MESMA entrada do registry cobre tanto "desfazer o delete" (restaura)
 * quanto "desfazer a restauração" (apaga de novo) — qual das duas rodar é
 * decidido em runtime pelo dispatch abaixo, olhando se a linha existe.
 */
export async function reverseUndoableAction(type: UndoActionType, payload: unknown): Promise<UndoResult> {
  switch (type) {
    case "task.update":
    case "contact.update":
    case "deal.update":
    case "deal.move":
      return revertFieldUpdate(type, payload as FieldUpdatePayload);
    case "task.bulkMove":
      return revertTaskBulkMove(payload as TaskBulkMovePayload);
    case "task.delete":
      return dispatchDelete("task", type, payload as DeleteSnapshotPayload);
    case "contact.delete":
      return dispatchDelete("contact", type, payload as DeleteSnapshotPayload);
    case "deal.delete":
      return dispatchDelete("deal", type, payload as DeleteSnapshotPayload);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Tipo de ação desfazível desconhecido: ${_exhaustive}`);
    }
  }
}

/** A linha do snapshot ainda existe? Então esta reversão é "desfazer a
 * restauração" (apaga de novo); senão é "desfazer o delete" (restaura). */
async function dispatchDelete(
  model: "task" | "contact" | "deal",
  type: UndoActionType,
  payload: DeleteSnapshotPayload,
): Promise<UndoResult> {
  const delegate = prisma[model] as unknown as { findUnique: (args: { where: { id: string } }) => Promise<unknown> };
  const stillExists = await delegate.findUnique({ where: { id: payload.snapshot.id as string } });
  return stillExists ? redeleteRow(model, type, payload) : revertDelete(model, type, payload);
}
