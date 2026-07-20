"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { usePushSubscription } from "@/lib/use-push-subscription";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";

export function PushNotificationsPrompt() {
  const { status, loading, subscribe } = usePushSubscription();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      const dismissed = sessionStorage.getItem("push_prompt_dismissed");
      if (!dismissed) {
        const timer = setTimeout(() => {
          setOpen(true);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [status]);

  async function handleAccept() {
    await subscribe();
    setOpen(false);
  }

  function handleDismiss() {
    sessionStorage.setItem("push_prompt_dismissed", "true");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <Modal onClose={handleDismiss}>
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/15">
          <Bell className="h-4 w-4 text-red-600 dark:text-red-400 animate-bounce" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Ativar Notificações do CRM
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Receba alertas em tempo real sobre novas tarefas, mensagens do WhatsApp e atualizações importantes de seus negócios.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={handleDismiss} className="btn-ghost text-xs">
          Agora não
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={loading}
          className="btn-primary text-xs"
        >
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Ativando
              <LoadingDots />
            </span>
          ) : (
            "Permitir notificações"
          )}
        </button>
      </div>
    </Modal>
  );
}
