"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, QrCode, Unplug } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";

type Status = "loading" | "disconnected" | "connecting" | "connected";

export function WhatsAppConnect() {
  const [status, setStatus] = useState<Status>("loading");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      const res = await fetch("/api/whatsapp/instance", { method: "POST" });
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

  if (status === "loading") {
    return <p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WhatsAppIcon className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">WhatsApp</p>
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
          <button onClick={disconnect} disabled={busy} className="btn-secondary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Unplug className="h-4 w-4" strokeWidth={2} />}
            Desconectar
          </button>
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

      {qrCode && status === "connecting" && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="QR Code do WhatsApp" className="h-48 w-48" />
          <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
            Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho, e escaneie o código.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
