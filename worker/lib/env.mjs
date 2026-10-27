import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerError } from "./errors.mjs";

export const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pasta dos dados locais (perfil do Firefox, registros, trava e status).
 * No computador instalado o iniciador do Windows aponta `SERVOPA_DATA_DIR`
 * para `%LOCALAPPDATA%\RoboServopa`, fora da pasta do código — assim a
 * atualização automática troca o código sem tocar na sessão nem nos registros.
 * Em desenvolvimento, fica na própria pasta `worker/`.
 */
export function workerDataDir() {
  const configured = process.env.SERVOPA_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : WORKER_DIR;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && (trimmed[0] === '"' || trimmed[0] === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Só para desenvolvimento: no computador instalado não existe `.env` (o iniciador passa tudo por variável). */
export function loadWorkerEnv(file = path.join(WORKER_DIR, ".env")) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = unquote(match[2]);
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new WorkerError("CONFIG_INVALID", `Configuracao ${name} ausente. Instale o robo de novo pelo CRM.`, { retryable: false });
  return value;
}

function secureUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkerError("CONFIG_INVALID", `${name} nao e uma URL valida.`, { retryable: false });
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new WorkerError("CONFIG_INVALID", `${name} precisa usar HTTPS.`, { retryable: false });
  }
  return url.origin;
}

export function readWorkerConfig() {
  loadWorkerEnv();
  const workerKey = required("SERVOPA_WORKER_KEY");
  if (!/^svw_[A-Za-z0-9_-]{40,}$/.test(workerKey)) {
    throw new WorkerError("CONFIG_INVALID", "SERVOPA_WORKER_KEY nao possui o formato esperado.", { retryable: false });
  }
  const concurrency = Number(process.env.SERVOPA_CONCURRENCY ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new WorkerError("CONFIG_INVALID", "SERVOPA_CONCURRENCY deve ser 1 ou 2.", { retryable: false });
  }
  const pollSeconds = Number(process.env.SERVOPA_POLL_SECONDS ?? 60);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 15 || pollSeconds > 900) {
    throw new WorkerError("CONFIG_INVALID", "SERVOPA_POLL_SECONDS deve ficar entre 15 e 900.", { retryable: false });
  }
  const dataDir = workerDataDir();

  return {
    crmBaseUrl: secureUrl("CRM_BASE_URL", required("CRM_BASE_URL")),
    workerKey,
    servopaBaseUrl: secureUrl("SERVOPA_BASE_URL", process.env.SERVOPA_BASE_URL?.trim() || "https://www.consorcioservopa.com.br"),
    // O acesso da Servopa é entregue pelo CRM a cada coleta. Estas duas variáveis
    // são só um recurso de diagnóstico local (desenvolvimento) e ficam vazias no
    // computador instalado.
    servopaUser: process.env.SERVOPA_USER?.trim() || null,
    servopaPassword: process.env.SERVOPA_PASS?.trim() || null,
    concurrency,
    pollSeconds,
    dataDir,
    profileDir: path.resolve(dataDir, process.env.SERVOPA_PROFILE_DIR?.trim() || (dataDir === WORKER_DIR ? ".profile" : "profile")),
    /** Versão do código instalado, informada pelo iniciador do Windows. Vazia em desenvolvimento. */
    appVersion: process.env.SERVOPA_APP_VERSION?.trim() || null,
    /** O iniciador liga isto por 30 min depois de uma atualização que falhou, para não entrar em ciclo. */
    updateBlocked: process.env.SERVOPA_UPDATE_BLOCKED === "1",
  };
}
