"use client";

import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { withViewTransition } from "@/lib/view-transition";

/**
 * Botão que só abre o painel — extraído de components/whatsapp-chat.tsx (o
 * componente pesado do chat em si, ~2k linhas com QR code/mídia/áudio) pra
 * este arquivo pequeno poder ser importado estaticamente na página do
 * negócio sem trazer o resto do chat pro bundle inicial — o painel de
 * verdade (WhatsAppPanel) só carrega via next/dynamic quando o usuário
 * clica aqui (ver deal-detail.tsx).
 */
export function WhatsAppPanelTrigger({ onOpen, hasUnread }: { onOpen: () => void; hasUnread?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => withViewTransition(onOpen)}
      className="btn-secondary relative w-full justify-center"
    >
      <WhatsAppIcon className="h-4 w-4" strokeWidth={2} />
      Abrir conversa
      {hasUnread && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3" title="O lead respondeu">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
        </span>
      )}
    </button>
  );
}
