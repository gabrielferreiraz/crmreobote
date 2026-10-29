"use client";

import { useLayoutEffect } from "react";

const RULES_MAX_PX = 11;
const RULES_MIN_PX = 6.5;
const STEP_PX = 0.25;

function overflows(sheet: HTMLElement) {
  return sheet.scrollHeight > sheet.clientHeight + 1;
}

/**
 * Garante a folha em UMA página: usa a maior letra das regras que couber,
 * de 11 px até 6,5 px; se ainda não couber, aperta o
 * espaçamento das linhas da tabela e tenta de novo. Também reduz só a
 * visualização (zoom) em telas mais estreitas que a folha, sem mudar o layout.
 */
export function SheetFit() {
  useLayoutEffect(() => {
    const sheet = document.querySelector<HTMLElement>(".servopa-sheet");
    if (!sheet) return;

    function fitContent() {
      if (!sheet) return;
      sheet.style.removeProperty("--servopa-preview-zoom");
      for (const compact of ["0", "1"]) {
        sheet.dataset.compact = compact;
        for (let size = RULES_MAX_PX; size >= RULES_MIN_PX; size -= STEP_PX) {
          sheet.style.setProperty("--servopa-rules-size", `${size}px`);
          if (!overflows(sheet)) return;
        }
      }
    }

    function fitPreview() {
      if (!sheet) return;
      sheet.style.removeProperty("--servopa-preview-zoom");
      const available = document.documentElement.clientWidth - 16;
      const zoom = Math.min(1, available / sheet.offsetWidth);
      if (zoom < 1) sheet.style.setProperty("--servopa-preview-zoom", zoom.toFixed(3));
      else sheet.style.removeProperty("--servopa-preview-zoom");
    }

    let cancelled = false;
    fitContent();
    fitPreview();
    // A fonte da página pode terminar de carregar depois: mede de novo.
    void document.fonts?.ready.then(() => {
      if (cancelled) return;
      fitContent();
      fitPreview();
    });
    window.addEventListener("resize", fitPreview);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", fitPreview);
    };
  }, []);

  return null;
}
