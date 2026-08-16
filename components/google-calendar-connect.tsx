"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar as CalendarIcon, Loader2, TriangleAlert, Unplug } from "lucide-react";

type Status = "loading" | "disconnected" | "connected";

/**
 * Conexão OAuth do Google Agenda — mesmo espírito do WhatsAppConnect, mas o
 * "conectar" é uma navegação de verdade (tela de consentimento do Google),
 * não polling de QR Code. `initialGoogleParam` vem do Server Component (ver
 * app/(dashboard)/configuracoes/perfil/page.tsx) em vez de useSearchParams()
 * aqui — evita precisar de Suspense só por causa disso, mesmo padrão já
 * usado em agenda/page.tsx pro parâmetro `novo`.
 */
export function GoogleCalendarConnect({ initialGoogleParam }: { initialGoogleParam?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);
  // null enquanto não sabemos ainda (ou desconectado) — só é true/false com
  // uma conexão de verdade carregada (ver GET /api/google-calendar/status).
  const [hasWriteScope, setHasWriteScope] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleParam, setGoogleParam] = useState(initialGoogleParam);

  async function refreshStatus() {
    const res = await fetch("/api/google-calendar/status");
    if (!res.ok) return;
    const data = await res.json();
    setEmail(data.email ?? null);
    setStatus(data.connected ? "connected" : "disconnected");
    setHasWriteScope(data.hasWriteScope ?? null);
  }

  useEffect(() => {
    refreshStatus();
    if (googleParam) {
      // Limpa o parâmetro da URL depois de ler — evita mostrar a mesma
      // mensagem de novo se a pessoa atualizar a página.
      router.replace("/configuracoes/perfil");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/google-calendar/disconnect", { method: "POST" });
      setStatus("disconnected");
      setEmail(null);
      setHasWriteScope(null);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <p className="text-sm text-neutral-400 dark:text-neutral-500">Verificando…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Google Agenda</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {status === "connected" ? `Conectado${email ? ` — ${email}` : ""}` : "Nenhuma conta conectada"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <button onClick={disconnect} disabled={busy} className="btn-secondary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Unplug className="h-4 w-4" strokeWidth={2} />}
            Desconectar
          </button>
        ) : (
          <a href="/api/google-calendar/authorize" className="btn-primary">
            <CalendarIcon className="h-4 w-4" strokeWidth={2} />
            Conectar
          </a>
        )}
      </div>

      {googleParam === "connected" && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Conta Google conectada com sucesso.</p>
      )}
      {googleParam === "denied" && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Conexão cancelada — nenhuma permissão foi concedida.</p>
      )}
      {googleParam === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">Não foi possível conectar. Tente novamente.</p>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {status === "connected" && hasWriteScope === false && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <p>
            Esta conexão foi feita antes do agendamento automático de reunião existir e só tem permissão de
            <strong className="font-medium"> leitura</strong>. Reuniões marcadas pela landing page não estão sendo
            criadas no seu Google Agenda até você <strong className="font-medium">desconectar e conectar de novo</strong> —
            a reserva no CRM continua acontecendo normalmente, só não aparece automaticamente no Google.
          </p>
        </div>
      )}

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        Lemos os eventos da sua agenda pra mostrar na Agenda do CRM, e criamos o evento da reunião quando um lead
        agenda um horário pela landing page (Configurações → API e webhooks) — nunca editamos nem apagamos nada que
        você mesmo criou direto no Google.
      </p>
    </div>
  );
}
