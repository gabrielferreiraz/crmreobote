"use client";

import { useEffect } from "react";

/**
 * Trava o scroll do body atrás de um modal em tela cheia (`fixed inset-0`)
 * — usado pelos modais do Cartão Digital (QR Code em digital-card-actions.tsx
 * e qr-code-panel.tsx, preview em tela cheia em card-editor.tsx).
 *
 * `overflow: hidden` sozinho no body NÃO basta no Safari iOS: é uma manha
 * antiga do WebKit em que touchmove ainda consegue rolar o conteúdo por
 * trás de um elemento `position: fixed` (o modal continua parado na tela,
 * mas o que está atrás dele desliza). Fixar o body na posição atual
 * (`position: fixed` + `top` negativo igual ao scroll) é o jeito que
 * realmente impede isso — e ao destravar, volta pro scroll exato de onde
 * parou (sem isso, o navegador reseta pro topo da página).
 */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const scrollY = window.scrollY;
    const { body } = document;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
