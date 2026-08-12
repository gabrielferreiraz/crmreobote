"use client";

import { useEffect, useState } from "react";
import { fetchTvMetrics } from "./actions";
import { formatCurrencyCompact } from "@/lib/format";

type Metrics = Awaited<ReturnType<typeof fetchTvMetrics>>;

export function TvView({
  initialMetrics,
}: {
  initialMetrics: Metrics;
}) {
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [currentAdIndex, setCurrentAdIndex] = useState(0);

  // Auto-refresh metrics every 30 seconds — fetchTvMetrics não recebe mais
  // organizationId daqui (ver app/tv/actions.ts): a action descobre sozinha
  // a organização pela sessão de quem está logado nesta TV, não confia mais
  // num id vindo do cliente.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const updated = await fetchTvMetrics();
        setMetrics(updated);
      } catch (err) {
        console.error("Failed to fetch TV metrics", err);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Carousel timer
  useEffect(() => {
    if (!metrics.adsUrls || metrics.adsUrls.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentAdIndex((prev) => (prev + 1) % metrics.adsUrls.length);
    }, 10000); // 10 seconds per ad
    return () => clearInterval(interval);
  }, [metrics.adsUrls]);

  // Handle case where ads array changed and index is out of bounds
  const safeAdIndex = Math.min(currentAdIndex, Math.max(0, (metrics.adsUrls?.length || 1) - 1));

  return (
    <div className="flex h-full w-full bg-[#1F2023] p-4 text-white">
      {/* Left Side - Carousel */}
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-neutral-800 shadow-xl">
        {metrics.adsUrls && metrics.adsUrls.length > 0 ? (
          <img
            src={metrics.adsUrls[safeAdIndex]}
            alt="Ad"
            className="h-full w-full object-cover transition-opacity duration-1000"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-neutral-500">
            Nenhuma propaganda configurada.
          </div>
        )}
      </div>

      {/* Right Side - Metrics */}
      <div className="flex w-[400px] shrink-0 flex-col px-6 xl:w-[500px]">
        {/* Sales Header */}
        {metrics.visibleWidgets.includes("sales_summary") && (
          <>
            <div className="mt-8 flex justify-between text-center text-sm">
              <div>
                <div className="font-semibold text-neutral-300">Vendas Anuais</div>
                <div className="mt-1 text-lg font-bold">{formatCurrencyCompact(metrics.vendasAnuais)}</div>
              </div>
              <div>
                <div className="font-semibold text-neutral-300">Vendas Cotas</div>
                <div className="mt-1 text-lg font-bold">{formatCurrencyCompact(metrics.vendasCotas)}</div>
              </div>
            </div>
            <div className="mt-6 text-center text-sm">
              <div className="font-semibold text-neutral-300">Vendas Agosto</div>
              <div className="mt-1 text-2xl font-bold">{formatCurrencyCompact(metrics.vendasMes)}</div>
            </div>
            <hr className="my-8 border-neutral-700" />
          </>
        )}

        {/* Churrascômetro */}
        {metrics.visibleWidgets.includes("churrascometro") && (
          <div className="mb-8">
            <div className="text-sm font-semibold text-neutral-300">Churrascômetro:</div>
            <div className="mt-2 flex h-4 w-full overflow-hidden rounded-full bg-neutral-700">
              <div
                className="bg-red-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, metrics.churrascometroProgress)}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-red-400">
              {metrics.churrascometroProgress.toFixed(2)}%
            </div>
          </div>
        )}

        {/* Última Venda */}
        {metrics.visibleWidgets.includes("last_sale") && (
          <>
            <div>
              <div className="text-sm font-semibold text-neutral-300">Última Venda:</div>
              {metrics.lastSale ? (
                <div className="mt-4 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="flex items-center justify-center">
                    {metrics.lastSale.image ? (
                      <img src={metrics.lastSale.image} className="h-14 w-14 rounded-full object-cover shadow-lg" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-700 text-lg">
                        {metrics.lastSale.name?.charAt(0)}
                      </div>
                    )}
                    <div className="ml-3 text-sm font-medium">{metrics.lastSale.name}</div>
                  </div>
                  <div className="text-xs text-neutral-400">
                    Data: {metrics.lastSale.date.toLocaleDateString("pt-BR")}
                  </div>
                  <div className="text-xl font-bold">{formatCurrencyCompact(metrics.lastSale.value)}</div>
                </div>
              ) : (
                <div className="mt-4 text-center text-sm text-neutral-500">Nenhuma venda registrada.</div>
              )}
            </div>
            <hr className="my-8 border-neutral-700" />
          </>
        )}

        {/* Funnel Metrics */}
        {metrics.visibleWidgets.includes("funnels") && (
          <div className="mb-8 flex justify-around text-center text-sm">
            {metrics.leadsInFunnels.map((stage) => (
              <div key={stage.id}>
                <div className="font-semibold text-neutral-300">{stage.name}</div>
                <div className="mt-1 text-xl">{stage.count}</div>
              </div>
            ))}
            {metrics.leadsInFunnels.length === 0 && (
              <div className="text-neutral-500">Nenhum funil selecionado.</div>
            )}
          </div>
        )}

        {/* Ranking */}
        {metrics.visibleWidgets.includes("ranking") && (
          <div className="mt-auto flex-1">
            <div className="text-center text-sm font-semibold text-neutral-300">Ranking Empresas</div>
            <div className="mt-8 flex items-end justify-center gap-6">
              {metrics.ranking.map((user, idx) => {
                const isFirst = idx === 0;
                return (
                  <div key={user.id} className={`flex flex-col items-center ${isFirst ? 'mb-4 scale-110' : ''}`}>
                    {isFirst && <div className="mb-1 text-2xl">👑</div>}
                    {user.image ? (
                      <img
                        src={user.image}
                        className={`rounded-full object-cover shadow-lg ${isFirst ? 'h-20 w-20 border-4 border-yellow-500' : 'h-14 w-14 border-2 border-neutral-600'}`}
                      />
                    ) : (
                      <div className={`flex items-center justify-center rounded-full bg-neutral-700 text-lg ${isFirst ? 'h-20 w-20 border-4 border-yellow-500' : 'h-14 w-14 border-2 border-neutral-600'}`}>
                        {user.name.charAt(0)}
                      </div>
                    )}
                    <div className="mt-3 text-xs font-medium max-w-[80px] truncate" title={user.name}>{user.name.toLowerCase()}</div>
                    <div className="mt-1 text-sm font-bold">{formatCurrencyCompact(user.total)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
