"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ExternalLink, Loader2, Undo2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

type ArchivedDeal = {
  id: string;
  name: string;
  value: number | null;
  status: "OPEN" | "WON" | "LOST";
  archivedAt: string | null;
  archivedByName: string | null;
  contactName: string;
  ownerName: string;
  stageName: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * "Arquivados" do Pipeline — a gaveta de onde o negócio arquivado volta.
 *
 * É a contrapartida obrigatória do botão direito → "Arquivar negócio" (ver
 * kanban-board.tsx): sem um lugar visível pra achar o que sumiu, arquivar
 * seria indistinguível de apagar pra quem usa.
 */
export function ArchivedDealsDialog({
  pipelineId,
  onClose,
  onRestored,
}: {
  pipelineId: string;
  onClose: () => void;
  /** Um negócio voltou pro funil — quem abriu recarrega Kanban/Lista. */
  onRestored: () => void;
}) {
  const [deals, setDeals] = useState<ArchivedDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Por negócio (não um "carregando" global): dá pra clicar em desarquivar
  // em vários seguidos sem travar a lista inteira a cada um.
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/deals/archived?pipelineId=${encodeURIComponent(pipelineId)}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Não foi possível carregar os arquivados.");
          setDeals([]);
          return;
        }
        setDeals(data.deals ?? []);
        setTruncated(!!data.truncated);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError("Falha de conexão.");
        setDeals([]);
      });
    return () => controller.abort();
  }, [pipelineId]);

  async function restore(deal: ArchivedDeal) {
    setRestoring((prev) => new Set(prev).add(deal.id));
    setError(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Não foi possível desarquivar este negócio.");
        return;
      }
      // Sai da lista na hora — ele não está mais arquivado, e deixá-lo aí com
      // o botão apagado faria parecer que a ação não funcionou.
      setDeals((prev) => (prev ?? []).filter((d) => d.id !== deal.id));
      onRestored();
    } catch {
      setError("Falha de conexão.");
    } finally {
      setRestoring((prev) => {
        const next = new Set(prev);
        next.delete(deal.id);
        return next;
      });
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl" panelClassName="!p-0 overflow-hidden" mobileSheet>
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Archive className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Negócios arquivados</h2>
        {deals && deals.length > 0 && (
          <span className="rounded-full bg-neutral-200/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-500 dark:bg-neutral-800/70 dark:text-neutral-400">
            {deals.length}
          </span>
        )}
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {deals === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-300 dark:text-neutral-700" />
          </div>
        ) : deals.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="Nenhum negócio arquivado"
            description="Clique com o botão direito num card do Kanban para arquivar — ele sai do funil e fica guardado aqui."
          />
        ) : (
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {deals.map((deal) => (
              <li key={deal.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/negocios/${deal.id}`}
                      className="min-w-0 truncate text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                      title={deal.name}
                    >
                      {deal.name}
                    </Link>
                    <ExternalLink className="h-3 w-3 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
                  </div>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {deal.contactName} · {deal.stageName} · {formatCurrency(deal.value)}
                  </p>
                  <p className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    Arquivado em {formatWhen(deal.archivedAt)}
                    {deal.archivedByName ? ` por ${deal.archivedByName}` : ""} · responsável {deal.ownerName}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={restoring.has(deal.id)}
                  onClick={() => restore(deal)}
                  className="btn-secondary shrink-0 px-2.5 py-1 text-xs"
                  title="Devolver este negócio ao funil"
                >
                  {restoring.has(deal.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  ) : (
                    <Undo2 className="h-3 w-3" strokeWidth={2} />
                  )}
                  Desarquivar
                </button>
              </li>
            ))}
          </ul>
        )}

        {truncated && (
          <p className="pt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
            Mostrando os 200 arquivados mais recentes.
          </p>
        )}
      </div>

      <div className="flex justify-end border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <button type="button" onClick={onClose} className="btn-secondary">
          Fechar
        </button>
      </div>
    </Modal>
  );
}
