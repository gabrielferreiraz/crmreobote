import test from "node:test";
import assert from "node:assert/strict";
import { formatDateBR, formatDateTimeBR, formatElapsed, formatTimeBR } from "@/lib/format-datetime";

test("data e hora saem no horário de Campo Grande (UTC-4), não no do servidor", () => {
  const iso = "2026-11-10T18:32:00.000Z"; // 14:32 em Campo Grande
  assert.equal(formatDateBR(iso), "10/11/2026");
  assert.equal(formatTimeBR(iso), "14:32");
  assert.equal(formatDateTimeBR(iso), "10/11/2026 às 14:32");
});

test("virada de dia respeita o fuso: 02:10 UTC ainda é o dia anterior, 22:10", () => {
  assert.equal(formatDateTimeBR("2026-11-11T02:10:00.000Z"), "10/11/2026 às 22:10");
});

test("meia-noite aparece como 00:xx, não 24:xx", () => {
  assert.equal(formatTimeBR("2026-11-10T04:05:00.000Z"), "00:05");
});

test("tempo decorrido em português curto", () => {
  assert.equal(formatElapsed(20_000), "menos de 1 min");
  assert.equal(formatElapsed(15 * 60_000), "15 min");
  assert.equal(formatElapsed((3 * 60 + 20) * 60_000), "3 h 20 min");
  assert.equal(formatElapsed(2 * 3_600_000), "2 h");
  assert.equal(formatElapsed(26 * 3_600_000), "1 dia");
  assert.equal(formatElapsed(72 * 3_600_000), "3 dias");
  assert.equal(formatElapsed(-5000), "menos de 1 min");
});
