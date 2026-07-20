"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Unplug, Megaphone } from "lucide-react";

type Status = "loading" | "disconnected" | "connected";
type Page = { id: string; name: string };

const QUERY_MESSAGES: Record<string, string> = {
  denied: "Conexão cancelada.",
  error: "Não foi possível concluir a conexão com o Facebook. Tente novamente.",
  no_pages: "Nenhuma Página do Facebook encontrada nessa conta — crie/associe uma Página antes de conectar.",
};

export function MetaAdsConnect() {
  const searchParams = useSearchParams();
  const metaAdsParam = searchParams.get("meta_ads");

  const [status, setStatus] = useState<Status>("loading");
  const [pageName, setPageName] = useState<string | null>(null);
  const [pixelId, setPixelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPages, setPendingPages] = useState<Page[] | null>(null);

  async function refreshStatus() {
    const res = await fetch("/api/meta-ads/status");
    if (!res.ok) return;
    const data = await res.json();
    setStatus(data.connected ? "connected" : "disconnected");
    setPageName(data.pageName ?? null);
    setPixelId(data.pixelId ?? "");
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshStatus();
    if (metaAdsParam && QUERY_MESSAGES[metaAdsParam]) setError(QUERY_MESSAGES[metaAdsParam]);
    if (metaAdsParam === "select_page") {
      fetch("/api/meta-ads/pages")
        .then((r) => r.json())
        .then((data) => setPendingPages(data.pages ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choosePage(pageId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meta-ads/pages/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao concluir a conexão");
        return;
      }
      setPendingPages(null);
      await refreshStatus();
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/meta-ads/disconnect", { method: "DELETE" });
      setStatus("disconnected");
      setPageName(null);
      setPixelId("");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function savePixelId() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meta-ads/pixel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Erro ao salvar o Pixel ID");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>;
  }

  if (pendingPages) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Escolha qual Página do Facebook vai receber os leads dos formulários:
        </p>
        <div className="space-y-1.5">
          {pendingPages.map((page) => (
            <button
              key={page.id}
              type="button"
              disabled={busy}
              onClick={() => choosePage(page.id)}
              className="btn-secondary w-full justify-start"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Megaphone className="h-4 w-4" strokeWidth={2} />}
              {page.name}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Meta Ads (Lead Ads)</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {status === "connected" ? `Conectado — ${pageName}` : "Nenhuma Página conectada"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <button onClick={disconnect} disabled={busy} className="btn-secondary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Unplug className="h-4 w-4" strokeWidth={2} />}
            Desconectar
          </button>
        ) : (
          <a href="/api/meta-ads/authorize" className="btn-primary">
            <Megaphone className="h-4 w-4" strokeWidth={2} />
            Conectar com Facebook
          </a>
        )}
      </div>

      {status === "connected" && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Pixel ID (Events Manager) — opcional, ativa o aviso de conversão pra Meta quando um negócio vira ganho
            </label>
            <div className="flex gap-2">
              <input
                value={pixelId}
                onChange={(e) => setPixelId(e.target.value)}
                placeholder="Ex.: 123456789012345"
                className="field-input flex-1 py-1.5 text-sm"
              />
              <button onClick={savePixelId} disabled={busy} className="btn-secondary shrink-0">
                Salvar
              </button>
            </div>
          </div>
          <Link href="/relatorios/meta-ads" className="text-sm text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
            Ver conversão por campanha →
          </Link>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
