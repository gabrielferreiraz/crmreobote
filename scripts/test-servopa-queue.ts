/**
 * Contratos de segurança da fila Servopa:
 *
 *   node --experimental-strip-types --test scripts/test-servopa-queue.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  hashServopaLeaseToken,
  planServopaFailure,
  SERVOPA_MAX_ATTEMPTS,
  ServopaQueueError,
  validateServopaSyncProgress,
} from "../lib/servopa-tables/queue-contract.ts";

test("token de lease fica representado somente por SHA-256", () => {
  const token = "token-secreto-do-worker";
  const hash = hashServopaLeaseToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hash, hashServopaLeaseToken(token));
  assert.notEqual(hash, hashServopaLeaseToken(`${token}-outro`));
});

test("progresso aceita apenas contadores coerentes e mensagem curta", () => {
  assert.deepEqual(
    validateServopaSyncProgress({ phase: "FETCHING_GROUPS", completed: 10, total: 146, message: "  Grupo 1511  " }),
    { phase: "FETCHING_GROUPS", completed: 10, total: 146, message: "Grupo 1511" },
  );

  for (const progress of [
    { phase: "FETCHING_GROUPS", completed: 147, total: 146 },
    { phase: "FETCHING_GROUPS", completed: -1, total: 146 },
    { phase: "INVALID", completed: 1, total: 1 },
    { phase: "STARTING", completed: 0.5, total: 1 },
    { phase: "STARTING", completed: 0, total: 1, message: "x".repeat(241) },
  ]) {
    assert.throws(
      () => validateServopaSyncProgress(progress as Parameters<typeof validateServopaSyncProgress>[0]),
      (error: unknown) => error instanceof ServopaQueueError && error.code === "INVALID_PROGRESS",
    );
  }
});

test("migration impede dois jobs ativos por organização", () => {
  const sql = readFileSync("prisma/migrations/20261026120000_servopa_sync_queue/migration.sql", "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX "ServopaSyncRun_one_active_per_org_key"/);
  assert.match(sql, /WHERE "status" IN \('PENDING', 'RUNNING'\)/);
});

test("cancelamento possui estado terminal e invalida a execucao sem reagendar", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20261026140000_servopa_sync_cancelled/migration.sql", "utf8");
  const queue = readFileSync("lib/servopa-tables/queue.ts", "utf8");
  const syncEngine = readFileSync("lib/servopa-tables/sync-engine.ts", "utf8");

  assert.match(schema, /enum ServopaSyncStatus\s*{[\s\S]*?CANCELLED/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'CANCELLED'/);
  assert.match(queue, /status: "CANCELLED"/);
  assert.match(queue, /errorCode: "CANCELLED_BY_USER"/);
  assert.match(queue, /leaseTokenHash: null/);
  assert.match(syncEngine, /status: "RUNNING"/);
  assert.match(syncEngine, /ServopaSyncInterruptedError/);
});

test("claim usa bloqueio concorrente e nunca devolve o hash como token", () => {
  const source = readFileSync("lib/servopa-tables/queue.ts", "utf8");
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /"attempts" = run\."attempts" \+ 1/);
  assert.match(source, /leaseTokenHash = hashServopaLeaseToken\(leaseToken\)/);
  assert.doesNotMatch(source, /leaseTokenHash:\s*leaseToken\b/);
  assert.match(source, /leaseTokenHash: hashServopaLeaseToken\(uploadLeaseToken\)/);
});

test("falha temporaria repete ate oito tentativas e depois para", () => {
  const retryAt = new Date("2026-10-26T14:15:00.000Z");
  const retry = planServopaFailure({
    attempts: SERVOPA_MAX_ATTEMPTS - 1,
    retryAt,
    code: "CLOUDFLARE_BLOCKED",
    message: "Cloudflare bloqueou",
  });
  assert.equal(retry.status, "PENDING");
  assert.equal(retry.retryAt, retryAt);
  assert.equal(retry.exhausted, false);

  const stopped = planServopaFailure({
    attempts: SERVOPA_MAX_ATTEMPTS,
    retryAt,
    code: "CLOUDFLARE_BLOCKED",
    message: "Cloudflare bloqueou",
  });
  assert.equal(stopped.status, "FAILED");
  assert.equal(stopped.retryAt, null);
  assert.equal(stopped.errorCode, "RETRY_LIMIT_REACHED");
  assert.equal(stopped.exhausted, true);
});

test("falha definitiva nao e reagendada nem na primeira tentativa", () => {
  const stopped = planServopaFailure({
    attempts: 1,
    code: "SERVOPA_AUTH_FAILED",
    message: "Credenciais recusadas",
  });
  assert.equal(stopped.status, "FAILED");
  assert.equal(stopped.retryAt, null);
  assert.equal(stopped.errorCode, "SERVOPA_AUTH_FAILED");
  assert.equal(stopped.exhausted, false);
});
