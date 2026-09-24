"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, Send, Waves } from "lucide-react";
import { DuplicateCampaignButton } from "../duplicate-campaign-button";

type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "DONE";

export function CampaignActions({
  id,
  status,
  hasAudienceFilter,
  hasRmktWaves,
}: {
  id: string;
  status: CampaignStatus;
  hasAudienceFilter: boolean;
  /** Só campanha com ondas de RMKT configuradas (Campaign.rmktWaves) ganha o botão dedicado "Enviar onda de RMKT agora" — ver getCampaignDetail em lib/campaigns/list.ts. */
  hasRmktWaves: boolean;
}) {
  const router = useRouter();
  const [togglingStatus, setTogglingStatus] = useState(false);
  // Dois botões, dois estados de "enviando" separados — clicar num não pode
  // desabilitar/mudar o texto do outro por engano (ver sendNow abaixo).
  const [sendingNow, setSendingNow] = useState<"initial" | "wave" | null>(null);
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

  /**
   * `target: "wave"` (pedido explícito: botão dedicado "Enviar onda de RMKT
   * agora") pula direto pra onda, ignorando pendente inicial e reenvio
   * único que o botão genérico prioriza antes — ver POST
   * /api/campaigns/[id]/send-now, que repassa isso pra sendNextRmktWaveNow
   * em vez de sendCampaignRecipientNow.
   */
  async function sendNow(target?: "wave") {
    setSendingNow(target ?? "initial");
    setSendNowResult(null);
    const res = await fetch(`/api/campaigns/${id}/send-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target ? { target } : {}),
    });
    const data = await res.json().catch(() => ({}));
    setSendingNow(null);
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
        <button
          type="button"
          disabled={sendingNow !== null}
          onClick={() => sendNow()}
          className="btn-secondary"
          title="Envia o próximo pendente AGORA (inicial, reenvio ou onda de RMKT que já venceu — nessa ordem), ignorando toda regra automática: delay entre contatos, janela de dias/horário e teto diário/aquecimento do número. Use com cuidado — mandar rápido demais fora do aquecimento é o tipo de coisa que o WhatsApp pode restringir/banir o número por fazer."
        >
          {sendingNow === "initial" ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Send className="h-4 w-4" strokeWidth={2} />}
          Enviar agora
        </button>
      )}
      {status === "RUNNING" && hasRmktWaves && (
        <button
          type="button"
          disabled={sendingNow !== null}
          onClick={() => sendNow("wave")}
          className="btn-secondary"
          title="Pula direto pra próxima onda de RMKT vencida, sem esperar a vez do pendente inicial ou do reenvio único, e ignora toda regra automática (janela de dias/horário, teto diário/aquecimento). Use com cuidado — risco de restrição/banimento do número."
        >
          {sendingNow === "wave" ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Waves className="h-4 w-4" strokeWidth={2} />}
          Enviar onda de RMKT agora
        </button>
      )}
      <DuplicateCampaignButton
        campaignId={id}
        hasAudienceFilter={hasAudienceFilter}
        labeled
        // O rascunho novo só pode ser editado/iniciado na lista (é lá que
        // fica o modal de edição) — navega pra lá em vez de ficar na página
        // de detalhe da campanha original.
        onDuplicated={() => router.push("/whatsapp/campanhas")}
      />
      {sendNowResult && <span className="text-xs text-neutral-500 dark:text-neutral-400">{sendNowResult}</span>}
    </div>
  );
}
