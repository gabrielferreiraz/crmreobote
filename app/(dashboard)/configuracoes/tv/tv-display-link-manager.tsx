"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2, Tv } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TempPasswordDialog } from "@/components/temp-password-dialog";
import { LoadingDots } from "@/components/loading-dots";

type TvDisplayLink = {
  id: string;
  tokenPrefix: string;
  createdByName: string;
  lastUsedAt: string | null;
  createdAt: string;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Gerenciamento do link público (sem login) da TV — ver app/tv/publico/
 * [token]/page.tsx. Mesmo padrão visual/de fluxo de
 * configuracoes/integracoes/api-keys-manager.tsx (mostra o token completo
 * só uma vez, na hora de gerar; nunca mais recuperável depois), só que "o"
 * link é singular por organização, não uma lista — gerar de novo já
 * substitui (revoga) o anterior.
 */
export function TvDisplayLinkManager({ initialLink }: { initialLink: TvDisplayLink | null }) {
  const router = useRouter();
  const [link, setLink] = useState(initialLink);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/tv-display-link", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    setConfirmRegenerate(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao gerar link");
      return;
    }

    setLink({
      id: data.id,
      tokenPrefix: data.tokenPrefix,
      createdByName: "você",
      lastUsedAt: null,
      createdAt: data.createdAt,
    });
    setNewUrl(`${window.location.origin}/tv/publico/${data.fullToken}`);
    router.refresh();
  }

  async function revoke() {
    if (!link) return;
    await fetch(`/api/tv-display-link/${link.id}`, { method: "DELETE" });
    setLink(null);
    setConfirmRevoke(false);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Link público da TV</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Pra abrir o dashboard num dispositivo de TV que não faz login (Smart TV, mini PC, Fire TV Stick etc.) — quem
          tiver o link acessa direto, sem senha. Gerar um novo substitui o anterior, que para de funcionar na hora.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {link ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
              <Tv className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm text-neutral-700 dark:text-neutral-300">
                {link.tokenPrefix}…
              </p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Gerado por {link.createdByName} em {formatDateTime(link.createdAt)} · último acesso{" "}
                {formatDateTime(link.lastUsedAt)}
              </p>
            </div>
            <button type="button" onClick={() => setConfirmRegenerate(true)} className="btn-secondary btn-sm shrink-0">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              Gerar outro
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevoke(true)}
              className="icon-btn shrink-0 hover:text-red-600 dark:hover:text-red-400"
              aria-label="Revogar link"
              title="Revogar"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum link público gerado ainda.</p>
            <button type="button" onClick={generate} disabled={loading} className="btn-primary btn-sm">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
              {loading ? (
                <span className="inline-flex items-center gap-1">
                  Gerando
                  <LoadingDots />
                </span>
              ) : (
                "Gerar link"
              )}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {newUrl && (
        <TempPasswordDialog
          title="Link gerado"
          description="Copie e cole esse endereço no navegador do dispositivo de TV agora — ele não será mostrado de novo. Qualquer link anterior já parou de funcionar."
          password={newUrl}
          onClose={() => setNewUrl(null)}
        />
      )}

      {confirmRegenerate && (
        <ConfirmDialog
          title="Gerar outro link?"
          description="O link atual para de funcionar imediatamente — qualquer TV ainda usando ele vai mostrar erro até você colar o novo endereço nela."
          confirmLabel="Gerar outro"
          onClose={() => setConfirmRegenerate(false)}
          onConfirm={generate}
        />
      )}

      {confirmRevoke && (
        <ConfirmDialog
          title="Revogar o link público?"
          description="Qualquer TV usando esse link para de mostrar o dashboard imediatamente. Não pode ser desfeito — só gerando um novo depois."
          confirmLabel="Revogar"
          onClose={() => setConfirmRevoke(false)}
          onConfirm={revoke}
        />
      )}
    </div>
  );
}
