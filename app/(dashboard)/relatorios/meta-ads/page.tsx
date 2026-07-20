import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { getMetaAdsAttribution } from "@/lib/meta-ads/attribution";
import { formatCurrency } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";

export default async function MetaAdsAttributionPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/relatorios");
  }
  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const rows = await getMetaAdsAttribution(organizationId);

    return (
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Conversão por campanha (Meta Ads)
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Leads recebidos via formulário nativo do Facebook/Instagram, agrupados por campanha, com o que virou
            negócio ganho, perdido ou ainda em andamento.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={Megaphone}
              title="Nenhum lead de anúncio ainda"
              description="Assim que um formulário nativo do Facebook/Instagram gerar um lead, ele aparece aqui agrupado por campanha. Confira em Configurações → Integrações se o Meta Ads já está conectado."
            />
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th className="px-4 py-2.5 font-medium">Campanha</th>
                  <th className="px-4 py-2.5 font-medium">Leads</th>
                  <th className="px-4 py-2.5 font-medium">Ganhos</th>
                  <th className="px-4 py-2.5 font-medium">Perdidos</th>
                  <th className="px-4 py-2.5 font-medium">Em andamento</th>
                  <th className="px-4 py-2.5 font-medium">Taxa de conversão</th>
                  <th className="px-4 py-2.5 font-medium">Valor ganho</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const conversionRate = row.leads > 0 ? (row.won / row.leads) * 100 : 0;
                  return (
                    <tr key={row.campaignId} className="border-b border-neutral-50 last:border-0 dark:border-neutral-900">
                      <td className="px-4 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{row.campaignName}</td>
                      <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{row.leads}</td>
                      <td className="px-4 py-2.5 text-emerald-600 dark:text-emerald-400">{row.won}</td>
                      <td className="px-4 py-2.5 text-red-600 dark:text-red-400">{row.lost}</td>
                      <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{row.open}</td>
                      <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{conversionRate.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{formatCurrency(row.wonValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  });
}
