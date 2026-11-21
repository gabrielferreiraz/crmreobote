/**
 * Importação de contatos — contato já existente ganha dado novo (cargo,
 * origem, tag…), mas nunca o nome; "liberado" (sem responsável / responsável
 * inativo) é decidido pela ROTA (ver app/api/contacts/import/route.ts), aqui
 * só o motor puro (lib/contacts/import-resolve.ts): o que diverge, e quais
 * tags a planilha traz que o contato ainda não tem.
 *
 *   node --experimental-strip-types --test scripts/test-contacts-import-resolve.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImportPlan, type ExistingContactInput, type MemberInput } from "../lib/contacts/import-resolve.ts";

const members: MemberInput[] = [{ userId: "u1", name: "Fulano", email: "fulano@x.com" }];

function existing(overrides: Partial<ExistingContactInput> = {}): ExistingContactInput {
  return {
    id: "c1",
    name: "Ana Souza",
    phoneNormalized: null,
    whatsappNormalized: "67999999999",
    responsavelId: "u1",
    responsavelName: "Fulano",
    responsavelActive: true,
    jobTitle: "Médico",
    source: "Indicação",
    company: null,
    email: null,
    tags: ["vip"],
    zipCode: null,
    address: null,
    addressNumber: null,
    addressComplement: null,
    neighborhood: null,
    city: null,
    state: null,
    ...overrides,
  };
}

function plan(csvRow: string, existingContacts: ExistingContactInput[]) {
  return resolveImportPlan({
    dataRows: [csvRow.split(";")],
    rawHeaderRow: "Nome;Cargo;Origem;WhatsApp;Tags".split(";"),
    existingContacts,
    members,
    jobTitleOptions: ["Médico", "Médico MS"],
    sourceOptions: ["Indicação", "Instagram"],
    includeWrites: true,
  });
}

test("linha duplicada: cargo/origem novos entram em divergentFields; nome nunca entra", () => {
  const p = plan("Ana Souza;Médico MS;Instagram;+5567999999999;", [existing()]);
  const row = p.rows[0];
  assert.equal(row.willImport, false);
  assert.ok(row.existingContact);
  const fields = row.existingContact!.divergentFields.map((f) => f.field);
  assert.deepEqual(fields.sort(), ["jobTitle", "source"]);
  assert.ok(!fields.includes("name" as never), "nome nunca é um campo atualizável");
  const update = p.writes!.contactUpdates.find((u) => u.id === "c1");
  assert.ok(update);
  assert.equal(update!.data.jobTitle, "Médico MS");
  assert.equal(update!.data.source, "Instagram");
});

test("tag nova da planilha vira tagsToAdd; tag que já existe (case-insensitive) não duplica", () => {
  const p = plan("Ana Souza;Médico;Indicação;+5567999999999;VIP, Quente", [existing({ tags: ["vip"] })]);
  const row = p.rows[0];
  // "VIP" já existe (case-insensitive) — só "Quente" é novidade.
  assert.deepEqual(row.existingContact!.tagsToAdd, ["Quente"]);
  const update = p.writes!.contactUpdates.find((u) => u.id === "c1");
  assert.ok(update, "só tag nova já é motivo pra entrar em contactUpdates, mesmo sem outro campo divergente");
  assert.deepEqual(update!.tagsToAdd, ["Quente"]);
  assert.deepEqual(update!.data, {}, "sem outro campo divergente, data fica vazio — só tagsToAdd muda");
});

test("nada novo (cargo/origem/tag iguais): contato não entra em contactUpdates", () => {
  const p = plan("Ana Souza;Médico;Indicação;+5567999999999;vip", [existing({ tags: ["VIP"] })]);
  const row = p.rows[0];
  assert.equal(row.existingContact!.divergentFields.length, 0);
  assert.equal(row.existingContact!.tagsToAdd.length, 0);
  assert.equal(p.writes!.contactUpdates.some((u) => u.id === "c1"), false);
});

test("célula vazia nunca apaga o que já está salvo", () => {
  const p = plan("Ana Souza;;;+5567999999999;", [existing()]);
  const row = p.rows[0];
  assert.equal(row.existingContact!.divergentFields.length, 0);
  assert.equal(row.existingContact!.tagsToAdd.length, 0);
});
