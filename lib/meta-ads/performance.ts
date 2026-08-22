/**
 * Junta as duas metades que faltavam se conversar: quanto foi GASTO por
 * campanha (Insights API, mesma chamada level:"ad" que
 * lib/meta-ads/insights.ts usa) com o que aconteceu com os LEADS daquela
 * campanha no CRM (getMetaAdsAttribution) — pro mesmo período. Sozinhas,
 * nenhuma das duas responde "quanto custou uma reunião" ou "quanto custou
 * uma venda"; juntas, respondem.
 */

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security/secret-crypto";
import { fetchInsightsBreakdown } from "@/lib/meta-ads";
import { MetaApiError } from "@/lib/meta-graph";
import { getMetaAdsAttribution } from "@/lib/meta-ads/attribution";
import { brazilDateStringToUTC, brazilEndOfDayUTC, brazilDateKey } from "@/lib/timezone";

export type CampaignPerformanceRow = {
  campaignId: string;
  campaignName: string;
  isManual: boolean;
  /** null = Meta não reportou gasto pra essa campanha nesse período (normal pra campanha "manual" — não existe do lado da Meta — ou sem conexão/Ad Account configurada). */
  spend: number | null;
  leads: number;
  costPerLead: number | null;
  qualifiedLeads: number;
  unqualifiedLeads: number;
  noResponseLeads: number;
  meetingLeads: number;
  costPerMeeting: number | null;
  /** Não é mutuamente exclusivo com meetingLeads — ver comentário em CampaignAttributionRow.noShowLeads. */
  noShowLeads: number;
  won: number;
  lost: number;
  wonValue: number;
  costPerWon: number | null;
  /** (valor ganho − gasto) / gasto, como fração — multiplicar por 100 pra virar %. null sem gasto conhecido. */
  roi: number | null;
  /** Só gasto/leads por anúncio (lado Meta) — o CRM não tem reunião/venda quebrado por anúncio individual, só por campanha. */
  ads: { id: string; name: string; spend: number; leads: number }[];
};

export type CampaignPerformance =
  | {
      ok: true;
      periodLabel: string;
      rows: CampaignPerformanceRow[];
      spendConnected: boolean;
      /** Conexão ativa, mas a chamada à Insights API falhou desta vez — diferente de `spendConnected: false` (nunca conectado) ou de uma campanha manual (nunca teve gasto pra começo de conversa). null = não teve erro, ou nem tentou (spendConnected false). */
      spendFetchError: string | null;
    }
  | { ok: false; reason: "no_data"; message?: string };

/** Nenhuma conta de anúncio real é mais antiga que isso — usado como início
 * de uma janela bem larga pra Insights API da Meta quando `period` é null
 * (Tudo), já que essa API externa exige um intervalo de datas real, não tem
 * conceito de "desde sempre" (diferente do lado CRM, ver `range` abaixo). */
const SPEND_ALL_TIME_SINCE = "2010-01-01";

/** `since`/`until` em "YYYY-MM-DD" (calendário de Brasília) — mesmo formato
 * que o resto de Relatórios usa pro filtro de período (ver date-range-filter.tsx/
 * lib/date-ranges.ts), não mais um dos 4 períodos fixos de antes. Quem chama
 * (meta-ads-view.tsx) decide o range: um dos atalhos (este mês/mês passado/
 * há 2-3 meses/este ano), um personalizado escolhido no calendário, ou
 * `null` pra "Tudo" (histórico inteiro, sem filtro de data nenhum do lado
 * CRM — ver getMetaAdsAttribution). */
export async function getCampaignPerformance(
  organizationId: string,
  period: { since: string; until: string } | null,
): Promise<CampaignPerformance> {
  const range = period ? { since: brazilDateStringToUTC(period.since), until: brazilEndOfDayUTC(period.until) } : undefined;
  // Proxy de "Tudo" pro lado do GASTO (chamada externa, precisa de um
  // intervalo real de verdade — ver SPEND_ALL_TIME_SINCE acima).
  const spendPeriod = period ?? { since: SPEND_ALL_TIME_SINCE, until: brazilDateKey(new Date()) };

  const [attributionRows, connection] = await Promise.all([
    getMetaAdsAttribution(organizationId, range),
    prisma.metaAdsConnection.findUnique({ where: { organizationId } }),
  ]);

  // Gasto é opcional pro resto da tabela funcionar — sem conexão/token/Ad
  // Account configurados, ainda mostra tudo que o CRM já sabe por conta
  // própria (leads, reunião, venda), só sem coluna de custo/ROI preenchida
  // (spend fica null em toda linha, ver spendConnected abaixo pra UI saber
  // se deve pedir pra conectar/reconectar em vez de simplesmente "sem
  // gasto nesse período").
  const spendByCampaignId = new Map<string, number>();
  const campaignNameFromMeta = new Map<string, string>();
  const adsByCampaignId = new Map<string, { id: string; name: string; spend: number; leads: number }[]>();
  let spendConnected = false;
  // Diferente de spendConnected=false (nunca conectado): aqui a conexão
  // existe, só a CHAMADA falhou dessa vez — a UI precisa saber pra não
  // mostrar "sem gasto" como se fosse normal quando na verdade é uma falha
  // temporária da Insights API (ver SPEND_ERROR_MESSAGE.error em
  // meta-ads-view.tsx, mesma mensagem que AdSpendCards já usa pro card de
  // resumo — essa tabela não reaproveitava esse sinal antes).
  let spendFetchError: string | null = null;

  if (connection?.userAccessTokenEncrypted && connection.adAccountId) {
    spendConnected = true;
    try {
      const accessToken = decryptSecret(connection.userAccessTokenEncrypted);
      const adRows = await fetchInsightsBreakdown(connection.adAccountId, accessToken, "ad", {
        since: spendPeriod.since,
        until: spendPeriod.until,
      });
      for (const row of adRows) {
        const campaignId = row.campaignId ?? "sem-campanha";
        spendByCampaignId.set(campaignId, (spendByCampaignId.get(campaignId) ?? 0) + row.spend);
        if (row.campaignName) campaignNameFromMeta.set(campaignId, row.campaignName);
        const ads = adsByCampaignId.get(campaignId) ?? [];
        ads.push({ id: row.id, name: row.name, spend: row.spend, leads: row.leads });
        adsByCampaignId.set(campaignId, ads);
      }
    } catch (err) {
      spendFetchError = err instanceof MetaApiError ? err.message : "Falha ao consultar a Insights API da Meta";
      console.error(`[meta-ads] falha ao buscar gasto por campanha pra performance (Ad Account ${connection.adAccountId})`, err);
      // Não derruba a linha inteira — segue sem gasto (spendByCampaignId
      // fica vazio), mesma degradação suave do resto da integração (ver
      // AdSpendCards). spendConnected continua true (a conexão em si está
      // OK, só essa chamada falhou) — não é o mesmo caso de "não conectado".
    }
  }

  if (attributionRows.length === 0 && spendByCampaignId.size === 0) return { ok: false, reason: "no_data" };

  // UNIÃO das duas fontes, não só quem tem lead no CRM — sem isso, uma
  // campanha que gastou dinheiro e não gerou NENHUM lead (webhook falhou,
  // formulário com problema, ou é campanha de outro objetivo tipo
  // Tráfego/Reconhecimento sem formulário de lead nenhum) simplesmente
  // desaparecia da tabela — exatamente o tipo de "gasto sem retorno" que
  // esse relatório existe pra mostrar, não pra esconder. É também o que
  // garante que a soma do "Gasto" desta tabela bate com o card de gasto
  // total do período (ver AdSpendCards) — sem a união, a tabela sempre
  // somaria MENOS que o total.
  const attributionById = new Map(attributionRows.map((r) => [r.campaignId, r]));
  const allCampaignIds = new Set([...attributionById.keys(), ...spendByCampaignId.keys()]);

  const rows: CampaignPerformanceRow[] = Array.from(allCampaignIds)
    .map((campaignId) => {
      const attr = attributionById.get(campaignId);
      const spend = spendByCampaignId.get(campaignId) ?? null;
      const leads = attr?.leads ?? 0;
      const meetingLeads = attr?.meetingLeads ?? 0;
      const won = attr?.won ?? 0;
      const wonValue = attr?.wonValue ?? 0;
      return {
        campaignId,
        campaignName: attr?.campaignName ?? campaignNameFromMeta.get(campaignId) ?? campaignId,
        isManual: attr?.isManual ?? false,
        spend,
        leads,
        costPerLead: spend != null && leads > 0 ? spend / leads : null,
        qualifiedLeads: attr?.qualifiedLeads ?? 0,
        unqualifiedLeads: attr?.unqualifiedLeads ?? 0,
        noResponseLeads: attr?.noResponseLeads ?? 0,
        meetingLeads,
        costPerMeeting: spend != null && meetingLeads > 0 ? spend / meetingLeads : null,
        noShowLeads: attr?.noShowLeads ?? 0,
        won,
        lost: attr?.lost ?? 0,
        wonValue,
        costPerWon: spend != null && won > 0 ? spend / won : null,
        roi: spend != null && spend > 0 ? (wonValue - spend) / spend : null,
        ads: (adsByCampaignId.get(campaignId) ?? []).sort((a, b) => b.spend - a.spend),
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.leads - a.leads);

  return {
    ok: true,
    periodLabel: period ? `${period.since} – ${period.until}` : "Tudo",
    rows,
    spendConnected,
    spendFetchError,
  };
}
