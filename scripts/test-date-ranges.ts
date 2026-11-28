/**
 * Atalhos de período e nome automático do negócio seguem o calendário de
 * Campo Grande (UTC-4), nunca o fuso da máquina. O servidor roda em UTC: das
 * 20h à meia-noite de MS ele já está no dia seguinte.
 *
 * Rodar: npx tsx --test scripts/test-date-ranges.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { buildListQuickRanges, buildQuickRanges } from "@/lib/date-ranges";
import { buildDealName } from "@/lib/deal-name";

function at(iso: string, fn: () => void) {
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
  try {
    fn();
  } finally {
    mock.timers.reset();
  }
}

const range = (key: string) => buildQuickRanges().find((q) => q.key === key)!.range();
const listRange = (key: string) => buildListQuickRanges().find((q) => q.key === key)!.range();

test("30/11 às 22h em MS (01/12 02:00 UTC): 'Este mês' ainda é novembro", () => {
  at("2026-12-01T02:00:00Z", () => {
    assert.deepEqual(range("this-month"), { from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(range("last-month"), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(listRange("today"), { from: "2026-11-30", to: "2026-11-30" });
  });
});

test("31/12 às 23h em MS: 'Este ano' ainda é o ano que termina", () => {
  at("2027-01-01T03:00:00Z", () => {
    assert.deepEqual(range("this-year"), { from: "2026-01-01", to: "2026-12-31" });
    assert.deepEqual(range("this-month"), { from: "2026-12-01", to: "2026-12-31" });
  });
});

test("meses para trás atravessam o ano e respeitam fevereiro bissexto", () => {
  at("2028-04-15T15:00:00Z", () => {
    assert.deepEqual(range("2-months-ago"), { from: "2028-02-01", to: "2028-02-29" });
  });
  at("2027-01-10T15:00:00Z", () => {
    assert.deepEqual(range("3-months-ago"), { from: "2026-10-01", to: "2026-10-31" });
  });
});

test("1º do mês às 00h30 em MS já é o mês novo", () => {
  at("2026-12-01T04:30:00Z", () => {
    assert.deepEqual(range("this-month"), { from: "2026-12-01", to: "2026-12-31" });
  });
});

test("nome do negócio criado no último dia do mês à noite leva o mês certo", () => {
  at("2026-12-01T02:00:00Z", () => {
    assert.equal(buildDealName("Maria", "site"), "11/26 - Maria SITE");
  });
  at("2027-01-01T03:59:00Z", () => {
    assert.equal(buildDealName("João"), "12/26 - João");
  });
  at("2027-01-01T04:00:00Z", () => {
    assert.equal(buildDealName("João"), "01/27 - João");
  });
});
