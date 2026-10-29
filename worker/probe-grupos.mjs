// Fase 0 — só leitura: login + página de busca de grupos (sem clicar em nada de venda).
import { firefox } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const base = process.env.SERVOPA_BASE_URL;
const browser = await firefox.launch({ headless: false });
const page = await browser.newPage();
await page.goto(`${base}/vendas/grupos/`, { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i = 0; i < 20 && (await page.title()) === "Just a moment..."; i++) await page.waitForTimeout(1500);
await page.fill("#representante_cpf_cnpj", process.env.SERVOPA_USER);
await page.fill("#representante_senha", process.env.SERVOPA_PASS);
await page.click("#btn_representante", { noWaitAfter: true, timeout: 10000 }).catch(e => console.log("click:", String(e.message).slice(0, 80)));
await page.waitForTimeout(6000);
await page.screenshot({ path: ".probe/02b-pos-login.png" });
console.log("após login:", page.url(), "|", await page.title());
await page.goto(`${base}/vendas/grupos/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("grupos:", page.url(), "|", await page.title());
await page.screenshot({ path: ".probe/03-grupos.png", fullPage: true });
writeFileSync(".probe/03-grupos.html", await page.content());
const fields = await page.$$eval("form input, form button, form select", els =>
  els.map(e => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, value: e.type === "radio" ? e.value : undefined })));
console.log(JSON.stringify(fields));
await browser.close();
