import Link from "next/link";
import { Megaphone, MessagesSquare, ThumbsDown, Users, CalendarCheck, CalendarX, Trophy, TrendingUp, Wallet } from "lucide-react";
import { runWithTenant } from "@/lib/tenant-context";
import { getAdSpendSummary, type AdSpendSummary } from "@/lib/meta-ads/insights";
import { getCampaignPerformance, type CampaignPerformance, type CampaignPerformanceRow } from "@/lib/meta-ads/performance";
import { CampaignBreakdownTable } from "./campaign-breakdown-table";
import { DateRangeFilter } from "./date-range-filter";
import { buildQuickRanges } from "@/lib/date-ranges";
import { formatCurrency } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { DonutChart } from "@/components/charts/donut-chart";

// Os dois tipos de resultado (resumo de gasto por período e o cruzamento
// gasto×funil por campanha) usam o mesmo formato de erro — mesma mensagem
// serve pros dois (ver AdSpendCards abaixo; o cruzamento tem seu próprio
// tratamento porque o motivo "no_data" não existe pro resumo de gasto).
const SPEND_ERROR_MESSAGE: Record<"not_connected" | "token_missing" | "no_ad_account" | "error", string> = {
  not_connected: "Conecte o Meta Ads em Configurações → Integrações pra ver o gasto aqui.",
  token_missing: "Essa conexão é de antes do resumo de gasto existir — reconecte em Configurações → Integrações.",
  no_ad_account: "Escolha uma conta de anúncio em Configurações → Integrações pra ver o gasto aqui.",
  error: "Não foi possível consultar o gasto no Facebook agora — tente de novo em alguns minutos.",
};

function rate(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
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

/**
 * Soma os totais de todas as campanhas do período pra virar os 6 cards do
 * topo — custo/lead, custo/reunião, custo/venda e ROI são recalculados a
 * partir dos TOTAIS agregados aqui, não a média das razões por campanha
 * (média de razão engana quando as campanhas têm tamanhos bem diferentes;
 * total sobre total não).
 */
function aggregatePerformance(rows: CampaignPerformanceRow[]) {
  const agg = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + (r.spend ?? 0),
      hasSpend: acc.hasSpend || r.spend != null,
      leads: acc.leads + r.leads,
      qualifiedLeads: acc.qualifiedLeads + r.qualifiedLeads,
      unqualifiedLeads: acc.unqualifiedLeads + r.unqualifiedLeads,
      noResponseLeads: acc.noResponseLeads + r.noResponseLeads,
      meetingLeads: acc.meetingLeads + r.meetingLeads,
      noShowLeads: acc.noShowLeads + r.noShowLeads,
      won: acc.won + r.won,
      wonValue: acc.wonValue + r.wonValue,
    }),
    {
      spend: 0,
      hasSpend: false,
      leads: 0,
      qualifiedLeads: 0,
      unqualifiedLeads: 0,
      noResponseLeads: 0,
      meetingLeads: 0,
      noShowLeads: 0,
      won: 0,
      wonValue: 0,
    },
  );
  const spend = agg.hasSpend ? agg.spend : null;
  return {
    ...agg,
    spend,
    costPerLead: spend != null && agg.leads > 0 ? spend / agg.leads : null,
    costPerMeeting: spend != null && agg.meetingLeads > 0 ? spend / agg.meetingLeads : null,
    costPerWon: spend != null && agg.won > 0 ? spend / agg.won : null,
    avgWonValue: agg.won > 0 ? agg.wonValue / agg.won : null,
    roi: spend != null && spend > 0 ? (agg.wonValue - spend) / spend : null,
  };
}

/**
 * Cards de resumo do período — hierarquia em duas camadas em vez dos 7 com o
 * mesmo peso visual de antes: 5 números que decidem se a campanha vale a
 * pena (Leads → Reunião/Visita → Vendas → Valor ganho, o funil de dinheiro em
 * si, + ROI) em destaque; 3 números de diagnóstico (por que um lead NÃO virou
 * venda) menores e discretos logo abaixo — pra bater o olho no que importa
 * primeiro. "Valor ganho" (com ticket médio) ganhou card próprio — antes só
 * aparecia pequeno, junto do ROI, e nenhum card mostrava ticket médio.
 */
function PerformanceSummaryCards({ agg }: { agg: ReturnType<typeof aggregatePerformance> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="card space-y-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Megaphone className="h-3.5 w-3.5" />
            Leads
          </div>
          <div className="text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{agg.leads}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {agg.costPerLead != null ? `${formatCurrency(agg.costPerLead)}/lead` : "sem dado de gasto"}
          </div>
        </div>
        <div className="card space-y-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <CalendarCheck className="h-3.5 w-3.5" />
            Reunião/Visita
          </div>
          <div className="text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{agg.meetingLeads}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {agg.costPerMeeting != null ? `${formatCurrency(agg.costPerMeeting)}/reunião` : "sem dado de gasto"}
          </div>
        </div>
        <div className="card space-y-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Trophy className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Vendas
          </div>
          <div className="text-3xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{agg.won}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {agg.costPerWon != null ? `${formatCurrency(agg.costPerWon)}/venda` : "sem dado de gasto"}
          </div>
        </div>
        {/* Destaque igual ao "Total ganho" da aba Comercial (mesma cor/peso
            visual) — é o número que fecha a pergunta "valeu o gasto?", não
            devia ficar escondido como legenda pequena do card de ROI. */}
        <div className="card space-y-1 border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-500/10">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Wallet className="h-3.5 w-3.5" />
            Valor ganho
          </div>
          <div className="text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(agg.wonValue)}</div>
          <div className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
            {agg.avgWonValue != null ? `Ticket médio ${formatCurrency(agg.avgWonValue)}` : "Sem venda no período"}
          </div>
        </div>
        <div className="card space-y-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <TrendingUp className="h-3.5 w-3.5" />
            ROI
          </div>
          {agg.roi != null ? (
            <div className={`text-3xl font-semibold tabular-nums ${agg.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {agg.roi >= 0 ? "+" : ""}
              {(agg.roi * 100).toFixed(0)}%
            </div>
          ) : (
            <div className="text-3xl font-semibold text-neutral-400 dark:text-neutral-500">—</div>
          )}
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {agg.spend != null ? `${formatCurrency(agg.spend)} gasto` : "sem dado de gasto"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <ThumbsDown className="h-3 w-3" />
            Desqualificados
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{agg.unqualifiedLeads}</div>
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{rate(agg.unqualifiedLeads, agg.leads).toFixed(0)}% dos leads</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <MessagesSquare className="h-3 w-3" />
            Não responderam
          </div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{agg.noResponseLeads}</div>
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500">tiveram conversa iniciada, ficaram em silêncio</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            <CalendarX className="h-3 w-3" />
            No-show
          </div>
          <div
            className={`mt-0.5 text-lg font-semibold tabular-nums ${agg.noShowLeads > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-700 dark:text-neutral-300"}`}
          >
            {agg.noShowLeads}
          </div>
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {rate(agg.noShowLeads, agg.meetingLeads + agg.noShowLeads).toFixed(0)}% dos encontros marcados
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Duas leituras complementares dos mesmos leads: progressão (funil — quantos
 * avançam etapa a etapa, onde a maior parte "vaza") e composição (rosca —
 * dos leads já classificados, quantos são bons ou ruins). Uma NÃO re-soma a
 * outra de propósito: qualificação e reunião/resposta são classificações
 * independentes no CRM (ver notas no rodapé da página), então tratar tudo
 * como uma única jornada linear fingiria uma relação que os números não têm.
 */
function LeadFunnelOverview({ agg }: { agg: ReturnType<typeof aggregatePerformance> }) {
  const notClassified = Math.max(0, agg.leads - agg.qualifiedLeads - agg.unqualifiedLeads);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Funil de conversão</p>
        <FunnelChart
          stages={[
            { id: "leads", label: "Leads", count: agg.leads, unit: "leads", color: "#a1a1aa" },
            { id: "qualified", label: "Qualificados", count: agg.qualifiedLeads, unit: "leads", color: "#818cf8" },
            { id: "meeting", label: "Reunião/Visita", count: agg.meetingLeads, unit: "leads", color: "#6366f1" },
            { id: "won", label: "Vendas", count: agg.won, value: agg.wonValue, unit: "vendas", color: "#10b981" },
          ]}
        />
      </div>
      <div className="card space-y-3 p-4">
        <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Classificação dos leads</p>
        {agg.leads > 0 ? (
          <DonutChart
            centerValue={String(agg.leads)}
            centerLabel={agg.leads === 1 ? "lead" : "leads"}
            slices={[
              { label: "Qualificados", value: agg.qualifiedLeads, color: "#10b981" },
              { label: "Desqualificados", value: agg.unqualifiedLeads, color: "#ef4444" },
              { label: "Não classificados ainda", value: notClassified, color: "#d4d4d8" },
            ]}
          />
        ) : (
          <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Sem leads nesse período.</p>
        )}
      </div>
    </div>
  );
}

/** Tabela de desempenho por campanha (gasto × funil, anúncios aninhados) do
 * período escolhido — mesmo filtro de período (?from=&to=) do resto de
 * Relatórios (ver date-range-filter.tsx): atalhos de mês + calendário
 * personalizado, em vez dos 4 botões fixos (Hoje/Últimos 7 dias/Este mês/
 * Este ano) de antes. DateRangeFilter é client e lê a URL sozinho — não
 * precisa de prop nenhuma vinda daqui. */
function PerformanceSection({ performance }: { performance: CampaignPerformance }) {
  // Calculado uma vez só aqui (quando há dados) — LeadFunnelOverview e
  // PerformanceSummaryCards leem os mesmos totais em vez de cada um agregar
  // performance.rows de novo por conta própria.
  const agg = performance.ok ? aggregatePerformance(performance.rows) : null;

  return (
    <div className="space-y-2">
      {/* Mesmo ajuste de app/(dashboard)/relatorios/page.tsx (ver comentário
          lá) — flex-col + sm:flex-row/flex-nowrap em vez de flex-wrap+
          justify-between, que salta o bloco de filtros pro lado esquerdo se
          algum dia crescer demais pra caber ao lado do rótulo. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between">
        <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <Users className="h-3.5 w-3.5" strokeWidth={2} />
          Desempenho por campanha e anúncio
        </div>
        <DateRangeFilter />
      </div>

      {!performance.ok || !agg ? (
        <div className="card">
          <EmptyState
            icon={Megaphone}
            title="Nenhum lead de anúncio nesse período"
            description="Assim que um formulário nativo do Facebook/Instagram gerar um lead (ou um contato antigo for marcado com uma Origem de anúncio), ele aparece aqui agrupado por campanha."
          />
        </div>
      ) : (
        <>
          <LeadFunnelOverview agg={agg} />
          <PerformanceSummaryCards agg={agg} />
          {performance.spendFetchError ? (
            // Diferente de "nunca conectado" abaixo — a conexão existe, só a
            // chamada à Insights API falhou dessa vez (rate limit, token
            // expirado, instabilidade da Meta). Sem isso, o usuário via as
            // mesmas colunas de custo vazias de uma campanha manual e não
            // tinha como saber que era uma falha temporária, não o esperado.
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <Wallet className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {SPEND_ERROR_MESSAGE.error} ({performance.spendFetchError})
            </p>
          ) : (
            !performance.spendConnected && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Sem conexão de gasto ativa — as colunas de custo/ROI ficam vazias até você conectar (ou reconectar) o Meta Ads em{" "}
                <Link href="/configuracoes/integracoes" className="underline hover:text-neutral-700 dark:hover:text-neutral-300">
                  Configurações → Integrações
                </Link>
                .
              </p>
            )
          )}
          <div className="card overflow-x-auto p-0">
            <CampaignBreakdownTable rows={performance.rows} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Aba "Facebook" de Relatórios — gasto cruzado com o funil de leads
 * (qualificação, resposta no WhatsApp, reunião/visita, venda), por
 * campanha e por anúncio, pro período escolhido (mesma ideia de
 * AdminReportsView: Server Component auto-contido, busca os próprios dados,
 * chamado direto de relatorios/page.tsx sem passar props). Antes vivia
 * sozinho em /relatorios/meta-ads sem nenhum link pra ele em lugar nenhum do
 * app — ver relatorios/page.tsx pro gate de acesso (só Dono).
 */
export async function MetaAdsReportView({
  organizationId,
  from,
  to,
  range,
}: {
  organizationId: string;
  /** "YYYY-MM-DD" (calendário de Brasília), vindo de ?from=&to= — mesmo
   * parâmetro de URL que o resto de Relatórios usa (ver date-range-filter.tsx).
   * Só usa o range da URL quando os DOIS vierem preenchidos (é como
   * DateRangeFilter sempre define os dois juntos, nunca um sozinho); faltando
   * qualquer um dos dois (e sem `range==="all"`, ver abaixo), cai em "este mês"
   * — mesmo padrão-de-quem-nunca-escolheu-nada que a aba Comercial já usa
   * (ver lib/reports/commercial-data.ts). */
  from?: string;
  to?: string;
  /** "all" = Tudo escolhido explicitamente no filtro — precisa desse marcador
   * PRÓPRIO porque from/to ausentes sozinhos são ambíguos demais ("escolheu
   * Tudo" vs "nunca escolheu nada"); essa ambiguidade era exatamente o bug
   * de "Tudo" virar silenciosamente "Este mês" nesta aba (mesmo raciocínio
   * de lib/reports/commercial-data.ts's `isAllTime`). */
  range?: string;
}) {
  const isAllTime = range === "all";
  const thisMonth = buildQuickRanges().find((q) => q.key === "this-month")!.range();
  const period = isAllTime ? null : { since: from && to ? from : thisMonth.from, until: from && to ? to : thisMonth.to };

  return runWithTenant(organizationId, async () => {
    const [adSpendSummary, performance] = await Promise.all([
      getAdSpendSummary(organizationId),
      getCampaignPerformance(organizationId, period),
    ]);

    return (
      <div className="space-y-6 lg:space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
              Funil de Leads do Facebook Ads
            </h1>
            <p className="mt-1 max-w-lg text-sm text-neutral-500 dark:text-neutral-400">
              Leads recebidos via formulário nativo do Facebook/Instagram — mais os marcados manualmente como
              anúncio pela Origem (ver Configurações → Origens) — cruzados com gasto, qualificação, resposta no
              WhatsApp, reunião/visita e venda.
            </p>
          </div>
        </div>

        <AdSpendCards summary={adSpendSummary} />

        <PerformanceSection performance={performance} />

        <div className="card p-4 text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">Período:</strong> conta pela data em que o LEAD chegou, não pela data em que fechou — um lead que chegou este mês e só vira venda mês que vem continua contando neste mês (é quando o gasto que trouxe ele foi feito).</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">Não responderam:</strong> teve conversa de WhatsApp iniciada mas nunca respondeu nada — não inclui quem nunca chegou a ser contatado.</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">Reunião/Visita:</strong> ao menos um encontro marcado como "Realizada" (resultado perguntado ao concluir a tarefa de Reunião/Visita, não mais ao criar) — histórico sem resposta registrada (anterior a essa opção existir) também conta aqui, nunca como no-show; já um encontro cuja tarefa ainda não foi concluída fica de fora dos dois até ter resposta.</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">No-show:</strong> ao menos um encontro marcado como "Não compareceu". Não é o oposto de Reunião/Visita — um lead pode ter levado um no-show numa data e comparecido na remarcação, contando nos dois.</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">Qualificado/Desqualificado:</strong> classificação manual na página do negócio. Só "Qualificado" dispara um evento &quot;Lead&quot; pra Conversions API da Meta — "Desqualificado" fica só neste relatório.</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">Ticket médio:</strong> valor ganho ÷ vendas, da própria campanha (ou do período todo, no card de resumo) — não é o ticket médio geral da organização.</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">ROI:</strong> (valor ganho − gasto) ÷ gasto, no período. Sem dado de gasto (campanha manual, ou Meta Ads não conectado), fica sem número em vez de mostrar 0%.</div>
          <div>• <strong className="text-neutral-700 dark:text-neutral-300">manual:</strong> campanha sem lead real do Facebook/Instagram — é um agrupamento pela Origem do contato marcada como anúncio, sem gasto associado (a Meta não sabe que ela existe).</div>
        </div>
      </div>
    );
  });
}
