import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CHANGES_PER_EVENT, diffFields, maskTail, normalizeValue, parseChanges, summarizeChanges } from "@/lib/audit-diff";
import { ACTION_LABELS, ACTION_TONE, categoryOf, categoryPrefixes, targetHref } from "@/lib/audit-meta";
import { REGISTRATION_FIELD_SPECS, QUOTA_FIELD_SPECS, diffQuotaSnapshots, diffRegistrationSnapshots } from "@/lib/deal-registration/audit";
import { buildAuditWhere } from "@/lib/audit-query";

test("vazio, nulo e só espaços são a mesma coisa; nada mudou, nada é registrado", () => {
  assert.equal(normalizeValue("  "), null);
  assert.equal(normalizeValue(undefined), null);
  assert.equal(normalizeValue(0), "0");
  assert.equal(normalizeValue(true), "Sim");
  const specs = { city: { label: "Cidade" } };
  assert.deepEqual(diffFields({ city: "" }, { city: null }, specs), []);
  assert.deepEqual(diffFields({ city: " Campo Grande " }, { city: "Campo Grande" }, specs), []);
});

test("só o que mudou aparece, com rótulo e antes → depois", () => {
  const specs = { city: { label: "Cidade" }, state: { label: "UF" } };
  const changes = diffFields({ city: "Dourados", state: "MS" }, { city: "Campo Grande", state: "MS" }, specs);
  assert.deepEqual(changes, [{ field: "city", label: "Cidade", from: "Dourados", to: "Campo Grande" }]);
});

test("atualização parcial não 'apaga' campo que nem foi enviado", () => {
  const specs = { city: { label: "Cidade" }, state: { label: "UF" } };
  assert.deepEqual(diffFields({ city: "A", state: "MS" }, { city: "B" }, specs), [{ field: "city", label: "Cidade", from: "A", to: "B" }]);
  // Apagar de propósito (null) é mudança.
  assert.deepEqual(diffFields({ state: "MS" }, { state: null }, specs), [{ field: "state", label: "UF", from: "MS", to: null }]);
});

test("dado sensível entra mascarado: prova que mudou sem guardar o valor", () => {
  assert.equal(maskTail("012.545.659-06"), "••••••••••••06");
  assert.equal(maskTail("12"), "••••");
  assert.equal(maskTail(null), null);
  const changes = diffRegistrationSnapshots({ cpf: "11144477735" }, { cpf: "52998224725" });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].label, "CPF");
  assert.ok(!changes[0].from?.includes("111") && !changes[0].to?.includes("529"));
  assert.ok(changes[0].to?.endsWith("25"));
});

test("valores têm formato próprio: renda em reais, prazo em meses, tipo de cliente por extenso", () => {
  const renda = diffRegistrationSnapshots({ monthlyIncome: 4000 }, { monthlyIncome: 5500.5 })[0];
  assert.match(renda.from ?? "", /4\.000,00/);
  assert.match(renda.to ?? "", /5\.500,50/);
  const tipo = diffRegistrationSnapshots({ personType: "PF" }, { personType: "PJ" })[0];
  assert.deepEqual([tipo.from, tipo.to], ["Pessoa física", "Pessoa jurídica"]);
  const prazo = diffQuotaSnapshots({ termMonths: null }, { termMonths: 180 })[0];
  assert.deepEqual([prazo.from, prazo.to], [null, "180 meses"]);
});

test("a cota do administrativo é auditada como 'Cota' e 'Dígito'; grupo, prazo e pagamento são do consultor", () => {
  const changes = diffQuotaSnapshots(
    { groupNumber: "1568", quotaNumber: null, quotaDigit: null, paymentMethod: "Boleto" },
    { groupNumber: "1568", quotaNumber: "0123", quotaDigit: "00", paymentMethod: "Boleto" },
  );
  assert.deepEqual(changes.map((c) => [c.label, c.from, c.to]), [
    ["Cota", null, "0123"],
    ["Dígito", null, "00"],
  ]);
  // O que o consultor edita no cadastro (PUT) também é auditado, com os mesmos rótulos.
  const consultant = diffRegistrationSnapshots({ groupNumber: null, termMonths: null, paymentMethod: null }, { groupNumber: "1568", termMonths: 180, paymentMethod: "PIX" });
  assert.deepEqual(consultant.map((c) => [c.label, c.to]), [["Grupo", "1568"], ["Prazo", "180 meses"], ["Forma de pagamento", "PIX"]]);
  // Cota e dígito não são editados pelo consultor.
  assert.ok(!("quotaNumber" in REGISTRATION_FIELD_SPECS) && !("quotaDigit" in REGISTRATION_FIELD_SPECS));
  assert.ok("quotaNumber" in QUOTA_FIELD_SPECS && "quotaDigit" in QUOTA_FIELD_SPECS);
});

test("um evento nunca carrega mais de MAX_CHANGES_PER_EVENT campos", () => {
  const specs: Record<string, { label: string }> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (let i = 0; i < MAX_CHANGES_PER_EVENT + 10; i++) {
    specs[`f${i}`] = { label: `Campo ${i}` };
    before[`f${i}`] = "a";
    after[`f${i}`] = "b";
  }
  assert.equal(diffFields(before, after, specs).length, MAX_CHANGES_PER_EVENT);
});

test("resumo de uma linha e leitura tolerante do JSON do banco", () => {
  const list = [
    { field: "a", label: "Cidade", from: "X", to: "Y" },
    { field: "b", label: "Renda", from: null, to: "R$ 1,00" },
    { field: "c", label: "UF", from: "MS", to: "SP" },
  ];
  assert.equal(summarizeChanges(list, 2), "Cidade: X → Y; Renda: vazio → R$ 1,00 e mais 1");
  assert.equal(summarizeChanges([]), "");
  assert.deepEqual(parseChanges(null), []);
  assert.deepEqual(parseChanges("lixo"), []);
  assert.deepEqual(parseChanges([null, 3, { field: "a" }, { field: "a", label: "A", from: 1, to: "z" }]), [{ field: "a", label: "A", from: null, to: "z" }]);
});

test("toda ação auditável tem rótulo, cor e área do sistema (nenhuma cai em 'Outros')", () => {
  for (const action of Object.keys(ACTION_LABELS)) {
    assert.ok(action in ACTION_TONE, `${action} sem cor`);
    assert.notEqual(categoryOf(action), "outros", `${action} sem área do sistema`);
  }
});

test("áreas do sistema separam cadastro de negócios e equipe", () => {
  assert.equal(categoryOf("DEAL_QUOTA_UPDATED"), "cadastro");
  assert.equal(categoryOf("DEAL_REGISTRATION_EDITED"), "cadastro");
  assert.equal(categoryOf("DEAL_DOCUMENT_REQUESTED"), "cadastro");
  assert.equal(categoryOf("DEAL_WON"), "negocios");
  assert.equal(categoryOf("DEALS_IMPORTED"), "negocios");
  assert.equal(categoryOf("MEMBER_AREA_CHANGED"), "equipe");
  assert.equal(categoryOf("ACADEMY_CRM_UNLOCKED"), "equipe");
  assert.equal(categoryOf("COMMISSION_PAID"), "comissoes");
  assert.equal(categoryOf("ALGO_NOVO"), "outros");
  assert.equal(categoryPrefixes("outros"), null);
});

test("itens auditados levam à tela certa", () => {
  assert.equal(targetHref("Deal", "d1"), "/negocios/d1");
  assert.equal(targetHref("Contact", "c1"), "/clientes/c1");
  assert.equal(targetHref("User", "u1"), null);
  assert.equal(targetHref(null, null), null);
});

test("filtros viram consulta: sempre da organização, com período, pessoa, item e cursor", () => {
  const where = buildAuditWhere("org1", { from: "2026-11-01", to: "2026-11-09", actorId: "u1", targetType: "Deal", targetId: "d1", action: "DEAL_WON" }, "2026-11-09T12:00:00.000Z|abc");
  assert.equal(where.organizationId, "org1");
  const and = (where.AND ?? []) as unknown[];
  // período (2) + pessoa + ação + tipo + item + cursor
  assert.equal(and.length, 7);
  assert.equal(JSON.stringify(and).includes('"actorUserId":"u1"'), true);
  assert.equal(JSON.stringify(and).includes('"targetId":"d1"'), true);
  assert.equal(JSON.stringify(and).includes("abc"), true);
});

test("sem filtro só restringe pela organização; datas e cursor inválidos são ignorados", () => {
  assert.deepEqual(buildAuditWhere("org1", {}), { organizationId: "org1" });
  assert.deepEqual(buildAuditWhere("org1", { from: "ontem", to: "2026/11/09" }, "lixo"), { organizationId: "org1" });
});

test("a busca de texto acha também pelo nome da ação em português", () => {
  const where = buildAuditWhere("org1", { q: "cota marcada" });
  const text = JSON.stringify(where);
  assert.ok(text.includes("DEAL_QUOTA_REGISTERED"));
  assert.ok(text.includes('"actorName"'));
});

test("o Ganho só libera com grupo, prazo e forma de pagamento (do consultor); cota e dígito não são cobrados dele", async () => {
  const { findMissingRegistrationItems } = await import("@/lib/deal-registration/rules");
  const base = {
    contact: { email: "a@b.com", whatsapp: "+55 (67) 99999-1234", phone: null, zipCode: "79002-000", address: "Rua A", addressNumber: "10", neighborhood: "Centro", city: "Campo Grande", state: "MS" },
    registration: { personType: "PF" as const, holderName: "Ana Maria", cpf: "529.982.247-25", cnpj: null, profession: "Eng", maritalStatus: "Solteiro(a)", monthlyIncome: 8000, groupNumber: null as string | null, termMonths: null as number | null, paymentMethod: null as string | null, bankName: null, bankAgency: null, bankAccount: null, bankAccountType: null },
    documents: [{ kind: "PHOTO_ID" as const }],
  };
  const opts = { requiresBankData: false, documentsWaived: false };
  assert.deepEqual(findMissingRegistrationItems(base, opts).map((m) => m.key), ["groupNumber", "termMonths", "paymentMethod"]);
  base.registration.groupNumber = "1568";
  base.registration.termMonths = 180;
  base.registration.paymentMethod = "Boleto";
  assert.deepEqual(findMissingRegistrationItems(base, opts), []);
  // sem cota/dígito (do administrativo) continua completo
  assert.equal("quotaNumber" in base.registration, false);
});

test("o catálogo de pedidos tem 'informar grupo, prazo e forma de pagamento' (resposta no cadastro, sem arquivo)", async () => {
  const { buildRequestItem } = await import("@/lib/deal-registration/request-rules");
  const item = buildRequestItem({ key: "quota_info" });
  assert.ok(item);
  assert.equal(item.needsFile, false);
  assert.equal(item.label, "Informar grupo, prazo e forma de pagamento");
});
