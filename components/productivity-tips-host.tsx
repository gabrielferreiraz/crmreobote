"use client";

import { useProductivityTips } from "@/lib/use-productivity-tips";
import {
  ManyWhatsAppTasksTip,
  NoShowDealsTip,
  WhatsAppDisconnectedTip,
} from "@/components/productivity-tip";

/**
 * Renderiza o popup de dica de produtividade no canto inferior direito, de
 * acordo com o que a avaliação da engine decidiu. Apenas um tip por vez (o
 * de maior prioridade). Qualquer erro aqui é silencioso — o pior que pode
 * acontecer é não mostrar a dica, nunca quebrar a tela.
 */
export function ProductivityTipsHost() {
  const { loading, tip, dismiss, onNoShowPickBatch, onScheduleTasks } = useProductivityTips();

  if (loading) return null;
  if (!tip) return null;

  try {
    switch (tip.tipType) {
      case "WHATSAPP_DISCONNECTED":
        return <WhatsAppDisconnectedTip tip={tip} onDismiss={dismiss} />;
      case "NOSHOW_DEALS":
        return <NoShowDealsTip tip={tip} onDismiss={dismiss} onPickBatch={onNoShowPickBatch} />;
      case "MANY_WHATSAPP_TASKS":
        return <ManyWhatsAppTasksTip tip={tip} onDismiss={dismiss} onScheduleAll={onScheduleTasks} />;
      default:
        return null;
    }
  } catch (err) {
    console.error("[productivity-tips] host render error", err);
    return null;
  }
}
