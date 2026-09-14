"use client";

import { useCallback, useMemo } from "react";

const SESSION_STORAGE_KEY = "reobote-card-visitor-id";

/**
 * Id anônimo de visitante — só pra estimar visitantes únicos (ver
 * DigitalCardEvent.sessionId no schema), NUNCA um fingerprint. Gerado uma
 * vez, guardado em localStorage (sobrevive entre páginas do mesmo cartão,
 * nunca é enviado a lugar nenhum além do nosso próprio evento). Tudo dentro
 * de try/catch — modo privado/Safari pode bloquear localStorage, e isso
 * nunca pode quebrar a página do visitante.
 */
function getOrCreateVisitorId(): string | null {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Dispara um evento de clique pro backend (ver
 * app/api/public/cards/[slug]/events/route.ts) — nunca bloqueia a ação
 * principal do visitante (o link/WhatsApp/mapa já abre ANTES da resposta
 * chegar, `keepalive: true` garante que a requisição sobrevive mesmo se a
 * aba perder foco/fechar logo em seguida por causa da navegação).
 */
export function useCardTracking(slug: string, source: string | null, presentationId: string | null) {
  const sessionId = useMemo(() => (typeof window !== "undefined" ? getOrCreateVisitorId() : null), []);

  const track = useCallback(
    (eventType: string) => {
      try {
        fetch(`/api/public/cards/${slug}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ eventType, sessionId, source, presentationId }),
        }).catch(() => {});
      } catch {
        // nunca deixa uma falha de rede atrapalhar a ação do visitante
      }
    },
    [slug, sessionId, source, presentationId],
  );

  return { track, sessionId };
}
