"use client";

import { useEffect, useState } from "react";
import { Download, Share2, Check, QrCode, X } from "lucide-react";
import { QrCodeDisplay } from "./qr-code-display";

type Props = {
  slug: string;
  displayName: string;
  publicUrl: string;
  sessionId: string | null;
  source: string | null;
  /** Ver comentário em digital-card-view.tsx — repassado até aqui só pra
   * ir junto no download do vCard (handleSaveContact abaixo), que é a
   * única ação com uma rota própria (GET, fora do POST de eventos de
   * clique) que também precisa saber disso. */
  presentationId: string | null;
  onTrack: (eventType: string) => void;
  /** `?qr=1` na URL (ver app/c/[slug]/page.tsx) — atalho "Cartão de
   * visita" do menu do usuário (components/user-menu.tsx) leva direto pra
   * cá com isso ligado: pedido explícito "ir direto na Landing Page e
   * abrir suavemente o QR Code pro consultor mostrar" — sem precisar do
   * toque extra no botão "QR Code". A transição em si já é suave
   * (animate-in fade-in, ver o modal abaixo), só o GATILHO que muda. */
  autoOpenQr?: boolean;
};

/**
 * Ações do cartão (Estrutura limpa e de alta conversão):
 * 1. Botão Principal (Full Width): "Salvar Contato" — Destaque total e máximo espaço visual.
 * 2. Grid Secundário (2 Colunas): "QR Code" | "Enviar Cartão" — Organizados lado a lado abaixo.
 */
export function DigitalCardActions({ slug, displayName, publicUrl, sessionId, source, presentationId, onTrack, autoOpenQr = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    if (autoOpenQr) {
      onTrack("QR_CODE_OPEN");
      setShowQrModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSaveContact() {
    onTrack("VCARD_DOWNLOAD");
    const params = new URLSearchParams();
    if (sessionId) params.set("sid", sessionId);
    if (source) params.set("src", source);
    if (presentationId) params.set("pid", presentationId);
    const qs = params.toString();
    window.location.href = `/api/public/cards/${slug}/vcard${qs ? `?${qs}` : ""}`;
  }

  async function handleShare() {
    onTrack("SHARE_CLICK");
    const shareData = { title: `Cartão de ${displayName}`, text: `Contato de ${displayName}`, url: publicUrl };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // fallback para clipboard se o usuário cancelar o share nativo
      }
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível
    }
  }

  return (
    <>
      <div className="w-full space-y-2 max-w-full">
        {/* Ação Principal: Salvar Contato (Largura Total - Destaque Máximo) */}
        <button
          type="button"
          onClick={handleSaveContact}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#00aeee] via-cyan-500 to-blue-600 py-3.5 px-4 text-sm font-extrabold text-white shadow-[0_4px_20px_rgba(0,174,238,0.4)] transition-all hover:brightness-110 active:scale-[0.98]"
        >
          <Download className="h-4.5 w-4.5 shrink-0" strokeWidth={2.5} />
          <span>Salvar Contato</span>
        </button>

        {/* Ações Secundárias em Grid de 2 Colunas Equilibradas — mais finas
            que o botão principal (py-2 em vez de py-2.5, ícone menor):
            são ações de apoio, não precisam do mesmo peso visual do
            "Salvar Contato". */}
        <div className="grid grid-cols-2 gap-2 w-full">
          {/* Mostrar QR Code */}
          <button
            type="button"
            onClick={() => {
              onTrack("QR_CODE_OPEN");
              setShowQrModal(true);
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 py-2 px-3 text-xs font-semibold text-white/90 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white active:scale-[0.98]"
          >
            <QrCode className="h-3.5 w-3.5 shrink-0 text-cyan-400" strokeWidth={2.2} />
            <span>QR Code</span>
          </button>

          {/* Enviar / Compartilhar */}
          <button
            type="button"
            onClick={handleShare}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 py-2 px-3 text-xs font-semibold text-white/90 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white active:scale-[0.98]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" strokeWidth={2.5} />
            ) : (
              <Share2 className="h-3.5 w-3.5 shrink-0 text-white/80" strokeWidth={2.2} />
            )}
            <span>{copied ? "Copiado!" : "Enviar Cartão"}</span>
          </button>
        </div>
      </div>

      {/* Modal Popup com o QR Code */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative flex flex-col items-center gap-4 rounded-3xl border border-white/15 bg-[#090d16] p-6 shadow-2xl text-center max-w-xs w-full">
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-3.5 right-3.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </button>

            <div className="space-y-1 pt-1">
              <p className="text-sm font-bold text-white">QR Code do Cartão</p>
              <p className="text-xs text-white/60">Aponte a câmera para abrir o cartão digital de {displayName}</p>
            </div>

            <div className="rounded-2xl p-2 bg-white shadow-xl">
              <QrCodeDisplay url={publicUrl} size={190} />
            </div>

            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="w-full rounded-xl bg-white/10 py-2 text-xs font-bold text-white hover:bg-white/20 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}





