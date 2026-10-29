/**
 * Testes transacionais da sincronização sem conexão externa:
 *
 *   node --experimental-strip-types --test scripts/test-servopa-sync.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  syncServopaSnapshotWithDependencies,
  type SyncTransaction,
} from "../lib/servopa-tables/sync-engine.ts";
import type { ServopaSnapshotEvidence } from "../lib/servopa-tables/snapshot-validation.ts";
import type { NormalizedGroup } from "../lib/servopa-tables/types.ts";

type FakeGroup = {
  id: string;
  organizationId: string;
  number: string;
  vacancies: number | null;
  active: boolean;
  contentHash: string;
  [key: string]: unknown;
};

type FakeTable = {
  id: string;
  organizationId: string;
  groupId: string;
  admRatePercent: number;
  adjustmentPoints: string;
  adjustedById: string | null;
  adjustedAt: Date | null;
  termMonths: number;
  contentHash: string;
  active: boolean;
  [key: string]: unknown;
};

type FakeRow = { tableId: string; [key: string]: unknown };
type FakeRun = {
  id: string;
  organizationId: string;
  status: string;
  startedAt: Date | null;
  [key: string]: unknown;
};
type FakeState = { groups: FakeGroup[]; tables: FakeTable[]; rows: FakeRow[]; runs: FakeRun[] };

function idsFrom(where: unknown, key: "in" | "notIn"): string[] | null {
  if (!where || typeof where !== "object") return null;
  const id = (where as { id?: unknown }).id;
  if (!id || typeof id !== "object") return null;
  const value = (id as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

class FakeServopaDatabase {
  state: FakeState = { groups: [], tables: [], rows: [], runs: [] };
  private nextId = 1;

  private id(prefix: string) {
    return `${prefix}-${this.nextId++}`;
  }

  readonly transaction: SyncTransaction = async (callback) => {
    const before = structuredClone(this.state);
    const nextIdBefore = this.nextId;
    try {
      return await callback(this.transactionClient() as never);
    } catch (error) {
      this.state = before;
      this.nextId = nextIdBefore;
      throw error;
    }
  };

  private transactionClient() {
    return {
      servopaSyncRun: {
        findFirst: async (args: {
          where:
            | { organizationId: string; OR: Array<{ status: string; startedAt?: { gt: Date } }> }
            | { id: string; organizationId: string; status: string };
        }) => {
          const found = this.state.runs.find(
            (run) => {
              if (run.organizationId !== args.where.organizationId) return false;
              if ("id" in args.where) return run.id === args.where.id && run.status === args.where.status;
              return args.where.OR.some(
                (condition) =>
                  run.status === condition.status &&
                  (!condition.startedAt || (run.startedAt instanceof Date && run.startedAt > condition.startedAt.gt)),
              );
            },
          );
          return found ? { id: found.id } : null;
        },
        create: async (args: { data: Record<string, unknown> }) => {
          const run: FakeRun = {
            id: this.id("run"),
            organizationId: String(args.data.organizationId),
            status: String(args.data.status),
            startedAt: args.data.startedAt instanceof Date ? args.data.startedAt : null,
            ...args.data,
          };
          this.state.runs.push(run);
          return { id: run.id };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const run = this.state.runs.find((item) => item.id === args.where.id);
          if (!run) throw new Error(`Execução inexistente: ${args.where.id}`);
          Object.assign(run, args.data);
          return run;
        },
        updateMany: async (args: {
          where: { organizationId: string; status: string; leaseTokenHash: null; startedAt: { lte: Date } };
          data: Record<string, unknown>;
        }) => {
          const selected = this.state.runs.filter(
            (run) =>
              run.organizationId === args.where.organizationId &&
              run.status === args.where.status &&
              (run.leaseTokenHash ?? null) === args.where.leaseTokenHash &&
              run.startedAt instanceof Date &&
              run.startedAt <= args.where.startedAt.lte,
          );
          selected.forEach((run) => Object.assign(run, args.data));
          return { count: selected.length };
        },
      },
      servopaGroup: {
        findMany: async (args: { where: { organizationId: string } }) =>
          this.state.groups
            .filter((group) => group.organizationId === args.where.organizationId)
            .map((group) => ({
              id: group.id,
              number: group.number,
              vacancies: group.vacancies,
              active: group.active,
              contentHash: group.contentHash,
              tables: this.state.tables
                .filter((table) => table.groupId === group.id)
                .map((table) => ({
                  id: table.id,
                  admRatePercent: table.admRatePercent,
                  contentHash: table.contentHash,
                  active: table.active,
                })),
            })),
        create: async (args: { data: Record<string, unknown> }) => {
          const group: FakeGroup = {
            id: this.id("group"),
            organizationId: String(args.data.organizationId),
            number: String(args.data.number),
            vacancies: args.data.vacancies as number | null,
            active: true,
            contentHash: String(args.data.contentHash),
            ...args.data,
          };
          this.state.groups.push(group);
          return { id: group.id };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const group = this.state.groups.find((item) => item.id === args.where.id);
          if (!group) throw new Error(`Grupo inexistente: ${args.where.id}`);
          Object.assign(group, args.data);
          return group;
        },
        updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
          const ids = idsFrom(args.where, "in") ?? [];
          const selected = this.state.groups.filter((group) => ids.includes(group.id));
          selected.forEach((group) => Object.assign(group, args.data));
          return { count: selected.length };
        },
        deleteMany: async (args: { where: { organizationId: string; id: { notIn: string[] } } }) => {
          const excluded = idsFrom(args.where, "notIn") ?? [];
          const removed = this.state.groups.filter(
            (group) => group.organizationId === args.where.organizationId && !excluded.includes(group.id),
          );
          const removedIds = new Set(removed.map((group) => group.id));
          const removedTableIds = new Set(this.state.tables.filter((table) => removedIds.has(table.groupId)).map((table) => table.id));
          this.state.groups = this.state.groups.filter((group) => !removedIds.has(group.id));
          this.state.tables = this.state.tables.filter((table) => !removedTableIds.has(table.id));
          this.state.rows = this.state.rows.filter((row) => !removedTableIds.has(row.tableId));
          return { count: removed.length };
        },
      },
      servopaTable: {
        create: async (args: { data: Record<string, unknown> }) => {
          const table: FakeTable = {
            id: this.id("table"),
            organizationId: String(args.data.organizationId),
            groupId: String(args.data.groupId),
            admRatePercent: Number(args.data.admRatePercent),
            adjustmentPoints: "0.0000",
            adjustedById: null,
            adjustedAt: null,
            termMonths: Number(args.data.termMonths),
            contentHash: String(args.data.contentHash),
            active: true,
            ...args.data,
          };
          table.admRatePercent = Number(table.admRatePercent);
          this.state.tables.push(table);
          return { id: table.id };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const table = this.state.tables.find((item) => item.id === args.where.id);
          if (!table) throw new Error(`Tabela inexistente: ${args.where.id}`);
          Object.assign(table, args.data);
          return table;
        },
        updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
          const ids = idsFrom(args.where, "in") ?? [];
          const selected = this.state.tables.filter((table) => ids.includes(table.id));
          selected.forEach((table) => Object.assign(table, args.data));
          return { count: selected.length };
        },
        deleteMany: async (args: { where: { organizationId: string; id: { notIn: string[] } } }) => {
          const excluded = idsFrom(args.where, "notIn") ?? [];
          const removed = this.state.tables.filter(
            (table) => table.organizationId === args.where.organizationId && !excluded.includes(table.id),
          );
          const removedIds = new Set(removed.map((table) => table.id));
          this.state.tables = this.state.tables.filter((table) => !removedIds.has(table.id));
          this.state.rows = this.state.rows.filter((row) => !removedIds.has(row.tableId));
          return { count: removed.length };
        },
      },
      servopaTableRow: {
        createMany: async (args: { data: FakeRow[] }) => {
          this.state.rows.push(...structuredClone(args.data));
          return { count: args.data.length };
        },
        deleteMany: async (args: { where: { tableId: string } }) => {
          const before = this.state.rows.length;
          this.state.rows = this.state.rows.filter((row) => row.tableId !== args.where.tableId);
          return { count: before - this.state.rows.length };
        },
      },
    };
  }
}

const ORG = "org-test";

function group(number: string, segment: NormalizedGroup["segment"], vacancies: number, version = 1): NormalizedGroup {
  return {
    number,
    segment,
    totalMonths: 120,
    vacancies,
    dueDay: 10,
    nextAssemblyNumber: null,
    nextAssemblyAt: null,
    reserveFundPercent: "0.5000",
    insuranceRatePercent: null,
    insuranceType: null,
    groupType: null,
    drawType: null,
    embeddedBidMaxPercent: null,
    membersCount: null,
    contemplationText: "",
    rawInfo: {},
    contentHash: `group-${number}-v${version}`,
    tables: [
      {
        admRatePercent: "10.0000",
        termMonths: 120,
        contentHash: `table-${number}-v${version}`,
        rows: [
          {
            position: 0,
            category: "A1",
            description: `Crédito ${version}`,
            creditValue: "100000.00",
            termMonths: 120,
            monthlyPercent: "0.9200",
            installment: "920.00",
            insurance: "0.00",
            observation: null,
            total: "920.00",
          },
        ],
      },
    ],
  };
}

function evidence(groups: NormalizedGroup[]): ServopaSnapshotEvidence {
  const realEstate = groups.filter((item) => item.segment === "REAL_ESTATE");
  const movable = groups.filter((item) => item.segment === "MOVABLE");
  const fallbackNumber = groups.some((item) => item.number === "999999") ? "999998" : "999999";
  return {
    lists: [
      {
        segment: "REAL_ESTATE",
        httpStatus: 200,
        cloudflareBlocked: false,
        groups: (realEstate.length ? realEstate : [group(fallbackNumber, "REAL_ESTATE", 0)]).map((item) => ({
          number: item.number,
          vacancies: item.vacancies ?? 0,
        })),
      },
      {
        segment: "MOVABLE",
        httpStatus: 200,
        cloudflareBlocked: false,
        groups: (movable.length ? movable : [group(fallbackNumber, "MOVABLE", 0)]).map((item) => ({
          number: item.number,
          vacancies: item.vacancies ?? 0,
        })),
      },
    ],
    pages: groups.map((item) => ({ number: item.number, httpStatus: 200, cloudflareBlocked: false })),
  };
}

async function sync(db: FakeServopaDatabase, groups: NormalizedGroup[], complete: boolean) {
  return syncServopaSnapshotWithDependencies(
    { organizationId: ORG, groups, trigger: "IMPORT", complete, evidence: complete ? evidence(groups) : undefined },
    { transaction: db.transaction, setTenant: async () => {} },
  );
}

test("grupo com zero vagas nunca é salvo", async () => {
  const db = new FakeServopaDatabase();
  const result = await sync(db, [group("100", "REAL_ESTATE", 2), group("200", "MOVABLE", 0)], true);
  assert.deepEqual(db.state.groups.map((item) => item.number), ["100"]);
  assert.equal(result.summary.groupsTotal, 1);
  assert.equal(db.state.tables.length, 1);
});

test("coleta completa remove grupo ausente; parcial preserva", async () => {
  const db = new FakeServopaDatabase();
  const a = group("100", "REAL_ESTATE", 2);
  const b = group("200", "MOVABLE", 2);
  await sync(db, [a, b], true);

  await sync(db, [a], false);
  assert.deepEqual(db.state.groups.map((item) => item.number).sort(), ["100", "200"]);

  const result = await sync(db, [a], true);
  assert.deepEqual(db.state.groups.map((item) => item.number), ["100"]);
  assert.equal(result.summary.groups.deleted, 1);
  assert.equal(result.summary.tables.deleted, 1);
});

test("coleta interrompida é recusada sem abrir execução ou alterar dados", async () => {
  const db = new FakeServopaDatabase();
  const current = group("100", "REAL_ESTATE", 2);
  await sync(db, [current], true);
  const before = structuredClone(db.state);
  const brokenEvidence = evidence([current]);
  brokenEvidence.pages[0] = { number: current.number, httpStatus: 502, cloudflareBlocked: true };

  await assert.rejects(
    () =>
      syncServopaSnapshotWithDependencies(
        { organizationId: ORG, groups: [current], trigger: "IMPORT", complete: true, evidence: brokenEvidence },
        { transaction: db.transaction, setTenant: async () => {} },
      ),
    /grupo 100 não foi carregada corretamente/,
  );
  assert.deepEqual(db.state, before);
});

test("atualização preserva ajuste comercial e reimportação é idempotente", async () => {
  const db = new FakeServopaDatabase();
  await sync(db, [group("100", "REAL_ESTATE", 2)], true);
  db.state.tables[0].adjustmentPoints = "-1.5000";
  db.state.tables[0].adjustedById = "owner-1";
  db.state.tables[0].adjustedAt = new Date("2026-10-26T12:00:00.000Z");

  const changed = group("100", "REAL_ESTATE", 2, 2);
  const updated = await sync(db, [changed], true);
  assert.equal(updated.summary.tables.updated, 1);
  assert.equal(db.state.tables[0].adjustmentPoints, "-1.5000");
  assert.equal(db.state.tables[0].adjustedById, "owner-1");
  assert.equal(db.state.rows.length, 1);

  const repeated = await sync(db, [changed], true);
  assert.equal(repeated.summary.groups.unchanged, 1);
  assert.equal(repeated.summary.tables.unchanged, 1);
  assert.equal(repeated.summary.groups.created, 0);
  assert.equal(repeated.summary.tables.created, 0);
  assert.equal(db.state.groups.length, 1);
  assert.equal(db.state.tables.length, 1);
  assert.equal(db.state.rows.length, 1);
});

test("snapshot do worker conclui a execucao reivindicada sem criar outra", async () => {
  const db = new FakeServopaDatabase();
  db.state.runs.push({
    id: "queued-run",
    organizationId: ORG,
    status: "RUNNING",
    startedAt: new Date(),
    leaseTokenHash: "hash-do-upload",
  });
  const current = group("100", "REAL_ESTATE", 2);

  const result = await syncServopaSnapshotWithDependencies(
    {
      organizationId: ORG,
      groups: [current],
      trigger: "MANUAL",
      complete: true,
      evidence: evidence([current]),
      existingRunId: "queued-run",
    },
    { transaction: db.transaction, setTenant: async () => {} },
  );

  assert.equal(result.runId, "queued-run");
  assert.equal(db.state.runs.length, 1);
  assert.equal(db.state.runs[0].status, "SUCCESS");
  assert.equal(db.state.runs[0].leaseTokenHash, null);
});
