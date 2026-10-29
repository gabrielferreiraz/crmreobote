/**
 * Base das rotas /api/v1/sheets/* (integração externa por API key — Make,
 * n8n, Zapier, BI). Mesmo envelope { success, data } do resto da v1 e a
 * mesma lib/sheets das telas: integração não tem atalho que pule validação.
 * Toda escrita sai no histórico como source "api:<apiKeyId>".
 */

import { NextResponse } from "next/server";
import type { z } from "zod";
import { requireApiKey } from "@/lib/require-api-key";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { bodyErrorResponse, readJson } from "@/lib/read-body";
import { apiError } from "@/lib/api/v1-response";
import { sheetErrorResponse } from "@/lib/sheets/errors";
import { firstIssue } from "@/lib/sheets/http";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import type { SheetActor } from "@/lib/sheets/sheets";

export async function requireSheetsApi(req: Request, bucket: "read" | "write"): Promise<{ actor: SheetActor } | { response: NextResponse }> {
  const access = await requireApiKey(req);
  if (!access.ok) return { response: apiError("Chave de API inválida ou revogada", 401) };
  const limited = rateLimitOrResponse(`apikey:${access.apiKeyId}:sheets:${bucket}`, bucket === "read" ? 120 : 60, 60_000);
  if (limited) return { response: limited };
  return {
    actor: { organizationId: access.organizationId, userId: null, actorName: "Integração (API)", source: `api:${access.apiKeyId}` },
  };
}

export async function readV1Body<T>(req: Request, schema: z.ZodType<T>, maxBytes: number = SHEET_LIMITS.pasteBodyBytes): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await readJson(req, maxBytes);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return { response: apiError((await res.json()).error, res.status) };
    throw err;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: apiError(firstIssue(parsed.error), 400) };
  return { data: parsed.data };
}

/** Erro de regra → envelope v1; inesperado relança (vira 500 com log). */
export async function v1SheetError(err: unknown): Promise<NextResponse> {
  const res = sheetErrorResponse(err);
  if (!res) throw err;
  const { error, ...details } = (await res.json()) as { error: string } & Record<string, unknown>;
  return apiError(error, res.status, Object.keys(details).length ? [details] : undefined);
}
