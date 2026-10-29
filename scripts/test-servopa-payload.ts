/** Valida o contrato de upload usando a fotografia real salva do painel. */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  buildServopaSnapshot,
  servopaSnapshotPayloadSchema,
  ServopaSnapshotPayloadError,
  type ServopaSnapshotPayload,
} from "../lib/servopa-tables/snapshot-payload.ts";
import { validateServopaSnapshot } from "../lib/servopa-tables/snapshot-validation.ts";
import type { ScrapedGroup, ScrapedListRow } from "../lib/servopa-tables/types.ts";

const FIXTURES = "worker/.probe/fast";

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function realPayload(): ServopaSnapshotPayload {
  const lists = readJson<Record<string, ScrapedListRow[]>>(path.join(FIXTURES, "_listas.json"));
  const files = readdirSync(FIXTURES).filter((file) => /^\d+-S\.json$/.test(file)).sort();
  return servopaSnapshotPayloadSchema.parse({
    runId: "run-real",
    leaseToken: "x".repeat(43),
    complete: true,
    lists: [
      { segment: "REAL_ESTATE", httpStatus: 200, cloudflareBlocked: false, rows: lists.IS },
      { segment: "MOVABLE", httpStatus: 200, cloudflareBlocked: false, rows: lists.MS },
    ],
    pages: files.map((file) => ({
      number: file.replace(/-S\.json$/, ""),
      httpStatus: 200,
      cloudflareBlocked: false,
      group: readJson<ScrapedGroup>(path.join(FIXTURES, file)),
    })),
  });
}

test("payload real cabe no contrato e produz somente grupos com vagas", () => {
  const parsed = servopaSnapshotPayloadSchema.parse(realPayload());
  const snapshot = buildServopaSnapshot(parsed);
  const available = validateServopaSnapshot({ groups: snapshot.groups, complete: true, evidence: snapshot.evidence });
  assert.equal(snapshot.groups.length, 146);
  assert.equal(available.length, 108);
  assert.equal(available.reduce((total, group) => total + group.tables.length, 0), 325);
});

test("página interrompida de grupo disponível não pode virar coleta completa", () => {
  const payload = realPayload();
  const firstAvailable = payload.lists.flatMap((list) => list.rows).find((row) => Number(row.vagas) > 0);
  assert.ok(firstAvailable);
  const page = payload.pages.find((item) => item.number === firstAvailable.grupo);
  assert.ok(page);
  page.httpStatus = 502;
  page.cloudflareBlocked = true;
  page.group = null;
  const snapshot = buildServopaSnapshot(payload);
  assert.throws(
    () => validateServopaSnapshot({ groups: snapshot.groups, complete: true, evidence: snapshot.evidence }),
    new RegExp(`grupo ${firstAvailable.grupo} não foi carregada corretamente`),
  );
});

test("número e segmento divergentes são recusados", () => {
  const payload = realPayload();
  const page = payload.pages[0];
  assert.ok(page.group);
  page.group.grupo = "999999";
  assert.throws(() => buildServopaSnapshot(payload), ServopaSnapshotPayloadError);

  const wrongSegment = realPayload();
  wrongSegment.lists[0].rows[0].segmento = "M";
  assert.throws(() => buildServopaSnapshot(wrongSegment), /segmento incorreta/);
});

test("contrato não aceita coleta parcial nem organizationId enviado pelo worker", () => {
  const partial = { ...realPayload(), complete: false };
  assert.equal(servopaSnapshotPayloadSchema.safeParse(partial).success, false);
  const withTenant = { ...realPayload(), organizationId: "outra-organizacao" };
  assert.equal(servopaSnapshotPayloadSchema.safeParse(withTenant).success, false);
});
