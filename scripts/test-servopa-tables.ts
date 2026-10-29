/**
 * Testes do núcleo das tabelas Servopa (lib/servopa-tables/) — funções puras,
 * sem banco:
 *
 *   node --experimental-strip-types --test scripts/test-servopa-tables.ts
 *
 * Os testes "com dados reais" rodam sobre a coleta salva em
 * worker/.probe/fast (gitignored); sem a pasta, eles são pulados.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseAssembly, parseCount, parseMoney, parsePercent, normalizeGroup, ServopaParseError } from "../lib/servopa-tables/parse.ts";
import { applyAdjustment, computeRow, effectiveAdmRate, fromUnits, toUnits, type PricedRow } from "../lib/servopa-tables/adjust.ts";
import {
  assertServopaReductionIsSafe,
  ServopaSnapshotValidationError,
  validateServopaSnapshot,
  type ServopaSnapshotEvidence,
} from "../lib/servopa-tables/snapshot-validation.ts";
import type { NormalizedGroup, ScrapedGroup } from "../lib/servopa-tables/types.ts";

const FIXTURES = "worker/.probe/fast";
const hasFixtures = existsSync(FIXTURES);

test("parseMoney / parsePercent / parseCount", () => {
  assert.equal(parseMoney("R$ 1.075,69"), "1075.69");
  assert.equal(parseMoney("R$ 113.734,00"), "113734.00");
  assert.equal(parseMoney("R$ 338,5"), "338.50");
  assert.throws(() => parseMoney("abc"), ServopaParseError);
  assert.equal(parsePercent("13,00%"), "13.0000");
  assert.equal(parsePercent("0,9458%"), "0.9458");
  assert.equal(parsePercent("36,8333%"), "36.8333");
  assert.equal(parseCount("5.040"), 5040);
  assert.throws(() => parseCount("12x"), ServopaParseError);
});

test("parseAssembly usa horário de Brasília", () => {
  const a = parseAssembly("012 - 23/11/2026 - 16:00 HORAS");
  assert.equal(a?.number, "012");
  assert.equal(a?.at.toISOString(), "2026-11-23T19:00:00.000Z");
  assert.equal(parseAssembly("sem data"), null);
});

test("toUnits / fromUnits", () => {
  assert.equal(toUnits("13.0000", 4), 130000);
  assert.equal(toUnits("-1.5", 4), -15000);
  assert.equal(fromUnits(107569, 2), "1075.69");
  assert.equal(fromUnits(5, 2), "0.05");
  assert.equal(fromUnits(-15000, 4), "-1.5000");
});

test("taxa efetiva: desconto, acréscimo e piso em zero", () => {
  assert.equal(effectiveAdmRate("10.0000", "-1.5000"), "8.5000");
  assert.equal(effectiveAdmRate("10.0000", "0.7500"), "10.7500");
  assert.throws(() => effectiveAdmRate("1.0000", "-2.0000"));
});

const a1 = {
  category: "A1",
  description: "CREDITO P/IMOVEL 7",
  creditValue: "113734.00",
  termMonths: 120,
  monthlyPercent: "0.9458",
  installment: "1075.69",
  insurance: "51.64",
  observation: "SEGURO NA CONTEMPLAÇÃO",
  total: "1127.33",
};

test("grupo 1568 categoria A1: a regra reproduz exatamente o que o site publica", () => {
  const r = computeRow(a1, "13.0000", "0.5000");
  assert.equal(r.monthlyPercent, "0.9458");
  assert.equal(r.installment, "1075.69");
  assert.equal(r.total, "1127.33");
});

test("ajuste 0 devolve as linhas do site, sem recalcular", () => {
  const out = applyAdjustment({ admRatePercent: "13.0000", adjustmentPoints: "0.0000", termMonths: 120, reserveFundPercent: "0.5000" }, [a1]);
  assert.equal(out.rows[0], a1);
  assert.equal(out.admRatePercent, "13.0000");
});

test("desconto de 1,5 p.p. recalcula só mensal, parcela e total (seguro intacto)", () => {
  const out = applyAdjustment({ admRatePercent: "13.0000", adjustmentPoints: "-1.5000", termMonths: 120, reserveFundPercent: "0.5000" }, [a1]);
  // (1 + 11,5% + 0,5%)/120 = 0,9333…% → 0,9333%; 113.734,00 × 0,9333% = 1.061,47 (centavos truncados)
  assert.equal(out.admRatePercent, "11.5000");
  assert.equal(out.rows[0].monthlyPercent, "0.9333");
  assert.equal(out.rows[0].installment, "1061.47");
  assert.equal(out.rows[0].insurance, "51.64");
  assert.equal(out.rows[0].total, "1113.11");
});

test("ajuste sem fundo de reserva conhecido não chuta", () => {
  assert.throws(() => applyAdjustment({ admRatePercent: "13.0000", adjustmentPoints: "-1.0000", termMonths: 120, reserveFundPercent: null }, [a1]));
});

test("coleta real: a regra reproduz TODAS as linhas publicadas pela Servopa", { skip: !hasFixtures }, () => {
  let rows = 0;
  for (const f of readdirSync(FIXTURES).filter((x) => /^\d+-S\.json$/.test(x))) {
    const g: NormalizedGroup = normalizeGroup(JSON.parse(readFileSync(`${FIXTURES}/${f}`, "utf8")) as ScrapedGroup);
    assert.ok(g.reserveFundPercent, `${g.number}: sem fundo de reserva`);
    for (const t of g.tables) {
      for (const r of t.rows) {
        const calc: PricedRow = computeRow<PricedRow>(r, t.admRatePercent, g.reserveFundPercent);
        assert.equal(calc.monthlyPercent, r.monthlyPercent, `${g.number} ${r.category} % mensal`);
        assert.equal(calc.installment, r.installment, `${g.number} ${r.category} parcela`);
        assert.equal(calc.total, r.total, `${g.number} ${r.category} total`);
        rows++;
      }
    }
  }
  assert.ok(rows > 2000);
});

test("normalizeGroup recusa o que não entende em vez de gravar lixo", () => {
  const base: ScrapedGroup = { grupo: "1", segmento: "I", titulo: "", preMessage: "", info: {}, tabs: [] };
  assert.throws(() => normalizeGroup(base), /sem nenhuma tabela/);
  assert.throws(() => normalizeGroup({ ...base, segmento: "X", tabs: [{ aba: "Taxa de Adm - 9,90%", cabecalho: [], linhas: [] }] }), /segmento desconhecido/);
  assert.throws(() => normalizeGroup({ ...base, tabs: [{ aba: "outra coisa", cabecalho: [], linhas: [["A1"]] }] }), /sem taxa de ADM/);
});

function snapshotGroup(number: string, segment: NormalizedGroup["segment"], vacancies: number | null): NormalizedGroup {
  return {
    number,
    segment,
    totalMonths: 120,
    vacancies,
    dueDay: 10,
    nextAssemblyNumber: null,
    nextAssemblyAt: null,
    reserveFundPercent: "0.5000",
    insuranceRatePercent: null,
    insuranceType: null,
    groupType: null,
    drawType: null,
    embeddedBidMaxPercent: null,
    membersCount: null,
    contemplationText: "",
    rawInfo: {},
    contentHash: `group-${number}`,
    tables: [
      {
        admRatePercent: "10.0000",
        termMonths: 120,
        contentHash: `table-${number}`,
        rows: [{ ...a1, position: 0 }],
      },
    ],
  };
}

function completeEvidence(): ServopaSnapshotEvidence {
  return {
    lists: [
      { segment: "REAL_ESTATE", httpStatus: 200, cloudflareBlocked: false, groups: [{ number: "100", vacancies: 3 }] },
      { segment: "MOVABLE", httpStatus: 200, cloudflareBlocked: false, groups: [{ number: "200", vacancies: 0 }] },
    ],
    pages: [
      { number: "100", httpStatus: 200, cloudflareBlocked: false },
      { number: "200", httpStatus: 200, cloudflareBlocked: false },
    ],
  };
}

test("snapshot completo só mantém grupos com vagas quando possui todas as evidências", () => {
  const available = validateServopaSnapshot({
    groups: [snapshotGroup("100", "REAL_ESTATE", 3), snapshotGroup("200", "MOVABLE", 0)],
    complete: true,
    evidence: completeEvidence(),
  });
  assert.deepEqual(available.map((group) => group.number), ["100"]);
});

test("snapshot completo recusa falta de evidência e página interrompida", () => {
  const groups = [snapshotGroup("100", "REAL_ESTATE", 3), snapshotGroup("200", "MOVABLE", 0)];
  assert.throws(() => validateServopaSnapshot({ groups, complete: true }), ServopaSnapshotValidationError);

  const evidence = completeEvidence();
  evidence.pages[0] = { number: "100", httpStatus: 503, cloudflareBlocked: true };
  assert.throws(() => validateServopaSnapshot({ groups, complete: true, evidence }), /grupo 100 não foi carregada corretamente/);
});

test("snapshot recusa vagas ausentes e tabelas vazias também em coleta parcial", () => {
  assert.throws(
    () => validateServopaSnapshot({ groups: [snapshotGroup("100", "REAL_ESTATE", null)], complete: false }),
    /sem uma quantidade de vagas válida/,
  );
  const group = snapshotGroup("100", "REAL_ESTATE", 1);
  group.tables[0].rows = [];
  assert.throws(() => validateServopaSnapshot({ groups: [group], complete: false }), /tabela vazia/);
});

test("redução anormal bloqueia a coleta antes da exclusão", () => {
  const existing = Array.from({ length: 25 }, (_, index) => ({
    number: String(100 + index),
    vacancies: 1,
    active: true,
    tables: [{ active: true }, { active: true }],
  }));
  const incoming = existing.slice(0, 19).map((group) => snapshotGroup(group.number, "REAL_ESTATE", 1));
  assert.throws(() => assertServopaReductionIsSafe(existing, incoming), /6 de 25 grupos disponíveis desapareceram/);
  const safeIncoming = existing.slice(0, 20).map((group) => {
    const snapshot = snapshotGroup(group.number, "REAL_ESTATE", 1);
    snapshot.tables.push({ ...snapshot.tables[0], admRatePercent: "12.0000", contentHash: `table-12-${group.number}` });
    return snapshot;
  });
  assert.doesNotThrow(() => assertServopaReductionIsSafe(existing, safeIncoming));
});
