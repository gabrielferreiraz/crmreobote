"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, QrCode, Unplug, History, ShieldCheck, ChevronDown, ChevronRight } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";

type EvolutionStatus = "loading" | "disconnected" | "connecting" | "connected";
type MetaStatus = "loading" | "disconnected" | "connected";

// SDK global do Facebook — carregado uma vez via <script>, ver loadFacebookSdk.
declare global {
  interface Window {
    FB?: {
      init: (params: { appId: string; version: string; xfbml?: boolean }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
        params: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let fbSdkLoadPromise: Promise<void> | null = null;

/** Carrega o SDK JS do Facebook uma única vez por página, mesmo se o componente remontar. */
function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (fbSdkLoadPromise) return fbSdkLoadPromise;

  fbSdkLoadPromise = new Promise((resolve) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: "v21.0", xfbml: false });
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/pt_BR/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
  return fbSdkLoadPromise;
}

/**
 * O popup de Embedded Signup manda o phone_number_id/waba_id via
 * postMessage, separado da resposta do FB.login (que só traz o `code`) — os
 * dois chegam em momentos diferentes, então essa função só resolve quando
 * tiver os dois juntos (ver useEffect que observa pendingSignup). O formato
 * exato desse evento já mudou entre versões da API da Meta — o parsing
 * abaixo aceita alguns formatos plausíveis, mas só dá pra confirmar 100%
 * testando com um App real (ver plano — não há credencial Meta configurada
 * ainda neste ambiente).
 */
function parseEmbeddedSignupMessage(data: unknown): { phoneNumberId?: string; wabaId?: string } | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.type !== "WA_EMBEDDED_SIGNUP" && (record as { event?: unknown }).event !== "WA_EMBEDDED_SIGNUP") {
    return null;
  }
  const inner = (record.data ?? record) as Record<string, unknown>;
  const phoneNumberId = inner.phone_number_id ?? inner.phoneNumberId;
  const wabaId = inner.waba_id ?? inner.wabaId;
  if (typeof phoneNumberId !== "string" && typeof wabaId !== "string") return null;
  return {
    phoneNumberId: typeof phoneNumberId === "string" ? phoneNumberId : undefined,
    wabaId: typeof wabaId === "string" ? wabaId : undefined,
  };
}

export function WhatsAppConnect() {
  const [status, setStatus] = useState<EvolutionStatus>("loading");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingHistory, setImportingHistory] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Proxy é opcional e só faz efeito na criação da instância (ver
  // app/api/whatsapp/instance/route.ts) — reduz o risco de a WhatsApp
  // identificar a sessão como automatizada por vir de IP de datacenter.
  // Nunca vem preenchido sozinho: precisa de um proxy residencial/móvel de
  // verdade contratado à parte (serviço pago — proxy "grátis" público é
  // datacenter ou já malicioso).
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("");
  const [proxyProtocol, setProxyProtocol] = useState("http");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");

  async function refreshStatus() {
    const res = await fetch("/api/whatsapp/instance");
    if (!res.ok) return;
    const data = await res.json();
    setPhoneNumber(data.phoneNumber ?? null);
    setStatus(data.connected ? "connected" : data.status === "CONNECTING" ? "connecting" : "disconnected");
    return data.connected as boolean;
  }

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "connecting") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const connected = await refreshStatus();
      if (connected && pollRef.current) {
        clearInterval(pollRef.current);
        setQrCode(null);
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const proxy = proxyHost.trim()
        ? {
            host: proxyHost.trim(),
            port: Number(proxyPort),
            protocol: proxyProtocol,
            username: proxyUsername.trim() || undefined,
            password: proxyPassword || undefined,
          }
        : undefined;
      const res = await fetch("/api/whatsapp/instance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao conectar WhatsApp");
        return;
      }
      setQrCode(data.qrCode ?? null);
      setStatus("connecting");
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
      await fetch("/api/whatsapp/instance", { method: "DELETE" });
      setStatus("disconnected");
      setPhoneNumber(null);
      setQrCode(null);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  // O puxão automático de histórico (no momento do pareamento) depende do
  // WhatsApp mandar o sync na hora certa — nem sempre acontece. Este botão
  // deixa tentar de novo a qualquer momento, sem precisar desconectar e
  // reconectar o número.
  async function importHistory() {
    setImportingHistory(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/whatsapp/instance/import-history", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportResult(data.error ?? "Erro ao importar histórico");
        return;
      }
      setImportResult(
        data.imported > 0
          ? `${data.imported} mensagem${data.imported === 1 ? "" : "s"} importada${data.imported === 1 ? "" : "s"} de ${data.contacts} conversa${data.contacts === 1 ? "" : "s"}.`
          : "Nenhuma mensagem encontrada pra importar ainda — o WhatsApp pode não ter sincronizado o histórico com o Evolution ainda. Tente de novo em alguns minutos.",
      );
    } catch {
      setImportResult("Falha de conexão. Tente novamente.");
    } finally {
      setImportingHistory(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {status === "loading" ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <WhatsAppIcon className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">WhatsApp (QR Code)</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {status === "connected"
                      ? `Conectado${phoneNumber ? ` — ${phoneNumber}` : ""}`
                      : status === "connecting"
                        ? "Aguardando leitura do QR Code…"
                        : "Nenhum número conectado"}
                  </p>
                </div>
              </div>

              {status === "connected" ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={importHistory}
                    disabled={importingHistory}
                    className="btn-secondary"
                    title="Puxar de novo o histórico de conversas já sincronizado pelo Evolution"
                  >
                    {importingHistory ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                    ) : (
                      <History className="h-4 w-4" strokeWidth={2} />
                    )}
                    Importar histórico
                  </button>
                  <button onClick={disconnect} disabled={busy} className="btn-secondary">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Unplug className="h-4 w-4" strokeWidth={2} />}
                    Desconectar
                  </button>
                </div>
              ) : (
                <button onClick={connect} disabled={busy || status === "connecting"} className="btn-primary">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                  ) : (
                    <QrCode className="h-4 w-4" strokeWidth={2} />
                  )}
                  Conectar
                </button>
              )}
            </div>

            {status === "disconnected" && (
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowProxyForm((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  {showProxyForm ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Configurar proxy (opcional)
                </button>
                {showProxyForm && (
                  <div className="space-y-2 border-t border-neutral-100 p-3 dark:border-neutral-800">
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                      Reduz o risco da WhatsApp identificar a conexão como automatizada (IP de datacenter é um sinal
                      de suspeita). Precisa de um proxy residencial/móvel contratado à parte — deixe em branco se não
                      tiver um.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={proxyHost}
                        onChange={(e) => setProxyHost(e.target.value)}
                        placeholder="Host"
                        className="field-input py-1.5 text-sm"
                      />
                      <input
                        value={proxyPort}
                        onChange={(e) => setProxyPort(e.target.value)}
                        placeholder="Porta"
                        inputMode="numeric"
                        className="field-input py-1.5 text-sm"
                      />
                      <select
                        value={proxyProtocol}
                        onChange={(e) => setProxyProtocol(e.target.value)}
                        className="field-input py-1.5 text-sm"
                      >
                        <option value="http">http</option>
                        <option value="https">https</option>
                        <option value="socks5">socks5</option>
                      </select>
                      <input
                        value={proxyUsername}
                        onChange={(e) => setProxyUsername(e.target.value)}
                        placeholder="Usuário (opcional)"
                        className="field-input py-1.5 text-sm"
                      />
                      <input
                        value={proxyPassword}
                        onChange={(e) => setProxyPassword(e.target.value)}
                        placeholder="Senha (opcional)"
                        type="password"
                        className="field-input col-span-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {qrCode && status === "connecting" && (
              <div className="flex flex-col items-center gap-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCode} alt="QR Code do WhatsApp" className="h-48 w-48" />
                <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
                  Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho, e escaneie o código.
                </p>
              </div>
            )}

            {importResult && <p className="text-sm text-neutral-500 dark:text-neutral-400">{importResult}</p>}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </>
        )}
      </div>

      <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <MetaWhatsAppConnect />
      </div>
    </div>
  );
}

/**
 * Conexão via API oficial da Meta (Embedded Signup) — bloco separado do QR
 * Code de propósito (ver components/whatsapp-connect.tsx, os dois convivem).
 * Sem NEXT_PUBLIC_META_APP_ID/NEXT_PUBLIC_META_SIGNUP_CONFIG_ID configurados
 * (ver .env), mostra só um aviso em vez do botão — impossível iniciar o
 * fluxo sem essas duas variáveis.
 */
function MetaWhatsAppConnect() {
  const [status, setStatus] = useState<MetaStatus>("loading");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guarda o phone_number_id/waba_id assim que o postMessage chega — pode
  // vir antes OU depois do callback do FB.login terminar (ver
  // parseEmbeddedSignupMessage), por isso fica num ref em vez de só uma
  // variável local dentro do callback.
  const signupDataRef = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_SIGNUP_CONFIG_ID;

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/whatsapp/instance/meta/connect");
    if (!res.ok) return;
    const data = await res.json();
    setPhoneNumber(data.phoneNumber ?? null);
    setStatus(data.connected ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      const parsed = parseEmbeddedSignupMessage(event.data);
      if (!parsed) return;
      signupDataRef.current = { ...signupDataRef.current, ...parsed };
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  async function finishConnect(code: string) {
    const { phoneNumberId, wabaId } = signupDataRef.current;
    if (!phoneNumberId || !wabaId) {
      setError("Não recebemos os dados do número conectado. Tente novamente.");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/whatsapp/instance/meta/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, phoneNumberId, wabaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao concluir a conexão");
        return;
      }
      setPhoneNumber(data.phoneNumber ?? null);
      setStatus("connected");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
      signupDataRef.current = {};
    }
  }

  async function connect() {
    if (!appId || !configId) return;
    setBusy(true);
    setError(null);
    signupDataRef.current = {};

    try {
      await loadFacebookSdk(appId);
    } catch {
      setError("Não foi possível carregar o SDK da Meta. Tente novamente.");
      setBusy(false);
      return;
    }

    window.FB?.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          // Cancelado pelo usuário, ou o popup fechou sem concluir — não é
          // um erro pra mostrar, só volta ao estado normal.
          setBusy(false);
          return;
        }
        finishConnect(code);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/whatsapp/instance/meta/connect", { method: "DELETE" });
      setStatus("disconnected");
      setPhoneNumber(null);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">WhatsApp Oficial (Meta)</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {status === "connected" ? `Conectado${phoneNumber ? ` — ${phoneNumber}` : ""}` : "Nenhum número conectado"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <button onClick={disconnect} disabled={busy} className="btn-secondary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Unplug className="h-4 w-4" strokeWidth={2} />}
            Desconectar
          </button>
        ) : (
          <button onClick={connect} disabled={busy || !appId || !configId} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <ShieldCheck className="h-4 w-4" strokeWidth={2} />}
            Conectar com Meta
          </button>
        )}
      </div>

      {!appId || !configId ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Conexão oficial ainda não configurada nesta organização (faltam variáveis de ambiente da Meta).
        </p>
      ) : null}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
