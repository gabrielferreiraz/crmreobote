"use client";

import { useState } from "react";
import { Download, Share2, Check } from "lucide-react";

type Props = {
  slug: string;
  displayName: string;
  publicUrl: string;
  sessionId: string | null;
  source: string | null;
  onTrack: (eventType: string) => void;
};

/**
 * "Salvar Contato" (baixa o .vcf gerado na hora — nunca armazenado, ver
 * app/api/public/cards/[slug]/vcard/route.ts) e "Enviar Cartão" (Web Share
 * API quando disponível, com fallback "Copiar link" — sempre o MESMO link
 * público permanente, nunca uma URL interna do CRM).
 */
export function DigitalCardActions({ slug, displayName, publicUrl, sessionId, source, onTrack }: Props) {
  const [copied, setCopied] = useState(false);

  function handleSaveContact() {
    onTrack("VCARD_DOWNLOAD");
    const params = new URLSearchParams();
    if (sessionId) params.set("sid", sessionId);
    if (source) params.set("src", source);
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
        // usuário cancelou o share nativo — cai pro fallback de copiar
      }
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível — sem fallback melhor sem um input visível
    }
  }

  return (
    <div className="flex items-center gap-3">
      {/* Dominante — mesma hierarquia da referência (Salvar Contato é a ação principal, ocupa a maior parte da largura). */}
      <button
        type="button"
        onClick={handleSaveContact}
        className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#00aeee] px-4 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
      >
        <Download className="h-4 w-4" strokeWidth={2.3} />
        Salvar Contato
      </button>
      {/* Secundária — ícone sobre rótulo, sem fundo (mesmo peso visual leve da referência). */}
      <button
        type="button"
        onClick={handleShare}
        className="flex shrink-0 flex-col items-center gap-1 px-1 text-white/70 transition-colors hover:text-white"
      >
        {copied ? <Check className="h-5 w-5" strokeWidth={2} /> : <Share2 className="h-5 w-5" strokeWidth={2} />}
        <span className="text-[11px] font-medium">{copied ? "Copiado" : "Enviar Cartão"}</span>
      </button>
    </div>
  );
}
