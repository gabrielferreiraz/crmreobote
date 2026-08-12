"use client";

import { useEffect, useState } from "react";
import type { GoogleEvent } from "@/app/(dashboard)/agenda/task-calendar";

type GoogleCalendarState = {
  /** true enquanto a 1ª resposta de /api/google-calendar/events ainda não chegou. */
  loading: boolean;
  connected: boolean;
  events: GoogleEvent[];
};

/**
 * Busca os eventos do Google Agenda DEPOIS que a página já carregou — ver
 * app/api/google-calendar/events/route.ts (mesma lógica que antes rodava
 * dentro do Promise.all do Server Component da Agenda, bloqueando a grade
 * principal até o Google responder). Começa com `connected: false` +
 * `loading: true`; quem usa isso deve tratar o estado de carregamento (ver
 * GoogleCalendarBanner) em vez de interpretar o valor inicial como "não
 * conectado" de verdade.
 */
export function useGoogleCalendarEvents(): GoogleCalendarState {
  const [state, setState] = useState<GoogleCalendarState>({ loading: true, connected: false, events: [] });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/google-calendar/events")
      .then((res) => (res.ok ? res.json() : { connected: false, events: [] }))
      .then((data: { connected?: boolean; events?: GoogleEvent[] }) => {
        if (cancelled) return;
        setState({ loading: false, connected: !!data.connected, events: data.events ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, connected: false, events: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
