"use client";

import { useEffect, useState } from "react";
import { QrCode as QrCodeIcon, X } from "lucide-react";
import { QrCodeDisplay } from "@/components/digital-card/qr-code-display";
import { usePresentationSession } from "@/components/digital-card/use-presentation-session";

/**
 * "Meu QR Code" — o consultor abre isto na hora de apresentar
 * presencialmente pro cliente. Abrir o modal já inicia uma
 * DigitalCardPresentation (ver usePresentationSession); a pergunta
 * pós-apresentação aparece sozinha quando o tempo em primeiro plano cruza o
 * limiar (nunca um setTimeout cego — ver hook).
 *
 * `autoOpen` — usado pelo atalho "Cartão de visita" do menu do usuário
 * (ver components/user-menu.tsx + card-quick-view.tsx): quem clicou ali já
 * quer mostrar o cartão NA HORA, não navegar até achar o botão — abre
 * sozinho ao montar, sem precisar desse clique extra.
 */
export function QrCodePanel({ cardId, publicUrl, autoOpen = false }: { cardId: string; publicUrl: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const { presentationId, askVisible, likelyAccessed, responded, start, respond, dismissForNow } = usePresentationSession(cardId);

  // Achado na revisão: o QR mostrado aqui codificava só `publicUrl` puro —
  // o presentationId criado por start() (acima) nunca chegava até o
  // navegador de quem escaneia, então whatsappClicked/vcardDownloaded/
  // instagramClicked (ver DigitalCardPresentation no schema) nunca eram
  // preenchidos, e o CARD_VIEW do cliente nem ficava marcado como vindo de
  // QR (source). presentationId chega async (POST em start()) — o QR
  // recalcula sozinho assim que ele fica pronto (useEffect de
  // QrCodeDisplay já reage a mudança de `url`).
  const qrUrl = (() => {
    const params = new URLSearchParams({ src: "qr" });
    if (presentationId) params.set("pid", presentationId);
    return `${publicUrl}?${params.toString()}`;
  })();

  function handleOpen() {
    setOpen(true);
    start();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoOpen) handleOpen();
  }, []);

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Meu QR Code</h2>
      <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
        Abra na hora de apresentar seu cartão presencialmente pra um cliente.
      </p>
      <button type="button" onClick={handleOpen} className="btn-primary btn-sm">
        <QrCodeIcon className="h-3.5 w-3.5" strokeWidth={2.3} />
        Abrir QR Code
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div
            className="relative w-full max-w-xs rounded-2xl bg-white p-6 text-center dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="icon-btn absolute right-3 top-3 h-7 w-7"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.3} />
            </button>

            {!askVisible ? (
              <>
                <p className="mb-4 text-sm font-medium text-neutral-700 dark:text-neutral-300">Mostre a tela pro cliente</p>
                <div className="flex justify-center">
                  <QrCodeDisplay url={qrUrl} size={200} />
                </div>
              </>
            ) : (
              <div className="py-2">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">O cliente acessou seu cartão?</p>
                {likelyAccessed && (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Detectamos um acesso ao seu cartão nesse período — foi o cliente?
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  <button type="button" onClick={() => respond("ACCESSED")} className="btn-primary btn-sm w-full">
                    Acessou
                  </button>
                  <button type="button" onClick={() => respond("REFUSED")} className="btn-ghost w-full">
                    Não quis acessar
                  </button>
                  <button type="button" onClick={() => respond("SELF_VIEW")} className="btn-ghost w-full">
                    Só mostrei, não apresentei
                  </button>
                  <button
                    type="button"
                    onClick={dismissForNow}
                    className="w-full text-xs text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
                  >
                    Ainda não
                  </button>
                </div>
              </div>
            )}
            {responded && <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">Obrigado! Registrado.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
