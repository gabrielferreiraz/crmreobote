// Varredura completa (SOMENTE LEITURA): lista de grupos (M/I × S/L) + página de cada grupo (S e L).
// Retomável: pula o que já existe em .probe/scan/. Nunca visita links "Vender".
import { openLoggedIn, passCloudflare } from "./lib-probe.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = ".probe/scan";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pause = () => sleep(1000 + Math.random() * 1200);

const { browser, page } = await openLoggedIn();

async function settle() {
  await page.waitForLoadState("load");
  await passCloudflare(page);
  await page.waitForSelector("#frm_representante_grupo", { timeout: 30000 });
  await sleep(700);
}

async function openGrupos() {
  await Promise.all([page.waitForURL(/vendas\/grupos/), page.evaluate(() => document.querySelector(`a[href$="/vendas/grupos"]`).click())]);
  await settle();
}

async function submit({ segmento, tp, grupo = "" }) {
  await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 60000 }), page.evaluate(({ segmento, tp, grupo }) => {
    document.querySelectorAll("input[name=segmento]").forEach(r => (r.checked = r.value === segmento));
    document.querySelectorAll("input[name=tp_lance]").forEach(r => (r.checked = r.value === tp));
    document.querySelector("#grupofrm").value = grupo;
    document.querySelector("#frm_representante_grupo").submit();
  }, { segmento, tp, grupo })]);
  await settle();
}

const txt = s => (s ?? "").replace(/\s+/g, " ").trim();

async function parseList() {
  return page.$$eval("table tbody tr, table tr", trs => trs.map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent.replace(/\s+/g, " ").trim())).filter(c => c.length >= 7 && /^\d+$/.test(c[0]))
    .map(c => ({ grupo: c[0], segmento: c[1], meses: c[2], assembleia: c[3], lance: c[4], contemplados: c[5], vagas: c[6] })));
}

async function parseGrupo() {
  return page.evaluate(() => {
    const t = s => (s ?? "").replace(/\s+/g, " ").trim();
    const info = document.querySelector(".grupo-info");
    if (!info) return { erro: t(document.querySelector(".error-view")?.textContent) || "sem .grupo-info" };
    const titulo = t(document.querySelector(".grupos > h3")?.textContent);
    const preMessage = (info.querySelector(".pre-message")?.innerText ?? "").trim();
    const infoRows = {};
    info.querySelectorAll(":scope > .table-wrapper table tr").forEach(tr => {
      const td = tr.querySelectorAll("td"); if (td.length >= 2) infoRows[t(td[0].textContent)] = t(td[1].textContent);
    });
    const tabLabels = [...info.querySelectorAll(".assets .tabs a")].map(a => t(a.textContent));
    const tabs = [...info.querySelectorAll(".assets > .tab")].map((tab, i) => ({
      aba: tabLabels[i] ?? null,
      linhas: [...tab.querySelectorAll("tbody tr")].map(tr => [...tr.querySelectorAll("td")].slice(0, 9).map(td => t(td.textContent))),
      cabecalho: [...tab.querySelectorAll("thead th")].map(th => t(th.textContent)),
    }));
    return { titulo, preMessage, info: infoRows, tabs };
  });
}

const listas = {};
await openGrupos();
for (const segmento of ["I", "M"]) for (const tp of ["S", "L"]) {
  await submit({ segmento, tp });
  const rows = await parseList();
  listas[`${segmento}${tp}`] = rows;
  console.log(`lista ${segmento}/${tp}: ${rows.length} grupos`);
  await pause();
}
writeFileSync(`${OUT}/_listas.json`, JSON.stringify(listas, null, 1));

const grupos = new Map(); // grupo -> segmento
for (const [k, rows] of Object.entries(listas)) for (const r of rows) grupos.set(r.grupo, r.segmento);
console.log("grupos únicos:", grupos.size);

let n = 0, falhas = 0;
for (const [grupo, segmento] of grupos) for (const tp of ["S", "L"]) {
  const f = `${OUT}/${grupo}-${tp}.json`;
  if (existsSync(f)) continue;
  try {
    await submit({ segmento, tp, grupo });
    const dados = await parseGrupo();
    writeFileSync(f, JSON.stringify({ grupo, segmento, tp, ...dados }, null, 1));
    n++;
    if (dados.erro) { falhas++; console.log(`  ${grupo}/${tp}: ${dados.erro}`); }
  } catch (e) {
    console.log(`ERRO ${grupo}/${tp}: ${String(e.message).split("\n")[0]}`);
    falhas++;
    if (/Cloudflare/.test(e.message) || falhas > 8) { console.log("abortando (retomável)"); break; }
    await openGrupos().catch(() => {});
  }
  if (n % 20 === 0) console.log(`progresso: ${n} páginas`);
  await pause();
}
console.log(`fim: ${n} páginas novas, ${falhas} falhas`);
await browser.close();
