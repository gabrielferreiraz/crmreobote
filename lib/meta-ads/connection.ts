/**
 * Chamado logo depois que a Página foi escolhida/salva (tanto no caminho de
 * uma Página só quanto no de escolher entre várias — ver
 * app/api/meta-ads/callback/route.ts e app/api/meta-ads/pages/select/route.ts),
 * já dentro do runWithTenant do chamador.
 *
 * Sempre grava o token de USUÁRIO de longa duração (é o único que consulta
 * a Insights API depois — token de Página não serve, ver
 * MetaAdsConnection.userAccessTokenEncrypted no schema) e, se sobrar
 * exatamente UMA Ad Account, já pré-seleciona ela sozinho — caso comum (uma
 * Business Manager, uma conta de anúncio) não exige nenhum passo a mais do
 * administrativo. Mais de uma conta: fica sem escolher, o admin escolhe
 * depois em Configurações → Integrações (ver GET/PATCH
 * /api/meta-ads/ad-account). Zero contas encontradas ou falha ao listar:
 * mesma coisa, só loga — nunca derruba a conexão da Página por causa disso
 * (Lead Ads + Conversions API continuam funcionando normalmente sem Ad
 * Account selecionada, só o resumo de gasto fica indisponível).
 */

import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/security/secret-crypto";
import { listAdAccounts } from "@/lib/meta-ads";

export async function finalizeAdAccountAutoSelection(organizationId: string, userAccessToken: string): Promise<void> {
  const data: {
    userAccessTokenEncrypted: string;
    adAccountId?: string;
    adAccountName?: string;
    adAccountCurrency?: string;
  } = {
    userAccessTokenEncrypted: encryptSecret(userAccessToken),
  };

  try {
    const accounts = await listAdAccounts(userAccessToken);
    if (accounts.length === 1) {
      data.adAccountId = accounts[0].id;
      data.adAccountName = accounts[0].name;
      data.adAccountCurrency = accounts[0].currency;
      console.log(`[meta-ads] conta de anúncio única auto-selecionada: ${accounts[0].name} (${accounts[0].id})`);
    } else {
      console.log(`[meta-ads] ${accounts.length} contas de anúncio encontradas — administrativo escolhe manualmente depois`);
    }
  } catch (err) {
    console.error("[meta-ads] falha ao listar contas de anúncio pra auto-seleção", err);
  }

  await prisma.metaAdsConnection.update({ where: { organizationId }, data });
}
