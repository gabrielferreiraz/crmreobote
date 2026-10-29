/**
 * Pacote do robô Servopa servido pelo CRM.
 *
 * - `readServopaWorkerBundle()` lê a lista FIXA de arquivos de `worker/` e
 *   calcula a versão pelo conteúdo (`0.3.0+<hash>`). O robô instalado compara
 *   essa versão com a dele a cada consulta e se atualiza sozinho.
 * - `buildServopaInstallerScript()` monta o único arquivo que a pessoa baixa
 *   (`Instalar Robo Servopa.cmd`): um cabeçalho de .cmd que extrai e abre o
 *   instalador PowerShell embutido (`windows/core.ps1` + `windows/install.ps1`),
 *   já com o endereço do CRM e o código de uso único. Nenhuma chave permanente
 *   vai no arquivo.
 *
 * Sem `server-only`: os testes e o simulador local importam este módulo.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

export const WORKER_BUNDLE_FILES = [
  "package.json",
  "package-lock.json",
  "run.mjs",
  "check-browser.mjs",
  "lib/browser.mjs",
  "lib/collector.mjs",
  "lib/crm-client.mjs",
  "lib/env.mjs",
  "lib/errors.mjs",
  "lib/logger.mjs",
  "lib/single-instance.mjs",
  "lib/status.mjs",
  "windows/core.ps1",
  "windows/launcher.ps1",
  "windows/robo-servopa.ps1",
  "windows/desinstalar.ps1",
] as const;

const INSTALLER_TEMPLATE = "windows/install.ps1";
const INSTALLER_CORE = "windows/core.ps1";
// Os marcadores aparecem no cabeçalho só partidos em dois pedaços ("...SERVOPA" + "-CORE##"),
// então a primeira ocorrência inteira de cada um é sempre a linha que abre a seção.
export const INSTALLER_CORE_MARKER = "##ROBO-SERVOPA-CORE##";
export const INSTALLER_SCRIPT_MARKER = "##ROBO-SERVOPA-INSTALADOR##";
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

type BundleFile = { path: string; content: Buffer };
export type ServopaWorkerBundle = { version: string; files: BundleFile[] };

let cached: { root: string; bundle: ServopaWorkerBundle } | null = null;

function defaultWorkerRoot() {
  return path.resolve(process.cwd(), "worker");
}

/**
 * O Windows PowerShell 5.1 lê `.ps1` sem BOM como ANSI (acentos quebram) e o
 * `cmd.exe` exige CRLF. Normaliza aqui para os arquivos-fonte ficarem simples.
 */
function normalizeForWindows(relativePath: string, content: Buffer): Buffer {
  if (!relativePath.endsWith(".ps1")) return content;
  const text = content.toString("utf8").replace(/^﻿/, "").replace(/\r?\n/g, "\r\n");
  return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf8")]);
}

export function readServopaWorkerBundle(root = defaultWorkerRoot()): ServopaWorkerBundle {
  // Em produção os arquivos não mudam durante a vida do processo.
  if (cached?.root === root && process.env.NODE_ENV === "production") return cached.bundle;

  const files = WORKER_BUNDLE_FILES.map((relativePath) => ({
    path: relativePath,
    // `turbopackIgnore`: o Dockerfile já copia `worker/` para a imagem; sem isto o
    // Turbopack inclui o projeto inteiro no build standalone (aviso no deploy).
    content: normalizeForWindows(relativePath, readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, relativePath))),
  }));
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.path).update("\0").update(file.content).update("\0");
  const packageVersion = String(JSON.parse(files[0].content.toString("utf8")).version ?? "0.0.0");
  const bundle = { version: `${packageVersion}+${hash.digest("hex").slice(0, 10)}`, files };
  cached = { root, bundle };
  return bundle;
}

/** Versão atual do robô; `null` se a pasta `worker/` não estiver disponível. */
export function getServopaWorkerAppVersion(): string | null {
  try {
    return readServopaWorkerBundle().version;
  } catch {
    return null;
  }
}

export async function buildServopaWorkerBundleZip(root?: string) {
  const bundle = readServopaWorkerBundle(root);
  const zip = new JSZip();
  for (const file of bundle.files) zip.file(file.path, file.content);
  zip.file("manifest.json", JSON.stringify({ version: bundle.version, files: bundle.files.map((file) => file.path) }, null, 2));
  const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { version: bundle.version, archive, sha256: createHash("sha256").update(archive).digest("hex") };
}

const CRM_URL_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const PAIRING_CODE_PATTERN = /^svp_[a-z0-9]{10,40}\.[A-Za-z0-9_-]{43}$/;

/**
 * Gera o `.cmd` de instalação. Os dois valores entram em strings PowerShell de
 * aspas simples; os padrões acima garantem que não carregam aspas, `$` nem
 * quebras de linha.
 */
export function buildServopaInstallerScript(params: { crmBaseUrl: string; pairingCode: string; root?: string }): string {
  const crmBaseUrl = params.crmBaseUrl.replace(/\/+$/, "");
  const url = new URL(crmBaseUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!CRM_URL_PATTERN.test(crmBaseUrl) || (url.protocol !== "https:" && !local)) {
    throw new Error("Endereço do CRM inválido para o instalador.");
  }
  if (!PAIRING_CODE_PATTERN.test(params.pairingCode)) throw new Error("Código do instalador inválido.");

  const root = params.root ?? defaultWorkerRoot();
  const read = (relativePath: string) => readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, relativePath), "utf8").replace(/^﻿/, "");
  const core = read(INSTALLER_CORE);
  const template = read(INSTALLER_TEMPLATE);
  if (!template.includes("__ROBO_CRM_BASE_URL__") || !template.includes("__ROBO_PAIRING_CODE__")) {
    throw new Error("Modelo do instalador incompleto.");
  }
  for (const marker of [INSTALLER_CORE_MARKER, INSTALLER_SCRIPT_MARKER]) {
    if (core.includes(marker) || template.includes(marker)) throw new Error("Marcador reservado dentro do instalador.");
  }
  const script = template
    .replaceAll("__ROBO_CRM_BASE_URL__", crmBaseUrl)
    .replaceAll("__ROBO_PAIRING_CODE__", params.pairingCode);

  // O cabeçalho só usa ASCII e nunca chega aos marcadores: `exit /b` encerra o
  // cmd antes. O PowerShell grava as duas seções (core.ps1 e instalar.ps1) numa
  // pasta temporária, com BOM (acentos corretos no Windows PowerShell 5.1), e
  // abre o instalador sem janela de console. Sem base64 nem `Invoke-Expression`.
  const split = (marker: string) => `'${marker.slice(0, 14)}'+'${marker.slice(14)}'`;
  const extract = [
    "$t=[IO.File]::ReadAllText($env:ROBO_SELF)",
    `$c=${split(INSTALLER_CORE_MARKER)}`,
    `$s=${split(INSTALLER_SCRIPT_MARKER)}`,
    "$a=$t.IndexOf($c)",
    "$b=$t.IndexOf($s)",
    "if($a -lt 0 -or $b -lt $a){exit 9}",
    "$e=New-Object Text.UTF8Encoding($true)",
    "[void](New-Item -ItemType Directory -Force -Path $env:ROBO_DIR)",
    "[IO.File]::WriteAllText((Join-Path $env:ROBO_DIR 'core.ps1'),$t.Substring($a+$c.Length,$b-$a-$c.Length).Trim(),$e)",
    "[IO.File]::WriteAllText((Join-Path $env:ROBO_DIR 'instalar.ps1'),$t.Substring($b+$s.Length).Trim(),$e)",
  ].join(";");
  const header = [
    "@echo off",
    "setlocal",
    "title Robo Servopa",
    'set "ROBO_SELF=%~f0"',
    'set "ROBO_DIR=%TEMP%\\robo-servopa-%RANDOM%%RANDOM%"',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${extract}"`,
    "if errorlevel 1 goto falhou",
    'start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%ROBO_DIR%\\instalar.ps1"',
    "exit /b 0",
    ":falhou",
    "echo.",
    "echo Nao foi possivel abrir o instalador. Baixe o arquivo de novo no CRM.",
    "pause",
    "exit /b 1",
  ].join("\r\n");
  const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");
  return `${header}\r\n${INSTALLER_CORE_MARKER}\r\n${crlf(core)}\r\n${INSTALLER_SCRIPT_MARKER}\r\n${crlf(script)}`;
}
