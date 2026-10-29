import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workerDataDir } from "./env.mjs";
import { WorkerError } from "./errors.mjs";

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireSingleInstance(lockFile = path.join(workerDataDir(), ".worker.lock")) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = openSync(lockFile, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(descriptor);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(readFileSync(lockFile, "utf8"));
          if (current.pid === process.pid) unlinkSync(lockFile);
        } catch {}
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(readFileSync(lockFile, "utf8")).pid);
      } catch {}
      if (processExists(ownerPid)) {
        throw new WorkerError("ALREADY_RUNNING", "O robo ja esta aberto neste computador.", { retryable: false });
      }
      try {
        unlinkSync(lockFile);
      } catch {}
    }
  }
  throw new WorkerError("LOCK_FAILED", "Nao foi possivel reservar a execucao do robo.", { retryable: false });
}
