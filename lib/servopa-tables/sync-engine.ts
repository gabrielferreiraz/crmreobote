/**
 * Motor transacional da sincronização. As dependências de banco e tenant são
 * recebidas de fora para que a mesma lógica possa ser testada sem tocar no
 * PostgreSQL de produção.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import {
  assertServopaReductionIsSafe,
  validateServopaSnapshot,
  type ServopaSnapshotEvidence,
} from "./snapshot-validation.ts";
import type { NormalizedGroup, NormalizedTable } from "./types.ts";

type Tx = Prisma.TransactionClient;
type TransactionOptions = { timeout?: number; maxWait?: number };

export type SyncTransaction = <T>(callback: (tx: Tx) => Promise<T>, options?: TransactionOptions) => Promise<T>;
export type SetTenant = (tx: Tx, organizationId: string) => Promise<void>;

export type SyncCounts = { created: number; updated: number; unchanged: number; deleted: number; reactivated: number };
export type SyncSummary = { groups: SyncCounts; tables: SyncCounts; groupsTotal: number; tablesTotal: number };
export type SyncOptions = {
  organizationId: string;
  groups: NormalizedGroup[];
  trigger: "SCHEDULED" | "MANUAL" | "IMPORT";
  requestedById?: string | null;
  /** A coleta cobriu TODOS os grupos? Só então o que não veio pode ser excluído. */
  complete: boolean;
  /** Provas produzidas pelo worker de que uma coleta completa não foi cortada. */
  evidence?: ServopaSnapshotEvidence;
  /** Execução já reivindicada pela fila. O endpoint valida o lease antes. */
  existingRunId?: string;
};

/** Uma coleta "RUNNING" há menos que isto bloqueia outra (evita duas ao mesmo tempo). */
const RUN_STALE_MS = 30 * 60 * 1000;

export class ServopaSyncInterruptedError extends Error {
  constructor() {
    super("A atualização foi cancelada no CRM.");
    this.name = "ServopaSyncInterruptedError";
  }
}

const emptyCounts = (): SyncCounts => ({ created: 0, updated: 0, unchanged: 0, deleted: 0, reactivated: 0 });

function groupData(g: NormalizedGroup) {
  return {
    segment: g.segment,
    totalMonths: g.totalMonths,
    vacancies: g.vacancies,
    dueDay: g.dueDay,
    nextAssemblyNumber: g.nextAssemblyNumber,
    nextAssemblyAt: g.nextAssemblyAt,
    reserveFundPercent: g.reserveFundPercent,
    insuranceRatePercent: g.insuranceRatePercent,
    insuranceType: g.insuranceType,
    groupType: g.groupType,
    drawType: g.drawType,
    embeddedBidMaxPercent: g.embeddedBidMaxPercent,
    membersCount: g.membersCount,
    contemplationText: g.contemplationText,
    rawInfo: g.rawInfo as Prisma.InputJsonValue,
    contentHash: g.contentHash,
  };
}

function rowsData(organizationId: string, tableId: string, t: NormalizedTable) {
  return t.rows.map((r) => ({ organizationId, tableId, ...r }));
}

export async function syncServopaSnapshotWithDependencies(
  opts: SyncOptions,
  dependencies: { transaction: SyncTransaction; setTenant: SetTenant },
): Promise<{ runId: string; summary: SyncSummary }> {
  const { organizationId, groups, trigger, complete } = opts;
  const { transaction, setTenant } = dependencies;

  // Toda validação que independe do banco ocorre antes de abrir uma execução.
  // Assim, uma coleta incompleta não gera escrita nem pode alcançar a limpeza.
  const availableGroups = validateServopaSnapshot({ groups, complete, evidence: opts.evidence });

  const prepared = await transaction(async (tx) => {
    await setTenant(tx, organizationId);
    const staleCutoff = new Date(Date.now() - RUN_STALE_MS);
    // Importações antigas não possuem lease. Se o processo morreu sem passar
    // pelo catch, libera a trava depois de 30 min e deixa um histórico claro.
    await tx.servopaSyncRun.updateMany({
      where: { organizationId, status: "RUNNING", leaseTokenHash: null, startedAt: { lte: staleCutoff } },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorCode: "STALE_DIRECT_SYNC",
        error: "A importação parou de responder e foi encerrada automaticamente.",
      },
    });
    let run: { id: string };
    if (opts.existingRunId) {
      const claimed = await tx.servopaSyncRun.findFirst({
        where: { id: opts.existingRunId, organizationId, status: "RUNNING" },
        select: { id: true },
      });
      if (!claimed) throw new Error("A execução do robô não está mais em andamento");
      run = claimed;
    } else {
      const busy = await tx.servopaSyncRun.findFirst({
        where: {
          organizationId,
          OR: [
            { status: "PENDING" },
            { status: "RUNNING", startedAt: { gt: staleCutoff } },
          ],
        },
        select: { id: true },
      });
      if (busy) throw new Error("Já existe uma coleta das tabelas Servopa em andamento");
      run = await tx.servopaSyncRun.create({
        data: { organizationId, trigger, status: "RUNNING", requestedById: opts.requestedById ?? null, startedAt: new Date() },
        select: { id: true },
      });
    }
    const existing = await tx.servopaGroup.findMany({
      where: { organizationId },
      select: {
        id: true,
        number: true,
        vacancies: true,
        active: true,
        contentHash: true,
        tables: { select: { id: true, admRatePercent: true, contentHash: true, active: true } },
      },
    });
    if (complete) assertServopaReductionIsSafe(existing, availableGroups);

    return { existing, run };
  });
  const { existing, run } = prepared;

  const summary: SyncSummary = { groups: emptyCounts(), tables: emptyCounts(), groupsTotal: availableGroups.length, tablesTotal: 0 };
  try {
    const byNumber = new Map(existing.map((g) => [g.number, g]));
    const seenGroupIds: string[] = [];
    const seenTableIds: string[] = [];

    for (const g of availableGroups) {
      summary.tablesTotal += g.tables.length;
      const now = new Date();
      await transaction(
        async (tx: Tx) => {
          await setTenant(tx, organizationId);
          const activeRun = await tx.servopaSyncRun.findFirst({
            where: { id: run.id, organizationId, status: "RUNNING" },
            select: { id: true },
          });
          if (!activeRun) throw new ServopaSyncInterruptedError();
          const found = byNumber.get(g.number);

          if (!found) {
            const created = await tx.servopaGroup.create({
              data: { organizationId, number: g.number, ...groupData(g), firstSeenAt: now, lastSeenAt: now, lastChangedAt: now },
              select: { id: true },
            });
            seenGroupIds.push(created.id);
            summary.groups.created++;
            for (const t of g.tables) {
              const ct = await tx.servopaTable.create({
                data: { organizationId, groupId: created.id, admRatePercent: t.admRatePercent, termMonths: t.termMonths, contentHash: t.contentHash, firstSeenAt: now, lastSeenAt: now, lastChangedAt: now },
                select: { id: true },
              });
              await tx.servopaTableRow.createMany({ data: rowsData(organizationId, ct.id, t) });
              seenTableIds.push(ct.id);
              summary.tables.created++;
            }
            return;
          }

          seenGroupIds.push(found.id);
          if (!found.active) summary.groups.reactivated++;
          if (found.contentHash !== g.contentHash || !found.active) {
            await tx.servopaGroup.update({
              where: { id: found.id },
              data: { ...groupData(g), active: true, lastSeenAt: now, ...(found.contentHash !== g.contentHash ? { lastChangedAt: now } : {}) },
            });
            if (found.contentHash !== g.contentHash) summary.groups.updated++;
          } else summary.groups.unchanged++;

          const tablesByRate = new Map(found.tables.map((t) => [t.admRatePercent.toFixed(4), t]));
          for (const t of g.tables) {
            const ft = tablesByRate.get(t.admRatePercent);
            if (!ft) {
              const ct = await tx.servopaTable.create({
                data: { organizationId, groupId: found.id, admRatePercent: t.admRatePercent, termMonths: t.termMonths, contentHash: t.contentHash, firstSeenAt: now, lastSeenAt: now, lastChangedAt: now },
                select: { id: true },
              });
              await tx.servopaTableRow.createMany({ data: rowsData(organizationId, ct.id, t) });
              seenTableIds.push(ct.id);
              summary.tables.created++;
              continue;
            }
            seenTableIds.push(ft.id);
            if (!ft.active) summary.tables.reactivated++;
            if (ft.contentHash !== t.contentHash) {
              await tx.servopaTableRow.deleteMany({ where: { tableId: ft.id } });
              await tx.servopaTableRow.createMany({ data: rowsData(organizationId, ft.id, t) });
              // adjustmentPoints/adjustedById/adjustedAt ficam como estão, de propósito.
              await tx.servopaTable.update({ where: { id: ft.id }, data: { termMonths: t.termMonths, contentHash: t.contentHash, active: true, lastSeenAt: now, lastChangedAt: now } });
              summary.tables.updated++;
            } else {
              if (!ft.active) await tx.servopaTable.update({ where: { id: ft.id }, data: { active: true, lastSeenAt: now } });
              summary.tables.unchanged++;
            }
          }
        },
        { timeout: 30_000, maxWait: 15_000 },
      );
    }

    // "Visto agora" de todo mundo que não mudou (um UPDATE só por tipo) e,
    // somente numa foto completa, remoção definitiva do que deixou de existir.
    await transaction(
      async (tx) => {
        await setTenant(tx, organizationId);
        const now = new Date();
        const activeRun = await tx.servopaSyncRun.findFirst({
          where: { id: run.id, organizationId, status: "RUNNING" },
          select: { id: true },
        });
        if (!activeRun) throw new ServopaSyncInterruptedError();
        await tx.servopaGroup.updateMany({ where: { id: { in: seenGroupIds } }, data: { lastSeenAt: now } });
        await tx.servopaTable.updateMany({ where: { id: { in: seenTableIds } }, data: { lastSeenAt: now } });
        if (complete) {
          // As tabelas vêm primeiro para o resumo contabilizar também as que
          // pertencem a grupos removidos; depois o cascade limpa qualquer sobra.
          const tables = await tx.servopaTable.deleteMany({
            where: { organizationId, id: { notIn: seenTableIds } },
          });
          const groups = await tx.servopaGroup.deleteMany({
            where: { organizationId, id: { notIn: seenGroupIds } },
          });
          summary.tables.deleted = tables.count;
          summary.groups.deleted = groups.count;
        }
        await tx.servopaSyncRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCESS",
            finishedAt: now,
            summary: summary as unknown as Prisma.InputJsonValue,
            progress: { phase: "UPLOADING", completed: 1, total: 1 },
            leaseExpiresAt: null,
            leaseTokenHash: null,
            errorCode: null,
            error: null,
          },
        });
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
    return { runId: run.id, summary };
  } catch (err) {
    await transaction(async (tx) => {
      await setTenant(tx, organizationId);
        await tx.servopaSyncRun.updateMany({
          where: { id: run.id, organizationId, status: "RUNNING" },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            errorCode: "SYNC_FAILED",
            error: err instanceof Error ? err.message : String(err),
            summary: summary as unknown as Prisma.InputJsonValue,
            leaseExpiresAt: null,
            leaseTokenHash: null,
          },
      });
    }).catch(() => {});
    throw err;
  }
}
