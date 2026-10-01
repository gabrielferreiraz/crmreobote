import { NextResponse } from "next/server";
import { requireAcademyToken } from "@/lib/require-academy-token";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/academy/me — usuário logado, do ponto de vista da Academy.
 * Resposta em formato FLAT (sem envelope {success,data}) — diferente da
 * convenção de app/api/v1/* (ver lib/api/v1-response.ts): o contrato aqui foi
 * fechado direto com a Academy no formato do spec original, não é a mesma
 * integração externa "genérica" (Make/Zapier) que aquele envelope serve.
 */
export async function GET(req: Request) {
  const access = await requireAcademyToken(req);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rateLimited = rateLimitOrResponse(`academy:${access.userId}:me`, 60, 60_000);
  if (rateLimited) return rateLimited;

  return NextResponse.json({ id: access.userId, name: access.name, email: access.email, role: access.role });
}
