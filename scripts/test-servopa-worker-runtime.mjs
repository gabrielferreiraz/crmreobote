import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { test } from "node:test";
import { CrmClient, WORKER_VERSION } from "../worker/lib/crm-client.mjs";
import { WorkerError } from "../worker/lib/errors.mjs";
import { createWorkerLogger } from "../worker/lib/logger.mjs";
import { acquireSingleInstance } from "../worker/lib/single-instance.mjs";
import { createStatusWriter } from "../worker/lib/status.mjs";

function scratch(context) {
  const root = path.resolve(".scratch");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, "servopa-worker-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** CRM simulado: `handler(request, body)` devolve { status, body, headers }. */
async function fakeCrm(context, handler) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ url: request.url, headers: request.headers, body: parsed });
      const reply = handler(request, parsed);
      response.writeHead(reply.status ?? 200, { "Content-Type": "application/json", ...(reply.headers ?? {}) });
      response.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

const KEY = `svw_${"k".repeat(43)}`;

/** Roda o robô de verdade (`worker/run.mjs`) como o iniciador do Windows faz. */
function runWorker(context, crmUrl, extraEnv = {}, args = []) {
  const dataDir = scratch(context);
  const env = {
    ...process.env,
    CRM_BASE_URL: crmUrl,
    SERVOPA_WORKER_KEY: KEY,
    SERVOPA_DATA_DIR: dataDir,
    SERVOPA_POLL_SECONDS: "15",
    SERVOPA_CONCURRENCY: "2",
    // Vazios (e não ausentes) para o robô não completar com o worker/.env do desenvolvedor.
    SERVOPA_USER: "",
    SERVOPA_PASS: "",
    SERVOPA_BASE_URL: "",
    SERVOPA_PROFILE_DIR: "",
    SERVOPA_APP_VERSION: "",
    SERVOPA_UPDATE_BLOCKED: "",
    ...extraEnv,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["worker/run.mjs", ...args], { env, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("o robô não terminou a tempo"));
    }, 20_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, dataDir });
    });
  });
}

test("cliente envia a credencial somente no Authorization e identifica a versao", async (context) => {
  const crm = await fakeCrm(context, () => ({ body: { job: null } }));
  const client = new CrmClient({ crmBaseUrl: crm.url, workerKey: KEY });

  assert.deepEqual(await client.claim(), { job: null });
  const [received] = crm.requests;
  assert.equal(received.url, "/api/servopa-worker/claim");
  assert.equal(received.headers.authorization, `Bearer ${KEY}`);
  assert.equal(received.headers["x-servopa-worker-version"], WORKER_VERSION);
  assert.deepEqual(received.body, {});
  assert.equal(JSON.stringify(received.body).includes(KEY), false);
});

test("cliente guarda a versao do robo anunciada pelo CRM, inclusive em respostas de erro", async (context) => {
  let status = 200;
  const crm = await fakeCrm(context, () => ({
    status,
    body: status === 200 ? { job: null } : { error: "Acesso pendente", code: "PANEL_CREDENTIALS_MISSING" },
    headers: { "X-Servopa-App-Version": status === 200 ? "0.3.0+aaaaaaaaaa" : "0.3.0+bbbbbbbbbb" },
  }));
  const client = new CrmClient({ crmBaseUrl: crm.url, workerKey: KEY });
  await client.claim();
  assert.equal(client.latestAppVersion, "0.3.0+aaaaaaaaaa");
  status = 503;
  await assert.rejects(() => client.claim(), (error) => error.code === "PANEL_CREDENTIALS_MISSING" && error.retryable);
  assert.equal(client.latestAppVersion, "0.3.0+bbbbbbbbbb");
});

test("erro do CRM nao inclui a credencial na mensagem", async (context) => {
  const crm = await fakeCrm(context, () => ({ status: 401, body: { error: "Credencial invalida" } }));
  const client = new CrmClient({ crmBaseUrl: crm.url, workerKey: KEY });
  await assert.rejects(
    () => client.claim(),
    (error) => error instanceof WorkerError && error.code === "CRM_HTTP_401" && error.message === "Credencial invalida" && !error.message.includes(KEY),
  );
});

test("coletor e configuracao preservam os limites operacionais", () => {
  const collector = readFileSync("worker/lib/collector.mjs", "utf8");
  const env = readFileSync("worker/lib/env.mjs", "utf8");
  const runtime = readFileSync("worker/run.mjs", "utf8");
  assert.match(collector, /\/vendas\/grupos\/\$\{input\.groupNumber\}\/S/);
  assert.doesNotMatch(collector, /vendas-consorcio|tp_lance:\s*["']L["']/);
  assert.match(env, /concurrency > 2/);
  assert.match(env, /url\.protocol !== "https:"/);
  assert.match(runtime, /error\.code === "JOB_CANCELLED"/);
  assert.match(runtime, /!uploadStarted && !interrupted/);
});

// Falhas encontradas no teste ponta a ponta de 26/10/2026 num perfil do Firefox vazio
// (primeiro acesso de um computador recém-instalado). Não podem voltar.
test("primeiro acesso de um computador novo: Cloudflare, login lento e bloqueio no meio da coleta", () => {
  const browser = readFileSync("worker/lib/browser.mjs", "utf8");
  const collector = readFileSync("worker/lib/collector.mjs", "utf8");
  // O Cloudflare recarrega a página sozinho: ler o título nesse instante não pode derrubar a coleta.
  assert.match(browser, /async function pageTitle\(page\) \{\s*try \{\s*return await page\.title\(\);\s*\} catch \{\s*return null;/);
  // Sem cache, o overlay do pace.js cobre o botão "Continuar": espera e, se preciso, clica direto no elemento.
  assert.match(browser, /classList\.contains\("pace-running"\)/);
  assert.match(browser, /button\.evaluate\(\(element\) => element\.click\(\)\)/);
  // Firefox do robô que ficou para trás é encerrado só pela pasta do robô (nunca o Firefox pessoal).
  assert.match(browser, /\$_\.Path\.StartsWith\(\$env:ROBO_BROWSERS/);
  // Bloqueio no meio: devolve o grupo à fila, recarrega a página e continua (até 2 vezes).
  assert.match(collector, /queue\.unshift\(row\)/);
  assert.match(collector, /recoveries >= 2/);
  assert.match(collector, /await page\.reload\(/);
  // A causa técnica de uma falha vai para o registro local.
  assert.match(readFileSync("worker/run.mjs", "utf8"), /describeCause\(error\)/);
});

test("lock impede duas instancias e libera uma execucao encerrada", (context) => {
  const lock = path.join(scratch(context), "worker.lock");
  const release = acquireSingleInstance(lock);
  assert.throws(
    () => acquireSingleInstance(lock),
    (error) => error instanceof WorkerError && error.code === "ALREADY_RUNNING",
  );
  release();
  const releaseAgain = acquireSingleInstance(lock);
  releaseAgain();
});

test("logger remove segredos e quebras de linha antes de persistir", (context) => {
  const directory = scratch(context);
  const secret = "segredo-local-123";
  const originalLog = console.log;
  console.log = () => {};
  try {
    createWorkerLogger([secret], directory)(`falha\nBearer token-visivel ${secret}`);
  } finally {
    console.log = originalLog;
  }
  const content = readFileSync(path.join(directory, readdirSync(directory)[0]), "utf8");
  assert.doesNotMatch(content, /token-visivel|segredo-local-123|\n.*falha/);
  assert.match(content, /Bearer \[REDACTED\].*\[REDACTED\]/);
});

test("logger passa a mascarar o acesso da Servopa entregue pelo CRM depois de iniciar", (context) => {
  const directory = scratch(context);
  const user = "12345678000199";
  const password = "senha-entregue-pelo-crm";
  const originalLog = console.log;
  console.log = () => {};
  try {
    const log = createWorkerLogger([], directory);
    log(`antes: ${user} ${password}`);
    log.addSecrets([user, password, undefined]);
    log(`depois: usuario ${user} senha ${password}`);
  } finally {
    console.log = originalLog;
  }
  const content = readFileSync(path.join(directory, readdirSync(directory)[0]), "utf8");
  const [before, after] = content.trim().split("\n");
  assert.match(before, new RegExp(password), "antes de conhecer o segredo ele ainda não é mascarado (esperado)");
  assert.doesNotMatch(after, new RegExp(`${user}|${password}`));
  assert.match(after, /usuario \[REDACTED\] senha \[REDACTED\]/);
});

test("status para o icone do Windows e gravado por inteiro", (context) => {
  const file = path.join(scratch(context), "status.json");
  const write = createStatusWriter(file);
  write("collecting", { runId: "run_1", completed: 3, total: 108 });
  const status = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(status.state, "collecting");
  assert.equal(status.completed, 3);
  assert.equal(status.pid, process.pid);
  assert.ok(!Number.isNaN(Date.parse(status.at)));
  assert.deepEqual(readdirSync(path.dirname(file)), ["status.json"], "sem temporário sobrando");
});

test("configuracao instalada: dados fora do codigo e sem acesso da Servopa local", async (context) => {
  const { readWorkerConfig } = await import("../worker/lib/env.mjs");
  const dataDir = scratch(context);
  const keep = { ...process.env };
  try {
    for (const name of ["SERVOPA_USER", "SERVOPA_PASS", "SERVOPA_BASE_URL", "SERVOPA_PROFILE_DIR"]) process.env[name] = "";
    process.env.CRM_BASE_URL = "https://crm.exemplo.com.br";
    process.env.SERVOPA_WORKER_KEY = KEY;
    process.env.SERVOPA_DATA_DIR = dataDir;
    process.env.SERVOPA_APP_VERSION = "0.3.0+abcdef1234";
    process.env.SERVOPA_UPDATE_BLOCKED = "1";
    const config = readWorkerConfig();
    assert.equal(config.servopaUser, null);
    assert.equal(config.servopaPassword, null);
    assert.equal(config.servopaBaseUrl, "https://www.consorcioservopa.com.br");
    assert.equal(config.dataDir, dataDir);
    assert.equal(config.profileDir, path.join(dataDir, "profile"));
    assert.equal(config.appVersion, "0.3.0+abcdef1234");
    assert.equal(config.updateBlocked, true);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in keep)) delete process.env[name];
    Object.assign(process.env, keep);
  }
});

test("robo instalado sai com 75 quando o CRM anuncia versao nova (o iniciador atualiza)", async (context) => {
  const crm = await fakeCrm(context, () => ({ body: { job: null }, headers: { "X-Servopa-App-Version": "0.3.0+novanovano" } }));
  const result = await runWorker(context, crm.url, { SERVOPA_APP_VERSION: "0.3.0+antigaanti" });
  assert.equal(result.code, 75);
  assert.equal(crm.requests.length, 1);
  assert.equal(crm.requests[0].headers["x-servopa-worker-version"], "0.3.0+antigaanti");
  const status = JSON.parse(readFileSync(path.join(result.dataDir, "status.json"), "utf8"));
  assert.equal(status.state, "idle");
  const logs = readdirSync(path.join(result.dataDir, "logs"));
  assert.equal(logs.length, 1);
  assert.doesNotMatch(readFileSync(path.join(result.dataDir, "logs", logs[0]), "utf8"), new RegExp(KEY));
});

test("robo sai com 78 quando o computador foi removido no CRM (o iniciador para)", async (context) => {
  const crm = await fakeCrm(context, () => ({ status: 401, body: { error: "Credencial inválida" } }));
  const result = await runWorker(context, crm.url, { SERVOPA_APP_VERSION: "0.3.0+antigaanti" });
  assert.equal(result.code, 78);
});

test("sem pedir atualizacao: em desenvolvimento e logo depois de uma atualizacao que falhou", async (context) => {
  const crm = await fakeCrm(context, () => ({ body: { job: null }, headers: { "X-Servopa-App-Version": "0.3.0+novanovano" } }));
  assert.equal((await runWorker(context, crm.url, {}, ["--once"])).code, 0, "sem SERVOPA_APP_VERSION (desenvolvimento)");
  assert.equal((await runWorker(context, crm.url, { SERVOPA_APP_VERSION: "0.3.0+antigaanti", SERVOPA_UPDATE_BLOCKED: "1" }, ["--once"])).code, 0);
  const sameVersion = await runWorker(context, crm.url, { SERVOPA_APP_VERSION: "0.3.0+novanovano" }, ["--once"]);
  assert.equal(sameVersion.code, 0);
});

test("CRM fora do ar nao derruba o robo (status offline, segue tentando)", async (context) => {
  const crm = await fakeCrm(context, () => ({ status: 502, body: { error: "Bad gateway" } }));
  const result = await runWorker(context, crm.url, { SERVOPA_APP_VERSION: "0.3.0+antigaanti" }, ["--once"]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(readFileSync(path.join(result.dataDir, "status.json"), "utf8")).state, "offline");
});

test("scripts do Windows passam pela analise sintatica do Windows PowerShell 5.1", { skip: process.platform !== "win32" }, () => {
  const files = ["core.ps1", "launcher.ps1", "install.ps1", "robo-servopa.ps1", "desinstalar.ps1"].map((file) => path.resolve("worker", "windows", file));
  for (const file of files) assert.ok(existsSync(file), file);
  const script = [
    "$failed = $false",
    ...files.map((file) => `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$errors); if ($errors) { $failed = $true; $errors | ForEach-Object { Write-Output ('${path.basename(file)}: ' + $_.Message + ' (linha ' + $_.Extent.StartLineNumber + ')') } }`),
    "if ($failed) { exit 1 }",
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
