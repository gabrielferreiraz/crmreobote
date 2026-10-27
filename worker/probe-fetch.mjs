import { openLoggedIn, passCloudflare } from "./lib-probe.mjs";
const { browser, page } = await openLoggedIn();
await Promise.all([page.waitForURL(/vendas\/grupos/), page.evaluate(() => document.querySelector(`a[href$="/vendas/grupos"]`).click())]);
await page.waitForLoadState("load"); await passCloudflare(page); await page.waitForSelector("#frm_representante_grupo"); await new Promise(r => setTimeout(r, 1500));
const res = await page.evaluate(async () => {
  const out = {};
  const check = async (nome, url, init) => {
    const r = await fetch(url, { credentials: "same-origin", ...init });
    const h = await r.text();
    out[nome] = { status: r.status, len: h.length, redirected: r.redirected, url: r.url, temInfoGrupo: /Informa..es do Grupo: ?\d+/.test(h), temTaxaAdm: /Taxa de Adm/i.test(h), titulo: (h.match(/<h3>([^<]*)<\/h3>/) || [])[1] };
  };
  await check("post_grupo", location.origin + "/vendas/grupos", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "tp_lance=S&grupofrm=1511" });
  await check("post_grupo_com_segmento", location.origin + "/vendas/grupos", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "segmento=I&tp_lance=S&grupofrm=1511" });
  await check("get_visualizar", location.origin + "/vendas/grupos/1511/S", {});
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
