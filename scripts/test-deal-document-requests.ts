import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUEST_CATALOG,
  REQUEST_LABEL_MAX,
  buildRequestItem,
  countRequestPending,
  isRequestComplete,
  parseRequestItems,
  summarizeRequestItems,
} from "@/lib/deal-registration/request-rules";
import { AREA_LABELS, AREA_OPTIONS, isBackOfficeArea, isValidArea } from "@/lib/areas";
import {
  QUOTA_DIGIT_RE,
  QUOTA_NUMBER_RE,
  canBypassRegistration,
  decideProcessQuotaUpdate,
  formatQuotaLabel,
  quotaWithDigit,
} from "@/lib/deal-registration/rules";

test("item do catálogo usa o rótulo e o tipo do catálogo, ignorando o texto enviado", () => {
  const item = buildRequestItem({ key: "photo_id", label: "qualquer coisa" });
  assert.ok(item);
  assert.equal(item.label, "Documento com foto (CNH ou RG)");
  assert.equal(item.kind, "PHOTO_ID");
  assert.equal(item.needsFile, true);
  assert.equal(item.doneAt, null);
  assert.deepEqual(item.documentIds, []);
});

test("'corrigir uma informação' não pede arquivo (responde por escrito)", () => {
  const item = buildRequestItem({ key: "fix_data" });
  assert.ok(item);
  assert.equal(item.needsFile, false);
  assert.equal(item.kind, null);
});

test("item livre pede arquivo do tipo Outro, exige texto e limita o tamanho", () => {
  assert.equal(buildRequestItem({ key: "custom:1", label: "   " }), null);
  assert.equal(buildRequestItem({ key: "custom:2" }), null);
  const item = buildRequestItem({ key: "custom:3", label: "Extrato bancário" });
  assert.ok(item);
  assert.equal(item.kind, "OTHER");
  assert.equal(item.needsFile, true);
  const long = buildRequestItem({ key: "custom:4", label: "x".repeat(500) });
  assert.equal(long?.label.length, REQUEST_LABEL_MAX);
});

test("todo item do catálogo gera um item válido", () => {
  for (const c of REQUEST_CATALOG) {
    const item = buildRequestItem({ key: c.key });
    assert.ok(item, c.key);
    assert.equal(item.needsFile, c.kind !== null);
  }
});

test("pedido só está completo quando todos os itens foram atendidos", () => {
  const a = buildRequestItem({ key: "photo_id" })!;
  const b = buildRequestItem({ key: "proof_income" })!;
  assert.equal(isRequestComplete([]), false);
  assert.equal(isRequestComplete([a, b]), false);
  a.doneAt = "2026-11-09T10:00:00.000Z";
  assert.equal(isRequestComplete([a, b]), false);
  assert.equal(countRequestPending([a, b]), 1);
  b.doneAt = "2026-11-09T11:00:00.000Z";
  assert.equal(isRequestComplete([a, b]), true);
  assert.equal(countRequestPending([a, b]), 0);
});

test("resumo mostra só o que falta, com 'e mais N'", () => {
  const items = ["photo_id", "proof_address", "proof_income", "marriage"].map((key) => buildRequestItem({ key })!);
  assert.equal(
    summarizeRequestItems(items, 2),
    "Documento com foto (CNH ou RG), Comprovante de residência e mais 2",
  );
  items[0].doneAt = "2026-11-09T10:00:00.000Z";
  assert.equal(summarizeRequestItems(items, 3), "Comprovante de residência, Comprovante de renda, Certidão de casamento");
  items.forEach((i) => (i.doneAt = "2026-11-09T10:00:00.000Z"));
  assert.equal(summarizeRequestItems(items), "");
});

test("lê o JSON do banco com tolerância e descarta lixo", () => {
  assert.deepEqual(parseRequestItems(null), []);
  assert.deepEqual(parseRequestItems("texto"), []);
  const parsed = parseRequestItems([
    null,
    42,
    { key: "a" },
    { key: "photo_id", label: "Documento", kind: "PHOTO_ID", doneAt: "2026-11-09T10:00:00.000Z", documentIds: ["d1", 7, "d2"], note: "ok" },
    { key: "fix_data", label: "Corrigir", kind: "INVALIDO" },
  ]);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0].documentIds, ["d1", "d2"]);
  assert.equal(parsed[0].needsFile, true);
  assert.equal(parsed[1].kind, null);
  assert.equal(parsed[1].needsFile, false);
});

test("quatro áreas, todas válidas, e só Vendas não é retaguarda", () => {
  assert.deepEqual(AREA_OPTIONS.map((o) => o.value), ["VENDAS", "ADMINISTRATIVO", "FINANCEIRO", "POS_CONTEMPLACAO"]);
  for (const o of AREA_OPTIONS) {
    assert.equal(isValidArea(o.value), true);
    assert.ok(AREA_LABELS[o.value]);
  }
  assert.equal(isValidArea("ADMIN"), false);
  assert.equal(isValidArea(undefined), false);
  assert.equal(isBackOfficeArea("VENDAS"), false);
  assert.equal(isBackOfficeArea("FINANCEIRO"), true);
  assert.equal(isBackOfficeArea("POS_CONTEMPLACAO"), true);
  assert.equal(isBackOfficeArea(null), false);
});

test("só Administrativo e Dono mexem no cadastro de cota (Financeiro e Pós-contemplação não)", () => {
  assert.equal(canBypassRegistration({ role: "OWNER", area: "VENDAS" }), true);
  assert.equal(canBypassRegistration({ role: "MEMBER", area: "ADMINISTRATIVO" }), true);
  assert.equal(canBypassRegistration({ role: "MEMBER", area: "FINANCEIRO" }), false);
  assert.equal(canBypassRegistration({ role: "MEMBER", area: "POS_CONTEMPLACAO" }), false);
  assert.equal(canBypassRegistration({ role: "MANAGER", area: "VENDAS" }), false);
});

test("grupo, cota e dígito aparecem juntos: Grupo 1568 · Cota 0123-00", () => {
  assert.equal(formatQuotaLabel({ groupNumber: "1568", quotaNumber: "0123", quotaDigit: "00" }), "Grupo 1568 · Cota 0123-00");
  assert.equal(formatQuotaLabel({ groupNumber: "1568", quotaNumber: "0123" }), "Grupo 1568 · Cota 0123");
  assert.equal(formatQuotaLabel({ groupNumber: " 1568 " }), "Grupo 1568");
  assert.equal(formatQuotaLabel({}), "");
  assert.equal(quotaWithDigit("0123", "00"), "0123-00");
  assert.equal(quotaWithDigit("0123", ""), "0123");
  assert.equal(quotaWithDigit("", "00"), null);
});

test("cota aceita até 6 dígitos e o dígito até 2, só números", () => {
  assert.equal(QUOTA_NUMBER_RE.test("0123"), true);
  assert.equal(QUOTA_NUMBER_RE.test("1234567"), false);
  assert.equal(QUOTA_NUMBER_RE.test("12a"), false);
  assert.equal(QUOTA_DIGIT_RE.test("00"), true);
  assert.equal(QUOTA_DIGIT_RE.test("001"), false);
  assert.equal(QUOTA_DIGIT_RE.test("x"), false);
});

test("a cota do administrativo chega ao Processo vazio", () => {
  const prev = { groupNumber: null, quotaNumber: null, quotaDigit: null };
  const next = { groupNumber: "1568", quotaNumber: "0123", quotaDigit: "00" };
  assert.deepEqual(decideProcessQuotaUpdate({ groupNumber: null, quotaNumber: null }, prev, next), { groupNumber: "1568", quotaNumber: "0123-00" });
});

test("o que a pós-contemplação digitou à mão no Processo não é sobrescrito", () => {
  const prev = { groupNumber: null, quotaNumber: null, quotaDigit: null };
  const next = { groupNumber: "1568", quotaNumber: "0123", quotaDigit: "00" };
  assert.deepEqual(decideProcessQuotaUpdate({ groupNumber: "9999", quotaNumber: "7777-01" }, prev, next), {});
  // Só um dos campos preenchido à mão: o outro ainda recebe.
  assert.deepEqual(decideProcessQuotaUpdate({ groupNumber: "9999", quotaNumber: null }, prev, next), { quotaNumber: "0123-00" });
});

test("corrigir um erro de digitação no cadastro atualiza o Processo que ainda tem o valor antigo", () => {
  const prev = { groupNumber: "1568", quotaNumber: "0123", quotaDigit: "00" };
  const next = { groupNumber: "1568", quotaNumber: "0124", quotaDigit: "00" };
  assert.deepEqual(decideProcessQuotaUpdate({ groupNumber: "1568", quotaNumber: "0123-00" }, prev, next), { quotaNumber: "0124-00" });
  // Se a pós já mudou, mantém.
  assert.deepEqual(decideProcessQuotaUpdate({ groupNumber: "1568", quotaNumber: "0150-00" }, prev, next), {});
});

test("nada muda quando o cadastro não mudou", () => {
  const same = { groupNumber: "1568", quotaNumber: "0123", quotaDigit: "00" };
  assert.deepEqual(decideProcessQuotaUpdate({ groupNumber: null, quotaNumber: null }, same, same), {});
});

test("só a área Administrativo lê o comercial da organização inteira (sem virar Dono)", async () => {
  const { seesOrganizationWideCommercialReport } = await import("@/lib/reports/scope");
  assert.equal(seesOrganizationWideCommercialReport("ADMINISTRATIVO"), true);
  assert.equal(seesOrganizationWideCommercialReport("VENDAS"), false);
  assert.equal(seesOrganizationWideCommercialReport("FINANCEIRO"), false);
  assert.equal(seesOrganizationWideCommercialReport("POS_CONTEMPLACAO"), false);
  assert.equal(seesOrganizationWideCommercialReport(null), false);
});
