/**
 * Contrato HTTP das Planilhas, compartilhado pelas rotas internas
 * (/api/sheets, sessão do Administrativo) e públicas (/api/v1/sheets, API
 * key): schemas zod dos corpos + disparo de webhooks. Rota fica só com
 * "autentica → valida → chama lib/sheets → responde".
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { enqueueWebhookEvent } from "@/lib/webhooks/enqueue";
import { sheetErrorResponse } from "@/lib/sheets/errors";
import { SHEET_COLUMN_TYPES } from "@/lib/sheets/column-types";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { AGG_FNS, FILTER_OPS, type SheetRowOut } from "@/lib/sheets/rows";
import { bodyErrorResponse } from "@/lib/read-body";
import { runWithTenant } from "@/lib/tenant-context";

const id = z.string().min(1).max(64);
const rowValues = z.record(z.string().max(64), z.unknown());

export const columnInputSchema = z.object({
  name: z.string().max(SHEET_LIMITS.nameChars),
  type: z.enum(SHEET_COLUMN_TYPES),
  config: z.unknown().optional(),
  required: z.boolean().optional(),
});

export const createSheetSchema = z.object({
  name: z.string().max(SHEET_LIMITS.nameChars),
  description: z.string().max(SHEET_LIMITS.descriptionChars).optional(),
  columns: z.array(columnInputSchema).max(SHEET_LIMITS.columnsPerSheet).optional(),
});

export const updateSheetSchema = z.object({
  name: z.string().max(SHEET_LIMITS.nameChars).optional(),
  description: z.string().max(SHEET_LIMITS.descriptionChars).optional(),
  archived: z.boolean().optional(),
  /** Aparência (Formatar como Tabela…) — validada em lib/sheets/formats.ts. */
  settings: z.unknown().optional(),
});

export const createColumnSchema = columnInputSchema.extend({ position: z.number().int().min(0).optional() });

export const updateColumnSchema = columnInputSchema.partial().extend({
  position: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
  /** Confirma apagar os valores que não cabem no tipo novo. */
  force: z.boolean().optional(),
  /** Resolução rápida para valores incompatíveis: limpar, converter para 0 ou adicionar às opções. */
  onInvalid: z.enum(["clear", "zero", "addOptions"]).optional(),
});

const rowExtras = z.object({ formats: z.record(z.string().max(64), z.unknown()).optional(), formulas: z.record(z.string().max(64), z.unknown()).optional() });
export const insertRowsSchema = z.object({
  rows: z.array(rowValues).min(1).max(SHEET_LIMITS.batchRows),
  /** Marcações/fórmulas das linhas novas, na mesma ordem de `rows` (colar do Excel, fórmula numa linha nova). */
  extras: z.array(rowExtras.optional().nullable()).max(SHEET_LIMITS.batchRows).optional(),
});
export const updateRowsSchema = z.object({
  rows: z
    .array(
      z.object({
        id,
        values: rowValues.optional(),
        formats: z.record(z.string().max(64), z.unknown()).optional(),
        formulas: z.record(z.string().max(64), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(SHEET_LIMITS.batchRows),
});
export const rowIdsSchema = z.object({ ids: z.array(id).min(1).max(SHEET_LIMITS.batchRows) });

const filterSchema = z.object({ columnId: id, op: z.enum(FILTER_OPS), value: z.unknown().optional() });

export const queryRowsSchema = z.object({
  filters: z.array(filterSchema).max(30).optional(),
  match: z.enum(["all", "any"]).optional(),
  sort: z.array(z.object({ columnId: id, dir: z.enum(["asc", "desc"]) })).max(5).optional(),
  search: z.string().max(200).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(SHEET_LIMITS.pageSizeMax).optional(),
  deleted: z.boolean().optional(),
});

export const summarySchema = z.object({
  groupBy: id.optional(),
  metrics: z.array(z.object({ columnId: id.optional(), fn: z.enum(AGG_FNS) })).min(1).max(10),
  filters: z.array(filterSchema).max(30).optional(),
  match: z.enum(["all", "any"]).optional(),
});

export function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  return issue ? `${issue.path.join(".") || "corpo"}: ${issue.message}` : "Dados inválidos";
}

/** Converte erro conhecido (regra de negócio, corpo grande/ inválido) em resposta; relança o resto. */
export function sheetRouteError(err: unknown): NextResponse {
  const res = sheetErrorResponse(err) ?? bodyErrorResponse(err);
  if (res) return res;
  throw err;
}

/** Webhooks de linha — nunca derruba a gravação, que já aconteceu. */
export function emitRowEvents(
  organizationId: string,
  event: "sheet.row.created" | "sheet.row.updated" | "sheet.row.deleted",
  sheet: { id: string; name: string },
  rows: Pick<SheetRowOut, "id" | "values">[],
) {
  // Um evento por linha (mesmo formato dos outros webhooks); lote grande vira
  // muitas entregas, então acima de 200 manda um evento-resumo só com os ids.
  const payloads =
    rows.length > 200
      ? [{ sheet, rowIds: rows.map((r) => r.id), truncated: true }]
      : rows.map((r) => ({ sheet, row: event === "sheet.row.deleted" ? { id: r.id } : r }));
  runWithTenant(organizationId, () => Promise.all(payloads.map((p) => enqueueWebhookEvent(organizationId, event, p)))).catch((err) =>
    console.error(`[webhooks] falha ao enfileirar ${event}`, err),
  );
}
