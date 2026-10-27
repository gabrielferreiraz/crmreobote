import { collectServopaSnapshot } from "./lib/collector.mjs";
import { CrmClient } from "./lib/crm-client.mjs";
import { readWorkerConfig } from "./lib/env.mjs";
import { asWorkerError, WorkerError } from "./lib/errors.mjs";
import { createWorkerLogger } from "./lib/logger.mjs";
import { acquireSingleInstance } from "./lib/single-instance.mjs";
import { createStatusWriter } from "./lib/status.mjs";

/**
 * Códigos de saída combinados com o iniciador do Windows (`windows/launcher.ps1`):
 * 75 = há versão nova (o iniciador atualiza e abre de novo); 78 = este
 * computador foi removido no CRM (o iniciador para e avisa). Qualquer outro
 * código = queda inesperada (o iniciador reabre com espera crescente).
 */
export const EXIT_UPDATE_AVAILABLE = 75;
export const EXIT_CREDENTIAL_REVOKED = 78;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timestamp = () => new Date().toISOString();
let log = (message) => console.log(`[${timestamp()}] ${message}`);
let status = () => {};

function startHeartbeat(client, job) {
  const abortController = new AbortController();
  let progress = { phase: "STARTING", completed: 0, total: 1 };
  let lastSuccessAt = 0;
  let inFlight = null;

  async function send() {
    if (inFlight) return inFlight;
    inFlight = client.heartbeat(job, progress)
      .then(() => {
        lastSuccessAt = Date.now();
      })
      .catch((error) => {
        const fatal = error instanceof WorkerError && !error.retryable;
        const offlineTooLong = lastSuccessAt > 0 && Date.now() - lastSuccessAt > 75_000;
        if (fatal || offlineTooLong) abortController.abort(error);
        if (lastSuccessAt === 0) throw error;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const timer = setInterval(() => void send().catch(() => {}), 20_000);
  // A tela do CRM mostra a etapa e o grupo atual: avisa logo que a etapa muda
  // e, dentro da mesma etapa, no máximo a cada 4 s (o intervalo de 20 s acima
  // continua como garantia do lease).
  let lastSentPhase = null;
  let lastSentAt = 0;
  return {
    signal: abortController.signal,
    async start() {
      await send();
      lastSentPhase = progress.phase;
      lastSentAt = Date.now();
    },
    update(nextProgress) {
      progress = nextProgress;
      if (abortController.signal.aborted) throw abortController.signal.reason;
      if (nextProgress.phase !== lastSentPhase || Date.now() - lastSentAt >= 4_000) {
        lastSentPhase = nextProgress.phase;
        lastSentAt = Date.now();
        void send().catch(() => {});
      }
    },
    async flush(nextProgress) {
      progress = nextProgress;
      await send();
      if (abortController.signal.aborted) throw abortController.signal.reason;
    },
    async stop() {
      clearInterval(timer);
      if (inFlight) await inFlight.catch(() => {});
    },
  };
}

/** Causa técnica para o registro local (o logger mascara segredos); nunca vai para o CRM. */
function describeCause(error) {
  const cause = error.cause;
  if (!cause) return "";
  const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return ` | causa: ${text.split("\n")[0].slice(0, 400)}`;
}

/** Acesso da Servopa: o entregue pelo CRM; o `.env` local só vale como recurso de diagnóstico. */
function resolvePanelAccess(config, credentials) {
  const user = credentials?.user ?? config.servopaUser;
  const password = credentials?.password ?? config.servopaPassword;
  if (!user || !password) {
    throw new WorkerError("PANEL_CREDENTIALS_MISSING", "O CRM nao entregou o acesso da Servopa.");
  }
  return { servopaUser: user, servopaPassword: password };
}

async function processJob(client, config, job, credentials) {
  log(`Coleta ${job.id} iniciada (tentativa ${job.attempt}).`);
  status("collecting", { runId: job.id, completed: 0, total: 0 });
  const heartbeat = startHeartbeat(client, job);
  let uploadStarted = false;
  try {
    await heartbeat.start();
    heartbeat.update({ phase: "AUTHENTICATING", completed: 0, total: 1 });
    const panelAccess = resolvePanelAccess(config, credentials);
    log.addSecrets?.([panelAccess.servopaUser, panelAccess.servopaPassword]);
    const snapshot = await collectServopaSnapshot({ ...config, ...panelAccess }, {
      signal: heartbeat.signal,
      log,
      onProgress: (next) => {
        heartbeat.update(next);
        if (next.phase === "FETCHING_GROUPS") status("collecting", { runId: job.id, completed: next.completed, total: next.total });
      },
    });
    await heartbeat.flush({ phase: "VALIDATING", completed: 1, total: 1 });
    uploadStarted = true;
    status("uploading", { runId: job.id });
    const result = await client.snapshot(job, snapshot);
    await heartbeat.stop();
    log(`Coleta ${job.id} concluida: ${snapshot.pages.length} grupos enviados.`);
    return result;
  } catch (cause) {
    await heartbeat.stop();
    const error = asWorkerError(cause);
    const interrupted = error.code === "JOB_CANCELLED" || error.code === "INVALID_LEASE";
    log(interrupted
      ? `Coleta ${job.id} interrompida pelo CRM.`
      : `Coleta ${job.id} falhou [${error.code}]: ${error.message}${describeCause(error)}`);
    if (!uploadStarted && !interrupted) {
      await client.fail(job, error)
        .then((result) => {
          if (result.exhausted) log(`Coleta ${job.id} atingiu o limite de ${result.maxAttempts} tentativas.`);
        })
        .catch((reportError) => {
          const safe = asWorkerError(reportError);
          log(`Nao foi possivel registrar a falha no CRM [${safe.code}].`);
        });
    }
  }
}

/** Só o robô instalado (com versão informada pelo iniciador) se atualiza; em desenvolvimento nunca. */
function updateAvailable(config, client) {
  return Boolean(!config.updateBlocked && config.appVersion && client.latestAppVersion && client.latestAppVersion !== config.appVersion);
}

async function main() {
  const once = process.argv.includes("--once");
  const config = readWorkerConfig();
  log = createWorkerLogger([config.workerKey, config.servopaUser, config.servopaPassword]);
  status = createStatusWriter();
  const releaseInstance = acquireSingleInstance();
  process.once("exit", releaseInstance);
  const client = new CrmClient(config);
  log(`Robo Servopa iniciado${config.appVersion ? ` (versao ${config.appVersion})` : ""}.`);
  status("starting");

  try {
    do {
      try {
        const { job, credentials } = await client.claim();
        if (job) {
          log.addSecrets?.([credentials?.user, credentials?.password]);
          await processJob(client, config, job, credentials);
        }
        status("idle");
      } catch (cause) {
        const error = asWorkerError(cause);
        if (error.code === "CRM_HTTP_401") {
          log("O CRM recusou a chave deste computador (removido no CRM). O robo vai parar.");
          return EXIT_CREDENTIAL_REVOKED;
        }
        if (error.code === "PANEL_CREDENTIALS_MISSING") {
          status("waiting-access");
        } else {
          status("offline");
          log(`CRM indisponivel [${error.code}]: ${error.message}`);
        }
        if (!error.retryable) throw error;
      }
      if (updateAvailable(config, client)) {
        log(`Nova versao do robo disponivel (${client.latestAppVersion}). Reiniciando para atualizar.`);
        return EXIT_UPDATE_AVAILABLE;
      }
      if (!once) await sleep(config.pollSeconds * 1_000);
    } while (!once);
    return 0;
  } finally {
    releaseInstance();
  }
}

await main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause) => {
    const error = asWorkerError(cause);
    log(`Robo encerrado [${error.code}]: ${error.message}${describeCause(error)}`);
    process.exitCode = 1;
  });
