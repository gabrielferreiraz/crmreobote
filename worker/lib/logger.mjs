import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { workerDataDir } from "./env.mjs";

const MAX_LOG_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

function logFileName(date) {
  return `worker-${date.toISOString().slice(0, 10)}.log`;
}

function cleanOldLogs(directory) {
  const cutoff = Date.now() - MAX_LOG_AGE_MS;
  for (const name of readdirSync(directory)) {
    if (!/^worker-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const file = path.join(directory, name);
    try {
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    } catch {}
  }
}

export function createWorkerLogger(secrets = [], directory = path.join(workerDataDir(), "logs")) {
  mkdirSync(directory, { recursive: true });
  cleanOldLogs(directory);
  const protectedValues = secrets.filter((value) => typeof value === "string" && value.length >= 4);

  const log = (message) => {
    let safe = String(message)
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/([?&](?:token|key|senha|password)=)[^&\s]+/gi, "$1[REDACTED]");
    for (const secret of protectedValues) safe = safe.split(secret).join("[REDACTED]");
    safe = safe.replace(/[\r\n]+/g, " ").slice(0, 2_000);
    const now = new Date();
    const line = `[${now.toISOString()}] ${safe}`;
    console.log(line);
    try {
      appendFileSync(path.join(directory, logFileName(now)), `${line}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {}
  };
  // Segredos conhecidos só depois de iniciar (ex.: acesso da Servopa entregue pelo CRM).
  log.addSecrets = (values) => {
    for (const value of values) {
      if (typeof value === "string" && value.length >= 4 && !protectedValues.includes(value)) protectedValues.push(value);
    }
  };
  return log;
}
