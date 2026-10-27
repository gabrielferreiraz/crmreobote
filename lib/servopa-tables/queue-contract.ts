import { createHash } from "node:crypto";

export const SERVOPA_MAX_ATTEMPTS = 8;

export type ServopaSyncProgress = {
  phase: "STARTING" | "AUTHENTICATING" | "LISTING_GROUPS" | "FETCHING_GROUPS" | "VALIDATING" | "UPLOADING";
  completed: number;
  total: number;
  message?: string;
};

const PROGRESS_PHASES = new Set<ServopaSyncProgress["phase"]>([
  "STARTING",
  "AUTHENTICATING",
  "LISTING_GROUPS",
  "FETCHING_GROUPS",
  "VALIDATING",
  "UPLOADING",
]);

export class ServopaQueueError extends Error {
  readonly code: "ACTIVE_JOB_EXISTS" | "INVALID_LEASE" | "INVALID_PROGRESS" | "JOB_CANCELLED";

  constructor(code: "ACTIVE_JOB_EXISTS" | "INVALID_LEASE" | "INVALID_PROGRESS" | "JOB_CANCELLED", message: string) {
    super(message);
    this.name = "ServopaQueueError";
    this.code = code;
  }
}

/** O token puro só existe no worker; comparações usam sempre SHA-256. */
export function hashServopaLeaseToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A API futura ainda validará o JSON externo antes de chegar ao motor. */
export function validateServopaSyncProgress(progress: ServopaSyncProgress): ServopaSyncProgress {
  if (
    !PROGRESS_PHASES.has(progress.phase) ||
    !Number.isInteger(progress.completed) ||
    !Number.isInteger(progress.total) ||
    progress.completed < 0 ||
    progress.total < 0 ||
    progress.completed > progress.total ||
    (progress.message !== undefined && (typeof progress.message !== "string" || progress.message.length > 240))
  ) {
    throw new ServopaQueueError("INVALID_PROGRESS", "O progresso informado pelo robô é inválido.");
  }
  return progress.message ? { ...progress, message: progress.message.trim() } : progress;
}

export function planServopaFailure(params: {
  attempts: number;
  retryAt?: Date;
  code: string;
  message: string;
}) {
  const exhausted = Boolean(params.retryAt) && params.attempts >= SERVOPA_MAX_ATTEMPTS;
  if (params.retryAt && !exhausted) {
    return {
      status: "PENDING" as const,
      retryAt: params.retryAt,
      errorCode: params.code,
      error: params.message,
      exhausted: false,
    };
  }
  return {
    status: "FAILED" as const,
    retryAt: null,
    errorCode: exhausted ? "RETRY_LIMIT_REACHED" : params.code,
    error: exhausted
      ? `A atualizacao parou apos ${SERVOPA_MAX_ATTEMPTS} tentativas. Ultima falha: ${params.message}`
      : params.message,
    exhausted,
  };
}

/** Quantos computadores ativos (com credencial) uma organização pode ter ao mesmo tempo. */
export const MAX_SERVOPA_WORKERS = 10;

/** Por quanto tempo o instalador baixado no CRM pode ser usado (uma única vez). */
export const SERVOPA_PAIRING_TTL_MS = 60 * 60 * 1_000;
