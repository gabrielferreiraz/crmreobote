"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { AdBreakdownCampaign } from "@/lib/meta-ads/insights";

/**
 * Gasto por campanha, com os anúncios de cada uma aninhados embaixo (ver
 * AdBreakdownCampaign.ads em lib/meta-ads/insights.ts) — tudo já veio
 * pronto do servidor numa chamada só (sem round-trip nenhum aqui), esse
 * componente só controla quais campanhas estão expandidas. Client de
 * propósito só por causa disso (useState); os dados em si continuam
 * buscados no Server Component pai (meta-ads-view.tsx).
 */
export function CampaignBreakdownTable({ campaigns }: { campaigns: AdBreakdownCampaign[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (campaigns.length === 0) {
    return <p className="p-4 text-sm text-neutral-400 dark:text-neutral-500">Nenhum gasto nesse período.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <th className="px-3 py-2.5 font-medium">Campanha</th>
          <th className="px-3 py-2.5 font-medium">Gasto</th>
          <th className="px-3 py-2.5 font-medium">Leads</th>
          <th className="px-3 py-2.5 font-medium">Custo/lead</th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map((campaign) => {
          const isOpen = expanded.has(campaign.id);
          return (
            <Fragment key={campaign.id}>
              <tr
                onClick={() => campaign.ads.length > 0 && toggle(campaign.id)}
                className={`border-b border-neutral-50 last:border-0 dark:border-neutral-900 ${
                  campaign.ads.length > 0 ? "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/60" : ""
                }`}
              >
                <td className="px-3 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="flex items-center gap-1.5">
                    {campaign.ads.length > 0 && (
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${
                          isOpen ? "rotate-90" : ""
                        }`}
                        strokeWidth={2}
                      />
                    )}
                    <span className="truncate">{campaign.name}</span>
                    {campaign.ads.length > 0 && (
                      <span className="shrink-0 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                        ({campaign.ads.length} anúncio{campaign.ads.length === 1 ? "" : "s"})
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-700 dark:text-neutral-300">{formatCurrency(campaign.spend)}</td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-700 dark:text-neutral-300">{campaign.leads}</td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-700 dark:text-neutral-300">
                  {campaign.costPerLead != null ? formatCurrency(campaign.costPerLead) : "—"}
                </td>
              </tr>
              {isOpen &&
                campaign.ads.map((ad) => (
                  <tr key={ad.id} className="border-b border-neutral-50 bg-neutral-50/50 last:border-0 dark:border-neutral-900 dark:bg-neutral-900/30">
                    <td className="px-3 py-2 pl-9 text-neutral-600 dark:text-neutral-400">
                      <span className="truncate">{ad.name}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500 dark:text-neutral-400">{formatCurrency(ad.spend)}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500 dark:text-neutral-400">{ad.leads}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500 dark:text-neutral-400">
                      {ad.costPerLead != null ? formatCurrency(ad.costPerLead) : "—"}
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
