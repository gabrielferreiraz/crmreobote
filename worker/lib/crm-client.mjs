import { readFileSync } from "node:fs";
import { WorkerError } from "./errors.mjs";

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** Versão enviada ao CRM: a do pacote instalado (`0.3.0+hash`) ou a do package.json em desenvolvimento. */
export const WORKER_VERSION = process.env.SERVOPA_APP_VERSION?.trim() || PACKAGE_VERSION;

export class CrmClient {
  constructor({ crmBaseUrl, workerKey }) {
    this.baseUrl = crmBaseUrl;
    this.workerKey = workerKey;
    /** Versão atual do robô anunciada pelo CRM em cada resposta (`X-Servopa-App-Version`). */
    this.latestAppVersion = null;
  }

  async request(path, body, { timeoutMs = 30_000 } = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.workerKey}`,
          "Content-Type": "application/json",
          "X-Servopa-Worker-Version": WORKER_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new WorkerError("CRM_UNREACHABLE", "O CRM nao respondeu.", { cause });
    }

    const announced = response.headers.get("x-servopa-app-version");
    if (announced && announced.length <= 50) this.latestAppVersion = announced;

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof data?.code === "string" ? data.code : `CRM_HTTP_${response.status}`;
      const message = typeof data?.error === "string" ? data.error : "O CRM recusou a requisicao do robo.";
      throw new WorkerError(code, message, { retryable: response.status >= 500 || response.status === 429 });
    }
    return data;
  }

  claim() {
    return this.request("/api/servopa-worker/claim", {});
  }

  heartbeat(job, progress) {
    return this.request("/api/servopa-worker/heartbeat", {
      runId: job.id,
      leaseToken: job.leaseToken,
      progress,
    });
  }

  fail(job, error) {
    return this.request("/api/servopa-worker/fail", {
      runId: job.id,
      leaseToken: job.leaseToken,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    });
  }

  snapshot(job, snapshot) {
    return this.retrySnapshot({
      runId: job.id,
      leaseToken: job.leaseToken,
      complete: true,
      ...snapshot,
    });
  }

  async retrySnapshot(payload) {
    let lastError;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        return await this.request("/api/servopa-worker/snapshot", payload, { timeoutMs: 10 * 60_000 });
      } catch (error) {
        lastError = error;
        const processing = error instanceof WorkerError && error.code === "INVALID_LEASE";
        if (!(error instanceof WorkerError) || (!error.retryable && !processing) || attempt === 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    }
    throw lastError;
  }
}
