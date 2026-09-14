"use client";

import { useState } from "react";
import { Download, Share2, Check, Copy } from "lucide-react";

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
    <div className="grid grid-cols-2 gap-2.5">
      <button
        type="button"
        onClick={handleSaveContact}
        className="flex items-center justify-center gap-2 rounded-xl bg-[#00aeee] px-4 py-3 text-sm font-semibold text-neutral-950 transition-opacity hover:opacity-90 active:opacity-80"
      >
        <Download className="h-4 w-4" strokeWidth={2.3} />
        Salvar Contato
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4" strokeWidth={2.3} />
            Copiado
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" strokeWidth={2.3} />
            Enviar Cartão
          </>
        )}
      </button>
      {copied && (
        <p className="col-span-2 flex items-center justify-center gap-1 text-xs text-white/50">
          <Copy className="h-3 w-3" /> Link copiado — cole onde quiser compartilhar
        </p>
      )}
    </div>
  );
}
