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
  SERVOPA_MACHINE_ERROR_CODES,
  SERVOPA_MAX_ATTEMPTS,
  servopaCancelledError,
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

// Caso real (27/10/2026): o Firefox de um PC travou e a coleta esperou 15 min com outro PC online.
test("falha do proprio computador: outro computador assume na hora, o que falhou espera", () => {
  assert.deepEqual([...SERVOPA_MACHINE_ERROR_CODES], ["BROWSER_START_FAILED"]);
  const source = readFileSync("lib/servopa-tables/queue.ts", "utf8");
  const claim = source.slice(source.indexOf("export async function claimNextServopaSync"), source.indexOf("export async function heartbeatServopaSync"));
  assert.match(claim, /"nextAttemptAt" <= \$\{now\}\s*OR \(\s*"targetWorkerId" IS NULL\s*AND "errorCode" IN \(\$\{Prisma\.join\(\[\.\.\.SERVOPA_MACHINE_ERROR_CODES\]\)\}\)/);
  assert.match(claim, /"claimedByWorkerId" <> \$\{workerId \?\? ""\}/);
  // A falha precisa manter quem falhou; senão o próprio computador quebrado pegaria de novo na hora.
  const fail = source.slice(source.indexOf("export async function failServopaSync"));
  assert.doesNotMatch(fail, /claimedByWorkerId/);
});

// Pedido do usuário (27/10/2026): "Rodar robô agora" roda no robô do PC de quem clicou.
test("pedido manual vai so para o computador de quem clicou", () => {
  const queue = readFileSync("lib/servopa-tables/queue.ts", "utf8");
  const claim = queue.slice(queue.indexOf("export async function claimNextServopaSync"), queue.indexOf("export async function heartbeatServopaSync"));
  assert.match(claim, /AND \("targetWorkerId" IS NULL OR "targetWorkerId" = \$\{workerId \?\? ""\}\)/);
  assert.match(queue, /targetWorkerId: params\.targetWorkerId \?\? null/);

  const route = readFileSync("app/api/servopa-tables/operations/route.ts", "utf8");
  assert.match(route, /z\.object\(\{ workerId: z\.string\(\)\.min\(1\)\.max\(64\) \}\)\.strict\(\)/);
  assert.match(route, /targetWorkerId: target\.id/);
  assert.match(route, /code: "WORKER_OFFLINE"/);
  assert.match(route, /code: "WORKER_NOT_FOUND"/);

  const migration = readFileSync("prisma/migrations/20261027120000_servopa_run_target_worker/migration.sql", "utf8");
  assert.match(migration, /ADD COLUMN "targetWorkerId" TEXT;/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /DROP|NOT NULL|UPDATE "/, "migração só adiciona");

  // Computador removido: o pedido feito para ele é cancelado, não fica esperando para sempre.
  const auth = readFileSync("lib/servopa-tables/worker-auth.ts", "utf8");
  assert.match(auth, /targetWorkerId: workerId \},\s*data: \{\s*status: "CANCELLED"/);
  assert.match(auth, /errorCode: "TARGET_WORKER_REMOVED"/);

  // A tela lembra o robô deste computador (instalação ou primeira escolha) e nunca roda sem destino.
  const screen = readFileSync("app/(dashboard)/tabelas/servopa-operations.tsx", "utf8");
  assert.match(screen, /THIS_COMPUTER_KEY = "servopa-this-computer"/);
  assert.match(screen, /json: \{ workerId: target\.id \}/);
  assert.match(screen, /if \(!target\) \{\s*setPickerOpen\(true\);/);
  assert.match(screen, /if \(newWorkerId && newWorkerName\) writeSavedComputer/);
});

test("cancelar depois de uma falha mantem o motivo no historico", () => {
  assert.equal(
    servopaCancelledError({ errorCode: "BROWSER_START_FAILED", error: "O navegador do robo (Firefox) nao abriu neste computador." }),
    "Última falha antes do cancelamento: O navegador do robo (Firefox) nao abriu neste computador.",
  );
  assert.equal(servopaCancelledError({ errorCode: null, error: null }), null);
  assert.equal(servopaCancelledError({ errorCode: "CANCELLED_BY_USER", error: "x" }), null);
  assert.match(readFileSync("lib/servopa-tables/queue.ts", "utf8"), /error: servopaCancelledError\(active\)/);
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
