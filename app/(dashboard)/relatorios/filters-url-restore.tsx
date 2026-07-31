"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PIPELINE_FILTER_KEY, WHO_FILTER_KEY, DATE_RANGE_FILTER_KEY } from "./filters-storage";

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
      try {
        const raw = localStorage.getItem(DATE_RANGE_FILTER_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { from?: string; to?: string };
          if (saved.from) {
            params.set("from", saved.from);
            changed = true;
          }
          if (saved.to) {
            params.set("to", saved.to);
            changed = true;
          }
        }
      } catch {}
    }

    if (changed) {
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
