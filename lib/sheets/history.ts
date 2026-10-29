import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { SheetError, sheetNotFound } from "@/lib/sheets/errors";
import { setRowsDeletedDetailed, updateRows } from "@/lib/sheets/rows";
import { setColumnArchived, updateColumn, updateSheet, type SheetActor } from "@/lib/sheets/sheets";
import type { SheetColumnType } from "@/lib/sheets/column-types";

const MAX_VERSION_EVENTS = 500;

type Activity = {
  id: string;
  rowId: string | null;
  action: string;
  changes: unknown;
  createdAt: Date;
};

type PairMap = Record<string, [unknown, unknown]>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pairs(value: unknown): PairMap | null {
  const record = object(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (!entries.every(([, pair]) => Array.isArray(pair) && pair.length === 2)) return null;
  return Object.fromEntries(entries) as PairMap;
}

function reversibleProblem(item: Activity): string | null {
  switch (item.action) {
    case "ROW_UPDATED":
    case "ROW_FORMULA":
      return item.rowId && pairs(item.changes) ? null : "alteração de célula sem valores anteriores";
    case "ROW_FORMATTED":
      return item.rowId && pairs(item.changes) ? null : "formatação antiga sem detalhes de antes/depois";
    case "ROW_CREATED":
    case "ROW_DELETED":
    case "ROW_RESTORED":
      return item.rowId ? null : "alteração de linha sem identificação";
    case "COLUMN_CREATED":
    case "COLUMN_ARCHIVED":
    case "COLUMN_RESTORED":
      return typeof object(item.changes)?.columnId === "string" ? null : "alteração de coluna sem identificação";
    case "COLUMN_UPDATED": {
      const changes = object(item.changes);
      return changes && typeof changes.columnId === "string" && object(changes.before) ? null : "alteração de coluna sem estado anterior";
    }
    case "SHEET_UPDATED":
      return object(object(item.changes)?.before) ? null : "alteração da planilha sem estado anterior";
    case "VERSION_RESTORED":
      return null;
    case "SHEET_CREATED":
      return "não é possível voltar para antes da criação da planilha";
    case "COLUMN_CLEARED":
      return "limpeza antiga de coluna não guardou o conteúdo removido";
    default:
      return `evento antigo não reversível (${item.action})`;
  }
}

async function loadPlan(organizationId: string, sheetId: string, activityId: string) {
  return runWithTenant(organizationId, async () => {
    const sheet = await prisma.sheet.findFirst({ where: { id: sheetId, organizationId, archivedAt: null }, select: { id: true } });
    if (!sheet) throw sheetNotFound();
    const target = await prisma.sheetActivity.findFirst({
      where: { id: activityId, sheetId, organizationId },
      select: { id: true, rowId: true, action: true, changes: true, createdAt: true },
    });
    if (!target) throw new SheetError(404, "Versão do histórico não encontrada");
    const newerWhere = {
      sheetId,
      organizationId,
      OR: [{ createdAt: { gt: target.createdAt } }, { createdAt: target.createdAt, id: { gt: target.id } }],
    };
    const total = await prisma.sheetActivity.count({ where: newerWhere });
    const activities = await prisma.sheetActivity.findMany({
      where: newerWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_VERSION_EVENTS + 1,
      select: { id: true, rowId: true, action: true, changes: true, createdAt: true },
    });
    return { target, total, activities };
  });
}

export async function versionPlan(organizationId: string, sheetId: string, activityId: string) {
  const { target, total, activities } = await loadPlan(organizationId, sheetId, activityId);
  const problems = activities.slice(0, MAX_VERSION_EVENTS).flatMap((item) => {
    const problem = reversibleProblem(item);
    return problem ? [{ activityId: item.id, action: item.action, problem }] : [];
  });
  if (total > MAX_VERSION_EVENTS) {
    problems.unshift({
      activityId: "limit",
      action: "LIMIT",
      problem: `a versão está a mais de ${MAX_VERSION_EVENTS} eventos do estado atual`,
    });
  }
  const counts = activities.slice(0, MAX_VERSION_EVENTS).reduce<Record<string, number>>((acc, item) => {
    acc[item.action] = (acc[item.action] ?? 0) + 1;
    return acc;
  }, {});
  return {
    activityId: target.id,
    createdAt: target.createdAt,
    newerCount: total,
    counts,
    canRestore: total > 0 && problems.length === 0,
    problems: problems.slice(0, 10),
  };
}

async function reverseActivity(actor: SheetActor, sheetId: string, item: Activity) {
  const pairMap = pairs(item.changes);
  switch (item.action) {
    case "ROW_UPDATED":
      await updateRows(actor, sheetId, [{ id: item.rowId!, values: Object.fromEntries(Object.entries(pairMap!).map(([key, [before]]) => [key, before])) }]);
      return;
    case "ROW_FORMULA":
      await updateRows(actor, sheetId, [{ id: item.rowId!, formulas: Object.fromEntries(Object.entries(pairMap!).map(([key, [before]]) => [key, before])) }]);
      return;
    case "ROW_FORMATTED":
      await updateRows(actor, sheetId, [{ id: item.rowId!, formats: Object.fromEntries(Object.entries(pairMap!).map(([key, [before]]) => [key, before])) }]);
      return;
    case "ROW_CREATED":
      await setRowsDeletedDetailed(actor, sheetId, [item.rowId!], true);
      return;
    case "ROW_DELETED":
      await setRowsDeletedDetailed(actor, sheetId, [item.rowId!], false);
      return;
    case "ROW_RESTORED":
      await setRowsDeletedDetailed(actor, sheetId, [item.rowId!], true);
      return;
    case "COLUMN_CREATED":
      await setColumnArchived(actor, sheetId, String(object(item.changes)!.columnId), true);
      return;
    case "COLUMN_ARCHIVED":
      await setColumnArchived(actor, sheetId, String(object(item.changes)!.columnId), false);
      return;
    case "COLUMN_RESTORED":
      await setColumnArchived(actor, sheetId, String(object(item.changes)!.columnId), true);
      return;
    case "COLUMN_UPDATED": {
      const changes = object(item.changes)!;
      const before = object(changes.before)!;
      await updateColumn(actor, sheetId, String(changes.columnId), {
        ...(typeof before.name === "string" ? { name: before.name } : {}),
        ...(typeof before.type === "string" ? { type: before.type as SheetColumnType } : {}),
        ...(before.config !== undefined ? { config: before.config } : {}),
        ...(typeof before.required === "boolean" ? { required: before.required } : {}),
        ...(typeof before.position === "number" ? { position: before.position } : {}),
      });
      return;
    }
    case "SHEET_UPDATED": {
      const before = object(object(item.changes)!.before)!;
      await updateSheet(actor, sheetId, {
        ...(typeof before.name === "string" ? { name: before.name } : {}),
        ...(typeof before.description === "string" ? { description: before.description } : {}),
        ...(before.settings !== undefined ? { settings: before.settings } : {}),
      });
      return;
    }
    case "VERSION_RESTORED":
      return;
  }
  throw new SheetError(409, reversibleProblem(item) ?? "Este evento não pode ser restaurado");
}

/** Volta a planilha ao estado imediatamente posterior ao evento escolhido. */
export async function restoreVersion(actor: SheetActor, sheetId: string, activityId: string) {
  const { total, activities } = await loadPlan(actor.organizationId, sheetId, activityId);
  if (total === 0) return { restored: 0 };
  if (total > MAX_VERSION_EVENTS || activities.length > MAX_VERSION_EVENTS) {
    throw new SheetError(409, `Escolha uma versão com no máximo ${MAX_VERSION_EVENTS} alterações posteriores`);
  }
  const blockers = activities.flatMap((item) => {
    const problem = reversibleProblem(item);
    return problem ? [problem] : [];
  });
  if (blockers.length) throw new SheetError(409, `Esta versão não pode ser restaurada integralmente: ${blockers[0]}`);

  const restoringActor = { ...actor, source: `history:${activityId}` };
  for (const item of activities) await reverseActivity(restoringActor, sheetId, item);
  await runWithTenant(actor.organizationId, () =>
    prisma.sheetActivity.create({
      data: {
        organizationId: actor.organizationId,
        sheetId,
        userId: actor.userId,
        source: actor.source,
        action: "VERSION_RESTORED",
        changes: { activityId, revertedEvents: activities.length },
      },
    }),
  );
  return { restored: activities.length };
}
