import { execFile, spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { firefox } from "playwright-core";
import { WORKER_DIR } from "./env.mjs";
import { WorkerError } from "./errors.mjs";

const CLOUDFLARE_TITLE = "Just a moment...";
const execFileAsync = promisify(execFile);

/**
 * Título da página, ou `null` enquanto ela navega. No primeiro acesso de um
 * computador novo (perfil vazio) o Cloudflare recarrega a página sozinho, e
 * ler o título nesse instante lança "Execution context was destroyed".
 */
async function pageTitle(page) {
  try {
    return await page.title();
  } catch {
    return null;
  }
}

/** Espera o desafio do Cloudflare ("Just a moment...") se resolver sozinho. */
export async function passCloudflare(page, label = "") {
  for (let attempt = 0; attempt < 60; attempt++) {
    const title = await pageTitle(page);
    if (title !== null && title !== CLOUDFLARE_TITLE) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return;
    }
    await page.waitForTimeout(1_000);
  }
  throw new WorkerError("CLOUDFLARE_BLOCKED", `O Cloudflare nao liberou o acesso ${label}.`);
}

/**
 * Encerra Firefox do robô que ficou para trás (de uma queda anterior) e
 * segura o perfil, travando a próxima abertura. Só toca em executáveis da
 * pasta de navegadores do robô — nunca no Firefox pessoal do usuário. A trava
 * de instância única garante que nenhum outro robô está usando essa pasta.
 */
function stopOrphanRobotFirefox() {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform !== "win32" || !browsers) return;
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Process firefox -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:ROBO_BROWSERS, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force",
    ],
    { env: { ...process.env, ROBO_BROWSERS: browsers }, windowsHide: true, timeout: 30_000 },
  );
}

/** Travas que um Firefox derrubado deixa no perfil. Só chamar depois de `stopOrphanRobotFirefox`. */
function removeStaleProfileLocks(profileDir) {
  for (const name of ["parent.lock", "lock", ".parentlock"]) {
    try {
      rmSync(path.join(profileDir, name), { force: true });
    } catch {}
  }
}

/**
 * Perfil novo: o antigo vira `<perfil>-com-problema` (só o último é guardado,
 * para diagnóstico). Perde-se só a liberação do Cloudflare, que o Firefox com
 * janela refaz sozinho em segundos.
 */
function replaceProfile(profileDir) {
  const broken = `${profileDir}-com-problema`;
  rmSync(broken, { recursive: true, force: true });
  if (existsSync(profileDir)) renameSync(profileDir, broken);
}

/** Baixa o Firefox do robô de novo por cima do atual (arquivo corrompido ou apagado pelo antivírus). */
async function reinstallRobotFirefox() {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const cli = path.join(WORKER_DIR, "node_modules", "playwright-core", "cli.js");
  if (!browsers || !existsSync(cli)) return false;
  await execFileAsync(process.execPath, [cli, "install", "--force", "firefox"], { cwd: WORKER_DIR, windowsHide: true, timeout: 15 * 60_000 });
  return true;
}

const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Abre o Firefox do robô consertando o que costuma impedir a abertura, do mais
 * leve ao mais pesado, e registra cada passo. Caso real (27/10/2026): o Firefox
 * travou ao abrir duas vezes seguidas e a coleta parou. Mesmo caminho usado no
 * teste do instalador (`check-browser.mjs`), então "instalou" = "o navegador abre".
 */
export async function launchFirefox(profileDir, { log = () => {} } = {}) {
  const steps = [
    { label: "abrindo o Firefox", repair: async () => {} },
    {
      label: "fechando Firefox travado e liberando o perfil",
      repair: async () => {
        stopOrphanRobotFirefox();
        removeStaleProfileLocks(profileDir);
      },
    },
    {
      label: "usando um perfil novo",
      repair: async () => {
        stopOrphanRobotFirefox();
        replaceProfile(profileDir);
      },
    },
    {
      label: "baixando o Firefox do robo de novo",
      repair: async () => {
        stopOrphanRobotFirefox();
        if (!(await reinstallRobotFirefox())) throw new Error("reinstalacao indisponivel fora do computador instalado");
        replaceProfile(profileDir);
      },
    },
  ];
  let lastError;
  for (const [index, step] of steps.entries()) {
    try {
      await step.repair();
      if (index > 0) log(`Firefox: tentativa ${index + 1} de ${steps.length} (${step.label}).`);
      const context = await firefox.launchPersistentContext(profileDir, { headless: false, timeout: LAUNCH_TIMEOUT_MS });
      if (index > 0) log(`Firefox abriu na tentativa ${index + 1} (${step.label}).`);
      return context;
    } catch (cause) {
      lastError = cause;
      const first = (cause instanceof Error ? cause.message : String(cause)).split("\n")[0].slice(0, 300);
      log(`Firefox nao abriu (${step.label}): ${first}`);
    }
  }
  // Um Firefox travado não pode segurar o perfil até a próxima tentativa.
  stopOrphanRobotFirefox();
  // O CRM mostra esta frase; "este computador" deixa claro que não é a Servopa.
  throw new WorkerError("BROWSER_START_FAILED", "O navegador do robo (Firefox) nao abriu neste computador.", { cause: lastError });
}

/**
 * Faixa no topo da página do painel avisando quem estiver no computador que a
 * janela é do robô e fecha sozinha. Só muda o DOM local; nunca é aplicada na
 * página de desafio do Cloudflare.
 */
export async function showRobotBanner(page) {
  await page.evaluate(() => {
    if (document.getElementById("reobote-robo-servopa")) return;
    const banner = document.createElement("div");
    banner.id = "reobote-robo-servopa";
    banner.textContent = "Robô Servopa atualizando as tabelas do CRM. Não feche esta janela: ela fecha sozinha ao terminar.";
    banner.setAttribute(
      "style",
      "position:fixed;inset:0 0 auto 0;z-index:2147483647;padding:14px 20px;background:#4f46e5;color:#fff;" +
        "font:600 16px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)",
    );
    document.body.appendChild(banner);
  }).catch(() => {});
}

/**
 * Abre o Firefox (com janela, perfil persistente) e entra no painel da Servopa.
 * As credenciais vêm de `config` — em produção, entregues pelo CRM junto com a
 * coleta; nunca lidas de arquivo neste módulo.
 */
export async function openLoggedIn(config = {}, { log } = {}) {
  const { servopaBaseUrl, servopaUser, servopaPassword } = config;
  const profileDir = config.profileDir ?? `${WORKER_DIR}/.profile`;
  if (!servopaBaseUrl || !servopaUser || !servopaPassword) {
    throw new WorkerError("CONFIG_INVALID", "O acesso da Servopa nao foi informado ao robo.", { retryable: false });
  }

  const context = await launchFirefox(profileDir, { log });
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page.goto(`${servopaBaseUrl}/vendas/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await passCloudflare(page, "na entrada");
    if (/\/vendas\/login/.test(page.url())) {
      // Num computador novo (sem cache) a página demora a carregar e o overlay
      // do pace.js fica por cima do botão: espera o carregamento terminar e,
      // se o clique ainda assim for interceptado, clica direto no elemento.
      await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
      await page.waitForFunction(() => !document.body?.classList.contains("pace-running"), null, { timeout: 15_000 }).catch(() => {});
      await page.fill("#representante_cpf_cnpj", servopaUser);
      await page.fill("#representante_senha", servopaPassword);
      const button = page.locator("#btn_representante");
      await button.click({ noWaitAfter: true, timeout: 10_000 }).catch(() => button.evaluate((element) => element.click()));
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForURL(/\/vendas\/dashboard/, { timeout: 30_000 }).catch(() => {});
      await passCloudflare(page, "apos o login");
      if (/\/vendas\/login/.test(page.url())) {
        throw new WorkerError("SERVOPA_AUTH_FAILED", "CPF/CNPJ ou senha da Servopa foram recusados.", { retryable: false });
      }
    }
    if (!/\/vendas\/dashboard/.test(page.url())) {
      throw new WorkerError("SERVOPA_LAYOUT_CHANGED", "A Servopa nao abriu o painel esperado.");
    }
    await showRobotBanner(page);
    return { context, page };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
