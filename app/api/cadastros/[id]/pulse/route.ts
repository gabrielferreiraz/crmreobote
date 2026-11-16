import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { canBypassRegistration } from "@/lib/deal-registration/rules";
import { getDealRegistrationSignature } from "@/lib/deal-registration/live";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Consulta leve que a tela de UM cadastro (/cadastros/[id]) faz sozinha: devolve só a
 * "assinatura" daquela venda (ver lib/deal-registration/live.ts). Mesma permissão da
 * própria tela (Administrativo e Dono).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getCurrentMembership();
  if (!m?.active || !canBypassRegistration(m)) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const limited = rateLimitOrResponse(`cadastro-pulse:${m.userId}`, 30, 60_000);
  if (limited) return limited;

  const signature = await runWithTenant(m.organizationId, () => getDealRegistrationSignature(m.organizationId, id));
  return NextResponse.json({ signature }, { headers: { "Cache-Control": "no-store" } });
}
