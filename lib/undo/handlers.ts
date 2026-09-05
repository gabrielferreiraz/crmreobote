import { prisma, prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import type { Prisma } from "@/app/generated/prisma/client";
import type { UndoActionType, FieldUpdatePayload, FieldUpdateTarget, TaskBulkMovePayload, DeleteSnapshotPayload } from "./types";

export type UndoResult = { type: UndoActionType; description: string; payload: unknown };

/**
 * `tx` é sempre um `Prisma.TransactionClient` de `prismaRaw.$transaction(...)`
 * (client SEM a extensão de RLS, ver lib/prisma.ts) — NUNCA `prisma.$transaction(async (tx) => ...)`
 * (o client normal, COM a extensão). Motivo: a extensão de RLS intercepta
 * toda operação e reabre sua PRÓPRIA mini-transação por baixo (`client.$transaction([...])`,
 * onde `client` é o client base capturado por closure, não o `tx` de fora) —
 * ou seja, cada `tx.modelo.metodo()` chamado a partir de um `prisma.$transaction(async (tx) => ...)`
 * escapa da transação externa e commita sozinho, na hora, independente do
 * resto. Observado na prática nesta base (correção de contas fantasmas do
 * Agendor: um passo intermediário ficou gravado mesmo com a transação
 * "inteira" falhando depois). Com `prismaRaw`, a extensão nunca entra no
 * caminho — só precisa fazer o `SET LOCAL` manualmente uma vez, no início
 * (`setTenantOnTx`), exatamente como o projeto já documenta pra esse
 * cenário em lib/tenant-context.ts.
 */
function fieldDelegate(tx: Prisma.TransactionClient, model: FieldUpdateTarget["model"]) {
  return tx[model] as unknown as {
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
 * numa ÚNICA transação real (ver comentário de fieldDelegate acima): antes
 * rodava sem transação nenhuma, então se o segundo update falhasse, o
 * negócio já tinha voltado mas o contato não — exatamente o tipo de
 * inconsistência ("negócio ficou com responsável diferente do contato")
 * que a própria sincronização original existe pra evitar. Lê o valor ATUAL
 * de cada campo antes de sobrescrever, escreve `previousValues` de volta, e
 * devolve os valores atuais (o que ESTAVA antes desta reversão) como o
 * payload do próximo passo — o mesmo par undo/redo alterna pra sempre entre
 * os dois estados sem duplicar lógica.
 *
 * O cast de delegate é necessário: task/contact/deal têm shapes de
 * update() bem diferentes entre si, e este handler despacha por NOME de
 * campo em tempo de execução (não dá pra tipar estaticamente "um objeto
 * com só os campos que mudaram, quaisquer que sejam"). A validação de
 * verdade — que campos existem, que tipos são aceitáveis — já aconteceu na
 * rota original antes dela gravar o UndoableAction; aqui é só devolver o
 * que já estava lá.
 */
async function revertFieldUpdate(
  organizationId: string,
  type: UndoActionType,
  payload: FieldUpdatePayload,
): Promise<UndoResult> {
  const redoEntities = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const redos: FieldUpdateTarget[] = [];
    for (const target of payload.entities) {
      const delegate = fieldDelegate(tx, target.model);
      const current = await delegate.findUniqueOrThrow({ where: { id: target.entityId } });
      const redoValues: Record<string, unknown> = {};
      for (const key of Object.keys(target.previousValues)) redoValues[key] = current[key];

      await delegate.update({ where: { id: target.entityId }, data: target.previousValues });
      redos.push({ model: target.model, entityId: target.entityId, previousValues: redoValues });
    }
    return redos;
  });

  return {
    type,
    description: payload.descriptions.afterRevert,
    payload: {
      entities: redoEntities,
      descriptions: { afterRevert: payload.descriptions.original, original: payload.descriptions.afterRevert },
    } satisfies FieldUpdatePayload,
  };
}

async function revertTaskBulkMove(organizationId: string, payload: TaskBulkMovePayload): Promise<UndoResult> {
  const redoMoves = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const redos: TaskBulkMovePayload["moves"] = [];
    for (const move of payload.moves) {
      const current = await tx.task.findUnique({ where: { id: move.taskId }, select: { dueAt: true } });
      if (!current?.dueAt) continue; // tarefa apagada/sem data depois do arraste — não tem mais o que reverter, ignora
      redos.push({ taskId: move.taskId, previousDueAt: current.dueAt.toISOString() });
      await tx.task.update({ where: { id: move.taskId }, data: { dueAt: new Date(move.previousDueAt) } });
    }
    return redos;
  });
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
  organizationId: string,
  model: "task" | "contact" | "deal",
  type: UndoActionType,
  payload: DeleteSnapshotPayload<T>,
): Promise<UndoResult> {
  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
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
  organizationId: string,
  model: "task" | "contact" | "deal",
  type: UndoActionType,
  payload: DeleteSnapshotPayload<T>,
): Promise<UndoResult> {
  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
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
 * `reverseUndoableAction(action.type, action.payload, organizationId)`;
 * adicionar undo a uma ação NOVA no futuro é só um novo par (type →
 * handler) aqui, quase sempre reaproveitando revertFieldUpdate/revertDelete
 * em vez de escrever handler do zero.
 *
 * task.delete/contact.delete/deal.delete aparecem duas vezes de propósito:
 * a MESMA entrada do registry cobre tanto "desfazer o delete" (restaura)
 * quanto "desfazer a restauração" (apaga de novo) — qual das duas rodar é
 * decidido em runtime pelo dispatch abaixo, olhando se a linha existe.
 */
export async function reverseUndoableAction(
  type: UndoActionType,
  payload: unknown,
  organizationId: string,
): Promise<UndoResult> {
  switch (type) {
    case "task.update":
    case "contact.update":
    case "deal.update":
    case "deal.move":
      return revertFieldUpdate(organizationId, type, payload as FieldUpdatePayload);
    case "task.bulkMove":
      return revertTaskBulkMove(organizationId, payload as TaskBulkMovePayload);
    case "task.delete":
      return dispatchDelete(organizationId, "task", type, payload as DeleteSnapshotPayload);
    case "contact.delete":
      return dispatchDelete(organizationId, "contact", type, payload as DeleteSnapshotPayload);
    case "deal.delete":
      return dispatchDelete(organizationId, "deal", type, payload as DeleteSnapshotPayload);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Tipo de ação desfazível desconhecido: ${_exhaustive}`);
    }
  }
}

/** A linha do snapshot ainda existe? Então esta reversão é "desfazer a
 * restauração" (apaga de novo); senão é "desfazer o delete" (restaura).
 * Leitura simples fora de transação — só decide qual caminho seguir, quem
 * de fato grava é revertDelete/redeleteRow, cada um na sua própria
 * transação real. */
async function dispatchDelete(
  organizationId: string,
  model: "task" | "contact" | "deal",
  type: UndoActionType,
  payload: DeleteSnapshotPayload,
): Promise<UndoResult> {
  const delegate = prisma[model] as unknown as { findUnique: (args: { where: { id: string } }) => Promise<unknown> };
  const stillExists = await delegate.findUnique({ where: { id: payload.snapshot.id as string } });
  return stillExists
    ? redeleteRow(organizationId, model, type, payload)
    : revertDelete(organizationId, model, type, payload);
}
