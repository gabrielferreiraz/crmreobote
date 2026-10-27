import { randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prismaRaw } from "@/lib/prisma";
import {
  hashServopaLeaseToken,
  planServopaFailure,
  SERVOPA_MAX_ATTEMPTS,
  ServopaQueueError,
  validateServopaSyncProgress,
  type ServopaSyncProgress,
} from "@/lib/servopa-tables/queue-contract";
import { setTenantOnTx } from "@/lib/tenant-context";

export { SERVOPA_MAX_ATTEMPTS, ServopaQueueError, type ServopaSyncProgress } from "@/lib/servopa-tables/queue-contract";

const LEASE_DURATION_MS = 2 * 60 * 1000;
const UPLOAD_LEASE_DURATION_MS = 30 * 60 * 1000;
const LEGACY_RUNNING_STALE_MS = 30 * 60 * 1000;
export const SERVOPA_RETRY_DELAY_MS = 15 * 60 * 1000;

export type ClaimedServopaSync = {
  id: string;
  trigger: "SCHEDULED" | "MANUAL" | "IMPORT";
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function leaseError(organizationId: string, runId: string): Promise<ServopaQueueError> {
  const run = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.servopaSyncRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
  });
  return run?.status === "CANCELLED"
    ? new ServopaQueueError("JOB_CANCELLED", "A atualização foi cancelada no CRM.")
    : new ServopaQueueError("INVALID_LEASE", "Esta execução expirou ou foi assumida por outro robô.");
}

async function findActiveRun(organizationId: string) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.servopaSyncRun.findFirst({
      where: { organizationId, status: { in: ["PENDING", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, trigger: true, nextAttemptAt: true, leaseExpiresAt: true },
    });
  });
}

/** Cria no máximo um trabalho ativo por organização, inclusive sob corrida. */
export async function enqueueServopaSync(params: {
  organizationId: string;
  trigger: "SCHEDULED" | "MANUAL";
  requestedById?: string | null;
  nextAttemptAt?: Date;
}): Promise<{ created: boolean; run: NonNullable<Awaited<ReturnType<typeof findActiveRun>>> }> {
  const { organizationId } = params;
  try {
    const run = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, organizationId);
      const active = await tx.servopaSyncRun.findFirst({
        where: { organizationId, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, trigger: true, nextAttemptAt: true, leaseExpiresAt: true },
      });
      if (active) return { created: false as const, run: active };

      const created = await tx.servopaSyncRun.create({
        data: {
          organizationId,
          trigger: params.trigger,
          status: "PENDING",
          requestedById: params.requestedById ?? null,
          nextAttemptAt: params.nextAttemptAt ?? new Date(),
        },
        select: { id: true, status: true, trigger: true, nextAttemptAt: true, leaseExpiresAt: true },
      });
      return { created: true as const, run: created };
    });
    return run;
  } catch (error) {
    // O índice parcial é a última barreira caso dois processos passem pelo
    // findFirst ao mesmo tempo. O perdedor recebe o trabalho já existente.
    if (!isUniqueViolation(error)) throw error;
    const active = await findActiveRun(organizationId);
    if (!active) throw new ServopaQueueError("ACTIVE_JOB_EXISTS", "Já existe uma atualização das tabelas em andamento.");
    return { created: false, run: active };
  }
}

/** Interrompe o pedido atual sem revogar nem desinstalar o worker. */
export async function cancelActiveServopaSync(organizationId: string) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const active = await tx.servopaSyncRun.findFirst({
      where: { organizationId, status: { in: ["PENDING", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!active) return null;

    const updated = await tx.servopaSyncRun.updateMany({
      where: { id: active.id, organizationId, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        claimedAt: null,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        leaseTokenHash: null,
        progress: Prisma.DbNull,
        errorCode: "CANCELLED_BY_USER",
        error: null,
      },
    });
    return updated.count === 1 ? active : null;
  });
}

/**
 * Reivindica atomicamente o próximo trabalho pronto da organização. Vários
 * computadores podem consultar a fila ao mesmo tempo: só um recebe o job
 * (FOR UPDATE SKIP LOCKED) e o `workerId` fica registrado no histórico.
 */
export async function claimNextServopaSync(organizationId: string, workerId?: string): Promise<ClaimedServopaSync | null> {
  const leaseToken = randomBytes(32).toString("base64url");
  const leaseTokenHash = hashServopaLeaseToken(leaseToken);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const legacyStaleAt = new Date(now.getTime() - LEGACY_RUNNING_STALE_MS);

  const claimed = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);

    // Notebook desligado ou processo encerrado: o mesmo job volta à fila.
    await tx.servopaSyncRun.updateMany({
      where: {
        organizationId,
        status: "RUNNING",
        OR: [
          { leaseExpiresAt: { lt: now } },
          { leaseTokenHash: null, startedAt: { lt: legacyStaleAt } },
        ],
      },
      data: {
        status: "PENDING",
        nextAttemptAt: now,
        claimedAt: null,
        claimedByWorkerId: null,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        leaseTokenHash: null,
        errorCode: "LEASE_EXPIRED",
        error: "O robô parou de responder. O mesmo trabalho voltou para a fila.",
      },
    });

    const rows = await tx.$queryRaw<
      Array<{ id: string; trigger: "SCHEDULED" | "MANUAL" | "IMPORT"; attempts: number; leaseExpiresAt: Date }>
    >`
      WITH candidate AS (
        SELECT "id"
        FROM "ServopaSyncRun"
        WHERE "organizationId" = ${organizationId}
          AND "status" = 'PENDING'
          AND "nextAttemptAt" <= ${now}
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "ServopaSyncRun" AS run
      SET
        "status" = 'RUNNING',
        "attempts" = run."attempts" + 1,
        "claimedAt" = ${now},
        "claimedByWorkerId" = ${workerId ?? null},
        "lastHeartbeatAt" = ${now},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "leaseTokenHash" = ${leaseTokenHash},
        "startedAt" = COALESCE(run."startedAt", ${now}),
        "finishedAt" = NULL,
        "errorCode" = NULL,
        "error" = NULL
      FROM candidate
      WHERE run."id" = candidate."id"
      RETURNING run."id", run."trigger", run."attempts", run."leaseExpiresAt"
    `;
    return rows[0] ?? null;
  });

  return claimed
    ? {
        id: claimed.id,
        trigger: claimed.trigger,
        attempt: claimed.attempts,
        leaseToken,
        leaseExpiresAt: claimed.leaseExpiresAt,
      }
    : null;
}

/** Mantém o claim vivo e atualiza o progresso visível no CRM. */
export async function heartbeatServopaSync(params: {
  organizationId: string;
  runId: string;
  leaseToken: string;
  progress: ServopaSyncProgress;
}): Promise<{ leaseExpiresAt: Date }> {
  const progress = validateServopaSyncProgress(params.progress);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const leaseTokenHash = hashServopaLeaseToken(params.leaseToken);
  const updated = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, params.organizationId);
    return tx.servopaSyncRun.updateMany({
      where: {
        id: params.runId,
        organizationId: params.organizationId,
        status: "RUNNING",
        leaseTokenHash,
        leaseExpiresAt: { gte: now },
      },
      data: {
        lastHeartbeatAt: now,
        leaseExpiresAt,
        progress: progress as unknown as Prisma.InputJsonValue,
      },
    });
  });
  if (updated.count !== 1) throw await leaseError(params.organizationId, params.runId);
  return { leaseExpiresAt };
}

export async function beginServopaSnapshotUpload(params: {
  organizationId: string;
  runId: string;
  leaseToken: string;
}) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + UPLOAD_LEASE_DURATION_MS);
  // The rotated lease makes snapshot processing exclusive. A concurrent retry
  // carrying the previous token cannot apply the same snapshot in parallel.
  const uploadLeaseToken = randomBytes(32).toString("base64url");
  const updated = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, params.organizationId);
    return tx.servopaSyncRun.updateMany({
      where: {
        id: params.runId,
        organizationId: params.organizationId,
        status: "RUNNING",
        leaseTokenHash: hashServopaLeaseToken(params.leaseToken),
        leaseExpiresAt: { gte: now },
      },
      data: {
        lastHeartbeatAt: now,
        leaseExpiresAt,
        leaseTokenHash: hashServopaLeaseToken(uploadLeaseToken),
        progress: { phase: "UPLOADING", completed: 0, total: 1 },
      },
    });
  });
  if (updated.count !== 1) throw await leaseError(params.organizationId, params.runId);
  return { leaseExpiresAt, uploadLeaseToken };
}

export async function getCompletedServopaSync(organizationId: string, runId: string) {
  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.servopaSyncRun.findFirst({
      where: { id: runId, organizationId, status: "SUCCESS" },
      select: { id: true, finishedAt: true, summary: true },
    });
  });
}

/** Falha definitiva ou reagendamento explícito do mesmo trabalho. */
export async function failServopaSync(params: {
  organizationId: string;
  runId: string;
  leaseToken: string;
  code: string;
  message: string;
  retryAt?: Date;
}) {
  const message = params.message.trim().slice(0, 2_000) || "A atualização das tabelas falhou.";
  const code = params.code.trim().slice(0, 80) || "UNKNOWN_ERROR";
  const now = new Date();
  const leaseTokenHash = hashServopaLeaseToken(params.leaseToken);
  const result = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, params.organizationId);
    const run = await tx.servopaSyncRun.findFirst({
      where: {
        id: params.runId,
        organizationId: params.organizationId,
        status: "RUNNING",
        leaseTokenHash,
        leaseExpiresAt: { gte: now },
      },
      select: { attempts: true },
    });
    if (!run) return null;

    const plan = planServopaFailure({ attempts: run.attempts, retryAt: params.retryAt, code, message });
    const updated = await tx.servopaSyncRun.updateMany({
      where: {
        id: params.runId,
        organizationId: params.organizationId,
        status: "RUNNING",
        leaseTokenHash,
        leaseExpiresAt: { gte: now },
      },
      data: {
        status: plan.status,
        nextAttemptAt: plan.retryAt ?? now,
        finishedAt: plan.retryAt ? null : now,
        claimedAt: null,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
        leaseTokenHash: null,
        errorCode: plan.errorCode,
        error: plan.error,
        progress: Prisma.DbNull,
      },
    });
    if (updated.count !== 1) return null;
    return plan;
  });
  if (!result) throw await leaseError(params.organizationId, params.runId);
  return { retryAt: result.retryAt, exhausted: result.exhausted, maxAttempts: SERVOPA_MAX_ATTEMPTS };
}
