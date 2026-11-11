import test from "node:test";
import assert from "node:assert/strict";
import { findFields } from "@/lib/ocr/find-fields";
import { linesFromWords, mergePasses, pickBestWords } from "@/lib/ocr/merge";
import type { ReadLine, WordBox } from "@/lib/ocr/quality";

// Posições de uma cédula de identidade profissional (nome e CRM em colunas diferentes, filiação em duas linhas).
const at = (text: string, x0: number, y0: number, w = 400, h = 35, confidence = 90): ReadLine => ({ text, confidence, box: { x0, y0, x1: x0 + w, y1: y0 + h } });

const CARD: ReadLine[] = [
  at("CONSELHO FEDERAL DE MEDICINA", 660, 320, 1075),
  at("CONSELHO REGIONAL DE MEDICINA - MATO GROSSO DO SUL", 660, 395, 960, 30),
  at("CÉDULA DE IDENTIDADE DE MÉDICO", 660, 440, 660, 30),
  at("NOME", 635, 540, 100, 30),
  at("CRM/UF", 1440, 545, 150, 30),
  at("FERNANDO COUTINHO BATISTA", 635, 580, 550),
  at("10608/MS", 1440, 583, 180),
  at("FILIAÇÃO", 635, 735, 150, 30),
  at("NEIDE COUTINHO BATISTA", 635, 778, 480),
  at("ADILSON FERNANDES BATISTA", 635, 866, 550),
  at("DATA DE INSCRIÇÃO VIA", 258, 968, 430, 30),
  at("30/05/2019", 258, 1005, 215),
  at("01", 635, 1010, 40),
  at("ASSINATURA DO PORTADOR", 535, 1215, 370, 30),
];

test("cédula com colunas: nome, filiação, CRM/UF e data de inscrição vêm de onde estão na imagem", () => {
  const f = Object.fromEntries(findFields(CARD).map((x) => [x.key, x.value]));
  assert.equal(f["name"], "FERNANDO COUTINHO BATISTA");
  assert.equal(f["filiation-0"], "NEIDE COUTINHO BATISTA");
  assert.equal(f["filiation-1"], "ADILSON FERNANDES BATISTA");
  assert.equal(f["crm"], "10608/MS");
  assert.equal(f["issue"], "30/05/2019");
});

test("o nome não é pego da coluna ao lado, nem o cabeçalho do documento vira nome", () => {
  const fields = findFields(CARD);
  assert.ok(!fields.some((x) => /CONSELHO|CEDULA|CÉDULA/.test(x.value) && x.label.startsWith("Nome")));
  assert.equal(fields.filter((x) => x.key === "name").length, 1);
});

test("rótulos com letras erradas ainda funcionam", () => {
  const f = Object.fromEntries(
    findFields([at("N0ME", 100, 100, 90, 30), at("JOSE DA SILVA SANTOS", 100, 140, 420), at("FILIAÇAO", 100, 230, 150, 30), at("MARIA DA SILVA", 100, 270, 300), at("DATA DE NASCIMENT0", 100, 350, 400, 30), at("O2/1O/1990", 100, 390, 200)]).map((x) => [x.key, x.value]),
  );
  assert.equal(f["name"], "JOSE DA SILVA SANTOS");
  assert.equal(f["filiation-0"], "MARIA DA SILVA");
  assert.equal(f["birth"], "02/10/1990");
});

test("CNH: registro, validade e categoria na mesma linha do rótulo", () => {
  const f = Object.fromEntries(findFields(["NOME E SOBRENOME", "ANA PAULA RIBEIRO", "DATA NASCIMENTO 14/07/1988", "CAT. HAB. B", "VALIDADE 02/03/2031", "CPF 529.982.247-25"]).map((x) => [x.key, x.value]));
  assert.equal(f["name"], "ANA PAULA RIBEIRO");
  assert.equal(f["birth"], "14/07/1988");
  assert.equal(f["validity"], "02/03/2031");
  assert.equal(f["category"], "B");
  assert.equal(f["cpf-52998224725"], "529.982.247-25");
});

test("RG novo: número do registro e órgão emissor", () => {
  const f = Object.fromEntries(findFields(["REGISTRO GERAL 1.234.567", "ORGÃO EMISSOR SSP/MS", "NATURALIDADE CAMPO GRANDE - MS"]).map((x) => [x.key, x.value]));
  assert.equal(f["rg"], "1.234.567");
  assert.equal(f["issuer"], "SSP/MS");
  assert.equal(f["naturalness"], "CAMPO GRANDE - MS");
});

test("texto de várias leituras: vence a palavra mais confiante em cada lugar", () => {
  const w = (text: string, x0: number, confidence: number, y0 = 100): WordBox => ({ text, confidence, box: { x0, y0, x1: x0 + 150, y1: y0 + 30 } });
  const a = [w("FERNANDO", 100, 62), w("COUTINHO", 300, 95), w("BATISTA", 500, 40)];
  const b = [w("FERNANDO", 102, 96), w("COUTINH0", 301, 70), w("BATISTA", 501, 93)];
  assert.deepEqual(pickBestWords([a, b]).map((x) => x.text).sort(), ["BATISTA", "COUTINHO", "FERNANDO"]);
  const lines = mergePasses([a, b]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "FERNANDO COUTINHO BATISTA");
});

test("colunas diferentes viram linhas diferentes", () => {
  const w = (text: string, x0: number): WordBox => ({ text, confidence: 90, box: { x0, y0: 100, x1: x0 + 100, y1: 130 } });
  const lines = linesFromWords([w("NOME", 100), w("CRM/UF", 900)]);
  assert.deepEqual(lines.map((l) => l.text), ["NOME", "CRM/UF"]);
});

test("letras soltas nas pontas da linha (pedaços do desenho de fundo) são descartadas", () => {
  const w = (text: string, x0: number, confidence: number): WordBox => ({ text, confidence, box: { x0, y0: 100, x1: x0 + 60, y1: 130 } });
  const lines = linesFromWords([w("2", 100, 55), w("1)", 170, 50), w("NEIDE", 240, 93), w("COUTINHO", 310, 92), w("BATISTA", 390, 94), w("|", 460, 40)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "NEIDE COUTINHO BATISTA");
});

test("lixo de baixa confiança é descartado, mas rótulo conhecido nunca", async () => {
  const { isLikelyNoise } = await import("@/lib/ocr/find-fields");
  assert.equal(isLikelyNoise({ text: "Rem IE", confidence: 59 }), true);
  assert.equal(isLikelyNoise({ text: "NOME", confidence: 57 }), false);
  assert.equal(isLikelyNoise({ text: "FERNANDO COUTINHO BATISTA", confidence: 60 }), false);
  assert.equal(isLikelyNoise({ text: "texto do pdf", confidence: null }), false);
});

test("sem o rótulo NOME/FILIAÇÃO: o primeiro nome vira titular e os de baixo, filiação — ambos 'prováveis'", () => {
  const noLabels = CARD.filter((l) => !["NOME", "FILIAÇÃO"].includes(l.text));
  const fields = findFields(noLabels);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(byKey["name"].value, "FERNANDO COUTINHO BATISTA");
  assert.equal(byKey["name"].label, "Nome (provável)");
  assert.equal(byKey["filiation-0"].value, "NEIDE COUTINHO BATISTA");
  assert.equal(byKey["filiation-1"].value, "ADILSON FERNANDES BATISTA");
  assert.equal(byKey["filiation-0"].label, "Filiação (provável)");
});

test("texto de PDF (sem posições) não inventa filiação", () => {
  const f = findFields(["JOSE DA SILVA SANTOS", "MARIA DA SILVA", "ANA SOUZA"]);
  assert.deepEqual(f.map((x) => x.label), ["Nome (provável)"]);
});

test("isolar as letras apaga o desenho de fundo e mantém o texto escuro", async () => {
  const { isolateText } = await import("@/lib/ocr/binarize");
  const w = 400;
  const h = 200;
  const gray = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pattern = (x + y) % 6 < 3 ? 200 : 175; // desenho de segurança de baixo contraste
      const bar = y >= 90 && y < 97 && x >= 40 && x < 300; // "linha de texto" escura e fina
      gray[y * w + x] = bar ? 30 : pattern;
    }
  }
  const out = isolateText(gray, w, h, 1.6, 2.2);
  let bgSum = 0;
  let bgN = 0;
  for (let y = 10; y < 70; y++) for (let x = 10; x < 390; x++) { bgSum += out[y * w + x]; bgN++; }
  assert.ok(bgSum / bgN > 245, `o fundo não ficou branco: ${bgSum / bgN}`);
  assert.ok(out[93 * w + 150] < 80, `o texto ficou apagado: ${out[93 * w + 150]}`);
});

test("a inclinação da foto é estimada pelas linhas de texto", async () => {
  const { estimateSkew } = await import("@/lib/ocr/binarize");
  const w = 600;
  const h = 400;
  const img = new Uint8ClampedArray(w * h).fill(255);
  const tilt = (4 * Math.PI) / 180;
  for (let row = 0; row < 8; row++) {
    for (let x = 40; x < 560; x++) {
      for (let t = 0; t < 4; t++) {
        const y = Math.round(60 + row * 40 + t + (x - 300) * Math.tan(tilt));
        if (y >= 0 && y < h && (x % 14) < 10) img[y * w + x] = 20;
      }
    }
  }
  const angle = estimateSkew(img, w, h);
  assert.ok(Math.abs(Math.abs(angle) - 4) < 1.2, `ângulo estimado ${angle}`);
});

test("carteira com RG/órgão, título de eleitor e local de expedição — e nenhum nome inventado a partir de rótulos", () => {
  const f = Object.fromEntries(
    findFields([
      "CPF", "031.243.991-10", "RG/ÓRGÃO EMISSOR", "01285792 / SESP-MS", "TÍTULO DE ELEITOR", "SEÇÃO", "ZONA", "022105341945",
      "DATA DE NASCIMENTO", "04/04/1989", "NATURALIDADE", "TRÊS LAGOAS-MS", "LOCAL E DATA DE EXPEDIÇÃO", "CAMPO GRANDE-MS 03/06/2019",
    ].map((text) => ({ text, confidence: 90 }))).map((x) => [x.key, x.value]),
  );
  assert.equal(f["birth"], "04/04/1989");
  assert.equal(f["cpf-03124399110"], "031.243.991-10");
  assert.equal(f["rg"], "01285792");
  assert.equal(f["issuer"], "SESP/MS");
  assert.equal(f["voter"], "022105341945");
  assert.equal(f["naturalness"], "TRÊS LAGOAS-MS");
  assert.equal(f["issue"], "03/06/2019");
  assert.equal(f["name"], undefined);
});

test("palpite de nome não pega cabeçalho curto nem rótulo de outro campo", () => {
  const lines = ["CONSELHO FEDERAL DE MEDICINA", "GROSSO DO SUL", "TITULO DE ELEITOR", "FERNANDO COUTINHO BATISTA"].map((text) => ({ text, confidence: 90 }));
  const name = findFields(lines).find((x) => x.key === "name");
  assert.equal(name?.value, "FERNANDO COUTINHO BATISTA");
  assert.equal(findFields(["GROSSO DO SUL", "TITULO DE ELEITOR"].map((text) => ({ text, confidence: 90 }))).some((x) => x.key === "name"), false);
});

test("palavras da mesma frase não se separam em linhas por causa de ruído pequeno", () => {
  const w = (text: string, x0: number, y0 = 100, h = 36, confidence = 92): WordBox => ({ text, confidence, box: { x0, y0, x1: x0 + text.length * 22, y1: y0 + h } });
  // muitas palavrinhas de ruído (baixa altura) não podem encolher a "altura típica" e quebrar a frase
  const noise = Array.from({ length: 30 }, (_, i) => w("x", 40 + i * 5, 400 + i * 12, 9, 50));
  const lines = linesFromWords([...noise, w("FERNANDO", 100), w("COUTINHO", 100 + 8 * 22 + 26), w("BATISTA", 100 + 16 * 22 + 52)]);
  assert.ok(lines.some((l) => l.text === "FERNANDO COUTINHO BATISTA"));
});

test("cartão do CPF: reconhece o documento, acha o número pelo rótulo e não inventa filiação", () => {
  const at2 = (text: string, x0: number, y0: number, w = 400, h = 40): ReadLine => ({ text, confidence: 90, box: { x0, y0, x1: x0 + w, y1: y0 + h } });
  const fields = findFields([
    at2("MINISTÉRIO DA FAZENDA", 600, 100, 500), at2("Receita Federal", 600, 150, 400), at2("CPF", 600, 200, 150),
    at2("CADASTRO DE PESSOAS FÍSICAS", 600, 260, 700), at2("Número de Inscrição", 100, 330, 400, 30), at2("095.402.999-26", 100, 380, 500, 70),
    at2("Nome", 100, 500, 100, 30), at2("TAYNARA RAQUEL DE OLIVEIRA", 100, 540, 700), at2("Nascimento", 100, 640, 250, 30), at2("26/05/1994", 100, 680, 280),
  ]);
  const by = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  assert.equal(by["type"], "Cartão do CPF");
  assert.equal(by["cpf-09540299926"], "095.402.999-26");
  assert.equal(by["name"], "TAYNARA RAQUEL DE OLIVEIRA");
  assert.equal(by["birth"], "26/05/1994");
  assert.ok(!fields.some((f) => f.label.startsWith("Filiação")));
  assert.ok(!fields.some((f) => /CADASTRO|RECEITA/i.test(f.value) && f.label.startsWith("Nome")));
});

test("o tipo do documento é reconhecido mesmo com letras erradas, e 'título de eleitor' como campo não vira o tipo", async () => {
  const { detectDocumentType } = await import("@/lib/ocr/document-type");
  assert.equal(detectDocumentType(["M1NISTERIO DA FAZENDA", "CADASTRO DE PESSOAS FISICAS", "Numero de Inscrição"])?.id, "cpf");
  assert.equal(detectDocumentType(["CARTEIRA NACIONAL DE HABILITAÇÃO", "CAT. HAB. B"])?.id, "cnh");
  assert.equal(detectDocumentType(["TÍTULO DE ELEITOR", "SEÇÃO", "ZONA", "NATURALIDADE", "VÁLIDA COMO PROVA DE IDENTIDADE"])?.id, "rg");
  assert.equal(detectDocumentType(["JUSTIÇA ELEITORAL", "TÍTULO ELEITORAL"])?.id, "voter");
  assert.equal(detectDocumentType(["lista de compras", "pão e leite"]), null);
});

test("um número lido inteiro numa leitura não é trocado por pedaços de outra", () => {
  const w = (text: string, x0: number, x1: number, confidence: number): WordBox => ({ text, confidence, box: { x0, y0: 100, x1, y1: 160 } });
  const whole = [w("095.402.999-26", 100, 600, 91)];
  const pieces = [w("095.402", 100, 340, 96), w(".999-", 350, 480, 88)];
  const merged = mergePasses([pieces, whole]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "095.402.999-26");
});

test("zona e seção ignoram um dígito solto (sujeira) e aceitam o número de verdade", () => {
  const one = (lines: string[]) => Object.fromEntries(findFields(lines.map((text) => ({ text, confidence: 90 }))).map((f) => [f.key, f.value]));
  assert.equal(one(["SEÇÃO", "4"])["section"], undefined);
  assert.equal(one(["ZONA", "009"])["zone"], "009");
  assert.equal(one(["SEÇÃO", "0085"])["section"], "0085");
});

test("com o rótulo CPF lido mas sem número válido, falta ler: vale tentar mais uma leitura", async () => {
  const { missingExpectedFields } = await import("@/lib/ocr/find-fields");
  assert.equal(missingExpectedFields(["CPF", "031.243.99?-10"]), true);
  assert.equal(missingExpectedFields(["CPF", "031.243.991-10"]), false);
  assert.equal(missingExpectedFields(["lista de compras", "pão"]), false);
});

test("comprovante de Pix: valor, data e hora, pagador, recebedor, bancos, chave, autenticação e ID", () => {
  const lines = [
    "itaú", "Comprovante de Pix", "R$1.273,75", "Realizado em 10/11/2026 às 16:46:08", "DI", "SAULO GALVAO SABIONI", "CPF: *** 260.011",
    "Instituição: ITAÚ UNIBANCO S.A", "Para", "REOBOTE CONSULTORIA", "CPF: ***.858.570-**169", "Instituição: BANCO BRADESCO S.A.",
    "Chave Pix: 20085857000169", "Dados da transação", "Autenticação:", "CE848E76B5BE346EE67D3F3B7F73A61596CFC282", "ID da transação:",
    "E60701190202611101945DY5802DVGIT", "Realizada em: Celular", "Central de atendimento",
  ].map((text) => ({ text, confidence: 90 }));
  const f = Object.fromEntries(findFields(lines).map((x) => [x.key, x.value]));
  assert.equal(f["type"], "Comprovante de pagamento");
  assert.equal(f["pay-value"], "R$ 1.273,75");
  assert.equal(f["pay-datetime"], "10/11/2026 16:46:08");
  assert.equal(f["payer-name"], "SAULO GALVAO SABIONI");
  assert.equal(f["payer-bank"], "ITAÚ UNIBANCO S.A");
  assert.equal(f["payee-name"], "REOBOTE CONSULTORIA");
  assert.equal(f["payee-bank"], "BANCO BRADESCO S.A.");
  assert.equal(f["payee-key"], "20085857000169");
  assert.equal(f["pay-auth"], "CE848E76B5BE346EE67D3F3B7F73A61596CFC282");
  assert.equal(f["pay-id"], "E60701190202611101945DY5802DVGIT");
  // nenhum nome/filiação inventado a partir do título do comprovante
  assert.ok(!Object.keys(f).some((k) => k === "name" || k.startsWith("filiation")));
});

test("comprovante sem os cabeçalhos De/Para: o primeiro bloco é o pagador, o segundo o recebedor", () => {
  const f = Object.fromEntries(
    findFields(["Comprovante de transferência", "Valor R$ 500,00", "ANA LIMA", "CPF: ***.111.222-**", "Instituição: NUBANK", "JOÃO PEREIRA", "CNPJ: **.333.444/0001-**", "Instituição: INTER"].map((text) => ({ text, confidence: 90 }))).map((x) => [x.key, x.value]),
  );
  assert.equal(f["payer-name"], "ANA LIMA");
  assert.equal(f["payee-name"], "JOÃO PEREIRA");
  assert.equal(f["pay-value"], "R$ 500,00");
});
