import { openLoggedIn, base } from "./lib-probe.mjs";
const { browser, page } = await openLoggedIn();
const links = await page.$$eval("a", as => as.map(a => [a.textContent.trim().replace(/\s+/g, " ").slice(0, 40), a.href]).filter(([t, h]) => t && h && !h.startsWith("javascript")));
console.log(links.map(l => l.join("  ->  ")).join("\n"));
await browser.close();
