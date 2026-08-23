"use client";

import { Fragment, useState } from "react";
import { ChevronRight, PenLine, TriangleAlert } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { CampaignPerformanceRow } from "@/lib/meta-ads/performance";

function Cost({ value }: { value: number | null }) {
  return <span className="tabular-nums">{value != null ? formatCurrency(value) : "—"}</span>;
}

/**
 * Desempenho por campanha (gasto cruzado com o que aconteceu com o lead no
 * CRM: qualificação, resposta, reunião, venda) — anúncios de cada campanha
 * aninhados embaixo dela (clique pra expandir). Tudo já vem pronto do
 * servidor (ver lib/meta-ads/performance.ts) numa chamada só; esse
 * componente só controla quais campanhas estão expandidas. Client de
 * propósito só por causa disso (useState).
 */
export function CampaignBreakdownTable({ rows }: { rows: CampaignPerformanceRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-neutral-400 dark:text-neutral-500">Nenhum lead de anúncio nesse período.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <th className="px-3 py-2.5 font-medium">Campanha</th>
          <th className="px-3 py-2.5 font-medium">Gasto</th>
          <th className="px-3 py-2.5 font-medium">Leads</th>
          <th className="px-3 py-2.5 font-medium">Custo/lead</th>
          <th className="px-3 py-2.5 font-medium">Qualificados</th>
          <th className="px-3 py-2.5 font-medium">Desqualificados</th>
          <th className="px-3 py-2.5 font-medium">Não responderam</th>
          <th className="px-3 py-2.5 font-medium">Reunião/Visita</th>
          <th className="px-3 py-2.5 font-medium">Custo/reunião</th>
          <th className="px-3 py-2.5 font-medium">No-show</th>
          <th className="px-3 py-2.5 font-medium">Vendas</th>
          <th className="px-3 py-2.5 font-medium">Valor ganho</th>
          <th className="px-3 py-2.5 font-medium">Ticket médio</th>
          <th className="px-3 py-2.5 font-medium">Custo/venda</th>
          <th className="px-3 py-2.5 font-medium">ROI</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isOpen = expanded.has(row.campaignId);
          const hasAds = row.ads.length > 0;
          // Gastou e não trouxe NENHUM lead — exatamente o tipo de "dinheiro
          // sem retorno" que essa tabela existe pra expor (ver comentário na
          // união de fontes em lib/meta-ads/performance.ts). Sem destaque
          // nenhum, um 0 solto no meio de uma tabela de 12 colunas passa
          // batido; com o fundo âmbar + aviso, é a primeira coisa que salta
          // aos olhos.
          const spentWithNoLeads = (row.spend ?? 0) > 0 && row.leads === 0;
          return (
            <Fragment key={row.campaignId}>
              <tr
                onClick={() => hasAds && toggle(row.campaignId)}
                className={`border-b border-neutral-50 last:border-0 dark:border-neutral-900 align-top ${
                  spentWithNoLeads ? "bg-amber-50/60 dark:bg-amber-500/[0.06]" : ""
                } ${hasAds ? "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/60" : ""}`}
              >
                <td className="px-3 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="flex items-center gap-1.5">
                    {hasAds && (
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${
                          isOpen ? "rotate-90" : ""
                        }`}
                        strokeWidth={2}
                      />
                    )}
                    <span className="truncate">{row.campaignName}</span>
                    {spentWithNoLeads && (
                      <span
                        title="Gastou nesse período e não gerou nenhum lead no CRM — vale conferir se o formulário/webhook está funcionando"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                      >
                        <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2} />
                        sem lead
                      </span>
                    )}
                    {row.isManual && (
                      <span
                        title="Atribuição manual — Origem marcada como anúncio, não veio pelo formulário nativo do Facebook/Instagram"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      >
                        <PenLine className="h-2.5 w-2.5" strokeWidth={2} />
                        manual
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300">
                  <Cost value={row.spend} />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-700 dark:text-neutral-300">{row.leads}</td>
                <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300">
                  <Cost value={row.costPerLead} />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-emerald-600 dark:text-emerald-400">{row.qualifiedLeads}</td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-500 dark:text-neutral-400">{row.unqualifiedLeads}</td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-500 dark:text-neutral-400">{row.noResponseLeads}</td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-700 dark:text-neutral-300">{row.meetingLeads}</td>
                <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300">
                  <Cost value={row.costPerMeeting} />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-500 dark:text-neutral-400">
                  {row.noShowLeads > 0 ? <span className="text-red-600 dark:text-red-400">{row.noShowLeads}</span> : 0}
                </td>
                <td className="px-3 py-2.5 tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{row.won}</td>
                <td className="px-3 py-2.5 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatCurrency(row.wonValue)}
                </td>
                <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300">
                  <Cost value={row.avgWonValue} />
                </td>
                <td className="px-3 py-2.5 text-neutral-700 dark:text-neutral-300">
                  <Cost value={row.costPerWon} />
                </td>
                <td className="px-3 py-2.5 font-medium">
                  {row.roi != null ? (
                    <span className={row.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      {row.roi >= 0 ? "+" : ""}
                      {(row.roi * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-neutral-400 dark:text-neutral-500">—</span>
                  )}
                </td>
              </tr>
              {isOpen &&
                row.ads.map((ad) => (
                  <tr key={ad.id} className="border-b border-neutral-50 bg-neutral-50/50 last:border-0 dark:border-neutral-900 dark:bg-neutral-900/30">
                    <td className="px-3 py-2 pl-9 text-neutral-600 dark:text-neutral-400">
                      <span className="truncate">{ad.name}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500 dark:text-neutral-400">{formatCurrency(ad.spend)}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500 dark:text-neutral-400">{ad.leads}</td>
                    {/* 15 colunas no total (ver <thead> acima), 3 já preenchidas (nome/gasto/leads) — o resto (12) vira essa célula só, o CRM não sabe reunião/venda por anúncio individual. */}
                    <td className="px-3 py-2 tabular-nums text-neutral-500 dark:text-neutral-400" colSpan={12}>
                      {ad.leads > 0 ? formatCurrency(ad.spend / ad.leads) + "/lead" : "—"}
                    </td>
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
