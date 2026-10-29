import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";
import { ServopaQueueError } from "@/lib/servopa-tables/queue";
import { requireServopaWorker } from "@/lib/servopa-tables/worker-auth";
import { getServopaWorkerAppVersion } from "@/lib/servopa-tables/worker-bundle";

/**
 * Toda resposta ao robô diz qual é a versão atual do código dele; o robô
 * instalado compara com a própria e, se estiver ocioso, se atualiza sozinho.
 */
export function servopaWorkerJson(body: unknown, status = 200) {
  const appVersion = getServopaWorkerAppVersion();
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(appVersion ? { "X-Servopa-App-Version": appVersion } : {}) },
  });
}

export async function requireServopaWorkerRoute(req: Request, action: string) {
  const ipLimit = rateLimitOrResponse(`servopa-worker-ip:${getClientIp(req)}`, 180, 60_000);
  if (ipLimit) {
    ipLimit.headers.set("Cache-Control", "no-store");
    return { ok: false as const, response: ipLimit };
  }

  const access = await requireServopaWorker(req);
  if (!access.ok) return { ok: false as const, response: servopaWorkerJson({ error: "Credencial inválida" }, 401) };

  const workerLimit = rateLimitOrResponse(`servopa-worker:${access.workerId}:${action}`, 120, 60_000);
  if (workerLimit) {
    workerLimit.headers.set("Cache-Control", "no-store");
    return { ok: false as const, response: workerLimit };
  }
  return { ok: true as const, access };
}

export async function parseServopaWorkerBody<T extends z.ZodType>(req: Request, schema: T, maxBytes = 16_384) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return { ok: false as const, response: servopaWorkerJson({ error: "Requisição muito grande" }, 413) };

  const text = await req.text().catch(() => "");
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false as const, response: servopaWorkerJson({ error: "Requisição muito grande" }, 413) };
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false as const, response: servopaWorkerJson({ error: "JSON inválido" }, 400) };
  }
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true as const, data: parsed.data as z.infer<T> }
    : { ok: false as const, response: servopaWorkerJson({ error: "Requisição inválida" }, 400) };
}

export function servopaQueueErrorResponse(error: unknown) {
  if (error instanceof ServopaQueueError) {
    const status = error.code === "INVALID_LEASE" || error.code === "JOB_CANCELLED" ? 409 : 400;
    return servopaWorkerJson({ error: error.message, code: error.code }, status);
  }
  return servopaWorkerJson({ error: "Não foi possível atualizar o estado do robô" }, 500);
}
