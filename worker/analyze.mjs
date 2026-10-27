import { readdirSync, readFileSync } from "node:fs";
const dir = process.argv[2] ?? ".probe/scan";
const files = readdirSync(dir).filter(f => /^\d+-[SL]\.json$/.test(f));
const d = {};
for (const f of files) { const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); (d[j.grupo] ??= {})[j.tp] = j; }
let comErro = 0, iguais = 0, difTabela = 0, difInfo = 0, difPre = 0, semTab = 0, multiAbas = 0, difAbasQtd = 0;
const exemplos = [], erros = [], prazos = new Set();
for (const [g, v] of Object.entries(d)) {
  const { S, L } = v;
  for (const x of [S, L]) if (x?.erro || !x?.tabs) { comErro++; erros.push(`${g}/${x?.tp}: ${x?.erro}`); }
  if (!S?.tabs || !L?.tabs) continue;
  if (S.tabs.length > 1) multiAbas++;
  if (!S.tabs.length) semTab++;
  const tS = JSON.stringify(S.tabs), tL = JSON.stringify(L.tabs);
  if (tS === tL) iguais++; else { difTabela++; if (exemplos.length < 3) exemplos.push(g); }
  if (JSON.stringify(S.info) !== JSON.stringify(L.info)) difInfo++;
  if (S.preMessage !== L.preMessage) difPre++;
  for (const t of S.tabs) for (const l of t.linhas) prazos.add(l[3]);
}
console.log({ grupos: Object.keys(d).length, arquivos: files.length, comErro, tabelasIguaisSL: iguais, tabelasDiferentesSL: difTabela, infoDifere: difInfo, preMessageDifere: difPre, gruposSemTabela: semTab, gruposComVariasAbas: multiAbas });
console.log("exemplos diferentes:", exemplos, "erros:", erros.slice(0, 5));
console.log("prazos distintos nas linhas:", [...prazos].sort((a, b) => a - b).join(","));
