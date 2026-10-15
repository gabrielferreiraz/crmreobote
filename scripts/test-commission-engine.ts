/**
 * Testes do núcleo de comissões (lib/commissions/engine.ts) — funções puras,
 * sem banco:
 *
 *   npx tsx --test scripts/test-commission-engine.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  buildRevenueSchedule,
  buildSaleSchedule,
  firstPaymentMonth,
  pickRule,
  revenueConfigError,
  saleReferenceMonth,
  splitByWeights,
  splitCents,
  type AdministratorLike,
  type RuleLike,
  type SaleLike,
} from "@/lib/commissions/engine";
import { exampleSplit } from "@/lib/commissions/describe";

/** Instante no horário de Campo Grande (UTC-4). */
const cg = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h + 4));

const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: Math.random().toString(36).slice(2),
  beneficiaryRole: "SELLER",
  userId: null,
  administratorId: null,
  modality: null,
  creditType: null,
  base: "NET",
  percent: 1,
  active: true,
  updatedAt: new Date(2026, 0, 1),
  ...over,
});

const adm = (over: Partial<AdministratorLike> = {}): AdministratorLike => ({
  id: "adm1",
  commissionInstallments: 1,
  graceMonths: 1,
  cutoffDay: null,
  paysSellerDirectly: false,
  revenueMode: null,
  revenueTotalPercent: null,
  revenuePercents: null,
  revenueBase: "NET",
  ...over,
});

const sale = (over: Partial<SaleLike> = {}): SaleLike => ({
  sellerId: "seller",
  supervisorId: null,
  managerId: null,
  administratorId: "adm1",
  modality: "FULL",
  creditType: null,
  saleDate: cg(2026, 10, 15),
  netValue: 100_000,
  grossValue: 120_000,
  clientInstallment: null,
  ...over,
});

const sumCents = (list: { amountCents: number }[]) => list.reduce((a, i) => a + i.amountCents, 0);

test("addMonths atravessa o ano", () => {
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 0), "2026-12");
});

test("mês da venda respeita o fuso de Campo Grande", () => {
  // 31/10 às 23h em Campo Grande já é 01/11 em UTC — continua sendo outubro.
  assert.equal(saleReferenceMonth(cg(2026, 10, 31, 23), null), "2026-10");
});

test("dia de corte empurra a venda pro mês seguinte", () => {
  assert.equal(saleReferenceMonth(cg(2026, 10, 25), 25), "2026-10");
  assert.equal(saleReferenceMonth(cg(2026, 10, 26), 25), "2026-11");
  assert.equal(saleReferenceMonth(cg(2026, 12, 28), 20), "2027-01");
});

test("carência conta a partir do mês da venda", () => {
  assert.equal(firstPaymentMonth(cg(2026, 10, 15), null, 0), "2026-10");
  assert.equal(firstPaymentMonth(cg(2026, 10, 15), null, 2), "2026-12");
  assert.equal(firstPaymentMonth(cg(2026, 10, 26), 25, 1), "2026-12");
});

test("parcelas somam exatamente o total (sobra na última)", () => {
  const parts = splitCents(100_00, 3);
  assert.deepEqual(parts, [3333, 3333, 3334]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100_00);

  const weighted = splitByWeights(99_99, [3, 1, 1]);
  assert.equal(weighted.reduce((a, b) => a + b, 0), 99_99);
  assert.deepEqual(weighted.slice(0, 2), [5999, 1999]);
  assert.deepEqual(splitByWeights(10_00, [0, 0]), [500, 500]);
});

test("cadastro do que a administradora paga: nada de 'somar 100'", () => {
  assert.equal(revenueConfigError(null, 10, null, null), null);
  assert.equal(revenueConfigError("CREDIT_EQUAL", 10, 5, null), null);
  assert.match(revenueConfigError("CREDIT_EQUAL", 10, null, null) ?? "", /no total/);
  assert.equal(revenueConfigError("CREDIT_TABLE", 3, null, [1.5, 0.5, 0.5]), null);
  assert.match(revenueConfigError("CREDIT_TABLE", 4, null, [1.5, 0.5, 0.5]) ?? "", /4 parcelas/);
  assert.match(revenueConfigError("CREDIT_TABLE", 2, null, [0, 0]) ?? "", /Pelo menos uma/);
  assert.equal(revenueConfigError("CLIENT_INSTALLMENT_TABLE", 2, null, [100, 50]), null);
});

test("regra mais específica vence; pessoa vale mais que administradora", () => {
  const generic = rule({ percent: 1 });
  const byAdm = rule({ administratorId: "adm1", percent: 1.2 });
  const byPerson = rule({ userId: "seller", percent: 1.5 });
  const ctx = { role: "SELLER" as const, userId: "seller", administratorId: "adm1", modality: "FULL" as const, creditType: null };
  assert.equal(pickRule([generic, byAdm], ctx)?.percent, 1.2);
  assert.equal(pickRule([generic, byAdm, byPerson], ctx)?.percent, 1.5);
  assert.equal(pickRule([generic, byAdm], { ...ctx, userId: "other", administratorId: "adm2" })?.percent, 1);
});

test("regra inativa, de outro papel ou de outra modalidade não serve", () => {
  const ctx = { role: "SELLER" as const, userId: "seller", administratorId: "adm1", modality: "FULL" as const, creditType: null };
  assert.equal(pickRule([rule({ active: false })], ctx), null);
  assert.equal(pickRule([rule({ beneficiaryRole: "SUPERVISOR" })], ctx), null);
  assert.equal(pickRule([rule({ modality: "REDUCED" })], ctx), null);
  assert.equal(pickRule([rule({ creditType: "Imóvel" })], { ...ctx, creditType: "imóvel " })?.creditType, "Imóvel");
});

test("empate de especificidade: a editada por último vence", () => {
  const ctx = { role: "SELLER" as const, userId: "seller", administratorId: "adm1", modality: "FULL" as const, creditType: null };
  const old = rule({ administratorId: "adm1", percent: 1, updatedAt: new Date(2026, 0, 1) });
  const recent = rule({ administratorId: "adm1", percent: 2, updatedAt: new Date(2026, 5, 1) });
  assert.equal(pickRule([old, recent], ctx)?.percent, 2);
});

test("cronograma: 1% de 100 mil em 4x iguais (administradora sem receita informada)", () => {
  const { installments, problems, revenue, revenueProblem } = buildSaleSchedule(sale(), adm({ commissionInstallments: 4 }), [rule({ percent: 1 })]);
  assert.deepEqual(problems, []);
  assert.equal(installments.length, 4);
  assert.deepEqual(installments.map((i) => i.paymentMonth), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.equal(sumCents(installments), 1000_00);
  assert.deepEqual(installments.map((i) => i.amountCents), [250_00, 250_00, 250_00, 250_00]);
  assert.deepEqual(revenue, []);
  assert.equal(revenueProblem, "NO_CONFIG");
});

test("base bruta usa o valor bruto", () => {
  const { installments } = buildSaleSchedule(sale(), adm(), [rule({ percent: 1, base: "GROSS" })]);
  assert.equal(installments[0].amountCents, 1200_00);
});

test("o que a corretora recebe: % do crédito em partes iguais", () => {
  const { installments, problem } = buildRevenueSchedule(sale(), adm({ commissionInstallments: 10, revenueMode: "CREDIT_EQUAL", revenueTotalPercent: 5 }));
  assert.equal(problem, null);
  assert.equal(installments.length, 10);
  assert.equal(sumCents(installments), 5000_00);
  assert.equal(installments[0].amountCents, 500_00);
  assert.equal(installments[0].paymentMonth, "2026-11");
});

test("o que a corretora recebe: tabela de % do crédito por parcela (valor bruto)", () => {
  const { installments } = buildRevenueSchedule(
    sale(),
    adm({ commissionInstallments: 3, revenueMode: "CREDIT_TABLE", revenuePercents: [1.5, 0.5, 0.5], revenueBase: "GROSS" }),
  );
  assert.deepEqual(installments.map((i) => i.amountCents), [1800_00, 600_00, 600_00]);
});

test("o que a corretora recebe: % da parcela do cliente — precisa do valor da parcela", () => {
  const administrator = adm({ commissionInstallments: 3, revenueMode: "CLIENT_INSTALLMENT_TABLE", revenuePercents: [100, 50, 50] });
  assert.equal(buildRevenueSchedule(sale(), administrator).problem, "NO_CLIENT_INSTALLMENT");
  const { installments } = buildRevenueSchedule(sale({ clientInstallment: 1_200 }), administrator);
  assert.deepEqual(installments.map((i) => i.amountCents), [1200_00, 600_00, 600_00]);
});

test("a comissão do consultor acompanha o ritmo do que a corretora recebe", () => {
  const administrator = adm({ commissionInstallments: 3, revenueMode: "CREDIT_TABLE", revenuePercents: [3, 1, 1] });
  const { installments } = buildSaleSchedule(sale(), administrator, [rule({ percent: 1 })]);
  // 1% de 100 mil = R$ 1.000, na proporção 3:1:1.
  assert.deepEqual(installments.map((i) => i.amountCents), [600_00, 200_00, 200_00]);
});

test("consultor com '% do que a corretora recebe'", () => {
  const administrator = adm({ commissionInstallments: 10, revenueMode: "CREDIT_EQUAL", revenueTotalPercent: 5 });
  const { installments, problems } = buildSaleSchedule(sale(), administrator, [rule({ percent: 20, base: "COMPANY_REVENUE" })]);
  assert.deepEqual(problems, []);
  assert.equal(sumCents(installments), 1000_00); // 20% de R$ 5.000
  assert.equal(installments[0].amountCents, 100_00);
});

test("'% do que a corretora recebe' sem saber o que ela recebe vira aviso", () => {
  const { installments, problems } = buildSaleSchedule(sale(), adm(), [rule({ percent: 20, base: "COMPANY_REVENUE" })]);
  assert.deepEqual(installments, []);
  assert.deepEqual(problems, [{ code: "NO_REVENUE", role: "SELLER", reason: "NO_CONFIG" }]);
});

test("sem administradora, sem regra ou sem valor viram aviso, não parcela", () => {
  assert.deepEqual(buildSaleSchedule(sale({ administratorId: null }), null, [rule({})]).problems, [{ code: "NO_ADMINISTRATOR" }]);
  assert.deepEqual(buildSaleSchedule(sale(), adm(), []).problems, [{ code: "NO_RULE", role: "SELLER" }]);
  assert.deepEqual(buildSaleSchedule(sale({ netValue: null }), adm(), [rule({})]).problems, [{ code: "NO_VALUE", role: "SELLER", base: "NET" }]);
});

test("supervisor e gerente só recebem com regra própria, nunca sobre a própria venda", () => {
  const rules = [rule({ percent: 1 }), rule({ beneficiaryRole: "SUPERVISOR", percent: 0.2 })];
  const withTeam = buildSaleSchedule(sale({ supervisorId: "sup", managerId: "man" }), adm(), rules);
  assert.deepEqual(withTeam.installments.map((i) => [i.role, i.beneficiaryId]), [["SELLER", "seller"], ["SUPERVISOR", "sup"]]);
  assert.deepEqual(withTeam.problems, []);

  const supervisorSold = buildSaleSchedule(sale({ sellerId: "sup", supervisorId: "sup" }), adm(), rules);
  assert.deepEqual(supervisorSold.installments.map((i) => i.role), ["SELLER"]);
});

test("administradora que paga direto marca só a parte do vendedor", () => {
  const rules = [rule({ percent: 1 }), rule({ beneficiaryRole: "SUPERVISOR", percent: 0.2 })];
  const { installments } = buildSaleSchedule(sale({ supervisorId: "sup" }), adm({ paysSellerDirectly: true }), rules);
  assert.deepEqual(installments.map((i) => [i.role, i.paidByAdministrator]), [["SELLER", true], ["SUPERVISOR", false]]);
});

test("meia parcela usa a regra da modalidade reduzida", () => {
  const rules = [rule({ percent: 1 }), rule({ modality: "REDUCED", percent: 0.5 })];
  const { installments } = buildSaleSchedule(sale({ modality: "REDUCED" }), adm(), rules);
  assert.equal(installments[0].amountCents, 500_00);
});

test("conta de exemplo: corretora recebe, cada um recebe, o que fica", () => {
  const administrator = adm({ commissionInstallments: 10, revenueMode: "CREDIT_EQUAL", revenueTotalPercent: 5 });
  const split = exampleSplit(administrator, [rule({ percent: 1 }), rule({ beneficiaryRole: "SUPERVISOR", percent: 0.2 })]);
  assert.equal(split.revenue, 5000);
  assert.deepEqual(split.commissions, [{ role: "SELLER", amount: 1000 }, { role: "SUPERVISOR", amount: 200 }]);
  assert.equal(split.remaining, 3800);

  // Administradora pagando o vendedor direto: só a liderança sai da corretora.
  const direct = exampleSplit({ ...administrator, paysSellerDirectly: true }, [rule({ percent: 1 })]);
  assert.equal(direct.remaining, 5000);
});
