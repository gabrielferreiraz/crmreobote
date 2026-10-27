/**
 * Leitura das tabelas Servopa para as telas: já devolve cada tabela com as
 * linhas como devem aparecer (taxa efetiva aplicada — ver adjust.ts) e tudo
 * em texto, pronto para serializar. Os valores do site nunca são alterados
 * aqui; com ajuste 0 as linhas saem exatamente como a Servopa publica.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { applyAdjustment, toUnits, type PricedRow } from "@/lib/servopa-tables/adjust";
import { hasServopaPanelCredentials } from "@/lib/servopa-tables/panel-credentials";
import { MAX_SERVOPA_WORKERS, SERVOPA_MAX_ATTEMPTS } from "@/lib/servopa-tables/queue-contract";

export type ServopaTableRowView = PricedRow & { position: number };

export type ServopaTableView = {
  id: string;
  groupNumber: string;
  segment: "REAL_ESTATE" | "MOVABLE";
  /** Prazo restante (meses) — é o que o PDF mostra. */
  termMonths: number;
  /** Taxa de ADM publicada pela Servopa ("13.0000"). */
  admOriginal: string;
  /** Taxa com o desconto/acréscimo aplicado (igual à original quando o ajuste é 0). */
  admEffective: string;
  adjustmentPoints: string;
  adjustedAt: Date | null;
  adjustedById: string | null;
  reserveFundPercent: string | null;
  /** Quantidade disponível no grupo, publicada na lista da Servopa. */
  vacancies: number | null;
  dueDay: number | null;
  nextAssemblyNumber: string | null;
  nextAssemblyAt: Date | null;
  contemplationText: string;
  /** Linhas como devem aparecer (já com o ajuste). */
  rows: ServopaTableRowView[];
  lastChangedAt: Date;
};

export type ServopaTableListView = Pick<
  ServopaTableView,
  | "id"
  | "groupNumber"
  | "segment"
  | "termMonths"
  | "admOriginal"
  | "admEffective"
  | "adjustmentPoints"
  | "reserveFundPercent"
  | "vacancies"
  | "nextAssemblyAt"
> & {
  creditRange: { min: string; max: string };
  installmentRange: { min: string; max: string };
};

type DbTable = {
  id: string;
  admRatePercent: { toFixed(n: number): string };
  adjustmentPoints: { toFixed(n: number): string };
  adjustedAt: Date | null;
  adjustedById: string | null;
  termMonths: number;
  lastChangedAt: Date;
  group: {
    number: string;
    segment: "REAL_ESTATE" | "MOVABLE";
    dueDay: number | null;
    nextAssemblyNumber: string | null;
    nextAssemblyAt: Date | null;
    reserveFundPercent: { toFixed(n: number): string } | null;
    vacancies: number | null;
    contemplationText: string;
  };
  rows: {
    position: number;
    category: string;
    description: string;
    creditValue: { toFixed(n: number): string };
    termMonths: number;
    monthlyPercent: { toFixed(n: number): string };
    installment: { toFixed(n: number): string };
    insurance: { toFixed(n: number): string };
    observation: string | null;
    total: { toFixed(n: number): string };
  }[];
};

function toView(t: DbTable): ServopaTableView {
  const rows = t.rows.map((r) => ({
    position: r.position,
    category: r.category,
    description: r.description,
    creditValue: r.creditValue.toFixed(2),
    termMonths: r.termMonths,
    monthlyPercent: r.monthlyPercent.toFixed(4),
    installment: r.installment.toFixed(2),
    insurance: r.insurance.toFixed(2),
    observation: r.observation,
    total: r.total.toFixed(2),
  }));
  const fund = t.group.reserveFundPercent?.toFixed(4) ?? null;
  const adjusted = applyAdjustment(
    { admRatePercent: t.admRatePercent.toFixed(4), adjustmentPoints: t.adjustmentPoints.toFixed(4), termMonths: t.termMonths, reserveFundPercent: fund },
    rows,
  );
  return {
    id: t.id,
    groupNumber: t.group.number,
    segment: t.group.segment,
    termMonths: t.termMonths,
    admOriginal: t.admRatePercent.toFixed(4),
    admEffective: adjusted.admRatePercent,
    adjustmentPoints: t.adjustmentPoints.toFixed(4),
    adjustedAt: t.adjustedAt,
    adjustedById: t.adjustedById,
    reserveFundPercent: fund,
    vacancies: t.group.vacancies,
    dueDay: t.group.dueDay,
    nextAssemblyNumber: t.group.nextAssemblyNumber,
    nextAssemblyAt: t.group.nextAssemblyAt,
    contemplationText: t.group.contemplationText,
    rows: adjusted.rows,
    lastChangedAt: t.lastChangedAt,
  };
}

function rangeOf(rows: ServopaTableRowView[], field: "creditValue" | "installment"): { min: string; max: string } {
  if (rows.length === 0) throw new Error("Tabela Servopa sem linhas");
  let min = rows[0][field];
  let max = min;
  let minUnits = toUnits(min, 2);
  let maxUnits = minUnits;
  for (let index = 1; index < rows.length; index += 1) {
    const value = rows[index][field];
    const units = toUnits(value, 2);
    if (units < minUnits) { min = value; minUnits = units; }
    if (units > maxUnits) { max = value; maxUnits = units; }
  }
  return { min, max };
}

function toListView(t: DbTable): ServopaTableListView {
  const table = toView(t);
  return {
    id: table.id,
    groupNumber: table.groupNumber,
    segment: table.segment,
    termMonths: table.termMonths,
    admOriginal: table.admOriginal,
    admEffective: table.admEffective,
    adjustmentPoints: table.adjustmentPoints,
    reserveFundPercent: table.reserveFundPercent,
    vacancies: table.vacancies,
    nextAssemblyAt: table.nextAssemblyAt,
    creditRange: rangeOf(table.rows, "creditValue"),
    installmentRange: rangeOf(table.rows, "installment"),
  };
}

const include = {
  group: { select: { number: true, segment: true, vacancies: true, dueDay: true, nextAssemblyNumber: true, nextAssemblyAt: true, reserveFundPercent: true, contemplationText: true } },
  rows: { orderBy: { position: "asc" as const } },
};

/** Todas as tabelas ativas (≈400 no total — pequeno o bastante para filtrar em memória). */
export async function listServopaTables(organizationId: string): Promise<ServopaTableListView[]> {
  const tables = await runWithTenant(organizationId, () =>
    prisma.servopaTable.findMany({
      where: {
        organizationId,
        active: true,
        group: { active: true, OR: [{ vacancies: null }, { vacancies: { gt: 0 } }] },
        rows: { some: {} },
      },
      include,
    }),
  );
  return tables
    .map((t) => toListView(t as unknown as DbTable))
    .sort((a, b) => Number(a.groupNumber) - Number(b.groupNumber) || toUnits(a.admOriginal, 4) - toUnits(b.admOriginal, 4));
}

export async function getServopaTable(organizationId: string, id: string): Promise<ServopaTableView | null> {
  const t = await runWithTenant(organizationId, () =>
    prisma.servopaTable.findFirst({
      where: {
        id,
        organizationId,
        active: true,
        group: { active: true, OR: [{ vacancies: null }, { vacancies: { gt: 0 } }] },
        rows: { some: {} },
      },
      include,
    }),
  );
  return t ? toView(t as unknown as DbTable) : null;
}

/** Última coleta bem-sucedida (para "atualizado em"). */
export async function getLastServopaSync(organizationId: string): Promise<{ finishedAt: Date | null; trigger: string } | null> {
  return runWithTenant(organizationId, () =>
    prisma.servopaSyncRun.findFirst({
      where: { organizationId, status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, trigger: true },
    }),
  );
}

/** Sem sinal há mais que isto (o robô consulta a cada 60 s) = offline. */
const WORKER_ONLINE_WINDOW_MS = 150_000;

export async function getServopaOperationState(organizationId: string) {
  return runWithTenant(organizationId, async () => {
    const [activeRun, latestRun, activeWorkers] = await Promise.all([
      prisma.servopaSyncRun.findFirst({
        where: { organizationId, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          trigger: true,
          attempts: true,
          nextAttemptAt: true,
          progress: true,
          startedAt: true,
          createdAt: true,
          errorCode: true,
          error: true,
        },
      }),
      prisma.servopaSyncRun.findFirst({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          trigger: true,
          attempts: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
          errorCode: true,
          error: true,
          summary: true,
        },
      }),
      prisma.servopaWorker.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, keyPrefix: true, lastSeenAt: true, version: true, createdAt: true },
      }),
    ]);
    // Vários computadores podem rodar o robô; basta UM online para a fila andar.
    const now = Date.now();
    const workers = activeWorkers.map((worker) => ({
      ...worker,
      online: Boolean(worker.lastSeenAt && now - worker.lastSeenAt.getTime() <= WORKER_ONLINE_WINDOW_MS),
    }));
    return {
      activeRun,
      latestRun,
      workers,
      workerOnline: workers.some((worker) => worker.online),
      // Só um sim/não: o valor do acesso da Servopa nunca sai do servidor para a tela.
      panelCredentialsConfigured: hasServopaPanelCredentials(),
      maxAttempts: SERVOPA_MAX_ATTEMPTS,
      maxWorkers: MAX_SERVOPA_WORKERS,
    };
  });
}

export async function listServopaSyncHistory(organizationId: string, limit = 30) {
  return runWithTenant(organizationId, async () => {
    const runs = await prisma.servopaSyncRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        status: true,
        trigger: true,
        requestedById: true,
        claimedByWorkerId: true,
        attempts: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        summary: true,
        errorCode: true,
        error: true,
      },
    });
    const workerIds = [...new Set(runs.map((run) => run.claimedByWorkerId).filter((id): id is string => Boolean(id)))];
    const workers = workerIds.length
      ? await prisma.servopaWorker.findMany({ where: { organizationId, id: { in: workerIds } }, select: { id: true, name: true } })
      : [];
    const workerNames = new Map(workers.map((worker) => [worker.id, worker.name]));
    const requesterIds = [...new Set(runs.map((run) => run.requestedById).filter((id): id is string => Boolean(id)))];
    const members = requesterIds.length
      ? await prisma.organizationUser.findMany({
          where: { organizationId, userId: { in: requesterIds } },
          select: { userId: true, user: { select: { name: true } } },
        })
      : [];
    const names = new Map(members.map((member) => [member.userId, member.user.name]));
    return runs.map((run) => ({
      ...run,
      requestedByName: run.requestedById ? names.get(run.requestedById) ?? "Usuário removido" : run.trigger === "SCHEDULED" ? "Agendamento" : "Sistema",
      workerName: run.claimedByWorkerId ? workerNames.get(run.claimedByWorkerId) ?? null : null,
    }));
  });
}
