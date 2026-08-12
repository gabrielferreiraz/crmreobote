"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Unplug, Megaphone, Wallet } from "lucide-react";

type Status = "loading" | "disconnected" | "connected";
type Page = { id: string; name: string };
type AdAccount = { id: string; name: string; currency: string };

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

  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [adAccountName, setAdAccountName] = useState<string | null>(null);
  const [hasInsightsToken, setHasInsightsToken] = useState(false);
  // null = fechado; [] = aberto carregando; array preenchido = pra escolher.
  // Só busca a lista de contas quando o admin clica em "Trocar" — sem isso
  // toda abertura da tela de Integrações bateria a Graph API à toa.
  const [adAccountChoices, setAdAccountChoices] = useState<AdAccount[] | null>(null);
  const [loadingAdAccounts, setLoadingAdAccounts] = useState(false);

  async function refreshStatus() {
    const res = await fetch("/api/meta-ads/status");
    if (!res.ok) return;
    const data = await res.json();
    setStatus(data.connected ? "connected" : "disconnected");
    setPageName(data.pageName ?? null);
    setPixelId(data.pixelId ?? "");
    setAdAccountId(data.adAccountId ?? null);
    setAdAccountName(data.adAccountName ?? null);
    setHasInsightsToken(!!data.hasInsightsToken);
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

  async function loadAdAccountChoices() {
    setLoadingAdAccounts(true);
    setError(null);
    setAdAccountChoices([]);
    try {
      const res = await fetch("/api/meta-ads/ad-account");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao listar contas de anúncio");
        setAdAccountChoices(null);
        return;
      }
      setAdAccountChoices(data.accounts ?? []);
    } catch {
      setError("Falha de conexão. Tente novamente.");
      setAdAccountChoices(null);
    } finally {
      setLoadingAdAccounts(false);
    }
  }

  async function chooseAdAccount(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meta-ads/ad-account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao escolher a conta de anúncio");
        return;
      }
      setAdAccountId(data.adAccountId ?? null);
      setAdAccountName(data.adAccountName ?? null);
      setAdAccountChoices(null);
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
      setAdAccountId(null);
      setAdAccountName(null);
      setHasInsightsToken(false);
      setAdAccountChoices(null);
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

          {/* Conta de anúncio — de onde vem gasto/leads/CPL do resumo em
              Relatórios → Facebook (ver lib/meta-ads/insights.ts). Token de
              usuário separado do de Página (ver status.hasInsightsToken) —
              conexão feita antes dessa funcionalidade existir não tem, só
              reconectando de novo resolve. */}
          <div className="space-y-1.5 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
              Conta de anúncio (gasto/leads/CPL)
            </div>

            {!hasInsightsToken ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Essa conexão é de antes do resumo de gasto existir — reconecte pra habilitar.
                </p>
                <a href="/api/meta-ads/authorize" className="btn-secondary btn-sm shrink-0">
                  Reconectar
                </a>
              </div>
            ) : adAccountChoices === null ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{adAccountName ?? "Nenhuma conta selecionada"}</p>
                <button onClick={loadAdAccountChoices} disabled={busy} className="btn-secondary btn-sm shrink-0">
                  {adAccountId ? "Trocar" : "Escolher"}
                </button>
              </div>
            ) : loadingAdAccounts ? (
              <p className="flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                Buscando contas de anúncio…
              </p>
            ) : adAccountChoices.length === 0 ? (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Nenhuma conta de anúncio encontrada nesse login do Facebook.
              </p>
            ) : (
              <div className="space-y-1">
                {adAccountChoices.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    disabled={busy}
                    onClick={() => chooseAdAccount(acc.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                      acc.id === adAccountId
                        ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                        : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
                    }`}
                  >
                    <span className="truncate">{acc.name}</span>
                    <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{acc.currency}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Link href="/relatorios/meta-ads" className="text-sm text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
            Ver conversão por campanha e gasto →
          </Link>
        </>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
