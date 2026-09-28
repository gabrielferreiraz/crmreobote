"use client";

import { useEffect, useState } from "react";
import { Share2, Check, QrCode, X } from "lucide-react";
import { QrCodeDisplay } from "./qr-code-display";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { ensureBrazilianMobileNinthDigit, normalizePhoneNumber, toDialNumber } from "@/lib/phone-normalize";

type Props = {
  displayName: string;
  publicUrl: string;
  whatsapp: string | null;
  onTrack: (eventType: string) => void;
  /** `?qr=1` na URL (ver app/c/[slug]/page.tsx) — atalho "Cartão de
   * visita" do menu do usuário (components/user-menu.tsx) leva direto pra
   * cá com isso ligado: pedido explícito "ir direto na Landing Page e
   * abrir suavemente o QR Code pro consultor mostrar" — sem precisar do
   * toque extra no botão "QR Code". A transição em si já é suave
   * (animate-in fade-in, ver o modal abaixo), só o GATILHO que muda. */
  autoOpenQr?: boolean;
  /** Adapta a paleta dos botões secundários para o tema claro */
  light?: boolean;
};

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.447-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.572-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414zM12.004 2.003c-5.514 0-10 4.486-10 10 0 1.815.485 3.518 1.332 4.988l-1.332 4.909 5.064-1.314c1.42.793 3.056 1.246 4.79 1.246 5.514 0 10-4.486 10-10s-4.486-10-10-10zm0 18.333c-1.579 0-3.08-.426-4.38-1.182l-.314-.183-3.003.78.795-2.923-.201-.32c-.838-1.336-1.282-2.888-1.282-4.505 0-4.595 3.738-8.333 8.333-8.333 4.596 0 8.334 3.738 8.334 8.333 0 4.595-3.738 8.333-8.334 8.333z" />
    </svg>
  );
}

/**
 * Ações do cartão (Estrutura limpa e de alta conversão):
 * 1. Botão Principal (Full Width): WhatsApp — contato imediato e direto.
 * 2. Grid Secundário (2 Colunas): "QR Code" | "Enviar Cartão" — Organizados lado a lado abaixo.
 */
export function DigitalCardActions({ displayName, publicUrl, whatsapp, onTrack, autoOpenQr = false, light = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  useLockBodyScroll(showQrModal);

  useEffect(() => {
    if (!autoOpenQr) return;
    const timeout = window.setTimeout(() => {
      onTrack("QR_CODE_OPEN");
      setShowQrModal(true);
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salvar contato fica preservado para uma próxima etapa, mas fora da
  // interface enquanto o WhatsApp é a ação principal do cartão.
  // function handleSaveContact() {
  //   onTrack("VCARD_DOWNLOAD");
  //   window.location.href = `/api/public/cards/${slug}/vcard`;
  // }

  async function handleShare() {
    onTrack("SHARE_CLICK");
    const shareData = { title: `Cartão de ${displayName}`, text: `Contato de ${displayName}`, url: publicUrl };
    if (typeof navigator !== "undefined" && navigator.share) {
      // Nunca cai pro fallback de copiar link se o navigator.share existe —
      // mesmo se a pessoa CANCELAR a folha nativa (rejeita com AbortError),
      // isso é a decisão dela de não compartilhar, não um "não funcionou".
      // Antes, cancelar no iOS acabava copiando o link escondido mesmo
      // assim, parecendo compartilhar por trás depois dela dizer "não".
      try {
        await navigator.share(shareData);
      } catch {
        // AbortError (cancelou) ou qualquer outro erro — nos dois casos,
        // sem fallback: só faz sentido copiar quando NÃO existe share
        // nativo pra tentar, não quando ele existiu e não deu certo.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível
    }
  }

  const whatsappDigits = whatsapp ? ensureBrazilianMobileNinthDigit(normalizePhoneNumber(whatsapp)) : null;
  const whatsappHref = whatsappDigits ? `https://wa.me/${toDialNumber(whatsappDigits)}` : null;

  return (
    <>
      <div className="w-full space-y-2 max-w-full">
        {/*
        <button type="button" onClick={handleSaveContact}>
          Salvar Contato
        </button>
        */}
        {whatsappHref && (
          <a
            href={whatsappHref}
            onClick={() => onTrack("WHATSAPP_CLICK")}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-600 px-4 py-3.5 text-base font-bold text-white shadow-[0_8px_16px_rgba(5,150,105,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] transition-colors hover:bg-emerald-500 active:translate-y-px"
          >
            <WhatsappIcon className="h-5 w-5 shrink-0" />
            <span>WhatsApp</span>
          </a>
        )}

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
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors active:translate-y-px ${
              light
                ? "border-white bg-white/75 text-slate-800 shadow-[0_5px_10px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white"
                : "border-white/[0.09] bg-[#202733] text-white/90 shadow-[0_5px_10px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-[#27303d] hover:text-white"
            }`}
          >
            <QrCode className={`h-4 w-4 shrink-0 ${light ? "text-[#00aeee]" : "text-cyan-400"}`} strokeWidth={2.2} />
            <span>QR Code</span>
          </button>

          {/* Enviar / Compartilhar */}
          <button
            type="button"
            onClick={handleShare}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors active:translate-y-px ${
              light
                ? "border-white bg-white/75 text-slate-800 shadow-[0_5px_10px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white"
                : "border-white/[0.09] bg-[#202733] text-white/90 shadow-[0_5px_10px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-[#27303d] hover:text-white"
            }`}
          >
            {copied ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.5} />
            ) : (
              <Share2 className={`h-4 w-4 shrink-0 ${light ? "text-slate-600" : "text-white/80"}`} strokeWidth={2.2} />
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

