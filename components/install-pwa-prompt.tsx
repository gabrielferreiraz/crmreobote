"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

const STORAGE_KEY = "pwa-install-prompt-next-show";
// Some depois de fechar/instalar e só volta a perguntar depois de alguns
// dias — "de vez em quando", nunca em toda visita.
const REASK_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function snoozeFor(ms: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + ms));
  } catch {
    // localStorage indisponível (modo privado etc.) — só não persiste, sem quebrar nada.
  }
}

/**
 * Aviso pequeno e não-bloqueante pra instalar o PWA — só no mobile (o
 * desktop já pode instalar pelo próprio ícone do navegador, sem precisar
 * empurrar isso). Android/Chrome captura o beforeinstallprompt e instala
 * com 1 toque; iOS não tem esse evento (Apple não permite), então só
 * explica o caminho manual (Compartilhar → Adicionar à Tela de Início).
 */
export function InstallPwaPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform("android");
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  useEffect(() => {
    if (isStandalone()) return;
    if (!window.matchMedia("(max-width: 1023.98px)").matches) return;

    let nextShowAt = 0;
    try {
      nextShowAt = Number(localStorage.getItem(STORAGE_KEY) || 0);
    } catch {
      // segue com 0 (nunca mostrado) se não der pra ler o localStorage
    }
    if (Date.now() < nextShowAt) return;

    if (isIos()) {
      setPlatform("ios");
      const timeout = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timeout);
    }

    // No Android o beforeinstallprompt pode chegar um instante depois do
    // carregamento — dá uma folga antes de checar se já temos ele guardado.
    const timeout = setTimeout(() => {
      setDeferredPrompt((current) => {
        if (current) setVisible(true);
        return current;
      });
    }, 1500);
    return () => clearTimeout(timeout);
  }, []);

  function dismiss() {
    snoozeFor(REASK_INTERVAL_MS);
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    // Aceitou ou recusou no diálogo nativo, os dois casos não precisam
    // perguntar de novo tão cedo.
    snoozeFor(REASK_INTERVAL_MS);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)] z-40 lg:hidden">
      <div
        className="surface-glass flex items-center gap-3 rounded-xl p-3 shadow-xl"
        style={{ animation: "modal-panel-in 200ms ease-out" }}
      >
        <img src="/icons/192" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Instalar app web</p>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {platform === "ios"
              ? 'Toque em Compartilhar e depois em "Adicionar à Tela de Início"'
              : "Acesso rápido, tela cheia, sem barra do navegador."}
          </p>
        </div>
        {platform === "android" && deferredPrompt && (
          <button type="button" onClick={install} className="btn-primary btn-sm shrink-0">
            <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
            Instalar
          </button>
        )}
        <button type="button" onClick={dismiss} className="icon-btn shrink-0" aria-label="Fechar aviso">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
