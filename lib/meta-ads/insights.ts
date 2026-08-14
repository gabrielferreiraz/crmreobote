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
import { fetchAdSpendInsights, type AdInsightsPeriod } from "@/lib/meta-ads";
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

export type AdSpendPeriodDef = { key: AdSpendPeriodKey; label: string; since: string; until: string };

/** since/until "YYYY-MM-DD" (calendário de Brasília) de cada um dos 4 períodos fixos — exportado pra lib/meta-ads/performance.ts reaproveitar em vez de recalcular a mesma coisa. */
export function buildPeriodDefs(now: Date = new Date()): AdSpendPeriodDef[] {
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

// Detalhamento por campanha/anúncio (gasto puro, sem cruzar com o CRM) foi
// substituído por getCampaignPerformance em lib/meta-ads/performance.ts, que
// já traz o mesmo gasto por anúncio cruzado com o funil (qualificação,
// reunião, venda) — ver PerformanceSection em relatorios/meta-ads-view.tsx.
