import Link from "next/link";
import { Megaphone, MessageCircle, MessageSquare, PenLine, ThumbsDown, ThumbsUp, Trophy, Wallet } from "lucide-react";
import { runWithTenant } from "@/lib/tenant-context";
import { getMetaAdsAttribution, type CampaignAttributionRow } from "@/lib/meta-ads/attribution";
import {
  getAdSpendSummary,
  getAdCampaignBreakdown,
  AD_SPEND_PERIODS,
  type AdSpendSummary,
  type AdCampaignBreakdown,
  type AdSpendPeriodKey,
} from "@/lib/meta-ads/insights";
import { CampaignBreakdownTable } from "./campaign-breakdown-table";
import { formatCurrency } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";

// Os dois tipos de resultado (resumo por período e detalhamento por
// campanha/anúncio) usam o mesmo formato de erro — mesma mensagem serve
// pros dois (ver AdSpendCards e AdBreakdownSection abaixo).
const SPEND_ERROR_MESSAGE: Record<"not_connected" | "token_missing" | "no_ad_account" | "error", string> = {
  not_connected: "Conecte o Meta Ads em Configurações → Integrações pra ver o gasto aqui.",
  token_missing: "Essa conexão é de antes do resumo de gasto existir — reconecte em Configurações → Integrações.",
  no_ad_account: "Escolha uma conta de anúncio em Configurações → Integrações pra ver o gasto aqui.",
  error: "Não foi possível consultar o gasto no Facebook agora — tente de novo em alguns minutos.",
};

const DEFAULT_BREAKDOWN_PERIOD: AdSpendPeriodKey = "month";

function isValidPeriodKey(value: string | undefined): value is AdSpendPeriodKey {
  return AD_SPEND_PERIODS.some((p) => p.key === value);
}

/** Detalhamento por campanha (com anúncios aninhados) do período escolhido — período trocado via link (?breakdownPeriod=...), sem JS nenhum pra isso, só a tabela em si (expandir/colapsar campanha) é client. */
function AdBreakdownSection({ breakdown, activePeriod }: { breakdown: AdCampaignBreakdown; activePeriod: AdSpendPeriodKey }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <Megaphone className="h-3.5 w-3.5" strokeWidth={2} />
          Detalhamento por campanha e anúncio
        </div>
        <div className="flex gap-1">
          {AD_SPEND_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/relatorios?view=facebook&breakdownPeriod=${p.key}`}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-smooth ${
                p.key === activePeriod
                  ? "bg-brand text-white"
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {!breakdown.ok ? (
        <div className="card flex items-center gap-2 p-4 text-sm text-neutral-500 dark:text-neutral-400">
          <Megaphone className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            {SPEND_ERROR_MESSAGE[breakdown.reason]}
            {breakdown.reason === "error" && breakdown.message ? ` (${breakdown.message})` : ""}
          </span>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <CampaignBreakdownTable campaigns={breakdown.campaigns} />
        </div>
      )}
    </div>
  );
}

/** Cards de gasto/leads/CPL por período (ver lib/meta-ads/insights.ts) — falha soft: se a Insights API não responder, mostra um aviso em vez de derrubar o resto do relatório. */
function AdSpendCards({ summary }: { summary: AdSpendSummary }) {
  if (!summary.ok) {
    return (
      <div className="card flex items-center gap-2 p-4 text-sm text-neutral-500 dark:text-neutral-400">
        <Wallet className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span>
          {SPEND_ERROR_MESSAGE[summary.reason]}
          {summary.reason === "error" && summary.message ? ` (${summary.message})` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
          Gasto — {summary.adAccountName}
        </div>
        <Link
          href="/configuracoes/integracoes"
          className="text-xs text-neutral-400 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:text-neutral-500 dark:decoration-neutral-700 dark:hover:text-neutral-300"
        >
          Trocar conta →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summary.periods.map((p) => (
          <div key={p.key} className="card space-y-1 p-4">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{p.label}</div>
            <div className="text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrency(p.spend)}</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {p.leads} lead{p.leads === 1 ? "" : "s"}
              {p.costPerLead != null && <span className="tabular-nums"> · {formatCurrency(p.costPerLead)}/lead</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function rate(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function funnelSummary(rows: CampaignAttributionRow[]) {
  const agg = rows.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leads,
      withWhatsappThread: acc.withWhatsappThread + r.withWhatsappThread,
      whatsappRespondedLeads: acc.whatsappRespondedLeads + r.whatsappRespondedLeads,
      qualifiedLeads: acc.qualifiedLeads + r.qualifiedLeads,
      won: acc.won + r.won,
      wonValue: acc.wonValue + r.wonValue,
    }),
    { leads: 0, withWhatsappThread: 0, whatsappRespondedLeads: 0, qualifiedLeads: 0, won: 0, wonValue: 0 },
  );
  return agg;
}

/**
 * Aba "Facebook" de Relatórios — leads recebidos via formulário nativo do
 * Facebook/Instagram, agrupados por campanha (mesma ideia de
 * AdminReportsView: Server Component auto-contido, busca os próprios dados,
 * chamado direto de relatorios/page.tsx sem passar props). Antes vivia
 * sozinho em /relatorios/meta-ads sem nenhum link pra ele em lugar nenhum do
 * app — ver relatorios/page.tsx pro gate de acesso (só Dono).
 */
export async function MetaAdsReportView({
  organizationId,
  breakdownPeriod,
}: {
  organizationId: string;
  breakdownPeriod?: string;
}) {
  const activePeriod = isValidPeriodKey(breakdownPeriod) ? breakdownPeriod : DEFAULT_BREAKDOWN_PERIOD;

  return runWithTenant(organizationId, async () => {
    const [rows, adSpendSummary, adBreakdown] = await Promise.all([
      getMetaAdsAttribution(organizationId),
      getAdSpendSummary(organizationId),
      getAdCampaignBreakdown(organizationId, activePeriod),
    ]);
    const summary = funnelSummary(rows);

    return (
      <div className="space-y-6 lg:space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
              Funil de Leads do Facebook Ads
            </h1>
            <p className="mt-1 max-w-lg text-sm text-neutral-500 dark:text-neutral-400">
              Leads recebidos via formulário nativo do Facebook/Instagram, agrupados por campanha — mais os
              marcados manualmente como anúncio pela Origem (ver Configurações → Origens). Acompanhe a jornada
              completa: formulário → WhatsApp → resposta → qualificação → venda.
            </p>
          </div>
        </div>

        <AdSpendCards summary={adSpendSummary} />

        <AdBreakdownSection breakdown={adBreakdown} activePeriod={activePeriod} />

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Megaphone}
              title="Nenhum lead de anúncio ainda"
              description="Assim que um formulário nativo do Facebook/Instagram gerar um lead, ele aparece aqui agrupado por campanha. Confira em Configurações → Integrações se o Meta Ads já está conectado."
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="card space-y-1 p-4">
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <Megaphone className="h-3.5 w-3.5" />
                  Leads recebidos
                </div>
                <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{summary.leads}</div>
              </div>
              <div className="card space-y-1 p-4">
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Conversa aberta no WhatsApp
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{summary.withWhatsappThread}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{rate(summary.withWhatsappThread, summary.leads).toFixed(1)}%</div>
                </div>
              </div>
              <div className="card space-y-1 p-4">
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Leads que responderam
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{summary.whatsappRespondedLeads}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{rate(summary.whatsappRespondedLeads, summary.withWhatsappThread).toFixed(1)}%</div>
                </div>
              </div>
              <div className="card space-y-1 p-4">
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <ThumbsUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Leads qualificados
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{summary.qualifiedLeads}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{rate(summary.qualifiedLeads, summary.leads).toFixed(1)}%</div>
                </div>
              </div>
              <div className="card space-y-1 p-4">
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <Trophy className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Negócios ganhos
                </div>
                <div className="flex flex-col">
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{summary.won}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{rate(summary.won, summary.leads).toFixed(1)}%</div>
                  </div>
                  <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{formatCurrency(summary.wonValue)}</div>
                </div>
              </div>
            </div>

            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    <th className="px-3 py-2.5 font-medium">Campanha</th>
                    <th className="px-3 py-2.5 font-medium">Leads</th>
                    <th className="px-3 py-2.5 font-medium">WhatsApp</th>
                    <th className="px-3 py-2.5 font-medium">Respondidos</th>
                    <th className="px-3 py-2.5 font-medium">Mensagens ↔</th>
                    <th className="px-3 py-2.5 font-medium">Qualificado</th>
                    <th className="px-3 py-2.5 font-medium">Desqualificado</th>
                    <th className="px-3 py-2.5 font-medium">Ganhos</th>
                    <th className="px-3 py-2.5 font-medium">Perdidos</th>
                    <th className="px-3 py-2.5 font-medium">Andamento</th>
                    <th className="px-3 py-2.5 font-medium">% venda</th>
                    <th className="px-3 py-2.5 font-medium">Valor ganho</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const conversionRate = rate(row.won, row.leads);
                    const responseRate = rate(row.whatsappRespondedLeads, row.withWhatsappThread);
                    const qualifyRate = rate(row.qualifiedLeads, row.leads);
                    return (
                      <tr key={row.campaignId} className="border-b border-neutral-50 last:border-0 dark:border-neutral-900 align-top">
                        <td className="px-3 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">
                          {row.campaignName}
                          {row.isManual && (
                            <span
                              title="Atribuição manual — Origem marcada como anúncio, não veio pelo formulário nativo do Facebook/Instagram"
                              className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                            >
                              <PenLine className="h-2.5 w-2.5" strokeWidth={2} />
                              manual
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300">{row.leads}</td>
                        <td className="px-3 py-2.5 text-neutral-600 dark:text-neutral-400">
                          <span className="font-medium text-neutral-800 dark:text-neutral-200">{row.withWhatsappThread}</span>
                          <span className="block text-[11px] text-neutral-500 dark:text-neutral-500">{rate(row.withWhatsappThread, row.leads).toFixed(1)}% dos leads</span>
                        </td>
                        <td className="px-3 py-2.5 text-neutral-600 dark:text-neutral-400">
                          <span className="font-medium text-neutral-800 dark:text-neutral-200">{row.whatsappRespondedLeads}</span>
                          <span className="block text-[11px] text-neutral-500 dark:text-neutral-500">{responseRate.toFixed(1)}% dos contatos</span>
                        </td>
                        <td className="px-3 py-2.5 text-neutral-600 dark:text-neutral-400 tabular-nums">
                          <span className="text-emerald-600 dark:text-emerald-400">↓ {row.whatsappMessagesInbound}</span>
                          <span className="mx-1 text-neutral-300 dark:text-neutral-700">/</span>
                          <span className="text-blue-600 dark:text-blue-400">↑ {row.whatsappMessagesOutbound}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
                            <ThumbsUp className="h-3 w-3" />
                            {row.qualifiedLeads}
                          </span>
                          <span className="block text-[11px] text-neutral-500 dark:text-neutral-500 mt-0.5">{qualifyRate.toFixed(1)}% dos leads</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-[12px] font-medium text-neutral-700 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700">
                            <ThumbsDown className="h-3 w-3" />
                            {row.unqualifiedLeads}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-emerald-600 dark:text-emerald-400 font-medium">{row.won}</td>
                        <td className="px-3 py-2.5 text-red-600 dark:text-red-400">{row.lost}</td>
                        <td className="px-3 py-2.5 text-neutral-500 dark:text-neutral-400">{row.open}</td>
                        <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300 font-medium">{conversionRate.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300 font-medium">{formatCurrency(row.wonValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="card p-4 text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
              <div>• <strong className="text-neutral-700 dark:text-neutral-300">WhatsApp:</strong> quantos leads possuem ao menos uma conversa aberta no WhatsApp (thread vinculada).</div>
              <div>• <strong className="text-neutral-700 dark:text-neutral-300">Respondidos:</strong> quantos leads únicos receberam ao menos uma mensagem de retorno INBOUND no WhatsApp.</div>
              <div>• <strong className="text-neutral-700 dark:text-neutral-300">Mensagens ↔:</strong> total de mensagens recebidas (↓) e enviadas (↑) para todos os leads da campanha.</div>
              <div>• <strong className="text-neutral-700 dark:text-neutral-300">Qualificado/Desqualificado:</strong> classificação manual aplicada na página do negócio. Só "Qualificado" dispara um evento &quot;Lead&quot; para a Conversions API da Meta (se a conexão Meta Ads estiver ativa) — "Desqualificado" fica só neste relatório, nunca é enviado pra Meta.</div>
              <div>• <strong className="text-neutral-700 dark:text-neutral-300">manual:</strong> campanha não veio de um lead real do Facebook/Instagram — é um agrupamento pela Origem do contato, marcada como anúncio em Configurações → Origens (útil pra lead antigo ou que chegou por outro caminho).</div>
            </div>
          </>
        )}
      </div>
    );
  });
}
