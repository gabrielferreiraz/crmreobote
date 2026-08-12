/**
 * Resumo de gasto/leads/custo-por-lead do Meta Ads pra alimentar os cards da
 * aba Facebook em Relatórios — 4 períodos fixos (hoje, últimos 7 dias, este
 * mês, este ano), numa chamada só na Insights API (ver fetchAdSpendInsights
 * em lib/meta-ads.ts). Sem cache: chamado direto a cada carregamento da
 * página — é uma tela de baixo tráfego (só quem abre esse relatório
 * específico), bem dentro do rate limit da Marketing API pra uma única Ad
 * Account.
 *
 * since/until de cada período usam o calendário de Brasília (ver
 * lib/timezone.ts). A Insights API interpreta essas datas no fuso
 * configurado NA PRÓPRIA Ad Account — pra uma conta de anunciante
 * brasileiro isso quase sempre já é esse mesmo fuso, mas não dá pra
 * confirmar sem consultar timezone_offset_hours_utc da conta (que
 * economizamos aqui de propósito: o pior caso é o corte de "hoje" ficar até
 * ~1h errado, não afeta os períodos de semana/mês/ano de verdade).
 */

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { fetchAdSpendInsights, fetchInsightsBreakdown, type AdInsightsPeriod } from "@/lib/meta-ads";
import { MetaApiError } from "@/lib/meta-graph";
import { brazilDateKey, brazilStartOfDay, brazilStartOfMonth, getBrazilParts } from "@/lib/timezone";

export type AdSpendPeriodKey = "today" | "last7d" | "month" | "year";

export type AdSpendPeriod = {
  key: AdSpendPeriodKey;
  label: string;
  spend: number;
  leads: number;
  costPerLead: number | null;
};

export type AdSpendSummary =
  | { ok: true; adAccountName: string; currency: string; periods: AdSpendPeriod[] }
  | { ok: false; reason: "not_connected" | "no_ad_account" | "token_missing" | "error"; message?: string };

function daysAgoKey(now: Date, days: number): string {
  const startToday = brazilStartOfDay(now);
  return brazilDateKey(new Date(startToday.getTime() - days * 86_400_000));
}

function buildPeriodDefs(now: Date = new Date()): { key: AdSpendPeriodKey; label: string; since: string; until: string }[] {
  const todayKey = brazilDateKey(now);
  const { year } = getBrazilParts(now);
  return [
    { key: "today", label: "Hoje", since: todayKey, until: todayKey },
    { key: "last7d", label: "Últimos 7 dias", since: daysAgoKey(now, 6), until: todayKey },
    { key: "month", label: "Este mês", since: brazilDateKey(brazilStartOfMonth(now)), until: todayKey },
    { key: "year", label: "Este ano", since: `${year}-01-01`, until: todayKey },
  ];
}

/** Só key+label dos 4 períodos fixos — pro seletor da UI (ver meta-ads-view.tsx), sem expor since/until (detalhe de implementação). */
export const AD_SPEND_PERIODS: { key: AdSpendPeriodKey; label: string }[] = buildPeriodDefs().map((p) => ({
  key: p.key,
  label: p.label,
}));

export async function getAdSpendSummary(organizationId: string): Promise<AdSpendSummary> {
  const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId } });
  if (!connection) return { ok: false, reason: "not_connected" };
  if (!connection.userAccessTokenEncrypted) return { ok: false, reason: "token_missing" };
  if (!connection.adAccountId) return { ok: false, reason: "no_ad_account" };

  const periodDefs = buildPeriodDefs();

  try {
    const accessToken = decryptSecret(connection.userAccessTokenEncrypted);
    const results = await fetchAdSpendInsights(
      connection.adAccountId,
      accessToken,
      periodDefs.map((p): AdInsightsPeriod => ({ key: p.key, since: p.since, until: p.until })),
    );
    const byKey = new Map(results.map((r) => [r.key, r]));

    const periods: AdSpendPeriod[] = periodDefs.map((def) => {
      const r = byKey.get(def.key);
      const spend = r?.spend ?? 0;
      const leads = r?.leads ?? 0;
      return { key: def.key, label: def.label, spend, leads, costPerLead: leads > 0 ? spend / leads : null };
    });

    return {
      ok: true,
      adAccountName: connection.adAccountName ?? connection.adAccountId,
      currency: connection.adAccountCurrency ?? "BRL",
      periods,
    };
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : "Falha ao consultar a Insights API da Meta";
    console.error(`[meta-ads] falha ao buscar gasto/leads da Ad Account ${connection.adAccountId}`, err);
    return { ok: false, reason: "error", message };
  }
}

export type AdBreakdownAd = { id: string; name: string; spend: number; leads: number; costPerLead: number | null };
export type AdBreakdownCampaign = AdBreakdownAd & { ads: AdBreakdownAd[] };

export type AdCampaignBreakdown =
  | { ok: true; periodLabel: string; campaigns: AdBreakdownCampaign[] }
  | { ok: false; reason: "not_connected" | "no_ad_account" | "token_missing" | "error"; message?: string };

/**
 * Gasto/leads por campanha, com os anúncios de cada uma aninhados dentro
 * (ver AdBreakdownCampaign.ads) — pro período escolhido (ver AD_SPEND_PERIODS
 * acima e o seletor em meta-ads-view.tsx). Uma chamada só na Insights API
 * com `level: "ad"` (ver fetchInsightsBreakdown em lib/meta-ads.ts); os
 * totais por campanha são somados aqui a partir das linhas de anúncio — não
 * bate a API de novo com `level: "campaign"` pra isso, todo anúncio
 * pertence a exatamente uma campanha, a soma sempre bate.
 */
export async function getAdCampaignBreakdown(organizationId: string, periodKey: AdSpendPeriodKey): Promise<AdCampaignBreakdown> {
  const connection = await prisma.metaAdsConnection.findUnique({ where: { organizationId } });
  if (!connection) return { ok: false, reason: "not_connected" };
  if (!connection.userAccessTokenEncrypted) return { ok: false, reason: "token_missing" };
  if (!connection.adAccountId) return { ok: false, reason: "no_ad_account" };

  const periodDefs = buildPeriodDefs();
  const periodDef = periodDefs.find((p) => p.key === periodKey) ?? periodDefs.find((p) => p.key === "month")!;

  try {
    const accessToken = decryptSecret(connection.userAccessTokenEncrypted);
    const adRows = await fetchInsightsBreakdown(connection.adAccountId, accessToken, "ad", {
      since: periodDef.since,
      until: periodDef.until,
    });

    const campaignMap = new Map<string, AdBreakdownCampaign>();
    for (const row of adRows) {
      const campaignId = row.campaignId ?? "sem-campanha";
      const campaignName = row.campaignName ?? "(sem campanha)";
      if (!campaignMap.has(campaignId)) {
        campaignMap.set(campaignId, { id: campaignId, name: campaignName, spend: 0, leads: 0, costPerLead: null, ads: [] });
      }
      const campaign = campaignMap.get(campaignId)!;
      campaign.spend += row.spend;
      campaign.leads += row.leads;
      campaign.ads.push({ id: row.id, name: row.name, spend: row.spend, leads: row.leads, costPerLead: row.leads > 0 ? row.spend / row.leads : null });
    }

    const campaigns = Array.from(campaignMap.values())
      .map((c) => ({ ...c, costPerLead: c.leads > 0 ? c.spend / c.leads : null, ads: c.ads.sort((a, b) => b.spend - a.spend) }))
      .sort((a, b) => b.spend - a.spend);

    return { ok: true, periodLabel: periodDef.label, campaigns };
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : "Falha ao consultar a Insights API da Meta";
    console.error(`[meta-ads] falha ao buscar detalhamento por campanha da Ad Account ${connection.adAccountId}`, err);
    return { ok: false, reason: "error", message };
  }
}
