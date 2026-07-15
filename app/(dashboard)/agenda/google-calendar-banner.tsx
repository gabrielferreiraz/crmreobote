"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar as CalendarIcon, CheckCircle2 } from "lucide-react";

/**
 * Convite/feedback de conexão do Google Agenda direto na tela da Agenda —
 * mesmo fluxo OAuth de Configurações → Perfil (ver components/google-calendar-connect.tsx),
 * só que volta pra cá no final (?redirect=/agenda em authorize/route.ts).
 * `googleParam` congelado em estado (não usa a prop ao vivo) igual ao
 * GoogleCalendarConnect — senão a mensagem some assim que o router.replace
 * abaixo limpa a URL.
 */
export function GoogleCalendarBanner({
  isGoogleConnected,
  googleParam,
}: {
  isGoogleConnected: boolean;
  googleParam?: string;
}) {
  const router = useRouter();
  const [param] = useState(googleParam);

  useEffect(() => {
    if (googleParam) router.replace("/agenda");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (param === "connected") {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        Conta Google conectada com sucesso — os compromissos já aparecem na Agenda.
      </p>
    );
  }
  if (param === "denied") {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Conexão cancelada — nenhuma permissão foi concedida.
      </p>
    );
  }
  if (param === "error") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Não foi possível conectar o Google Agenda. Tente novamente.
      </p>
    );
  }

  if (isGoogleConnected) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
        Google Agenda integrado
      </span>
    );
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
      <div className="flex items-center gap-2.5">
        <CalendarIcon className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
        <div>
          <p className="font-medium text-neutral-800 dark:text-neutral-200">Conecte seu Google Agenda</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Veja os compromissos do Google direto aqui na Agenda do CRM.
          </p>
        </div>
      </div>
      <a href="/api/google-calendar/authorize?redirect=/agenda" className="btn-secondary btn-sm shrink-0">
        Conectar
      </a>
    </div>
  );
}
