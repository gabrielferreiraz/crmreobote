import "server-only";

import { Prisma } from "@/app/generated/prisma/client";
import { prisma, prismaRaw } from "@/lib/prisma";
import { runWithServopaWorkerLookup, setTenantOnTx } from "@/lib/tenant-context";
import { MAX_SERVOPA_WORKERS, SERVOPA_PAIRING_TTL_MS } from "@/lib/servopa-tables/queue-contract";
import {
  generateServopaPairingCode,
  generateServopaWorkerKey,
  hashServopaWorkerKey,
  parseServopaPairingCode,
  readServopaWorkerBearer,
  servopaWorkerName,
} from "@/lib/servopa-tables/worker-key";

export { generateServopaWorkerKey, hashServopaWorkerKey } from "@/lib/servopa-tables/worker-key";

export class ServopaPairingError extends Error {
  readonly code: "PAIRING_INVALID" | "WORKER_LIMIT";
  constructor(code: "PAIRING_INVALID" | "WORKER_LIMIT", message: string) {
    super(message);
    this.name = "ServopaPairingError";
    this.code = code;
  }
}

/**
 * Gera o código de uso único que vai embutido no instalador baixado. Vale por
 * 1 hora e para um computador; o banco guarda só o hash. Códigos vencidos há
 * mais de um dia são apagados aqui mesmo, sem job separado.
 */
export async function createServopaWorkerPairing(params: { organizationId: string; createdById: string }) {
  const pairing = generateServopaPairingCode(params.organizationId);
  const expiresAt = new Date(Date.now() + SERVOPA_PAIRING_TTL_MS);
  await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, params.organizationId);
    await tx.servopaWorkerPairing.deleteMany({
      where: { organizationId: params.organizationId, expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
    });
    await tx.servopaWorkerPairing.create({
      data: { organizationId: params.organizationId, createdById: params.createdById, codeHash: pairing.codeHash, expiresAt },
      select: { id: true },
    });
  });
  return { code: pairing.code, expiresAt };
}

/**
 * Troca o código do instalador pela chave própria do computador. Reinstalar no
 * mesmo computador (mesmo usuário do Windows e mesmo nome de máquina) substitui
 * a chave anterior em vez de duplicar a linha. A chave pura sai só nesta chamada.
 */
export async function redeemServopaWorkerPairing(params: { code: unknown; windowsUser?: string; computerName?: string }) {
  const parsed = parseServopaPairingCode(params.code);
  if (!parsed) throw new ServopaPairingError("PAIRING_INVALID", "Este instalador não é válido. Baixe outro no CRM.");
  const credential = generateServopaWorkerKey();
  const name = servopaWorkerName(params.windowsUser, params.computerName);

  return prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, parsed.organizationId);
    // A função do PostgreSQL retorna `void`. `$queryRaw` tenta desserializar
    // esse retorno e o adapter-pg do Prisma 7 lança P2010; `$executeRaw`
    // executa a trava sem interpretar uma linha de resultado.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${parsed.organizationId}, 20261026))`;
    const pairing = await tx.servopaWorkerPairing.findFirst({
      where: { organizationId: parsed.organizationId, codeHash: parsed.codeHash, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdById: true },
    });
    if (!pairing) {
      throw new ServopaPairingError("PAIRING_INVALID", "Este instalador expirou ou já foi usado. Baixe outro no CRM.");
    }

    const now = new Date();
    const sameComputer = { organizationId: parsed.organizationId, active: true, name: { equals: name, mode: "insensitive" as const } };
    const previousIds = (await tx.servopaWorker.findMany({ where: sameComputer, select: { id: true } })).map((worker) => worker.id);
    const replaced = await tx.servopaWorker.updateMany({
      where: sameComputer,
      data: { active: false, revokedAt: now },
    });
    const activeCount = await tx.servopaWorker.count({ where: { organizationId: parsed.organizationId, active: true } });
    if (activeCount >= MAX_SERVOPA_WORKERS) {
      throw new ServopaPairingError("WORKER_LIMIT", `Já existem ${MAX_SERVOPA_WORKERS} computadores conectados. Remova um no CRM e rode o instalador de novo.`);
    }

    const worker = await tx.servopaWorker.create({
      data: {
        organizationId: parsed.organizationId,
        createdById: pairing.createdById,
        name,
        keyPrefix: credential.keyPrefix,
        keyHash: credential.keyHash,
      },
      select: { id: true, name: true, keyPrefix: true },
    });
    await tx.servopaWorkerPairing.update({ where: { id: pairing.id }, data: { usedAt: now, workerId: worker.id }, select: { id: true } });
    if (previousIds.length) {
      // Reinstalação no mesmo computador: o pedido que esperava por ele continua sendo dele.
      await tx.servopaSyncRun.updateMany({
        where: { organizationId: parsed.organizationId, status: { in: ["PENDING", "RUNNING"] }, targetWorkerId: { in: previousIds } },
        data: { targetWorkerId: worker.id },
      });
    }
    return {
      organizationId: parsed.organizationId,
      createdById: pairing.createdById,
      worker,
      replacedPrevious: replaced.count > 0,
      fullKey: credential.fullKey,
    };
  });
}

export async function revokeServopaWorkerCredential(organizationId: string, workerId: string): Promise<boolean> {
  const result = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    const now = new Date();
    const revoked = await tx.servopaWorker.updateMany({
      where: { id: workerId, organizationId, active: true },
      data: { active: false, revokedAt: now },
    });
    if (revoked.count === 1) {
      // Pedido feito para este computador não pode ficar esperando um robô que não existe mais.
      await tx.servopaSyncRun.updateMany({
        where: { organizationId, status: { in: ["PENDING", "RUNNING"] }, targetWorkerId: workerId },
        data: {
          status: "CANCELLED",
          finishedAt: now,
          claimedAt: null,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
          leaseTokenHash: null,
          progress: Prisma.DbNull,
          errorCode: "TARGET_WORKER_REMOVED",
          error: "O computador escolhido para esta atualização foi removido do CRM.",
        },
      });
    }
    return revoked;
  });
  return result.count === 1;
}

/** Autenticação exclusiva de /api/servopa-worker/*; não concede acesso a /api/v1. */
export async function requireServopaWorker(req: Request) {
  const key = readServopaWorkerBearer(req);
  if (!key) return { ok: false as const };
  const keyHash = hashServopaWorkerKey(key);
  const worker = await runWithServopaWorkerLookup(keyHash, () =>
    prisma.servopaWorker.findUnique({
      where: { keyHash },
      select: { id: true, organizationId: true, active: true, revokedAt: true },
    }),
  );
  if (!worker?.active || worker.revokedAt) return { ok: false as const };

  const rawVersion = req.headers.get("x-servopa-worker-version")?.trim();
  const version = rawVersion && rawVersion.length <= 50 ? rawVersion : undefined;
  await runWithServopaWorkerLookup(keyHash, () =>
    prisma.servopaWorker.update({
      where: { id: worker.id },
      data: { lastSeenAt: new Date(), ...(version ? { version } : {}) },
      select: { id: true },
    }),
  );

  return { ok: true as const, workerId: worker.id, organizationId: worker.organizationId };
}
