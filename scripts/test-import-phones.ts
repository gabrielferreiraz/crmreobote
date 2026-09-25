/**
 * Teste PONTA A PONTA da importação de telefones — usa o parser REAL (worker +
 * ExcelJS + sanitizeCell) e os resolvedores REAIS de contatos e de negócios,
 * sem tocar no banco. Prova que nenhum caminho de importação grava apóstrofo
 * e que a máscara/validação/DDI funcionam com CSV e XLSX de verdade:
 *
 *   npx tsx scripts/test-import-phones.ts
 *
 * (O teste unitário lib/phone-normalize.test.mjs cobre as regras; este cobre a
 * fiação — o worker, a sanitização de célula e os dois resolvedores.)
 */
import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import { parseSpreadsheet } from "@/lib/parse-spreadsheet";
import { resolveImportPlan } from "@/lib/contacts/import-resolve";
import { resolveImportPlan as resolveDealsPlan } from "@/lib/deals/import-resolve";

const csv = [
  "Nome;Cargo;WhatsApp;Celular;Email",
  "Ana Souza;Gerente;+5567999999999;;ana@x.com",
  "Bruno Lima;Diretor;+55 (67) 99123-4567;(67) 3321-8101;",
  "Carla Dias;Analista;'+5511987654321;;",
  "Daniel Rocha;Gerente;5567991348842;;",
  "Eva Nunes;Gerente;(67) 9134-8843;;",
  "Fabio Braga;Gerente;(67) 3321-8101;;",
  "Gil Torres;Gerente;+351 968 203 610;;",
  "Helena Prado;Gerente;abc;;",
  "-Ivo Melo;Gerente;+55 67 98888-7777;;",
  "Joao Reis;Gerente;;+5567981112222;",
  "Karen Lopes;Gerente;5.5679E+12;;",
  "Lia Cruz;Gerente;+1 (917) 555-1234;;",
  "Mauro Sá;Gerente;;;",
].join("\n");

async function run(rows: string[][], label: string) {
  console.log(`\n===== ${label} =====`);
  console.log("células cruas do parser (whatsapp col):", rows.slice(1).map((r) => JSON.stringify(r[2])).join(" "));

  const plan = resolveImportPlan({
    dataRows: rows.slice(1),
    rawHeaderRow: rows[0],
    existingContacts: [],
    members: [],
    fieldDefaults: {},
    includeWrites: true,
  });
  console.log("resumo:", JSON.stringify(plan.summary));
  for (const r of plan.rows) {
    console.log(`  linha ${String(r.rowNumber).padStart(2)} ${r.willImport ? "IMPORTA" : "BARRADA"} ${JSON.stringify(r.name)}${r.issues.length ? "  → " + r.issues.map((i) => i.code + ": " + i.message).join(" | ") : ""}`);
  }
  console.log("gravaria:");
  for (const c of plan.writes!.newContacts) {
    console.log(`  ${JSON.stringify(c.name).padEnd(16)} phone=${JSON.stringify(c.phone)} (${c.phoneNormalized}) whatsapp=${JSON.stringify(c.whatsapp)} (${c.whatsappNormalized})`);
    assert.ok(!/['"`’‘]/.test(c.phone ?? ""), "apóstrofo no phone!");
    assert.ok(!/['"`’‘]/.test(c.whatsapp ?? ""), "apóstrofo no whatsapp!");
  }
  return plan;
}

async function main() {
  // 1) CSV real pelo worker real
  const rows = await parseSpreadsheet(Buffer.from(csv, "utf8"), "teste.csv");
  const plan = await run(rows, "CSV (parser real em worker)");
  const byName = new Map(plan.writes!.newContacts.map((c) => [c.name, c]));
  assert.equal(byName.get("Ana Souza")!.whatsapp, "+55 (67) 99999-9999");
  assert.equal(byName.get("Ana Souza")!.whatsappNormalized, "67999999999");
  assert.equal(byName.get("Bruno Lima")!.phone, "+55 (67) 3321-8101"); // fixo fica no Celular
  assert.equal(byName.get("Bruno Lima")!.whatsapp, "+55 (67) 99123-4567");
  assert.equal(byName.get("Carla Dias")!.whatsapp, "+55 (11) 98765-4321"); // apóstrofo do arquivo removido
  assert.equal(byName.get("Eva Nunes")!.whatsapp, "+55 (67) 99134-8843"); // 9º dígito acrescentado
  assert.equal(byName.get("Gil Torres")!.whatsapp, "+351 968 203 610");
  assert.equal(byName.get("Lia Cruz")!.whatsapp, "+1 (917) 555-1234");
  assert.equal(byName.get("Joao Reis")!.whatsapp, "+55 (67) 98111-2222"); // celular sozinho virou WhatsApp
  assert.equal(byName.get("Joao Reis")!.phone, undefined);
  assert.equal(byName.get("'-Ivo Melo")!.whatsapp, "+55 (67) 98888-7777"); // nome com '-' segue prefixado (sanitizeCell continua valendo pra texto)
  assert.ok(!byName.has("Fabio Braga") && !byName.has("Helena Prado") && !byName.has("Karen Lopes")); // barradas
  assert.equal(plan.summary.skippedInvalidPhone, 3); // Fabio (fixo), Helena (abc), Karen (5.5679E+12 → 5567900000000, dígitos perdidos)
  assert.ok(byName.has("Mauro Sá")); // sem número nenhum continua permitido

  // 2) XLSX real: célula numérica + célula de texto com "+"
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plan1");
  ws.addRow(["Nome", "Cargo", "WhatsApp"]);
  ws.addRow(["Nina Xavier", "Gerente", 5567999998888]); // número puro
  ws.addRow(["Otavio Pires", "Gerente", "+5567999997777"]); // texto com +
  ws.addRow(["Paula Vaz", "Gerente", "+55 (67) 3321-8101"]); // fixo
  const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
  const xrows = await parseSpreadsheet(xbuf, "teste.xlsx");
  const xplan = await run(xrows, "XLSX (parser real em worker)");
  const xby = new Map(xplan.writes!.newContacts.map((c) => [c.name, c]));
  assert.equal(xby.get("Nina Xavier")!.whatsapp, "+55 (67) 99999-8888");
  assert.equal(xby.get("Otavio Pires")!.whatsapp, "+55 (67) 99999-7777");
  assert.ok(!xby.has("Paula Vaz")); // fixo no WhatsApp: barrada

  // 3) Importação de NEGÓCIOS (Celular continua sendo o "número 2")
  const dealCsv = ["Contato;Telefone;WhatsApp;Valor", "Cris;+5567981112222;;1000", "Davi;;+55 67 99999-0000;2000", "Elza;;abc;3000"].join("\n");
  const drows = await parseSpreadsheet(Buffer.from(dealCsv, "utf8"), "negocios.csv");
  const dplan = resolveDealsPlan({
    dataRows: drows.slice(1), rawHeaderRow: drows[0], stages: [{ id: "s1", name: "Novo" }], members: [{ userId: "u1", name: "Vend", email: "v@x.com" }],
    existingContacts: [], contactIdsWithOpenDeal: new Set(), openLoadByOwnerId: new Map(), fallbackOwnerId: "u1", includeWrites: true,
  });
  console.log("\n===== NEGÓCIOS =====");
  console.log("resumo:", JSON.stringify(dplan.summary));
  for (const c of dplan.writes!.newContacts) console.log(`  ${c.name}: phone=${JSON.stringify(c.phone)} whatsapp=${JSON.stringify(c.whatsapp)}`);
  const dby = new Map(dplan.writes!.newContacts.map((c) => [c.name, c]));
  assert.equal(dby.get("Cris")!.phone, "+55 (67) 98111-2222");
  assert.equal(dby.get("Cris")!.whatsapp, undefined); // Celular NÃO vira WhatsApp aqui (decisão original da importação de negócios)
  assert.equal(dby.get("Davi")!.whatsapp, "+55 (67) 99999-0000");
  assert.ok(!dby.has("Elza"));
  assert.equal(dplan.summary.skippedInvalidPhone, 1);

  console.log("\n✔ TUDO OK — nenhum apóstrofo em nenhum caminho de importação");
}
main().catch((e) => { console.error("✖ FALHOU:", e); process.exitCode = 1; });
