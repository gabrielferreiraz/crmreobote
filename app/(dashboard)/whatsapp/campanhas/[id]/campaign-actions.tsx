"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, Send } from "lucide-react";

type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "DONE";

export function CampaignActions({ id, status }: { id: string; status: CampaignStatus }) {
  const router = useRouter();
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [sendingNow, setSendingNow] = useState(false);
  const [sendNowResult, setSendNowResult] = useState<string | null>(null);

  async function setStatus(next: "RUNNING" | "PAUSED") {
    setTogglingStatus(true);
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setTogglingStatus(false);
    router.refresh();
  }

  async function sendNow() {
    setSendingNow(true);
    setSendNowResult(null);
    const res = await fetch(`/api/campaigns/${id}/send-now`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setSendingNow(false);
    if (!res.ok) {
      setSendNowResult(data.error ?? "Não foi possível enviar agora");
      return;
    }
    setSendNowResult(
      data.outcome === "sent"
        ? "Mensagem enviada agora!"
        : data.outcome === "failed"
          ? "Tentativa de envio falhou — ver detalhes na lista de destinatários."
          : "Contato pulado (sem WhatsApp/celular cadastrado).",
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(status === "DRAFT" || status === "PAUSED") && (
        <button type="button" disabled={togglingStatus} onClick={() => setStatus("RUNNING")} className="btn-secondary">
          {togglingStatus ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Play className="h-4 w-4" strokeWidth={2} />}
          Retomar
        </button>
      )}
      {status === "RUNNING" && (
        <button type="button" disabled={togglingStatus} onClick={() => setStatus("PAUSED")} className="btn-secondary">
          {togglingStatus ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Pause className="h-4 w-4" strokeWidth={2} />}
          Pausar
        </button>
      )}
      {status === "RUNNING" && (
        <button type="button" disabled={sendingNow} onClick={sendNow} className="btn-secondary" title="Envia o próximo pendente agora, sem esperar o delay entre contatos">
          {sendingNow ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
          Enviar agora
        </button>
      )}
      {sendNowResult && <span className="text-xs text-neutral-500 dark:text-neutral-400">{sendNowResult}</span>}
    </div>
  );
}
