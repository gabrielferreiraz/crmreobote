import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { canBypassRegistration } from "@/lib/deal-registration/rules";
import { getCadastrosSignature } from "@/lib/deal-registration/live";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Consulta leve que a tela de Cadastros faz sozinha: devolve só a "assinatura" da fila
 * (ver lib/deal-registration/live.ts). Mesma permissão da própria tela (Administrativo e Dono).
 */
export async function GET() {
  const m = await getCurrentMembership();
  if (!m?.active || !canBypassRegistration(m)) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Folga larga: uma aba consulta a cada ~15 s (4/min); isso só barra abuso.
  const limited = rateLimitOrResponse(`cadastros-pulse:${m.userId}`, 30, 60_000);
  if (limited) return limited;

  const signature = await runWithTenant(m.organizationId, () => getCadastrosSignature(m.organizationId));
  return NextResponse.json({ signature }, { headers: { "Cache-Control": "no-store" } });
}
