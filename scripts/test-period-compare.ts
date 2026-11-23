/**
 * Comparação de período do relatório Comercial (lib/reports/period-compare.ts)
 * — confere, pra cada um dos 5 modos, que o período anterior resolvido é
 * EXATAMENTE o que a documentação do arquivo promete (mesma duração
 * espelhada / mês civil anterior / 3 meses civis / mesmas datas 1 ano atrás /
 * o que a pessoa escolheu à mão), com o calendário de Brasília — não UTC,
 * não o fuso da máquina que roda o teste.
 *
 *   npx tsx --test scripts/test-period-compare.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveComparePeriod } from "@/lib/reports/period-compare";
import { brazilDateStringToUTC, brazilEndOfDayUTC, brazilDateKey } from "@/lib/timezone";

/** "2026-08-01".."2026-08-31" (ambos em Brasília) → range de from/to como a
 * página de verdade monta (ver date-range-filter.tsx / compare-period-filter.tsx). */
function range(from: string, to: string) {
  return { from: brazilDateStringToUTC(from), to: brazilEndOfDayUTC(to) };
}

/** Devolve as duas pontas como "YYYY-MM-DD" (Brasília) pra comparar com `assert.deepEqual`
 * sem se preocupar com a hora exata do instante (meia-noite vs. fim-do-dia). */
function keys(period: { from: Date; to: Date } | null) {
  if (!period) return null;
  return { from: brazilDateKey(period.from), to: brazilDateKey(period.to) };
}

test("mirror: mês cheio de 31 dias (Agosto) compara com Julho inteiro (também 31 dias), imediatamente antes", () => {
  const { from, to } = range("2026-08-01", "2026-08-31");
  const result = resolveComparePeriod("mirror", from, to);
  assert.deepEqual(keys(result), { from: "2026-07-01", to: "2026-07-31" });
});

test("mirror: período custom de 10 dias compara com os 10 dias civis imediatamente anteriores", () => {
  const { from, to } = range("2026-08-20", "2026-08-29");
  const result = resolveComparePeriod("mirror", from, to);
  assert.deepEqual(keys(result), { from: "2026-08-10", to: "2026-08-19" });
});

test("mirror: um único dia compara com o dia civil imediatamente anterior", () => {
  const { from, to } = range("2026-08-15", "2026-08-15");
  const result = resolveComparePeriod("mirror", from, to);
  assert.deepEqual(keys(result), { from: "2026-08-14", to: "2026-08-14" });
});

test("month: SEMPRE o mês civil anterior inteiro, não importa a duração/posição do período atual dentro do mês", () => {
  const casesInAugust = [range("2026-08-01", "2026-08-31"), range("2026-08-20", "2026-08-25"), range("2026-08-01", "2026-08-01")];
  for (const { from, to } of casesInAugust) {
    assert.deepEqual(keys(resolveComparePeriod("month", from, to)), { from: "2026-07-01", to: "2026-07-31" });
  }
});

test("month: janeiro volta pra dezembro do ano ANTERIOR (virada de ano)", () => {
  const { from, to } = range("2026-01-10", "2026-01-20");
  assert.deepEqual(keys(resolveComparePeriod("month", from, to)), { from: "2025-12-01", to: "2025-12-31" });
});

test("last3: os 3 meses civis imediatamente antes do mês do início do período atual, como um bloco só", () => {
  const { from, to } = range("2026-08-05", "2026-08-25");
  assert.deepEqual(keys(resolveComparePeriod("last3", from, to)), { from: "2026-05-01", to: "2026-07-31" });
});

test("last3: virada de ano quando os 3 meses anteriores cruzam dezembro/janeiro", () => {
  const { from, to } = range("2026-02-01", "2026-02-10");
  assert.deepEqual(keys(resolveComparePeriod("last3", from, to)), { from: "2025-11-01", to: "2026-01-31" });
});

test("year: mesmas datas exatas, 1 ano antes", () => {
  const { from, to } = range("2026-08-01", "2026-08-31");
  assert.deepEqual(keys(resolveComparePeriod("year", from, to)), { from: "2025-08-01", to: "2025-08-31" });
});

test("year: 29/fev (2028, bissexto) sem correspondente em 2027 cai em 28/fev — nunca transborda pra 1/mar", () => {
  const { from, to } = range("2028-02-29", "2028-02-29");
  assert.deepEqual(keys(resolveComparePeriod("year", from, to)), { from: "2027-02-28", to: "2027-02-28" });
});

test("year: período atravessando 29/fev bissexto (ex.: 25/02-05/03/2028) também recua certo em cada ponta", () => {
  const { from, to } = range("2028-02-25", "2028-03-05");
  assert.deepEqual(keys(resolveComparePeriod("year", from, to)), { from: "2027-02-25", to: "2027-03-05" });
});

test("custom: usa exatamente as datas escolhidas, sem nenhuma relação com o período atual", () => {
  const { from, to } = range("2026-08-01", "2026-08-31");
  const result = resolveComparePeriod("custom", from, to, { from: "2024-01-05", to: "2024-01-09" });
  assert.deepEqual(keys(result), { from: "2024-01-05", to: "2024-01-09" });
});

test("custom: sem as duas datas, ou from depois de to, resolve pra null (nunca inventa nem inverte)", () => {
  const { from, to } = range("2026-08-01", "2026-08-31");
  assert.equal(resolveComparePeriod("custom", from, to, { from: "2024-01-05", to: undefined }), null);
  assert.equal(resolveComparePeriod("custom", from, to, {}), null);
  assert.equal(resolveComparePeriod("custom", from, to, { from: "2024-01-10", to: "2024-01-05" }), null);
});

test("rangeLabel: mesmo ano mostra o ano só no fim (01/07 – 31/07/2026)", () => {
  const { from, to } = range("2026-08-01", "2026-08-31");
  const result = resolveComparePeriod("mirror", from, to)!;
  assert.equal(result.rangeLabel, "01/07 – 31/07/2026");
});

test("rangeLabel: virada de ano mostra o ano nas duas pontas (01/12/2025 – 31/01/2026)", () => {
  const { from, to } = range("2026-02-01", "2026-02-28");
  const result = resolveComparePeriod("last3", from, to)!;
  assert.equal(result.rangeLabel, "01/11/2025 – 31/01/2026");
});

test("rangeLabel: um único dia mostra só uma data, sem travessão repetido", () => {
  const { from, to } = range("2026-08-15", "2026-08-15");
  const result = resolveComparePeriod("mirror", from, to)!;
  assert.equal(result.rangeLabel, "14/08/2026");
});
