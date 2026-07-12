"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";

export function TestEmailButton() {
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setState("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/test-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(data.error ?? "Falha ao enviar");
        return;
      }
      setState("ok");
      setMessage(`Enviado para ${data.to}`);
    } catch {
      setState("error");
      setMessage("Falha de conexão");
    }
  }

  return (
    <div className="flex items-center gap-3 p-4 text-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
        <Mail className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">Testar envio de e-mail</p>
        <p className="mt-0.5 text-sm text-neutral-400 dark:text-neutral-500">
          {message ?? "Confirma se o SMTP configurado (.env) está funcionando — manda pro seu próprio e-mail."}
        </p>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "sending"}
        className="btn-secondary btn-sm shrink-0"
      >
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : "Enviar teste"}
      </button>
    </div>
  );
}
