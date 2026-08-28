"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2, Tv, Copy, Check } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
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

function CopyField({ value, mono = false }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <p className={`min-w-0 flex-1 break-all text-neutral-900 dark:text-neutral-100 ${mono ? "font-mono text-sm" : "text-xs"}`}>
        {value}
      </p>
      <button type="button" onClick={copy} className="icon-btn shrink-0" aria-label="Copiar">
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

/**
 * Gerenciamento do link público (sem login) da TV — ver app/t/[code]/
 * page.tsx (rota no nível raiz do site, o mais curta possível — pedido
 * explícito: não é só o código que precisa ser fácil de digitar no
 * controle remoto, o endereço inteiro também). Código curto de propósito
 * (12 caracteres, ver lib/tv-display-link.ts) — o formato anterior (token
 * de 54 caracteres, mesmo estilo de API key) provou ser impraticável de
 * digitar; o código continua só sendo mostrado uma vez, na hora de gerar,
 * nunca mais recuperável depois — mesmo cuidado do formato anterior e de
 * configuracoes/integracoes/api-keys-manager.tsx. "O" link é singular por
 * organização, não uma lista — gerar de novo já substitui (revoga) o
 * anterior.
 */
export function TvDisplayLinkManager({ initialLink }: { initialLink: TvDisplayLink | null }) {
  const router = useRouter();
  const [link, setLink] = useState(initialLink);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ displayCode: string; url: string } | null>(null);
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
      setError(data.error ?? "Erro ao gerar código");
      return;
    }

    setLink({
      id: data.id,
      tokenPrefix: data.tokenPrefix,
      createdByName: "você",
      lastUsedAt: null,
      createdAt: data.createdAt,
    });
    setReveal({
      displayCode: data.displayCode,
      url: `${window.location.origin}/t/${data.displayCode}`,
    });
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
          Pra abrir o dashboard num dispositivo de TV que não faz login (Smart TV, mini PC, Fire TV Stick etc.) — um
          código curto, fácil de digitar no controle remoto. Gerar um novo substitui o anterior, que para de funcionar
          na hora.
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
              aria-label="Revogar código"
              title="Revogar"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhum código gerado ainda.</p>
            <button type="button" onClick={generate} disabled={loading} className="btn-primary btn-sm">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
              {loading ? (
                <span className="inline-flex items-center gap-1">
                  Gerando
                  <LoadingDots />
                </span>
              ) : (
                "Gerar código"
              )}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {reveal && (
        <Modal onClose={() => setReveal(null)} maxWidth="max-w-md">
          <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Código gerado</h2>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
            Anote ou copie agora — não será mostrado de novo. Qualquer código anterior já parou de funcionar.
          </p>

          <p className="field-label mb-1">Digite isso no controle da TV</p>
          <CopyField value={reveal.displayCode} mono />

          <p className="field-label mt-3 mb-1">Ou abra o endereço completo</p>
          <CopyField value={reveal.url} />

          <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
            Dica: se o navegador da TV permitir, defina esse endereço como página inicial — assim você só digita uma
            vez, mesmo que a TV reinicie depois.
          </p>

          <div className="mt-4 flex justify-end">
            <button onClick={() => setReveal(null)} className="btn-primary">
              Fechar
            </button>
          </div>
        </Modal>
      )}

      {confirmRegenerate && (
        <ConfirmDialog
          title="Gerar outro código?"
          description="O código atual para de funcionar imediatamente — qualquer TV ainda usando ele vai mostrar erro até você digitar o novo código nela."
          confirmLabel="Gerar outro"
          onClose={() => setConfirmRegenerate(false)}
          onConfirm={generate}
        />
      )}

      {confirmRevoke && (
        <ConfirmDialog
          title="Revogar o código público?"
          description="Qualquer TV usando esse código para de mostrar o dashboard imediatamente. Não pode ser desfeito — só gerando um novo depois."
          confirmLabel="Revogar"
          onClose={() => setConfirmRevoke(false)}
          onConfirm={revoke}
        />
      )}
    </div>
  );
}
