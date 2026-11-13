import test from "node:test";
import assert from "node:assert/strict";
import {
  canBypassRegistration,
  findMissingRegistrationItems,
  summarizeMissing,
  type RegistrationSnapshot,
} from "@/lib/deal-registration/rules";

function complete(): RegistrationSnapshot {
  return {
    contact: {
      email: "ana@email.com", whatsapp: "+55 (67) 99999-1234", phone: null, zipCode: "79002-000", address: "Rua A",
      addressNumber: "10", neighborhood: "Centro", city: "Campo Grande", state: "MS",
    },
    registration: {
      personType: "PF", holderName: "Ana Maria de Souza", cpf: "529.982.247-25", cnpj: null, profession: "Engenheira", maritalStatus: "Solteiro(a)",
      monthlyIncome: 8000, groupNumber: "1568", termMonths: 120, paymentMethod: "Boleto",
      bankName: null, bankAgency: null, bankAccount: null, bankAccountType: null,
    },
    documents: [{ kind: "PHOTO_ID" }],
  };
}
const opts = { requiresBankData: false, documentsWaived: false };

test("nome do titular é obrigatório e acompanha o tipo de pessoa", () => {
  const s = complete();
  s.registration.holderName = null;
  assert.deepEqual(findMissingRegistrationItems(s, opts)[0], {
    key: "holderName",
    label: "Nome completo do titular",
    group: "registration",
  });
  s.registration.personType = "PJ";
  assert.equal(findMissingRegistrationItems(s, opts)[0]?.label, "Razão social do titular");
});

test("cadastro completo não tem pendência", () => {
  assert.deepEqual(findMissingRegistrationItems(complete(), opts), []);
});

test("sem documento com foto o Ganho fica pendente; cliente que já comprou dispensa o documento", () => {
  const s = complete();
  s.documents = [];
  assert.deepEqual(findMissingRegistrationItems(s, opts).map((m) => m.key), ["doc:PHOTO_ID"]);
  assert.deepEqual(findMissingRegistrationItems(s, { ...opts, documentsWaived: true }), []);
});

test("CPF inválido é pendência (não só vazio)", () => {
  const s = complete();
  s.registration.cpf = "111.111.111-11";
  assert.deepEqual(findMissingRegistrationItems(s, opts).map((m) => m.key), ["cpf"]);
});

test("pessoa jurídica exige CNPJ válido, mas não contrato social", () => {
  const s = complete();
  s.registration.personType = "PJ";
  assert.deepEqual(findMissingRegistrationItems(s, opts).map((m) => m.key), ["cnpj"]);
  s.registration.cnpj = "11.222.333/0001-81";
  assert.deepEqual(findMissingRegistrationItems(s, opts), []);
});

test("administradora que pede dados bancários (Pontual) cobra os 4 campos", () => {
  const keys = findMissingRegistrationItems(complete(), { ...opts, requiresBankData: true }).map((m) => m.key);
  assert.deepEqual(keys, ["bankName", "bankAgency", "bankAccount", "bankAccountType"]);
});

test("celular precisa ser WhatsApp; fixo sozinho não vale", () => {
  const s = complete();
  s.contact.whatsapp = null;
  s.contact.phone = "(67) 3305-2500";
  assert.deepEqual(findMissingRegistrationItems(s, opts).map((m) => m.key), ["whatsapp"]);
});

test("resumo curto: até 3 itens e 'mais N'", () => {
  const s = complete();
  s.contact.email = null; s.registration.profession = null; s.registration.maritalStatus = null; s.documents = [];
  assert.equal(summarizeMissing(findMissingRegistrationItems(s, opts)), "Falta: E-mail, Profissão, Estado civil e mais 1");
  assert.equal(summarizeMissing([]), "");
});

test("só Dono e Administrativo dispensam o cadastro", () => {
  assert.equal(canBypassRegistration({ role: "OWNER", area: "VENDAS" }), true);
  assert.equal(canBypassRegistration({ role: "MEMBER", area: "ADMINISTRATIVO" }), true);
  assert.equal(canBypassRegistration({ role: "MANAGER", area: "VENDAS" }), false);
});

test("ninguém dispensa o cadastro hoje (nem o Dono)", async () => {
  const { canWaiveRegistration } = await import("@/lib/deal-registration/rules");
  assert.equal(canWaiveRegistration({ role: "OWNER", area: "VENDAS" }), false);
  assert.equal(canWaiveRegistration({ role: "MEMBER", area: "ADMINISTRATIVO" }), false);
});
