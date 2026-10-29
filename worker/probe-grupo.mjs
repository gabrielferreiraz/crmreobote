import { openLoggedIn, passCloudflare } from "./lib-probe.mjs";
import { writeFileSync } from "node:fs";
const { browser, page } = await openLoggedIn();
await Promise.all([page.waitForURL(/vendas\/grupos/), page.evaluate(() => document.querySelector(`a[href$="/vendas/grupos"]`).click())]);
await page.waitForLoadState("load"); await page.waitForTimeout(3000);
await Promise.all([page.waitForLoadState("load"), page.evaluate(() => {
  document.querySelector("input[name=segmento][value=I]").checked = true;
  document.querySelector("input[name=tp_lance][value=S]").checked = true;
  document.querySelector("#frm_representante_grupo").submit();
})]);
await page.waitForSelector("table tbody tr");
await Promise.all([page.waitForURL(/1511/), page.evaluate(() => document.querySelector('a[href$="/vendas/grupos/1511/S"]').click())]);
await page.waitForLoadState("load"); await passCloudflare(page); await page.waitForTimeout(2500);
console.log("url:", page.url());
await page.screenshot({ path: ".probe/07-grupo.png", fullPage: true });
writeFileSync(".probe/07-grupo.html", await page.content());
await browser.close();
