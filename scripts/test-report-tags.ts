/**
 * Testes do filtro de tags dos relatórios (lib/reports/tags.ts) — puro, sem banco:
 *
 *   npx tsx --test scripts/test-report-tags.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dealTagWhere, MAX_REPORT_TAGS, normalizeReportTags } from "@/lib/reports/tags";

test("a URL traz uma `tag` por tag escolhida — valor único ou lista, tudo vira lista limpa", () => {
  assert.deepEqual(normalizeReportTags(undefined), []);
  assert.deepEqual(normalizeReportTags("Lead"), ["Lead"]);
  assert.deepEqual(normalizeReportTags(["Lead", "Cliente"]), ["Lead", "Cliente"]);
});

test("tag com espaço, barra vertical e # (tags reais da organização) passa intacta", () => {
  assert.deepEqual(normalizeReportTags(["DAXUS | IA11 #32", "Chikabum - Clientes"]), ["DAXUS | IA11 #32", "Chikabum - Clientes"]);
});

test("vazio, só espaço e repetido saem; espaço nas pontas é aparado; maiúscula conta (comparação exata)", () => {
  assert.deepEqual(normalizeReportTags(["", "  ", " Lead ", "Lead", "lead"]), ["Lead", "lead"]);
});

test("valor que não é texto é ignorado, sem derrubar a página", () => {
  assert.deepEqual(normalizeReportTags([undefined, null, "Lead"] as unknown as string[]), ["Lead"]);
});

test(`no máximo ${MAX_REPORT_TAGS} tags e cada uma com no máximo 80 caracteres`, () => {
  const many = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
  assert.equal(normalizeReportTags(many).length, MAX_REPORT_TAGS);
  assert.equal(normalizeReportTags(["x".repeat(500)])[0].length, 80);
});

test("sem tags não filtra nada; com tags, o contato precisa ter QUALQUER uma", () => {
  assert.deepEqual(dealTagWhere([]), {});
  assert.deepEqual(dealTagWhere(["Lead", "Cliente"]), { contact: { tags: { hasSome: ["Lead", "Cliente"] } } });
});
