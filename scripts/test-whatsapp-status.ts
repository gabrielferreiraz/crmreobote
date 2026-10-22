/**
 * Ordem dos status de mensagem (lib/whatsapp/message-status.ts) — puro:
 *
 *   npx tsx --test scripts/test-whatsapp-status.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusesReplaceableBy, type MessageStatus } from "@/lib/whatsapp/message-status";

/** Aplica uma sequência de eventos como o webhook faria e devolve o status final. */
function apply(events: MessageStatus[], start: MessageStatus = "PENDING"): MessageStatus {
  let current = start;
  for (const next of events) if (statusesReplaceableBy(next).includes(current)) current = next;
  return current;
}

test("eventos em ordem avançam normalmente", () => {
  assert.equal(apply(["SENT", "DELIVERED", "READ"]), "READ");
});

test("evento atrasado nunca faz voltar (lida continua lida)", () => {
  assert.equal(apply(["READ", "SENT"]), "READ");
  assert.equal(apply(["READ", "DELIVERED"]), "READ");
  assert.equal(apply(["DELIVERED", "SENT"]), "DELIVERED");
});

test("falha só vale antes de ser entregue", () => {
  assert.equal(apply(["SENT", "FAILED"]), "FAILED");
  assert.equal(apply(["DELIVERED", "FAILED"]), "DELIVERED");
  assert.equal(apply(["READ", "FAILED"]), "READ");
});

test("marcada como falha que depois chegou passa a valer o status novo", () => {
  assert.equal(apply(["FAILED", "DELIVERED"]), "DELIVERED");
  assert.equal(apply(["FAILED", "READ"]), "READ");
});

test("repetir o mesmo status não muda nada", () => {
  assert.ok(!statusesReplaceableBy("READ").includes("READ"));
  assert.ok(!statusesReplaceableBy("DELIVERED").includes("DELIVERED"));
});
