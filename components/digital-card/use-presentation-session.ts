"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ~2-3min de tempo em PRIMEIRO PLANO de verdade (não tempo de relógio) —
// pedido explícito: "não implementar isso simplesmente com um setTimeout
// cego de 180 segundos". O consultor normalmente segura a tela ligada
// mostrando o QR pro cliente, então isso acumula naturalmente durante a
// apresentação de verdade; se ele sair da tela (responder uma ligação,
// trocar de app), o contador pausa e só retoma quando ele volta.
const ASK_THRESHOLD_MS = 2.5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5000;

export type PresentationResponse = "ACCESSED" | "REFUSED" | "SELF_VIEW";

/**
 * Sessão de apresentação presencial — abre quando o consultor entra na tela
 * "Meu QR Code" (ver app/(dashboard)/configuracoes/meu-cartao/qr-code-panel.tsx),
 * acumula tempo em primeiro plano via Page Visibility API, e sinaliza
 * `askVisible` quando é hora de perguntar "o cliente acessou?".
 * `likelyAccessed` é só uma DICA (houve CARD_VIEW deste cartão durante a
 * apresentação?) — nunca a resposta em si.
 */
export function usePresentationSession(cardId: string) {
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [askVisible, setAskVisible] = useState(false);
  const [likelyAccessed, setLikelyAccessed] = useState(false);
  const [responded, setResponded] = useState(false);

  const foregroundMsRef = useRef(0);
  const lastVisibleAtRef = useRef<number | null>(null);
  const askedRef = useRef(false);

  const start = useCallback(async () => {
    setResponded(false);
    setAskVisible(false);
    setLikelyAccessed(false);
    askedRef.current = false;
    foregroundMsRef.current = 0;

    const res = await fetch(`/api/digital-cards/${cardId}/presentations`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    setPresentationId(data.id as string);
    lastVisibleAtRef.current = typeof document !== "undefined" && document.visibilityState === "visible" ? Date.now() : null;
  }, [cardId]);

  useEffect(() => {
    if (!presentationId || responded) return;

    function flush() {
      if (lastVisibleAtRef.current != null) {
        foregroundMsRef.current += Date.now() - lastVisibleAtRef.current;
        lastVisibleAtRef.current = Date.now();
      }
      if (!askedRef.current && foregroundMsRef.current >= ASK_THRESHOLD_MS) {
        askedRef.current = true;
        setAskVisible(true);
        fetch(`/api/digital-cards/${cardId}/presentations/${presentationId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => setLikelyAccessed(!!data?.likelyAccessed))
          .catch(() => {});
      }
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        lastVisibleAtRef.current = Date.now();
      } else {
        flush();
        lastVisibleAtRef.current = null;
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [presentationId, cardId, responded]);

  const respond = useCallback(
    async (response: PresentationResponse) => {
      if (!presentationId) return;
      await fetch(`/api/digital-cards/${cardId}/presentations/${presentationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      }).catch(() => {});
      setAskVisible(false);
      setResponded(true);
    },
    [cardId, presentationId],
  );

  /** "Ainda não" — não força resposta, só adia a pergunta pro próximo limiar de tempo em primeiro plano. */
  const dismissForNow = useCallback(() => {
    setAskVisible(false);
    askedRef.current = false;
    foregroundMsRef.current = 0;
  }, []);

  return { presentationId, askVisible, likelyAccessed, responded, start, respond, dismissForNow };
}
