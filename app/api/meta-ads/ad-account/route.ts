import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { listAdAccounts } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

/**
 * Lista as contas de anúncio disponíveis pra escolher (ver
 * meta-ads-connect.tsx, botão "Trocar" quando já conectado) — chama a Graph
 * API de novo a cada abertura de propósito (é uma tela de configuração,
 * baixo tráfego; evita guardar uma cópia que pode ficar desatualizada se o
 * usuário ganhar/perder acesso a uma conta do lado da Meta).
 */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId: access.organizationId } });
    if (!connection) return NextResponse.json({ error: "Conecte o Facebook primeiro" }, { status: 404 });
    if (!connection.userAccessTokenEncrypted) {
      return NextResponse.json(
        { error: "Conexão feita antes do resumo de gasto existir — reconecte com o Facebook pra habilitar." },
        { status: 409 },
      );
    }

    try {
      const accounts = await listAdAccounts(decryptSecret(connection.userAccessTokenEncrypted));
      return NextResponse.json({ accounts, currentAdAccountId: connection.adAccountId });
    } catch (err) {
      console.error("[meta-ads] falha ao listar contas de anúncio", err);
      return NextResponse.json({ error: "Não foi possível consultar as contas de anúncio no Facebook agora." }, { status: 502 });
    }
  });
}

/** Troca a Ad Account usada no resumo de gasto (ver lib/meta-ads/insights.ts). */
export async function PATCH(req: Request) {
  const { adAccountId } = (await req.json().catch(() => ({}))) as { adAccountId?: string };
  if (!adAccountId) return NextResponse.json({ error: "adAccountId é obrigatório" }, { status: 400 });

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId: access.organizationId } });
    if (!connection) return NextResponse.json({ error: "Conecte o Facebook primeiro" }, { status: 404 });
    if (!connection.userAccessTokenEncrypted) {
      return NextResponse.json(
        { error: "Conexão feita antes do resumo de gasto existir — reconecte com o Facebook pra habilitar." },
        { status: 409 },
      );
    }

    // Confia no id, mas busca nome/moeda de novo em vez de aceitar o que o
    // cliente mandou — evita guardar um nome desatualizado ou inventado.
    let accounts;
    try {
      accounts = await listAdAccounts(decryptSecret(connection.userAccessTokenEncrypted));
    } catch (err) {
      console.error("[meta-ads] falha ao listar contas de anúncio pra confirmar escolha", err);
      return NextResponse.json({ error: "Não foi possível consultar as contas de anúncio no Facebook agora." }, { status: 502 });
    }
    const account = accounts.find((a) => a.id === adAccountId);
    if (!account) return NextResponse.json({ error: "Conta de anúncio não encontrada" }, { status: 400 });

    const updated = await prisma.metaAdsConnection.update({
      where: { organizationId: access.organizationId },
      data: { adAccountId: account.id, adAccountName: account.name, adAccountCurrency: account.currency },
    });

    return NextResponse.json({
      adAccountId: updated.adAccountId,
      adAccountName: updated.adAccountName,
      adAccountCurrency: updated.adAccountCurrency,
    });
  });
}
