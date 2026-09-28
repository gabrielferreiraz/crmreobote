"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, Send, Waves } from "lucide-react";
import { DuplicateCampaignButton } from "../duplicate-campaign-button";
import { trackUse } from "@/lib/feature-usage/track";

type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "DONE";

export function CampaignActions({
  id,
  status,
  hasAudienceFilter,
  hasRmktWaves,
  autoPausedByDisconnect,
}: {
  id: string;
  status: CampaignStatus;
  hasAudienceFilter: boolean;
  /** Só campanha com ondas de RMKT configuradas (Campaign.rmktWaves) ganha o botão dedicado "Enviar onda de RMKT agora" — ver getCampaignDetail em lib/campaigns/list.ts. */
  hasRmktWaves: boolean;
  /** Pausada pelo motor porque o WhatsApp caiu (vai retomar SOZINHA ao reconectar) — ganha o botão "Manter pausada" pra desligar essa retomada. */
  autoPausedByDisconnect: boolean;
}) {
  const router = useRouter();
  const [togglingStatus, setTogglingStatus] = useState(false);
  // Dois botões, dois estados de "enviando" separados — clicar num não pode
  // desabilitar/mudar o texto do outro por engano (ver sendNow abaixo).
  const [sendingNow, setSendingNow] = useState<"initial" | "wave" | null>(null);
  const [sendNowResult, setSendNowResult] = useState<string | null>(null);

  async function setStatus(next: "RUNNING" | "PAUSED") {
    setTogglingStatus(true);
    setSendNowResult(null);
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    setTogglingStatus(false);
    if (res?.ok) {
      trackUse(next === "RUNNING" ? "campanhas.iniciar" : "campanhas.pausar");
    } else {
      // O servidor recusa com o motivo (ex.: "o WhatsApp está desconectado") — mostra, em vez de a
      // pessoa clicar em Retomar e a campanha simplesmente continuar pausada sem explicação.
      const data = await res?.json().catch(() => null);
      setSendNowResult(data?.error ?? "Não foi possível alterar a campanha agora. Tente de novo.");
    }
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
    trackUse("campanhas.enviar-agora");
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
      {status === "PAUSED" && autoPausedByDisconnect && (
        // Interruptor de desligar a retomada automática: vira pausa MANUAL (o servidor zera o motivo),
        // que só volta quando alguém clicar em Retomar — pra quem NÃO quer que a campanha volte sozinha
        // quando o WhatsApp reconectar (ex.: a live já passou).
        <button
          type="button"
          disabled={togglingStatus}
          onClick={() => setStatus("PAUSED")}
          className="btn-ghost"
          title="Cancela a retomada automática: a campanha só volta a enviar quando você clicar em Retomar."
        >
          <Pause className="h-4 w-4" strokeWidth={2} />
          Manter pausada
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
