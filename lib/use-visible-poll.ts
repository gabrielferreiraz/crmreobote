"use client";

import { useEffect, useRef } from "react";

/**
 * Polling que só roda com a aba VISÍVEL — e que busca na hora ao voltar pra
 * aba, em vez de esperar o próximo tique.
 *
 * Por que existe: vários pollers do CRM ficam montados o tempo todo (o sino
 * e as dicas de produtividade estão no layout, então existem em TODA página;
 * Conversas/chat recarregam a cada 45s). Sem checar visibilidade, uma aba
 * esquecida aberta a tarde inteira continua batendo no servidor pra sempre —
 * e cada uma dessas chamadas vira consulta no Postgres, que já custa ~4,7
 * idas-e-voltas por causa da transação de RLS (ver withTenantRls em
 * lib/prisma.ts). Com 20 pessoas de aba aberta, isso é carga contínua de
 * graça, que só cresce com o time.
 *
 * O `visibilitychange` não é só economia: buscar imediatamente na volta
 * deixa o dado MAIS fresco do que o polling cego deixava (antes dava pra
 * voltar pra aba e olhar até um intervalo inteiro de dado velho achando que
 * estava atualizado).
 *
 * `fn` é guardado em ref — assim quem chama pode passar uma função nova a
 * cada render (o caso comum) sem reiniciar o intervalo a cada render.
 */
export function useVisiblePoll(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    function run() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      fnRef.current();
    }

    run();
    const interval = setInterval(run, intervalMs);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") run();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);
}
