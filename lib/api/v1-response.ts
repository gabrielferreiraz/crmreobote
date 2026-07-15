import { NextResponse } from "next/server";

/** Envelope de resposta padronizado só da camada /api/v1 (integração externa) — rotas internas continuam como já eram. */
export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(error: string, status: number, details?: unknown[]) {
  return NextResponse.json({ success: false, error, ...(details ? { details } : {}) }, { status });
}
