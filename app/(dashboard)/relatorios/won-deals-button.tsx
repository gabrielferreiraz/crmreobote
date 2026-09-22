"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Loader2 } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { Avatar } from "@/components/avatar";
import { formatCurrency } from "@/lib/format";
import type { WonDealRow, WonDealsResult } from "@/lib/reports/won-deals";

const PAGE_SIZE = 20;

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  // Dia civil de Brasília explícito — sem timeZone, o navegador de quem
  // estiver fora do fuso mostraria o fechamento das 23h como "dia seguinte".
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
}

/**
 * "Ver negócios" no fim de cada linha do card "Negócios fechados" do
 * ranking (ver relatorios/page.tsx) — abre um painel lateral com os
 * clientes/negócios que aquela pessoa fechou NO PERÍODO do relatório (os
 * mesmos limites que geraram o número do card, ver rangeFromIso em
 * lib/reports/commercial-data.ts) e leva pra página completa com TODOS os
 * ganhos dela (relatorios/ganhos/[userId]).
 *
 * Só carrega quando abre — o ranking mostra o time inteiro, montar uma
 * lista por pessoa de antemão seria trabalho jogado fora.
 */
export function WonDealsButton({
  ownerId,
  ownerName,
  photoUrl,
  fromIso,
  toIso,
  pipelineId,
  periodLabel,
}: {
  ownerId: string;
  ownerName: string;
  photoUrl: string | null;
  fromIso: string | null;
  toIso: string | null;
  pipelineId: string | null;
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
      >
        Ver negócios
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.25} />
      </button>
      {open && (
        <WonDealsPanel
          ownerId={ownerId}
          ownerName={ownerName}
          photoUrl={photoUrl}
          fromIso={fromIso}
          toIso={toIso}
          pipelineId={pipelineId}
          periodLabel={periodLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function WonDealsPanel({
  ownerId,
  ownerName,
  photoUrl,
  fromIso,
  toIso,
  pipelineId,
  periodLabel,
  onClose,
}: {
  ownerId: string;
  ownerName: string;
  photoUrl: string | null;
  fromIso: string | null;
  toIso: string | null;
  pipelineId: string | null;
  periodLabel: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<WonDealRow[]>([]);
  const [summary, setSummary] = useState<Pick<WonDealsResult, "total" | "sumValue" | "sumGrossValue"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  function buildUrl(skip: number) {
    const params = new URLSearchParams({ ownerId, skip: String(skip), take: String(PAGE_SIZE) });
    if (fromIso) params.set("from", fromIso);
    if (toIso) params.set("to", toIso);
    if (pipelineId) params.set("pipelineId", pipelineId);
    return `/api/reports/won-deals?${params.toString()}`;
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(buildUrl(0))
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
        if (cancelled) return;
        setItems((data as WonDealsResult).items);
        setSummary({ total: data.total, sumValue: data.sumValue, sumGrossValue: data.sumGrossValue });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não deu pra carregar os negócios.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // buildUrl só depende das props (estáveis enquanto o painel está aberto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(items.length));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setItems((prev) => [...prev, ...(data as WonDealsResult).items]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não deu pra carregar mais.");
    } finally {
      setLoadingMore(false);
    }
  }

  const firstName = ownerName.split(" ")[0];
  const hasMore = summary ? items.length < summary.total : false;

  return (
    <SidePanel onClose={onClose} title="Negócios fechados" maxWidth="max-w-lg">
      <div className="flex items-center gap-3">
        <Avatar name={ownerName} src={photoUrl} size="md" className="shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{ownerName}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{periodLabel}</p>
        </div>
      </div>

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="min-w-0 rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/60">
            <p className="text-[11px] tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Negócios</p>
            <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{summary.total}</p>
          </div>
          <div className="min-w-0 rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-neutral-800/60">
            <p className="text-[11px] tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Total ganho</p>
            <p className="text-base font-bold tabular-nums text-neutral-900 sm:text-lg dark:text-neutral-100">{formatCurrency(summary.sumValue)}</p>
            {summary.sumGrossValue > 0 && summary.sumGrossValue !== summary.sumValue && (
              <p className="text-[11px] text-neutral-400 tabular-nums dark:text-neutral-500">bruto: {formatCurrency(summary.sumGrossValue)}</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex-1">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/60" />
            ))}
          </div>
        ) : error && items.length === 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            {error}{" "}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-medium underline">
              Tentar de novo
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum negócio ganho neste período.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {items.map((d) => (
              <li key={d.id}>
                {/* Empilhado, não lado a lado com o valor — o nome do
                    cliente precisa caber INTEIRO (pedido explícito), e
                    dividindo a linha com o valor ele sempre truncava. */}
                <Link
                  href={`/negocios/${d.id}`}
                  className="-mx-2 block rounded-lg px-2 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                >
                  <p className="text-sm font-medium break-words text-neutral-900 dark:text-neutral-100">{d.contactName}</p>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {d.name !== d.contactName && <>{d.name} · </>}
                    {d.creditType ? `${d.creditType} · ` : ""}
                    {d.pipelineName}
                  </p>
                  <div className="mt-1.5 flex items-end justify-between gap-3">
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{formatDay(d.closedAt)}</p>
                    <div className="text-right">
                      <p className="text-sm font-semibold whitespace-nowrap tabular-nums text-neutral-900 dark:text-neutral-100">
                        {formatCurrency(d.value)}
                      </p>
                      {/* Bruto só quando difere do líquido — mostrar os dois
                          iguais seria ruído (pedido: bruto visível, mas menor). */}
                      {d.grossValue !== null && d.grossValue !== d.value && (
                        <p className="text-[10px] whitespace-nowrap text-neutral-400 tabular-nums dark:text-neutral-500">
                          bruto: {formatCurrency(d.grossValue)}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary btn-sm mt-3 w-full">
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
            {loadingMore ? "Carregando…" : `Carregar mais (${summary!.total - items.length})`}
          </button>
        )}
        {error && items.length > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {/* Fica colado no fim do painel — o caminho pra "ver todos os ganhos"
          (histórico inteiro, todos os funis) precisa estar sempre à vista,
          mesmo com a lista rolando. */}
      <div className="sticky bottom-0 -mx-5 mt-4 border-t border-neutral-100 bg-white/80 px-5 pt-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
        <Link
          href={`/relatorios/ganhos/${ownerId}`}
          className="btn-primary flex w-full items-center justify-center gap-1.5"
        >
          <span className="truncate">Ver todos os ganhos de {firstName}</span>
          <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2.25} />
        </Link>
      </div>
    </SidePanel>
  );
}
