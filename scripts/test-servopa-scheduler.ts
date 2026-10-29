import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getServopaScheduleWindow, scheduleServopaWithDependencies } from "../lib/servopa-tables/scheduler-contract.ts";

test("agendamento abre no dia 1 as 08:15 do fuso operacional", () => {
  assert.equal(getServopaScheduleWindow(new Date("2026-11-01T12:14:59.000Z")), null);
  const exact = getServopaScheduleWindow(new Date("2026-11-01T12:15:00.000Z"));
  assert.ok(exact);
  assert.equal(exact.competence, "2026-11");
  assert.equal(exact.dueAt.toISOString(), "2026-11-01T12:15:00.000Z");
  assert.equal(exact.monthEndsAt.toISOString(), "2026-12-01T04:00:00.000Z");
});

test("a janela permanece aberta no restante do dia 1 e fecha no dia 2", () => {
  assert.ok(getServopaScheduleWindow(new Date("2026-11-02T03:59:59.000Z")));
  assert.equal(getServopaScheduleWindow(new Date("2026-11-02T04:00:00.000Z")), null);
});

test("nao agenda antes do primeiro dia da competencia seguinte", () => {
  assert.equal(getServopaScheduleWindow(new Date("2026-10-26T16:00:00.000Z")), null);
});

test("cada organizacao recebe no maximo um trabalho por competencia", async () => {
  const enqueued: string[] = [];
  const result = await scheduleServopaWithDependencies(new Date("2026-11-01T12:15:00.000Z"), {
    listOrganizationIds: async () => ["org-covered", "org-new", "org-race"],
    findCoveredRun: async (organizationId) => organizationId === "org-covered",
    enqueue: async (organizationId) => {
      enqueued.push(organizationId);
      return { created: organizationId === "org-new" };
    },
  });
  assert.deepEqual(enqueued, ["org-new", "org-race"]);
  assert.deepEqual(result, { due: true, competence: "2026-11", organizations: 3, enqueued: 1, alreadyCovered: 2 });
});

test("fora da janela nao consulta organizacoes", async () => {
  let listed = false;
  const result = await scheduleServopaWithDependencies(new Date("2026-10-26T16:00:00.000Z"), {
    listOrganizationIds: async () => { listed = true; return []; },
    findCoveredRun: async () => false,
    enqueue: async () => ({ created: true }),
  });
  assert.equal(listed, false);
  assert.equal(result.due, false);
});

test("falha do agendamento Servopa nao derruba o cron compartilhado", () => {
  const source = readFileSync("app/api/cron/automations/route.ts", "utf8");
  assert.match(source, /scheduleServopaMonthlySync\(\)\.catch/);
  assert.match(source, /scheduleFailed:\s*true/);
});
