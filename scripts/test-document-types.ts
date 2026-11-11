import test from "node:test";
import assert from "node:assert/strict";
import { findFields } from "@/lib/ocr/find-fields";
import { detectDocumentType } from "@/lib/ocr/document-type";
import { dueDateFromFactor, findBoleto, isValidBoletoLine } from "@/lib/ocr/boleto";
import { parseCompetence, parseMoney, parseNumberRange } from "@/lib/ocr/parsers";

const L = (...texts: string[]) => texts.map((text) => ({ text, confidence: 90 }));
const byKey = (lines: { text: string; confidence: number }[]) => Object.fromEntries(findFields(lines).map((f) => [f.key, f.value]));

function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    let p = Number(digits[i]) * weight;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}
function boletoDigits(factor: string, cents: string): string {
  const a = "341917901";
  const b = "0100000000";
  const c = "1234567890";
  return `${a}${mod10(a)}${b}${mod10(b)}${c}${mod10(c)}1${factor}${cents}`;
}
const spaced = (d: string) => `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;

test("valores em reais e competência são lidos em vários formatos", () => {
  assert.equal(parseMoney("R$1.273,75"), "R$ 1.273,75");
  assert.equal(parseMoney("valor 3500,00"), "R$ 3.500,00");
  assert.equal(parseMoney("sem valor"), null);
  assert.equal(parseCompetence("10/2026"), "Outubro/2026");
  assert.equal(parseCompetence("OUT/2026"), "Outubro/2026");
  assert.equal(parseCompetence("Referência: Outubro de 2026"), "Outubro/2026");
  assert.equal(parseNumberRange("Matrícula 004512", 3, 12), "004512");
  assert.equal(parseNumberRange("12", 3, 12), null);
});

test("linha digitável do boleto: só vale se os dígitos verificadores fecharem; traz valor e vencimento", () => {
  const good = boletoDigits("9000", "0000123456");
  assert.equal(isValidBoletoLine(good), true);
  const bad = good.slice(0, 5) + (good[5] === "9" ? "0" : String(Number(good[5]) + 1)) + good.slice(6);
  assert.equal(isValidBoletoLine(bad), false);
  const info = findBoleto([`Linha digitável: ${spaced(good)}`]);
  assert.ok(info);
  assert.equal(info.amount, "R$ 1.234,56");
  assert.equal(info.due, dueDateFromFactor(9000));
  assert.equal(findBoleto([spaced(bad)]), null);
});

test("fator de vencimento respeita a virada de 22/02/2025", () => {
  assert.equal(dueDateFromFactor(1000), "22/02/2025");
  assert.equal(dueDateFromFactor(9999), "21/02/2025");
  assert.equal(dueDateFromFactor(500), null);
});

test("boleto: reconhece o tipo e lê beneficiário, pagador, vencimento e valor", () => {
  const good = boletoDigits("9000", "0000123456");
  const f = byKey(
    L("Ficha de Compensação", "Beneficiário: REOBOTE CONSULTORIA LTDA", "Pagador: MARIA DA SILVA", "Vencimento 15/12/2026", "Valor do Documento R$ 1.234,56", spaced(good)),
  );
  assert.equal(f["type"], "Boleto bancário");
  assert.equal(f["beneficiary"], "REOBOTE CONSULTORIA LTDA");
  assert.equal(f["payer"], "MARIA DA SILVA");
  assert.equal(f["due"], "15/12/2026");
  assert.equal(f["amount"], "R$ 1.234,56");
  assert.equal(f["boleto-amount"], "R$ 1.234,56");
  assert.ok(f["boleto-line"]);
});

test("contracheque: competência, empresa, cargo, bruto, descontos e líquido", () => {
  const f = byKey(L("CONTRACHEQUE", "Empresa: ACME COMERCIO LTDA", "Competência 10/2026", "Cargo: ANALISTA FINANCEIRO", "Matrícula 004512", "Total de Vencimentos R$ 5.200,00", "Total de Descontos R$ 812,40", "Líquido a Receber R$ 4.387,60"));
  assert.equal(f["type"], "Contracheque (comprovante de renda)");
  assert.equal(f["competence"], "Outubro/2026");
  assert.equal(f["employer"], "ACME COMERCIO LTDA");
  assert.equal(f["role"], "ANALISTA FINANCEIRO");
  assert.equal(f["registry-no"], "004512");
  assert.equal(f["gross"], "R$ 5.200,00");
  assert.equal(f["deductions"], "R$ 812,40");
  assert.equal(f["net"], "R$ 4.387,60");
  assert.equal(f["name"], undefined); // não inventa nome a partir do nome da empresa
});

test("conta de luz: titular, instalação, vencimento, valor e endereço", () => {
  const f = byKey(
    L("ENERGISA MATO GROSSO DO SUL", "Nota Fiscal Fatura de Energia Elétrica", "Cliente: JOSE CARLOS PEREIRA", "Unidade Consumidora 7012345-6", "Rua das Palmeiras, 150 - Centro", "CEP 79002-000", "Vencimento 20/11/2026", "Total a Pagar R$ 312,45"),
  );
  assert.equal(f["type"], "Comprovante de endereço");
  assert.equal(f["name"], "JOSE CARLOS PEREIRA");
  assert.equal(f["consumer-unit"], "7012345-6");
  assert.equal(f["due"], "20/11/2026");
  assert.equal(f["amount"], "R$ 312,45");
  assert.equal(f["address"], "Rua das Palmeiras, 150 - Centro");
  assert.equal(f["cep-79002000"], "79002-000");
});

test("documento do consórcio: grupo, cota, contrato, crédito e prazo", () => {
  const f = byKey(L("Contrato de Participação em Grupo de Consórcio", "Administradora: SERVOPA", "Grupo 1568", "Cota 0123", "Contrato 8841230", "Valor do Crédito R$ 110.000,00", "Prazo 180"));
  assert.equal(f["type"], "Documento do consórcio");
  assert.equal(f["group"], "1568");
  assert.equal(f["quota"], "0123");
  assert.equal(f["contract"], "8841230");
  assert.equal(f["credit"], "R$ 110.000,00");
  assert.equal(f["term"], "180");
  assert.equal(f["administrator"], "SERVOPA");
});

test("cartão do CNPJ: razão social, fantasia, abertura e situação", () => {
  const f = byKey(
    L("COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO CADASTRAL", "CADASTRO NACIONAL DA PESSOA JURÍDICA", "20.085.857/0001-69", "NOME EMPRESARIAL", "REOBOTE CONSULTORIA LTDA", "DATA DE ABERTURA", "12/03/2019", "SITUAÇÃO CADASTRAL", "ATIVA"),
  );
  assert.equal(f["type"], "Cartão do CNPJ");
  assert.equal(f["company-name"], "REOBOTE CONSULTORIA LTDA");
  assert.equal(f["opening"], "12/03/2019");
  assert.equal(f["situation"], "ATIVA");
});

test("rótulos como VALOR e GRUPO soltos não viram campo em documento de outro tipo", () => {
  const f = byKey(L("CARTEIRA NACIONAL DE HABILITAÇÃO", "CAT. HAB. B", "NOME E SOBRENOME", "ANA PAULA RIBEIRO", "VALOR R$ 10,00", "GRUPO 1234"));
  assert.equal(f["type"], "CNH (carteira de habilitação)");
  assert.equal(f["amount"], undefined);
  assert.equal(f["group"], undefined);
});

test("tipos novos são reconhecidos mesmo com letras erradas", () => {
  assert.equal(detectDocumentType(["C0NTRACHEQUE", "Total de Vencimentos"])?.id, "payslip");
  assert.equal(detectDocumentType(["Linha Digitavel", "Nosso Numero"])?.id, "boleto");
  assert.equal(detectDocumentType(["Consorcio", "Assembleia", "Grupo"])?.id, "consorcio");
});
