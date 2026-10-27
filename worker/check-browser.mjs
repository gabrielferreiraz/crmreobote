/**
 * Teste do navegador, rodado pelo instalador do Windows antes de dizer "Pronto":
 * abre o Firefox do robô pelo MESMO caminho da coleta (com os consertos
 * automáticos de `launchFirefox`) e carrega a página de login da Servopa, sem
 * entrar. Assim "instalou" significa "o navegador abre neste computador".
 *
 * Saída: uma linha JSON `{ browser, site }` e o código combinado com
 * `Test-RoboBrowser` (windows/core.ps1): 0 = tudo certo; 2 = o Firefox abriu,
 * mas a Servopa não carregou agora (só aviso: não reprova a instalação);
 * 1 = o Firefox não abriu.
 */
import path from "node:path";
import { launchFirefox, passCloudflare } from "./lib/browser.mjs";
import { WORKER_DIR, workerDataDir } from "./lib/env.mjs";
import { asWorkerError } from "./lib/errors.mjs";
import { createWorkerLogger } from "./lib/logger.mjs";
import { acquireSingleInstance } from "./lib/single-instance.mjs";

const dataDir = workerDataDir();
const profileDir = path.resolve(dataDir, dataDir === WORKER_DIR ? ".profile" : "profile");
const servopaBaseUrl = process.env.SERVOPA_BASE_URL?.trim() || "https://www.consorcioservopa.com.br";
const log = createWorkerLogger();
const result = { browser: "failed", site: "skipped" };

let release = () => {};
try {
  release = acquireSingleInstance();
  log("Teste do navegador iniciado (instalador).");
  const context = await launchFirefox(profileDir, { log });
  result.browser = "ok";
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${servopaBaseUrl}/vendas/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await passCloudflare(page, "no teste");
    result.site = "ok";
  } catch (cause) {
    result.site = "failed";
    log(`Teste do navegador: o Firefox abriu, mas o site da Servopa nao carregou agora (${asWorkerError(cause).message}).`);
  } finally {
    await context.close().catch(() => {});
  }
  log(`Teste do navegador concluido: navegador ${result.browser}, site ${result.site}.`);
} catch (cause) {
  const error = asWorkerError(cause);
  result.error = error.message;
  log(`Teste do navegador falhou [${error.code}]: ${error.message}`);
} finally {
  release();
}

console.log(JSON.stringify(result));
process.exitCode = result.browser !== "ok" ? 1 : result.site === "failed" ? 2 : 0;
