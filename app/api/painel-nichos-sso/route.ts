import { NextResponse } from "next/server";
import { buildPainelNichosSsoToken } from "@/lib/painel-nichos-sso";
import { getCurrentMembership } from "@/lib/current-membership";

export const dynamic = "force-dynamic";

// Rota dedicada do lado do Painel de Nichos (mesmo caminho que o Simulador
// usa, ver app/api/simulador-sso/route.ts). PAINEL_NICHOS_URL é só o
// domínio base (sem path).
const SSO_PATH = "/api/auth/crm-sso";

/**
 * Ponto único que o botão do Painel de Nichos deve chamar — gera o token
 * assinado (lib/painel-nichos-sso.ts) e redireciona pro Painel de Nichos com
 * ele na query string. Nunca aponta pro Painel de Nichos direto: centralizar
 * aqui significa que trocar de URL/segredo, ou parar de usar query string em
 * favor de outro mecanismo, é uma mudança só, num lugar só. Mesmo padrão do
 * Simulador, arquivo/rota independentes — nenhum dos dois mexe no outro.
 *
 * getCurrentMembership() (não `auth()` cru) porque reconfirma a filiação no
 * banco antes de liberar — uma desativação precisa barrar isto na próxima
 * chamada, não só bloquear login novo (mesmo cuidado de toda rota deste
 * tipo no projeto).
 */
export async function GET() {
  const membership = await getCurrentMembership();
  if (!membership?.active) return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));

  const painelNichosUrl = process.env.PAINEL_NICHOS_URL;
  if (!painelNichosUrl) {
    return NextResponse.json({ error: "PAINEL_NICHOS_URL não configurado" }, { status: 500 });
  }

  const session = membership.session;
  const token = buildPainelNichosSsoToken({
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    organizationId: membership.organizationId,
  });

  const target = new URL(SSO_PATH, painelNichosUrl);
  target.searchParams.set("crm_sso_token", token);
  return NextResponse.redirect(target);
}
