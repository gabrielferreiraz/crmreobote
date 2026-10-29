/**
 * Motor de fórmulas das Planilhas (sem banco):
 *
 *   node --experimental-transform-types --import ./scripts/alias-loader.mjs --test scripts/test-sheets-formula.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileFormula,
  displayFormula,
  FormulaError,
  isoToSerial,
  recalcSheet,
  scalarToStored,
  serialToIso,
  storedToScalar,
  type FormulaColumn,
  type Scalar,
  type SheetForCalc,
} from "../lib/sheets/formula.ts";

// Planilha de exemplo: A=Nome, B=Valor (moeda), C=Qtd (número), D=Data, E=Status (texto), F=Total (fórmula)
const COLS: FormulaColumn[] = [
  { id: "cA", name: "Nome", type: "TEXT" },
  { id: "cB", name: "Valor", type: "CURRENCY" },
  { id: "cC", name: "Qtd", type: "NUMBER" },
  { id: "cD", name: "Data", type: "DATE" },
  { id: "cE", name: "Status", type: "TEXT" },
  { id: "cF", name: "Total", type: "NUMBER" },
  { id: "cG", name: "Pct", type: "PERCENT" },
];
const ROWS: SheetForCalc["rows"] = [
  { id: "r1", values: { cA: "Ana", cB: 1500, cC: 2, cD: "2026-01-10", cE: "Pago", cG: 10 } },
  { id: "r2", values: { cA: "Bruno", cB: 300, cC: 5, cD: "2026-02-15", cE: "Pendente" } },
  { id: "r3", values: { cA: "Carla", cB: 2000, cC: 1, cD: "2026-03-01", cE: "Pago" } },
  { id: "r4", values: { cA: "Davi", cC: 3, cE: "Pendente" } },
];

/** Avalia uma fórmula digitada (A1) como se estivesse em F{row}. */
function calc(formula: string, row = 2, extra: Partial<SheetForCalc> = {}): Scalar {
  const compiled = compileFormula(formula, row, COLS);
  if (!compiled.ok) throw new Error(compiled.error);
  const rows: SheetForCalc["rows"] = ROWS.map((r, i) => ({ ...r, formulas: i === row - 2 ? { cF: compiled.internal } : undefined }));
  const out = recalcSheet({ columns: COLS, rows, refs: {}, today: isoToSerial("2026-10-28"), ...extra });
  return out.results.get(ROWS[row - 2].id)!.get("cF")!;
}
const errCode = (v: Scalar) => (v instanceof FormulaError ? v.code : v);

test("aritmética e precedência do Excel", () => {
  assert.equal(calc("=1+2*3"), 7);
  assert.equal(calc("=(1+2)*3"), 9);
  assert.equal(calc("=2^3^2"), 64); // Excel: esquerda para a direita
  assert.equal(calc("=-2^2"), 4); // Excel: negação antes da potência
  assert.equal(calc("=10%"), 0.1);
  assert.equal(calc("=1,5+1,5"), 3);
  assert.equal(calc('="a"&"b"&1'), "ab1");
  assert.equal(errCode(calc("=1/0")), "#DIV/0!");
  assert.equal(errCode(calc('="x"+1')), "#VALOR!");
});

test("referências relativas, absolutas e da mesma linha", () => {
  assert.equal(calc("=B2*C2", 2), 3000);
  assert.equal(calc("=B3*C3", 3), 1500);
  assert.equal(calc("=$B$2+B4", 3), 3500);
  assert.equal(calc("=A1", 2), "Nome"); // linha 1 = cabeçalho
  assert.equal(calc("=B5", 2), 0); // =B5 com B5 vazia mostra 0, como no Excel
  assert.equal(calc("=G2", 2), 0.1); // 10% guardado como 10 vale 0,1
});

test("guardado ↔ exibido: colunas por id, linhas relativas", () => {
  const c = compileFormula("=SOMA(B2:B4)+$C$2*c3", 3, COLS);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(c.internal, "=SOMA(⟦cB|~-1⟧:⟦cB|~1⟧)+⟦$cC|$2⟧*⟦cC|~0⟧");
  assert.equal(displayFormula(c.internal, 3, COLS), "=SOMA(B2:B4)+$C$2*C3");
  // Arrastar para a linha de baixo: mesmo texto interno, referências relativas andam.
  assert.equal(displayFormula(c.internal, 4, COLS), "=SOMA(B3:B5)+$C$2*C4");
  // Coluna B movida para o fim: a fórmula acompanha.
  const moved = [COLS[0], ...COLS.slice(2), COLS[1]];
  assert.equal(displayFormula(c.internal, 3, moved), "=SOMA(G2:G4)+$B$2*B3");
  // Coluna excluída: #REF! (como no Excel).
  assert.equal(displayFormula(c.internal, 3, COLS.filter((x) => x.id !== "cB")), "=SOMA(#REF!:#REF!)+$B$2*B3");
  // Para o .xlsx: inglês, vírgula, ponto decimal.
  const x = compileFormula("=SE(B2>1,5;\"sim\";SOMA(C:C))", 2, COLS);
  assert.ok(x.ok && displayFormula(x.internal, 2, COLS, { english: true }) === '=IF(B2>1.5,"sim",SUM(C:C))');
});

test("nomes de função em português, inglês, sem acento e minúsculas", () => {
  assert.equal(calc("=soma(C2:C5)"), 11);
  assert.equal(calc("=SUM(C2:C5)"), 11);
  assert.equal(calc("=MEDIA(C2:C5)"), 2.75);
  assert.equal(calc("=Média(C2:C5)"), 2.75);
  const c = compileFormula("=sum(C2:C3)", 2, COLS);
  assert.ok(c.ok && displayFormula(c.internal, 2, COLS) === "=SOMA(C2:C3)");
  assert.equal(compileFormula("=XYZ(1)", 2, COLS).ok, false);
  assert.equal(compileFormula("=SOMA(1;", 2, COLS).ok, false);
  assert.equal(compileFormula("=Z5", 2, COLS).ok, false); // coluna inexistente
});

test("agregações e contagens", () => {
  assert.equal(calc("=SOMA(B:B)"), 3800);
  assert.equal(calc("=SOMA(B2:C3)"), 1807);
  assert.equal(calc("=MÁXIMO(B2:B5)"), 2000);
  assert.equal(calc("=MÍNIMO(B2:B5)"), 300);
  assert.equal(calc("=CONT.NÚM(B2:B5)"), 3);
  assert.equal(calc("=CONT.VALORES(B2:B5)"), 3);
  assert.equal(calc("=CONTAR.VAZIO(B2:B5)"), 1);
  assert.equal(calc("=MED(C2:C5)"), 2.5);
  assert.equal(calc("=MAIOR(C2:C5;2)"), 3);
  assert.equal(calc("=MENOR(C2:C5;1)"), 1);
  assert.equal(calc("=PRODUTO(C2:C3)"), 10);
  assert.equal(calc("=SUBTOTAL(9;B2:B5)"), 3800);
  assert.equal(errCode(calc("=MÉDIA(A2:A3)")), "#DIV/0!");
});

test("condicionais e critérios", () => {
  assert.equal(calc('=SE(B2>1000;"alto";"baixo")'), "alto");
  assert.equal(calc('=SE(B3>1000;"alto";"baixo")', 3), "baixo");
  assert.equal(calc("=SE(FALSO;1)"), false);
  assert.equal(calc('=SES(B2>5000;"a";B2>1000;"b";VERDADEIRO;"c")'), "b");
  assert.equal(calc("=E(B2>0;C2>0)"), true);
  assert.equal(calc("=OU(B2<0;C2<0)"), false);
  assert.equal(calc("=NÃO(VERDADEIRO)"), false);
  assert.equal(calc('=SOMASE(E2:E5;"Pago";B2:B5)'), 3500);
  assert.equal(calc('=SOMASE(B2:B5;">1000")'), 3500);
  assert.equal(calc('=CONT.SE(E2:E5;"Pend*")'), 2);
  assert.equal(calc('=CONT.SE(E2:E5;"<>Pago")'), 2);
  assert.equal(calc('=CONT.SE(C2:C5;">=3")'), 2);
  assert.equal(calc('=MÉDIASE(E2:E5;"Pago";B2:B5)'), 1750);
  assert.equal(calc('=SOMASES(B2:B5;E2:E5;"Pago";C2:C5;">1")'), 1500);
  assert.equal(calc('=CONT.SES(E2:E5;"Pendente";C2:C5;">4")'), 1);
  assert.equal(calc("=SEERRO(1/0;\"erro\")"), "erro");
  assert.equal(calc('=SENÃODISP(PROCV("x";A2:B5;2;FALSO);0)'), 0);
  assert.equal(calc("=ÉCÉL.VAZIA(B5)"), true);
  assert.equal(calc("=ÉNÚM(B2)"), true);
  assert.equal(calc("=ÉTEXTO(A2)"), true);
  assert.equal(calc("=ÉERROS(1/0)"), true);
});

test("agregações matriciais e com vários critérios", () => {
  assert.equal(calc("=SOMARPRODUTO(B2:B5;C2:C5)"), 6500);
  assert.equal(calc("=SOMARPRODUTO(C2:C5)"), 11);
  assert.equal(errCode(calc("=SOMARPRODUTO(B2:B5;C2:C4)")), "#VALOR!");
  assert.equal(calc('=MÁXIMOSES(B2:B5;E2:E5;"Pago")'), 2000);
  assert.equal(calc('=MÍNIMOSES(B2:B5;E2:E5;"Pago")'), 1500);
  assert.equal(calc('=MÉDIASES(B2:B5;E2:E5;"Pago")'), 1750);
  assert.equal(calc('=MÁXIMOSES(B2:B5;E2:E5;"Inexistente")'), 0);
  assert.equal(errCode(calc('=MÉDIASES(B2:B5;E2:E5;"Inexistente")')), "#DIV/0!");
});

test("procuras: PROCV, PROCX, ÍNDICE+CORRESP, PROCH", () => {
  assert.equal(calc('=PROCV("Bruno";A2:C5;2;FALSO)'), 300);
  assert.equal(calc('=PROCV("bruno";A2:C5;3;0)'), 5);
  assert.equal(errCode(calc('=PROCV("Zé";A2:C5;2;FALSO)')), "#N/D");
  assert.equal(errCode(calc('=PROCV("Ana";A2:C5;9;FALSO)')), "#REF!");
  assert.equal(calc('=PROCV("C*";A2:C5;2;FALSO)'), 2000);
  assert.equal(calc("=PROCV(2500;B2:B5;1)"), 2000); // aproximada ignora ordem? dados não ordenados: Excel também dá resultado de busca binária
  assert.equal(calc('=PROCX("Carla";A2:A5;B2:B5)'), 2000);
  assert.equal(calc('=PROCX("Zé";A2:A5;B2:B5;"não achou")'), "não achou");
  assert.equal(calc('=ÍNDICE(B2:B5;CORRESP("Carla";A2:A5;0))'), 2000);
  assert.equal(calc("=ÍNDICE(A2:C5;2;3)"), 5);
  assert.equal(calc('=PROCH("Qtd";A1:C5;3;FALSO)'), 5);
  assert.equal(calc('=ESCOLHER(2;"primeiro";"segundo";"terceiro")'), "segundo");
  assert.equal(errCode(calc("=ESCOLHER(4;1;2;3)")), "#VALOR!");
  assert.equal(calc('=CORRESPX("Carla";A2:A5)'), 3);
  assert.equal(calc('=CORRESPX("Pendente";E2:E5;0;-1)'), 4);
  assert.equal(calc('=CORRESPX("C*";A2:A5;2)'), 3);
  assert.equal(calc("=CORRESPX(4;C2:C5;-1)"), 4);
  assert.equal(errCode(calc('=CORRESPX("Zé";A2:A5)')), "#N/D");
});

test("texto", () => {
  assert.equal(calc('=CONCAT(A2;" - ";E2)'), "Ana - Pago");
  assert.equal(calc('=CONCATENAR("a";"b")'), "ab");
  assert.equal(calc('=UNIRTEXTO(", ";VERDADEIRO;A2:A5)'), "Ana, Bruno, Carla, Davi");
  assert.equal(calc('=ESQUERDA("Reobote";3)'), "Reo");
  assert.equal(calc('=DIREITA("Reobote";4)'), "bote");
  assert.equal(calc('=EXT.TEXTO("Reobote";3;2)'), "ob");
  assert.equal(calc('=NÚM.CARACT("abc")'), 3);
  assert.equal(calc('=MAIÚSCULA("ção")'), "ÇÃO");
  assert.equal(calc('=MINÚSCULA("ABC")'), "abc");
  assert.equal(calc('=PRI.MAIÚSCULA("joão da silva")'), "João Da Silva");
  assert.equal(calc('=ARRUMAR("  a   b ")'), "a b");
  assert.equal(calc('=SUBSTITUIR("a-b-c";"-";"/")'), "a/b/c");
  assert.equal(calc('=SUBSTITUIR("a-b-c";"-";"/";2)'), "a-b/c");
  assert.equal(calc('=LOCALIZAR("B";"abc")'), 2);
  assert.equal(errCode(calc('=PROCURAR("B";"abc")')), "#VALOR!");
  assert.equal(calc('=TEXTO(1234,5;"#.##0,00")'), "1.234,50");
  assert.equal(calc('=TEXTO(0,256;"0,0%")'), "25,6%");
  assert.equal(calc('=TEXTO(D2;"dd/mm/aaaa")'), "10/01/2026");
  assert.equal(calc('=TEXTO(D2;"dd ""de"" mmmm")'), "10 de janeiro");
  assert.equal(calc('=TEXTO(D2;"dd \\de mmmm")'), "10 de janeiro");
  assert.equal(calc('=VALOR("1.234,5")'), 1234.5);
  assert.equal(calc("=A2&B2"), "Ana1500");
  assert.equal(calc('=REPT("ab";3)'), "ababab");
  assert.equal(calc('=REPT("x";2,9)'), "xx");
  assert.equal(errCode(calc('=REPT("x";-1)')), "#VALOR!");
  assert.equal(calc('=TIRAR("a"&CARACT(10)&"b")'), "ab");
  assert.equal(calc("=CARACT(65)"), "A");
  assert.equal(calc("=CARACT(128)"), "€");
  assert.equal(calc('=CÓDIGO("A")'), 65);
  assert.equal(calc('=CÓDIGO("€")'), 128);
});

test("datas", () => {
  assert.equal(serialToIso(isoToSerial("2026-01-10")), "2026-01-10");
  assert.equal(isoToSerial("1900-03-01"), 61); // igual ao Excel
  assert.equal(calc("=HOJE()"), isoToSerial("2026-10-28"));
  assert.equal(calc("=D3-D2"), 36);
  assert.equal(calc("=DIAS(D3;D2)"), 36);
  assert.equal(calc("=ANO(D2)"), 2026);
  assert.equal(calc("=MÊS(D3)"), 2);
  assert.equal(calc("=DIA(D4)"), 1);
  assert.equal(calc("=DATA(2026;12;25)"), isoToSerial("2026-12-25"));
  assert.equal(calc('=DATADIF(D2;D4;"M")'), 1);
  assert.equal(calc('=DATADIF(D2;D4;"D")'), 50);
  assert.equal(calc("=DIATRABALHOTOTAL(D2;D3)"), 25); // 12/01 a 13/02: 15 + 10 dias úteis
  assert.equal(calc("=DIA.DA.SEMANA(D2)"), 7); // 10/01/2026 é sábado
  assert.equal(calc("=FIMMÊS(D3;0)"), isoToSerial("2026-02-28"));
  assert.equal(calc("=DATAM(D2;1)"), isoToSerial("2026-02-10"));
  assert.equal(calc('=D2>DATA(2026;1;1)'), true);
  assert.equal(calc("=NÚM.SEMANA(DATA(2026;1;4);1)"), 2);
  assert.equal(calc("=NÚM.SEMANA(DATA(2026;1;4);2)"), 1);
  assert.equal(calc("=NÚM.SEMANA(DATA(2026;1;1);21)"), 1);
  assert.equal(calc("=DIATRABALHO(DATA(2026;1;9);1)"), isoToSerial("2026-01-12"));
  assert.equal(calc("=DIATRABALHO(DATA(2026;1;9);1;DATA(2026;1;12))"), isoToSerial("2026-01-13"));
  assert.equal(calc("=DIATRABALHO(DATA(2026;1;12);-1)"), isoToSerial("2026-01-09"));
});

test("matemática", () => {
  assert.equal(calc("=ARRED(2,345;2)"), 2.35);
  assert.equal(calc("=ARRED(-2,5;0)"), -3);
  assert.equal(calc("=ARREDONDAR.PARA.CIMA(2,001;0)"), 3);
  assert.equal(calc("=ARREDONDAR.PARA.BAIXO(2,999;1)"), 2.9);
  assert.equal(calc("=INT(-2,5)"), -3);
  assert.equal(calc("=ABS(-4)"), 4);
  assert.equal(calc("=MOD(-3;2)"), 1);
  assert.equal(calc("=POTÊNCIA(2;10)"), 1024);
  assert.equal(calc("=RAIZ(16)"), 4);
  assert.equal(errCode(calc("=RAIZ(-1)")), "#NÚM!");
  assert.equal(calc("=ÉPAR(4,9)"), true);
  assert.equal(calc("=ÉIMPAR(-3,9)"), true);
  assert.equal(calc("=ARREDMULTB(10;3)"), 9);
  assert.equal(errCode(calc("=ARREDMULTB(10;-3)")), "#NÚM!");
  assert.equal(calc("=TRUNCAR(-8,9)"), -8);
  assert.equal(calc("=TRUNCAR(1234,56;-2)"), 1200);
  assert.equal(errCode(calc("=NÃO.DISP()")), "#N/D");
  assert.equal(calc('=SENÃODISP(NÃO.DISP();"ausente")'), "ausente");
});

test("fórmula que depende de fórmula, e referência circular", () => {
  const sheet: SheetForCalc = {
    columns: COLS,
    refs: {},
    rows: [
      { id: "r1", values: { cB: 10 }, formulas: { cC: "=⟦cB|~0⟧*2", cF: "=⟦cC|~0⟧+1" } },
      { id: "r2", values: {}, formulas: { cF: "=⟦cF|~0⟧+1" } },
    ],
  };
  const out = recalcSheet(sheet);
  assert.equal(out.results.get("r1")!.get("cC"), 20);
  assert.equal(out.results.get("r1")!.get("cF"), 21);
  assert.deepEqual(out.circular, ["F3"]);
});

test("resultado vira valor guardado conforme o tipo da coluna", () => {
  assert.deepEqual(scalarToStored("CURRENCY", 10.5), { value: 10.5 });
  assert.deepEqual(scalarToStored("PERCENT", 0.125), { value: 12.5 });
  assert.deepEqual(scalarToStored("DATE", isoToSerial("2026-05-01")), { value: "2026-05-01" });
  assert.deepEqual(scalarToStored("TEXT", 1.5), { value: "1,5" });
  assert.deepEqual(scalarToStored("CHECKBOX", true), { value: true });
  assert.deepEqual(scalarToStored("NUMBER", "abc"), { value: undefined, display: "abc" });
  assert.deepEqual(scalarToStored("NUMBER", new FormulaError("#DIV/0!")), { value: undefined, display: "#DIV/0!", error: true });
  assert.equal(storedToScalar("PERCENT", 50, {}), 0.5);
  assert.equal(storedToScalar("CONTACT", "id1", { id1: "Maria" }), "Maria");
});

// ─── Excluir/restaurar linhas reescreve referências (como o Excel) ──
import { remapFormulaRows, rowMapForInsertion, rowMapForRemoval } from "../lib/sheets/formula.ts";

test("excluir linha: referências abaixo sobem, à linha excluída viram #REF!, intervalo encolhe", () => {
  // 5 linhas de dados (linhas 2..6 do Excel); exclui a linha de dados 2 (= linha 3 do Excel).
  const map = rowMapForRemoval(5, new Set([2]));
  const show = (internal: string, ownBefore: number, ownAfter: number) =>
    displayFormula(remapFormulaRows(internal, ownBefore, ownAfter, map), ownAfter, COLS);
  const at = (a1: string, own: number) => {
    const c = compileFormula(a1, own, COLS);
    assert.ok(c.ok);
    return c.ok ? c.internal : "";
  };
  // Fórmula em B6 (linha de dados 5 → depois vira B5).
  assert.equal(show(at("=$C$5+C4", 6), 6, 5), "=$C$4+C3");
  assert.equal(show(at("=C3*2", 6), 6, 5), "=#REF!*2");
  assert.equal(show(at("=SOMA(C2:C6)", 6), 6, 5), "=SOMA(C2:C5)");
  assert.equal(show(at("=SOMA(C3:C3)", 6), 6, 5), "=SOMA(#REF!)");
  assert.equal(show(at("=SOMA(C:C)+A1", 6), 6, 5), "=SOMA(C:C)+A1");
  // Fórmula acima da linha excluída não muda.
  assert.equal(show(at("=C2", 2), 2, 2), "=C2");
});

test("restaurar linha: referências abaixo descem de volta", () => {
  const map = rowMapForInsertion(new Set([2]));
  const c = compileFormula("=$C$4+C3", 5, COLS);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(displayFormula(remapFormulaRows(c.internal, 5, 6, map), 6, COLS), "=$C$5+C4");
});

// ─── Funções novas (valores de referência da documentação pública de cada função) ──
test("financeiras: PGTO, VP, VF, NPER, TAXA, IPGTO, PPGTO, VPL, TIR", () => {
  const near = (v: Scalar, expected: number, digits = 2) => {
    assert.equal(typeof v, "number", `esperava número, veio ${String(v)}`);
    assert.ok(Math.abs((v as number) - expected) < Math.pow(10, -digits), `${v} ≠ ${expected}`);
  };
  near(calc("=PGTO(8%/12;10;10000)"), -1037.03); // exemplo clássico da documentação
  near(calc("=PGTO(0;10;1000)"), -100);
  near(calc("=VP(0,5%;60;-1000)"), 51725.56);
  near(calc("=VF(6%/12;10;-200;-500;1)"), 2581.4);
  near(calc("=NPER(12%/12;-100;-1000;10000;1)"), 59.67);
  near(calc("=TAXA(48;-200;8000)") as number, 0.0077, 4);
  near(calc("=IPGTO(10%/12;1;36;8000)"), -66.67);
  near(calc("=PPGTO(10%/12;1;24;2000)"), -75.62);
  near(calc("=VPL(10%;-10000;3000;4200;6800)"), 1188.44);
  // TIR: fluxo do exemplo da documentação (-70.000; 12.000; 15.000; 18.000; 21.000; 26.000) → 8,66%.
  const flows = [-70000, 12000, 15000, 18000, 21000, 26000];
  const tirSheet: SheetForCalc = {
    columns: COLS,
    refs: {},
    rows: flows.map((v, i) => ({ id: `t${i}`, values: { cB: v }, formulas: i === 0 ? { cF: (compileFormula("=TIR(B2:B7)", 2, COLS) as { internal: string }).internal } : undefined })),
  };
  near(recalcSheet(tirSheet).results.get("t0")!.get("cF")!, 0.0866, 4);
  assert.equal(errCode(calc("=TIR(B2:B4)")), "#NÚM!"); // só valores positivos: sem solução
});

test("estatísticas: desvio padrão, variância, moda, ordem, percentil, quartil", () => {
  const near = (v: Scalar, expected: number) => assert.ok(Math.abs((v as number) - expected) < 1e-6, `${String(v)} ≠ ${expected}`);
  near(calc("=DESVPAD.A(C2:C5)"), 1.707825128);
  near(calc("=DESVPAD.P(C2:C5)"), 1.479019946);
  near(calc("=VAR.A(C2:C5)"), 2.916666667);
  near(calc("=VARP(C2:C5)"), 2.1875);
  assert.equal(calc("=MODO(1;2;2;3;3)"), 2); // empate: o primeiro que aparece
  assert.equal(errCode(calc("=MODO(1;2;3)")), "#N/D");
  assert.equal(calc("=ORDEM(3;C2:C5)"), 2);
  assert.equal(calc("=ORDEM(3;C2:C5;1)"), 3);
  near(calc("=PERCENTIL(C2:C5;0,5)"), 2.5);
  near(calc("=QUARTIL(C2:C5;1)"), 1.75);
  assert.equal(errCode(calc("=QUARTIL(C2:C5;5)")), "#NÚM!");
  assert.equal(calc("=SOMAQUAD(3;4)"), 25);
  assert.equal(calc("=SUBTOTAL(10;C2:C5)"), calc("=VAR.A(C2:C5)"));
});

test("matemáticas: TETO, MARRED, SINAL, LOG, FATORIAL, MDC, MMC, QUOCIENTE, PAR, ÍMPAR", () => {
  assert.equal(calc("=TETO(2,5;1)"), 3);
  assert.equal(calc("=TETO(-2,5;-2)"), -4);
  assert.equal(calc("=TETO(-2,5;2)"), -2);
  assert.equal(errCode(calc("=TETO(2,5;-2)")), "#NÚM!");
  assert.equal(calc("=TETO.MAT(-5,5;2)"), -4);
  assert.equal(calc("=TETO.MAT(-5,5;2;1)"), -6);
  assert.equal(calc("=ARREDMULTB.MAT(-5,5;2)"), -6);
  assert.equal(calc("=TETO(0,234;0,01)"), 0.24);
  assert.equal(calc("=MARRED(10;3)"), 9);
  assert.equal(calc("=MARRED(1,3;0,2)"), 1.4);
  assert.equal(errCode(calc("=MARRED(5;-2)")), "#NÚM!");
  assert.equal(calc("=SINAL(-0,1)"), -1);
  assert.equal(calc("=LOG(8;2)"), 3);
  assert.equal(calc("=LOG10(1000)"), 3);
  assert.equal(errCode(calc("=LN(0)")), "#NÚM!");
  assert.equal(calc("=FATORIAL(5)"), 120);
  assert.equal(calc("=MDC(24;36)"), 12);
  assert.equal(calc("=MMC(4;6)"), 12);
  assert.equal(calc("=QUOCIENTE(-10;3)"), -3);
  assert.equal(calc("=PAR(1,5)"), 2);
  assert.equal(calc("=PAR(-1)"), -2);
  assert.equal(calc("=ÍMPAR(2)"), 3);
  assert.equal(calc("=ÍMPAR(-2,1)"), -3);
  assert.equal(calc("=ARRED(GRAUS(PI());6)"), 180);
});

test("lógicas e informação: XOU, PARÂMETRO, É*, TIPO, N, T", () => {
  assert.equal(calc("=XOU(VERDADEIRO;VERDADEIRO;VERDADEIRO)"), true);
  assert.equal(calc("=XOU(VERDADEIRO;VERDADEIRO)"), false);
  assert.equal(calc('=PARÂMETRO(E2;"Pago";"OK";"Pendente";"Aguardando";"?")'), "OK");
  assert.equal(calc('=PARÂMETRO(E3;"Pago";"OK";"?")', 3), "?");
  assert.equal(errCode(calc('=PARÂMETRO(E3;"Pago";"OK")', 3)), "#N/D");
  assert.equal(calc("=ÉLÓGICO(VERDADEIRO())"), true);
  assert.equal(calc("=ÉNÃOTEXTO(B2)"), true);
  assert.equal(calc("=ÉERRO(1/0)"), true);
  assert.equal(calc("=ÉERRO(NÃO.DISP())"), false);
  assert.equal(calc("=É.NÃO.DISP(NÃO.DISP())"), true);
  assert.equal(calc("=TIPO(A2)"), 2);
  assert.equal(calc("=TIPO(B2:C3)"), 64);
  assert.equal(calc("=N(VERDADEIRO)"), 1);
  assert.equal(calc('=T(B2)&"x"'), "x");
});

test("texto: EXATO, MUDAR, TEXTOANTES/DEPOIS, VALORNUMÉRICO, MOEDA, DEF.NÚM.DEC, UNICODE", () => {
  assert.equal(calc('=EXATO("Abc";"abc")'), false);
  assert.equal(calc('=MUDAR("abcdef";3;2;"XY")'), "abXYef");
  assert.equal(calc('=TEXTOANTES("a-b-c";"-")'), "a");
  assert.equal(calc('=TEXTOANTES("a-b-c";"-";-1)'), "a-b");
  assert.equal(calc('=TEXTODEPOIS("a-b-c";"-";2)'), "c");
  assert.equal(errCode(calc('=TEXTODEPOIS("abc";"-")')), "#N/D");
  assert.equal(calc('=VALORNUMÉRICO("2.500,27")'), 2500.27);
  assert.equal(calc('=VALORNUMÉRICO("1,000.5";".";",")'), 1000.5);
  assert.equal(calc('=VALORNUMÉRICO("15%")'), 0.15);
  assert.equal(calc("=MOEDA(1234,567)"), "R$ 1.234,57");
  assert.equal(calc("=MOEDA(-5;0)"), "-R$ 5");
  assert.equal(calc("=DEF.NÚM.DEC(1234,567;1)"), "1.234,6");
  assert.equal(calc("=DEF.NÚM.DEC(1234,567;1;VERDADEIRO)"), "1234,6");
  assert.equal(calc("=UNICODE(\"A\")"), 65);
  assert.equal(calc("=UNICARACT(9731)"), "☃");
});

test("data e hora: TEMPO, HORA, MINUTO, SEGUNDO, DATA.VALOR, VALOR.TEMPO, DIAS360, FRAÇÃOANO, NÚMSEMANAISO", () => {
  assert.equal(calc("=TEMPO(12;0;0)"), 0.5);
  assert.equal(calc("=HORA(0,75)"), 18);
  assert.equal(calc("=MINUTO(TEMPO(9;45;30))"), 45);
  assert.equal(calc("=SEGUNDO(TEMPO(9;45;30))"), 30);
  assert.equal(calc('=DATA.VALOR("25/12/2026")'), isoToSerial("2026-12-25"));
  assert.equal(calc('=VALOR.TEMPO("18:00")'), 0.75);
  assert.equal(calc('=TEXTO(TEMPO(8;5;0);"hh:mm")'), "08:05");
  assert.equal(calc("=DIAS360(DATA(2026;1;30);DATA(2026;2;28))"), 28);
  assert.equal(calc("=DIAS360(DATA(2026;1;31);DATA(2026;3;31))"), 60);
  assert.ok(Math.abs((calc("=FRAÇÃOANO(DATA(2026;1;1);DATA(2026;7;1))") as number) - 0.5) < 1e-9);
  assert.ok(Math.abs((calc("=FRAÇÃOANO(DATA(2026;1;1);DATA(2026;7;1);3)") as number) - 181 / 365) < 1e-9);
  assert.equal(calc("=NÚMSEMANAISO(DATA(2026;1;1))"), 1);
  assert.equal(calc("=NÚMSEMANAISO(DATA(2027;1;1))"), 53);
});

test("referência: LIN, COL, LINS, COLS, HIPERLINK", () => {
  assert.equal(calc("=LIN()", 3), 3);
  assert.equal(calc("=LIN(B5)"), 5);
  assert.equal(calc("=COL(C2)"), 3);
  assert.equal(calc("=LINS(A2:C5)"), 4);
  assert.equal(calc("=COLS(A2:C5)"), 3);
  assert.equal(calc('=HIPERLINK("https://reobote.com.br";"Site")'), "Site");
});

test("HOJE no fuso do Brasil, não no do computador (tela e servidor concordam)", async () => {
  const { todaySerial } = await import("../lib/sheets/formula.ts");
  // 01:30 UTC de 29/10 ainda é 28/10 em Campo Grande (UTC-4).
  assert.equal(todaySerial(new Date("2026-10-29T01:30:00Z")), isoToSerial("2026-10-28"));
  assert.equal(todaySerial(new Date("2026-10-29T05:00:00Z")), isoToSerial("2026-10-29"));
});

test("número vira texto com 15 dígitos significativos, como o Excel", async () => {
  const { generalNumber } = await import("../lib/sheets/formula.ts");
  assert.equal(generalNumber(1 / 3), "0,333333333333333");
  assert.equal(generalNumber(0.1 + 0.2), "0,3");
  assert.equal(generalNumber(1500), "1500");
  assert.equal(generalNumber(-2.5), "-2,5");
  assert.equal(generalNumber(123456789.125), "123456789,125");
  assert.equal(generalNumber(100000000000000), "100000000000000");
  assert.equal(generalNumber(500000000000000), "500000000000000");
  assert.equal(calc('=1/3&""'), "0,333333333333333");
});
