// Apoio aos scripts de diagnóstico locais (fast.mjs, probe-*.mjs): lê o .env do
// desenvolvedor e delega ao módulo de produção (lib/browser.mjs). NÃO faz parte
// do instalador — o robô instalado recebe o acesso da Servopa pelo CRM.
import { loadWorkerEnv } from "./lib/env.mjs";
import { openLoggedIn as openBrowserSession, passCloudflare } from "./lib/browser.mjs";

loadWorkerEnv();
export const base = process.env.SERVOPA_BASE_URL;

export { passCloudflare };

export function openLoggedIn(config = {}) {
  return openBrowserSession({
    servopaBaseUrl: config.servopaBaseUrl ?? base,
    servopaUser: config.servopaUser ?? process.env.SERVOPA_USER,
    servopaPassword: config.servopaPassword ?? process.env.SERVOPA_PASS,
    profileDir: config.profileDir,
  });
}
