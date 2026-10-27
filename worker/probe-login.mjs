// Fase 0 — só leitura: abre /vendas/grupos, registra para onde redireciona e o formulário de login.
import { firefox } from "playwright-core";
import { writeFileSync } from "node:fs";

const base = process.env.SERVOPA_BASE_URL ?? "https://www.consorcioservopa.com.br";
const browser = await firefox.launch({ headless: true });
const page = await browser.newPage();
const resp = await page.goto(`${base}/vendas/grupos/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);
console.log("status:", resp?.status(), "url final:", page.url(), "title:", await page.title());
await page.screenshot({ path: ".probe/01-login.png", fullPage: true });
writeFileSync(".probe/01-login.html", await page.content());
const fields = await page.$$eval("input, button, form", els =>
  els.map(e => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, placeholder: e.placeholder, text: (e.textContent || "").trim().slice(0, 40), action: e.action })));
console.log(JSON.stringify(fields, null, 1));
await browser.close();
