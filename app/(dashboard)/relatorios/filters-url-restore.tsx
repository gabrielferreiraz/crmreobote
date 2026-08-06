"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { buildQuickRanges } from "@/lib/date-ranges";
import { PIPELINE_FILTER_KEY, WHO_FILTER_KEY, DATE_RANGE_FILTER_KEY, PROCESS_PIPELINE_FILTER_KEY } from "./filters-storage";

/**
 * Componente invisível (renderiza null) — na montagem, se a URL chegou "em
 * branco" (sem pipelineId/who/from/to, ex.: clicou em "Relatórios" no menu
 * vindo de outra tela), preenche com o último filtro salvo no localStorage
 * desta tela. Se a URL já trouxer algum desses parâmetros explicitamente
 * (link compartilhado, voltar/avançar do navegador), respeita e não mexe —
 * só completa o que falta, numa única navegação (evita 3 componentes de
 * filtro brigando pra escrever a URL cada um por conta própria).
 */
export function FiltersUrlRestore() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    let changed = false;

    if (!params.has("pipelineId")) {
      try {
        const saved = localStorage.getItem(PIPELINE_FILTER_KEY);
        if (saved) {
          params.set("pipelineId", saved);
          changed = true;
        }
      } catch {}
    }

    if (!params.has("processPipelineId")) {
      try {
        const saved = localStorage.getItem(PROCESS_PIPELINE_FILTER_KEY);
        if (saved) {
          params.set("processPipelineId", saved);
          changed = true;
        }
      } catch {}
    }

    if (!params.has("who")) {
      try {
        const saved = localStorage.getItem(WHO_FILTER_KEY);
        if (saved) {
          params.set("who", saved);
          changed = true;
        }
      } catch {}
    }

    if (!params.has("from") && !params.has("to")) {
      let restoredFromStorage = false;
      try {
        const raw = localStorage.getItem(DATE_RANGE_FILTER_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { from?: string; to?: string };
          if (saved.from) {
            params.set("from", saved.from);
            changed = true;
            restoredFromStorage = true;
          }
          if (saved.to) {
            params.set("to", saved.to);
            changed = true;
            restoredFromStorage = true;
          }
        }
      } catch {}

      // Ninguém nunca escolheu nada aqui (1ª visita, ou localStorage vazio) —
      // cai no atalho "Este mês" em vez de ficar sem filtro de data nenhum
      // (que varre o histórico inteiro da organização; ver o mesmo padrão em
      // page.tsx). Quem realmente quiser "Tudo" continua podendo escolher no
      // filtro — essa escolha, sim, é respeitada e nunca sobrescrita aqui.
      if (!restoredFromStorage) {
        const thisMonth = buildQuickRanges().find((q) => q.key === "this-month")!.range();
        params.set("from", thisMonth.from);
        params.set("to", thisMonth.to);
        changed = true;
      }
    }

    if (changed) {
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
