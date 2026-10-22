/**
 * Central de Leads ligada por padrão, com a variável só como freio de emergência
 * (lib/whatsapp/central-config.ts) — puro, sem banco:
 *
 *   npx tsx --test scripts/test-central-config.ts
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";

const original = process.env.CENTRAL_LEADS_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.CENTRAL_LEADS_ENABLED;
  else process.env.CENTRAL_LEADS_ENABLED = original;
});

test("sem a variável, a Central está LIGADA (não depende de .env nenhum)", () => {
  delete process.env.CENTRAL_LEADS_ENABLED;
  assert.equal(centralLeadsEnabled(), true);
});

test("só 'false' (qualquer caixa, com espaços) aciona o freio de emergência", () => {
  for (const value of ["false", "FALSE", "False", "  false  "]) {
    process.env.CENTRAL_LEADS_ENABLED = value;
    assert.equal(centralLeadsEnabled(), false, `"${value}"`);
  }
});

test("qualquer outro valor deixa ligada — inclusive o 'true' que antes era obrigatório", () => {
  for (const value of ["true", "TRUE", "1", "", "   ", "sim"]) {
    process.env.CENTRAL_LEADS_ENABLED = value;
    assert.equal(centralLeadsEnabled(), true, `"${value}"`);
  }
});
