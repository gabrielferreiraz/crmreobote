/**
 * Contratos de credencial e isolamento do worker Servopa:
 *
 *   node --experimental-strip-types --test scripts/test-servopa-worker.ts
 */

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { parseServopaPanelCredentials } from "../lib/servopa-tables/panel-credentials-core.ts";
import {
  buildServopaInstallerScript,
  buildServopaWorkerBundleZip,
  INSTALLER_CORE_MARKER,
  INSTALLER_SCRIPT_MARKER,
  readServopaWorkerBundle,
  WORKER_BUNDLE_FILES,
} from "../lib/servopa-tables/worker-bundle.ts";
import {
  generateServopaPairingCode,
  generateServopaWorkerKey,
  hashServopaWorkerKey,
  parseServopaPairingCode,
  readServopaWorkerBearer,
  servopaWorkerName,
} from "../lib/servopa-tables/worker-key.ts";

const ORG = "cmr9i96330001ekvpb3b4o4nn";

test("credencial do worker tem alta entropia, prefixo próprio e hash separado", () => {
  const first = generateServopaWorkerKey();
  const second = generateServopaWorkerKey();
  assert.match(first.fullKey, /^svw_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.keyPrefix, first.fullKey.slice(0, 12));
  assert.match(first.keyHash, /^[a-f0-9]{64}$/);
  assert.equal(first.keyHash, hashServopaWorkerKey(first.fullKey));
  assert.notEqual(first.fullKey, second.fullKey);
  assert.notEqual(first.keyHash, second.keyHash);
});

test("Bearer aceita somente chave exclusiva do worker", () => {
  const { fullKey } = generateServopaWorkerKey();
  assert.equal(readServopaWorkerBearer(new Request("https://crm.test", { headers: { authorization: `Bearer ${fullKey}` } })), fullKey);
  assert.equal(readServopaWorkerBearer(new Request("https://crm.test", { headers: { authorization: "Bearer crm_chave-generica" } })), null);
  // O código do instalador nunca vale como chave do robô.
  const { code } = generateServopaPairingCode(ORG);
  assert.equal(readServopaWorkerBearer(new Request("https://crm.test", { headers: { authorization: `Bearer ${code}` } })), null);
  assert.equal(readServopaWorkerBearer(new Request("https://crm.test")), null);
});

test("migration isola a credencial por RLS e limita uma ativa por organização", () => {
  const sql = readFileSync("prisma/migrations/20261026130000_servopa_worker_identity/migration.sql", "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /app\.current_servopa_worker_key_hash/);
  assert.match(sql, /CREATE UNIQUE INDEX "ServopaWorker_one_active_per_org_key"/);
  assert.match(sql, /WHERE "active" = true/);
});

test("hashes de credencial e de instalador estão no bloqueio global de leitura do Prisma", () => {
  const source = readFileSync("lib/prisma-omit.ts", "utf8");
  assert.match(source, /servopaWorker:\s*\{ keyHash: true \}/);
  assert.match(source, /servopaWorkerPairing:\s*\{ codeHash: true \}/);
});

test("troca do código do instalador serializa por organização", () => {
  const source = readFileSync("lib/servopa-tables/worker-auth.ts", "utf8");
  assert.match(source, /\$executeRaw`SELECT pg_advisory_xact_lock/);
  assert.match(source, /hashtextextended\(\$\{parsed\.organizationId\}, 20261026\)/);
  assert.doesNotMatch(source, /\$queryRaw`SELECT pg_advisory_xact_lock/);
});

// ── Vários computadores podem rodar o robô (se um estiver desligado, outro assume) ──

test("migration multi-computador remove a trava de uma credencial ativa e registra quem executou", () => {
  const sql = readFileSync("prisma/migrations/20261026150000_servopa_multi_worker/migration.sql", "utf8");
  assert.match(sql, /DROP INDEX IF EXISTS "ServopaWorker_one_active_per_org_key"/);
  assert.match(sql, /ADD COLUMN "claimedByWorkerId" TEXT/);
  assert.match(sql, /REFERENCES "ServopaWorker"\("id"\)\s+ON DELETE SET NULL/);
  // Só uma execução ativa por organização continua valendo (índice da fila, migration anterior).
  const queue = readFileSync("prisma/migrations/20261026120000_servopa_sync_queue/migration.sql", "utf8");
  assert.match(queue, /CREATE UNIQUE INDEX "ServopaSyncRun_one_active_per_org_key"/);
  assert.doesNotMatch(sql, /ServopaSyncRun_one_active_per_org_key/);
});

test("a fila registra qual computador reivindicou a execução e libera ao expirar o lease", () => {
  const queue = readFileSync("lib/servopa-tables/queue.ts", "utf8");
  assert.match(queue, /claimNextServopaSync\(organizationId: string, workerId\?: string\)/);
  assert.match(queue, /"claimedByWorkerId" = \$\{workerId \?\? null\}/);
  assert.match(queue, /claimedByWorkerId: null/, "lease expirado volta à fila sem dono");
  const route = readFileSync("app/api/servopa-worker/claim/route.ts", "utf8");
  assert.match(route, /claimNextServopaSync\(auth\.access\.organizationId, auth\.access\.workerId\)/);
});

test("o estado da operação lista todos os computadores e fica online com qualquer um deles", () => {
  const queries = readFileSync("lib/servopa-tables/queries.ts", "utf8");
  assert.match(queries, /prisma\.servopaWorker\.findMany\(\{\s*where: \{ organizationId, active: true \}/);
  assert.match(queries, /workerOnline: workers\.some\(\(worker\) => worker\.online\)/);
});

test("acesso da Servopa vem do ambiente do servidor e é validado", () => {
  assert.deepEqual(parseServopaPanelCredentials({ SERVOPA_USER: " 12345678000199 ", SERVOPA_PASS: "12345" }), { user: "12345678000199", password: "12345" });
  assert.equal(parseServopaPanelCredentials({ SERVOPA_USER: "12345678000199" }), null);
  assert.equal(parseServopaPanelCredentials({ SERVOPA_PASS: "12345" }), null);
  assert.equal(parseServopaPanelCredentials({ SERVOPA_USER: "123\n456", SERVOPA_PASS: "12345" }), null);
  assert.equal(parseServopaPanelCredentials({ SERVOPA_USER: "x".repeat(101), SERVOPA_PASS: "12345" }), null);
  assert.equal(parseServopaPanelCredentials({}), null);
});

test("claim só entrega o acesso da Servopa junto com uma coleta reivindicada, e exige o acesso configurado", () => {
  const route = readFileSync("app/api/servopa-worker/claim/route.ts", "utf8");
  const missing = route.indexOf("PANEL_CREDENTIALS_MISSING");
  const claim = route.indexOf("claimNextServopaSync(");
  assert.ok(missing > 0 && claim > missing, "sem acesso configurado nenhuma coleta é reivindicada");
  assert.match(route, /job \? \{ job, credentials \} : \{ job: null \}/, "sem coleta não sai credencial");
  assert.match(route, /503/);
  const ops = readFileSync("lib/servopa-tables/queries.ts", "utf8");
  assert.match(ops, /panelCredentialsConfigured: hasServopaPanelCredentials\(\)/);
  assert.doesNotMatch(ops, /readServopaPanelCredentials/, "a tela nunca recebe o valor do acesso");
});

// ── Instalador de uso único (um arquivo, nada para digitar) ──

test("código do instalador: 256 bits, carrega só o id da organização e recusa qualquer adulteração", () => {
  const first = generateServopaPairingCode(ORG);
  const second = generateServopaPairingCode(ORG);
  assert.match(first.code, new RegExp(`^svp_${ORG}\\.[A-Za-z0-9_-]{43}$`));
  assert.notEqual(first.code, second.code);
  assert.equal(first.codeHash, hashServopaWorkerKey(first.code));
  assert.deepEqual(parseServopaPairingCode(first.code), { code: first.code, organizationId: ORG, codeHash: first.codeHash });
  for (const bad of [
    first.code.slice(0, -1),
    first.code.replace("svp_", "svw_"),
    first.code.replace(ORG, "OUTRA-ORG"),
    `${first.code}x`,
    ` ${first.code}`,
    first.code.replace(".", "'"),
    "",
    null,
    42,
  ]) {
    assert.equal(parseServopaPairingCode(bad), null, String(bad));
  }
});

test("nome do computador vem do Windows e é limpo", () => {
  assert.equal(servopaWorkerName("ana.silva", "DESKTOP-7Q1K2L"), "ana.silva - DESKTOP-7Q1K2L");
  assert.equal(servopaWorkerName("João", "NOTE-ADM"), "João - NOTE-ADM");
  assert.equal(servopaWorkerName("<script>", "PC\"';$x"), "script - PCx");
  assert.equal(servopaWorkerName(undefined, "   "), "Computador");
  assert.equal(servopaWorkerName("a".repeat(90), "b".repeat(90)).length, 83);
});

test("migration do instalador é aditiva, isolada por RLS e guarda só o hash", () => {
  const sql = readFileSync("prisma/migrations/20261026160000_servopa_worker_pairing/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "ServopaWorkerPairing"/);
  assert.match(sql, /"codeHash" TEXT NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX "ServopaWorkerPairing_codeHash_key"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /current_setting\('app\.current_organization_id', true\)/);
  assert.doesNotMatch(sql, /DROP |ALTER TABLE "(?!ServopaWorkerPairing)/, "não mexe em nenhuma tabela existente");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model ServopaWorkerPairing \{[\s\S]*codeHash\s+String\s+@unique/);
});

test("troca do código: uso único, validade, limite de computadores e reinstalação substitui só o mesmo computador", () => {
  const source = readFileSync("lib/servopa-tables/worker-auth.ts", "utf8");
  const redeem = source.slice(source.indexOf("export async function redeemServopaWorkerPairing"), source.indexOf("export async function revokeServopaWorkerCredential"));
  assert.match(redeem, /usedAt: null, expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(redeem, /data: \{ usedAt: now, workerId: worker\.id \}/);
  assert.match(redeem, /MAX_SERVOPA_WORKERS/);
  // Só a linha com o MESMO nome (mesmo usuário + mesmo computador) é substituída.
  assert.match(redeem, /updateMany\(\{\s*where: \{ organizationId: parsed\.organizationId, active: true, name: \{ equals: name, mode: "insensitive" \} \}/);
  assert.equal((redeem.match(/updateMany/g) ?? []).length, 1);
  const contract = readFileSync("lib/servopa-tables/queue-contract.ts", "utf8");
  assert.match(contract, /SERVOPA_PAIRING_TTL_MS = 60 \* 60 \* 1_000/);
});

test("rotas: instalador exige operador; troca do código só tem limite por IP; desinstalação usa a própria chave", () => {
  const installer = readFileSync("app/api/servopa-tables/installer/route.ts", "utf8");
  assert.match(installer, /if \(!access\.canOperate\)/);
  assert.match(installer, /createServopaWorkerPairing\(/);
  assert.match(installer, /"Cache-Control": "no-store"/);
  const pair = readFileSync("app/api/servopa-worker/pair/route.ts", "utf8");
  assert.match(pair, /rateLimitOrResponse\(`servopa-worker-pair:\$\{getClientIp\(req\)\}`, 10, 60_000\)/);
  assert.match(pair, /\.strict\(\)/);
  assert.doesNotMatch(pair, /organizationId:\s*body/, "a organização vem do código, nunca do corpo");
  const unpair = readFileSync("app/api/servopa-worker/unpair/route.ts", "utf8");
  assert.match(unpair, /requireServopaWorkerRoute\(req, "unpair"\)/);
  assert.match(unpair, /revokeServopaWorkerCredential\(auth\.access\.organizationId, auth\.access\.workerId\)/);
  const credential = readFileSync("app/api/servopa-tables/worker-credential/route.ts", "utf8");
  assert.doesNotMatch(credential, /export async function POST/, "computador novo só entra pelo instalador");
  const route = readFileSync("lib/servopa-tables/worker-route.ts", "utf8");
  assert.match(route, /X-Servopa-App-Version/);
});

// ── Pacote do robô (instala e se atualiza sozinho) ──

test("pacote do robô contém só a lista fixa, sem segredos, e a versão vem do conteúdo", async () => {
  const bundle = await buildServopaWorkerBundleZip();
  const archive = await JSZip.loadAsync(bundle.archive);
  const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir).sort();
  assert.deepEqual(names, [...WORKER_BUNDLE_FILES, "manifest.json"].sort());
  assert.equal(names.some((name) => /(?:^|\/)\.env$|node_modules|\.profile|\.probe|\.log$|probe-|lib-probe/i.test(name)), false);
  const manifest = JSON.parse(await archive.files["manifest.json"].async("string"));
  assert.equal(manifest.version, bundle.version);
  assert.match(bundle.version, /^0\.3\.0\+[a-f0-9]{10}$/);
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/);
  for (const name of names) {
    const text = await archive.files[name].async("string");
    assert.doesNotMatch(text, /svw_[A-Za-z0-9_-]{40,}|svp_[a-z0-9]{10,}\.[A-Za-z0-9_-]{43}/, `${name} não pode carregar chave`);
  }
});

test("versão muda quando qualquer arquivo do robô muda", () => {
  const copy = mkdtempSync(path.join(tmpdir(), "servopa-bundle-"));
  try {
    cpSync("worker", copy, { recursive: true, filter: (source) => !/node_modules|\.profile|\.probe|[\\/]logs|[\\/]\.env$/.test(source) });
    const before = readServopaWorkerBundle(copy).version;
    assert.equal(readServopaWorkerBundle(copy).version, before);
    writeFileSync(path.join(copy, "lib", "collector.mjs"), `${readFileSync(path.join(copy, "lib", "collector.mjs"), "utf8")}\n// mudança\n`);
    assert.notEqual(readServopaWorkerBundle(copy).version, before);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("pacote é autossuficiente: imports relativos existem e só depende de playwright-core", async () => {
  const archive = await JSZip.loadAsync((await buildServopaWorkerBundleZip()).archive);
  const files = new Set(Object.keys(archive.files).filter((name) => !archive.files[name].dir));
  const pkg = JSON.parse(await archive.files["package.json"].async("string"));
  assert.deepEqual(Object.keys(pkg.dependencies), ["playwright-core"]);
  assert.match(pkg.dependencies["playwright-core"], /^\d+\.\d+\.\d+$/, "versão exata, igual ao lockfile");
  const lock = JSON.parse(await archive.files["package-lock.json"].async("string"));
  assert.equal(lock.packages["node_modules/playwright-core"].version, pkg.dependencies["playwright-core"]);
  assert.match(lock.packages["node_modules/playwright-core"].integrity, /^sha512-/);

  const problems: string[] = [];
  for (const name of files) {
    if (!name.endsWith(".mjs")) continue;
    const source = await archive.files[name].async("string");
    for (const match of source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        const parts = name.split("/").slice(0, -1);
        for (const segment of specifier.split("/")) {
          if (segment === "..") parts.pop();
          else if (segment !== ".") parts.push(segment);
        }
        if (!files.has(parts.join("/"))) problems.push(`${name} importa ${specifier}, que não está no pacote`);
      } else if (!specifier.startsWith("node:") && specifier !== "playwright-core") {
        problems.push(`${name} importa o pacote ${specifier}, que não é instalado`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("scripts do Windows no pacote vão com BOM e CRLF (Windows PowerShell 5.1 lê acentos certo)", async () => {
  const archive = await JSZip.loadAsync((await buildServopaWorkerBundleZip()).archive);
  for (const name of WORKER_BUNDLE_FILES.filter((file) => file.endsWith(".ps1"))) {
    const bytes = await archive.files[name].async("uint8array");
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], name);
    const text = Buffer.from(bytes).toString("utf8");
    assert.doesNotMatch(text, /[^\r]\n/, `${name} precisa de CRLF`);
  }
});

// ── O arquivo que a pessoa baixa ──

function splitInstaller(script: string) {
  const core = script.indexOf(INSTALLER_CORE_MARKER);
  const installer = script.indexOf(INSTALLER_SCRIPT_MARKER);
  return {
    header: script.slice(0, core),
    core: script.slice(core + INSTALLER_CORE_MARKER.length, installer).trim(),
    installer: script.slice(installer + INSTALLER_SCRIPT_MARKER.length).trim(),
  };
}

test("instalador .cmd: cabeçalho ASCII com CRLF, duas seções e só o código de uso único", () => {
  const { code } = generateServopaPairingCode(ORG);
  const script = buildServopaInstallerScript({ crmBaseUrl: "https://crm.reobote.com.br/", pairingCode: code });
  assert.ok(script.startsWith("@echo off\r\n"));
  assert.doesNotMatch(script, /[^\r]\n/, "cmd.exe exige CRLF");
  assert.equal(script.split(INSTALLER_CORE_MARKER).length, 2, "marcador do core aparece uma única vez inteiro");
  assert.equal(script.split(INSTALLER_SCRIPT_MARKER).length, 2, "marcador do instalador aparece uma única vez inteiro");
  const parts = splitInstaller(script);
  assert.match(parts.header, /^[\x20-\x7e\r\n]+$/, "cabeçalho do .cmd só com ASCII");
  assert.match(parts.header, /exit \/b 0\r\n/);
  assert.match(parts.header, /-ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%ROBO_DIR%\\instalar\.ps1"/);
  assert.doesNotMatch(parts.header, /Invoke-Expression|iex|FromBase64/i);
  assert.equal(parts.core, readFileSync("worker/windows/core.ps1", "utf8").replace(/^﻿/, "").replace(/\r?\n/g, "\r\n").trim());
  assert.match(parts.installer, /\$CrmBaseUrl = 'https:\/\/crm\.reobote\.com\.br'\r\n/);
  assert.match(parts.installer, new RegExp(`\\$PairingCode = '${code.replace(/[.]/g, "\\.")}'\\r\\n`));
  assert.doesNotMatch(parts.installer, /__ROBO_/);
  assert.doesNotMatch(script, /svw_[A-Za-z0-9_-]{40,}/, "nenhuma chave permanente no arquivo baixado");
});

test("instalador recusa endereço sem HTTPS (fora do localhost) e código adulterado", () => {
  const { code } = generateServopaPairingCode(ORG);
  assert.throws(() => buildServopaInstallerScript({ crmBaseUrl: "http://crm.reobote.com.br", pairingCode: code }));
  assert.throws(() => buildServopaInstallerScript({ crmBaseUrl: "https://crm.reobote.com.br/x'; calc", pairingCode: code }));
  assert.throws(() => buildServopaInstallerScript({ crmBaseUrl: "https://crm.reobote.com.br", pairingCode: `${code}'` }));
  assert.doesNotThrow(() => buildServopaInstallerScript({ crmBaseUrl: "http://localhost:3000", pairingCode: code }));
});

test("scripts do Windows: chave do registro nunca recriada com -Force e chave do computador protegida pelo Windows", () => {
  const core = readFileSync("worker/windows/core.ps1", "utf8");
  assert.doesNotMatch(core, /New-Item[^\r\n]*Robo(?:Run|Uninstall)Key[^\r\n]*-Force/, "New-Item -Force apaga os outros programas de inicialização");
  assert.match(core, /ProtectedData\]::Protect\(/);
  assert.match(core, /DataProtectionScope\]::CurrentUser/);
  assert.match(core, /\$script:RoboNodeSha256 = '[a-f0-9]{64}'/);
  assert.match(core, /Get-FileHash -LiteralPath \$zip -Algorithm SHA256/);
  assert.match(core, /'--ignore-scripts'/);
  assert.doesNotMatch(core, /New-ScheduledTask|Register-ScheduledTask/, "sem Agendador de Tarefas (para na bateria por padrão)");
  for (const file of ["core.ps1", "launcher.ps1", "install.ps1", "robo-servopa.ps1", "desinstalar.ps1"]) {
    const source = readFileSync(`worker/windows/${file}`, "utf8");
    assert.doesNotMatch(source, /Invoke-Expression|\biex\b|FromBase64String\([^)]*\)\s*\|/, `${file} sem execução de texto dinâmico`);
    assert.doesNotMatch(source, /SERVOPA_PASS|SERVOPA_USER|senha da Servopa:/i, `${file} não lida com o acesso da Servopa`);
  }
});

test("contrato de saída entre o robô e o iniciador do Windows", () => {
  const run = readFileSync("worker/run.mjs", "utf8");
  const launcher = readFileSync("worker/windows/launcher.ps1", "utf8");
  assert.match(run, /EXIT_UPDATE_AVAILABLE = 75/);
  assert.match(run, /EXIT_CREDENTIAL_REVOKED = 78/);
  assert.match(launcher, /\$code -eq 75/);
  assert.match(launcher, /\$code -eq 78/);
  for (const variable of ["CRM_BASE_URL", "SERVOPA_WORKER_KEY", "SERVOPA_APP_VERSION", "SERVOPA_DATA_DIR", "PLAYWRIGHT_BROWSERS_PATH", "SERVOPA_UPDATE_BLOCKED"]) {
    assert.match(launcher, new RegExp(`EnvironmentVariables\\['${variable}'\\]`), variable);
  }
});
