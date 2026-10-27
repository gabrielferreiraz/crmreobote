import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workerDataDir } from "./env.mjs";

/**
 * Estado atual do robô para o ícone ao lado do relógio do Windows
 * (`windows/launcher.ps1` lê este arquivo). Escrita atômica: grava num
 * temporário e renomeia, para o ícone nunca ler um JSON pela metade.
 *
 * state: "starting" | "idle" | "offline" | "waiting-access" | "collecting" | "uploading"
 */
export function createStatusWriter(file = path.join(workerDataDir(), "status.json")) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch {}
  return (state, details = {}) => {
    const payload = JSON.stringify({ state, ...details, at: new Date().toISOString(), pid: process.pid });
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, payload, "utf8");
      renameSync(temporary, file);
    } catch {}
  };
}
