"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { QrCode as QrCodeIcon, X } from "lucide-react";
import { QrCodeDisplay } from "@/components/digital-card/qr-code-display";
import { usePresentationSession } from "@/components/digital-card/use-presentation-session";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";

/**
 * Botão "QR Code" — o consultor abre na hora de apresentar presencialmente.
 * Abrir já inicia uma DigitalCardPresentation (ver usePresentationSession);
 * a pergunta "o cliente acessou?" aparece sozinha depois de um tempo com a
 * tela em primeiro plano (nunca um setTimeout cego — ver o hook).
 *
 * O modal vai por portal pro <body>: o botão mora dentro de uma seção do
 * editor, e um `position: fixed` dentro de algo com `backdrop-filter`/
 * `transform` fica preso naquela caixa em vez de cobrir a tela.
 */
export function QrCodePanel({
  cardId,
  publicUrl,
  className = "",
}: {
  cardId: string;
  publicUrl: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useLockBodyScroll(open);
  const { presentationId, askVisible, likelyAccessed, responded, start, respond, dismissForNow } = usePresentationSession(cardId);

  // O QR leva o presentationId (chega async do POST em start()) — é o que
  // liga o acesso de quem escaneou a esta apresentação (cliques no
  // WhatsApp/contato salvo). QrCodeDisplay redesenha quando a url muda.
  const qrUrl = (() => {
    const params = new URLSearchParams({ src: "qr" });
    if (presentationId) params.set("pid", presentationId);
    return `${publicUrl}?${params.toString()}`;
  })();

  function handleOpen() {
    setOpen(true);
    start();
  }

  return (
    <>
      <button type="button" onClick={handleOpen} className={`btn-primary h-11 justify-center ${className}`}>
        <QrCodeIcon className="h-4 w-4" strokeWidth={2.3} />
        QR Code
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="QR Code do cartão"
          >
            <div className="relative w-full max-w-xs rounded-2xl bg-white p-6 text-center dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="icon-btn absolute top-3 right-3 h-9 w-9">
                <X className="h-4 w-4" strokeWidth={2.3} />
              </button>

              {!askVisible ? (
                <>
                  <p className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">Aponte a câmera</p>
                  <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">O cliente abre seu cartão na hora.</p>
                  <div className="flex justify-center">
                    <QrCodeDisplay url={qrUrl} size={220} />
                  </div>
                </>
              ) : (
                <div className="py-2">
                  <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">O cliente abriu seu cartão?</p>
                  {likelyAccessed && <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">Teve um acesso agora há pouco.</p>}
                  <div className="mt-4 space-y-2">
                    <button type="button" onClick={() => respond("ACCESSED")} className="btn-primary h-11 w-full justify-center">
                      Abriu
                    </button>
                    <button type="button" onClick={() => respond("REFUSED")} className="btn-secondary h-11 w-full justify-center">
                      Não quis
                    </button>
                    <button type="button" onClick={() => respond("SELF_VIEW")} className="btn-ghost h-11 w-full justify-center">
                      Só mostrei
                    </button>
                    <button
                      type="button"
                      onClick={dismissForNow}
                      className="w-full py-2 text-sm text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                    >
                      Ainda não
                    </button>
                  </div>
                </div>
              )}
              {responded && <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Anotado.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
