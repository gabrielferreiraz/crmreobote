import { NextResponse } from "next/server";
import { CellValueError } from "@/lib/sheets/column-types";

/** Erro de regra de negócio das Planilhas, com status HTTP — rota converte com sheetErrorResponse. */
export class SheetError extends Error {
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SheetError";
    this.status = status;
    this.details = details;
  }
}

export const sheetNotFound = () => new SheetError(404, "Planilha não encontrada");

/** Resposta pronta para SheetError/CellValueError; `null` = erro inesperado, quem chamou relança. */
export function sheetErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof SheetError) return NextResponse.json({ error: err.message, ...(err.details ?? {}) }, { status: err.status });
  if (err instanceof CellValueError) return NextResponse.json({ error: err.message, columnId: err.columnId }, { status: 400 });
  return null;
}
