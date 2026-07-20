import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildSimuladorSsoToken } from "@/lib/simulador-sso";

export const dynamic = "force-dynamic";

// Rota dedicada confirmada do lado do Simulador (app/api/auth/crm-sso) — ver
// lib/crm-sso.ts de lá. SIMULADOR_URL é só o domínio base (sem path).
const SSO_PATH = "/api/auth/crm-sso";

/**
 * Ponto único que o botão "Simulador" (header/mobile-nav) chama — gera o
 * token assinado (lib/simulador-sso.ts) e redireciona pro Simulador com ele
 * na query string. Nunca aponta pro Simulador direto: centralizar aqui
 * significa que trocar de URL/segredo, ou parar de usar query string em
 * favor de outro mecanismo, é uma mudança só, num lugar só.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.organizationId) return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));

  const simuladorUrl = process.env.SIMULADOR_URL;
  if (!simuladorUrl) {
    return NextResponse.json({ error: "SIMULADOR_URL não configurado" }, { status: 500 });
  }

  const token = buildSimuladorSsoToken({
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    organizationId: session.user.organizationId,
  });

  const target = new URL(SSO_PATH, simuladorUrl);
  target.searchParams.set("crm_sso_token", token);
  return NextResponse.redirect(target);
}
