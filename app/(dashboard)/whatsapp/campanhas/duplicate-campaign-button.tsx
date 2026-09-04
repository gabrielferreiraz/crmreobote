"use client";

import { useState } from "react";
import { Copy, Loader2, Users, ListFilter } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";

type Mode = "same_contacts" | "same_filter";

/**
 * Botão de "Duplicar campanha" — usado na tabela (lista) e na página de
 * detalhe. Quando a campanha tinha um filtro de público de verdade (cargo/
 * tag/cidade), pergunta qual dos dois modos usar pra montar a lista de
 * destinatários da cópia (ver app/api/campaigns/[id]/duplicate/route.ts);
 * sem filtro (campanha PIPELINE_BULK/LEAD_CAPTURE, lista montada por
 * seleção manual), só "mesmos contatos" faz sentido — duplica direto, sem
 * perguntar nada.
 */
export function DuplicateCampaignButton({
  campaignId,
  hasAudienceFilter,
  labeled = false,
  onDuplicated,
}: {
  campaignId: string;
  hasAudienceFilter: boolean;
  /** Ícone só (tabela) vs ícone+texto (barra de ações da página de detalhe). */
  labeled?: boolean;
  onDuplicated: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate(mode: Mode) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campaignId}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao duplicar campanha");
      return;
    }
    setChoosing(false);
    onDuplicated();
  }

  function handleClick() {
    // Sem filtro de público, "mesmo público (recalcular)" nem é uma opção
    // válida (ver comentário na rota) — duplica direto com os mesmos
    // contatos, sem abrir modal pra escolher algo que só tem 1 escolha real.
    if (!hasAudienceFilter) {
      duplicate("same_contacts");
      return;
    }
    setChoosing(true);
  }

  return (
    <>
      {labeled ? (
        <button type="button" disabled={loading} onClick={handleClick} className="btn-secondary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
          Duplicar
        </button>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={handleClick}
          className="icon-btn"
          aria-label="Duplicar campanha"
          title="Duplicar campanha"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
        </button>
      )}

      {choosing && (
        <Modal onClose={() => !loading && setChoosing(false)} maxWidth="max-w-sm">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Duplicar campanha</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Cria um rascunho novo com a mesma configuração (mensagens, ritmo de envio). Escolha de onde vem a lista
              de destinatários:
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => duplicate("same_contacts")}
              className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-light)] disabled:opacity-60 dark:border-neutral-800 dark:hover:bg-[var(--brand-subtle)]"
            >
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <span>
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">Mesmos contatos</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  Copia exatamente a lista de destinatários desta campanha.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => duplicate("same_filter")}
              className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-light)] disabled:opacity-60 dark:border-neutral-800 dark:hover:bg-[var(--brand-subtle)]"
            >
              <ListFilter className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
              <span>
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">Mesmo público (recalcular)</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                  Remonta a lista pelo mesmo filtro de cargo/tag/cidade — pega contatos novos cadastrados desde então.
                </span>
              </span>
            </button>
          </div>

          {loading && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
              Duplicando
              <LoadingDots />
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-4 flex justify-end">
            <button type="button" disabled={loading} onClick={() => setChoosing(false)} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
