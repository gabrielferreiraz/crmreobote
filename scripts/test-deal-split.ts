/**
 * Testes da matemática da divisão do negócio (lib/deals/split-shares.ts) —
 * funções puras, sem banco:
 *
 *   node --experimental-strip-types --test scripts/test-deal-split.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDealShares,
  equalSplit,
  splitCentsByPercent,
  validateSplit,
  shareOfValue,
  MAX_CO_OWNERS,
} from "../lib/deals/split-shares.ts";

test("sem co-responsável, o principal fica com 100%", () => {
  assert.deepEqual(computeDealShares("A", []), [{ userId: "A", percent: 100, isPrincipal: true }]);
});

test("a parte do principal é o que sobra e a soma é sempre 100", () => {
  const shares = computeDealShares("A", [
    { userId: "B", sharePercent: 30 },
    { userId: "C", sharePercent: 25 },
  ]);
  assert.deepEqual(shares.map((s) => s.percent), [45, 30, 25]);
  assert.equal(shares.reduce((a, s) => a + s.percent, 0), 100);
  assert.equal(shares[0].isPrincipal, true);
});

test("divisão igual: 2 pessoas = 50/50, 3 = 34/33/33, 4 = 25 cada", () => {
  assert.deepEqual(equalSplit(2), { principal: 50, coOwner: 50 });
  assert.deepEqual(equalSplit(3), { principal: 34, coOwner: 33 });
  assert.deepEqual(equalSplit(4), { principal: 25, coOwner: 25 });
  assert.deepEqual(equalSplit(1), { principal: 100, coOwner: 100 });
});

test("validação: aceita divisões corretas", () => {
  assert.deepEqual(validateSplit("A", []), { ok: true });
  assert.deepEqual(validateSplit("A", [{ userId: "B", sharePercent: 50 }]), { ok: true });
  assert.deepEqual(validateSplit("A", [{ userId: "B", sharePercent: 99 }]), { ok: true });
});

test("validação: recusa o que quebraria a divisão", () => {
  const bad = (participants: { userId: string; sharePercent: number }[]) => validateSplit("A", participants).ok;
  assert.equal(bad([{ userId: "A", sharePercent: 50 }]), false, "principal não pode ser co-responsável");
  assert.equal(bad([{ userId: "B", sharePercent: 0 }]), false, "0% não vale");
  assert.equal(bad([{ userId: "B", sharePercent: 100 }]), false, "100% deixaria o principal com 0");
  assert.equal(bad([{ userId: "B", sharePercent: 33.5 }]), false, "só número inteiro");
  assert.equal(bad([{ userId: "B", sharePercent: Number.NaN }]), false);
  assert.equal(bad([{ userId: "B", sharePercent: 60 }, { userId: "C", sharePercent: 40 }]), false, "soma 100 tira tudo do principal");
  assert.equal(bad([{ userId: "B", sharePercent: 10 }, { userId: "B", sharePercent: 10 }]), false, "pessoa repetida");
  assert.equal(bad([{ userId: "", sharePercent: 10 }]), false);
  const many = Array.from({ length: MAX_CO_OWNERS + 1 }, (_, i) => ({ userId: `U${i}`, sharePercent: 1 }));
  assert.equal(bad(many), false, "passou do máximo de co-responsáveis");
});

test("repartir centavos: a soma bate sempre com o total", () => {
  for (const total of [0, 1, 2, 3, 99, 100, 101, 12345, 99999]) {
    for (const percents of [[50, 50], [34, 33, 33], [45, 30, 25], [1, 99], [70, 20, 10]]) {
      const parts = splitCentsByPercent(total, percents.map((percent) => ({ percent })));
      assert.equal(parts.reduce((a, b) => a + b, 0), total, `total ${total} / ${percents.join("-")}`);
      assert.ok(parts.every((p) => p >= 0 && Number.isInteger(p)));
    }
  }
});

test("repartir centavos: 50/50 de valor ímpar dá o centavo extra ao principal (1º da lista)", () => {
  assert.deepEqual(splitCentsByPercent(101, [{ percent: 50 }, { percent: 50 }]), [51, 50]);
});

test("parte do valor em reais", () => {
  assert.equal(shareOfValue(10000, 50), 5000);
  assert.equal(shareOfValue(333.33, 34), 113.33);
});
