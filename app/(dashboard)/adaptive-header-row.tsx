"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Decide entre busca/"Novo negócio" completos ou só ícone medindo de
 * verdade se cabe, em vez de chutar um breakpoint de largura de tela (2
 * tentativas anteriores erraram a conta — a largura real depende de fonte,
 * zoom, nomes de página etc., não dá pra prever só por CSS). O nome de cada
 * página (`nav`) nunca encolhe nem vira ícone — só `fullActions`/
 * `compactActions` (busca + "Novo negócio") cede espaço primeiro.
 *
 * `fixedActions` (sino + avatar) nunca muda de tamanho — entra na conta da
 * medição, mas não é clonado (ver abaixo o motivo do clone só de
 * `fullActions`).
 */
export function AdaptiveHeaderRow({
  nav,
  fullActions,
  compactActions,
  fixedActions,
}: {
  nav: React.ReactNode;
  fullActions: React.ReactNode;
  compactActions: React.ReactNode;
  fixedActions: React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const fullActionsRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const navEl = navRef.current;
    const fixedEl = fixedRef.current;
    const fullEl = fullActionsRef.current;
    if (!row || !navEl || !fixedEl || !fullEl) return;

    // Mede contra o clone invisível de `fullActions` (não o que está
    // renderizado agora) de propósito — comparar "cabe o cheio de verdade?"
    // sempre com o mesmo valor fixo evita ficar oscilando entre
    // cheio/compacto a cada frame (compactar abre espaço → mediria "cabe"
    // nesse espaço menor → voltaria a cheio → apertaria de novo → repete).
    function measure() {
      const needed = navEl!.scrollWidth + fullEl!.scrollWidth + fixedEl!.scrollWidth;
      setCompact(needed > row!.clientWidth);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rowRef} className="flex min-w-0 flex-1 items-center justify-between gap-6">
      <div ref={navRef} className="min-w-0">
        {nav}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {compact ? compactActions : fullActions}
        <div ref={fixedRef} className="flex shrink-0 items-center gap-3">
          {fixedActions}
        </div>
      </div>
      {/* Clone só pra medir — nunca visível, nunca clicável, fora do fluxo
          (não empurra nada ao lado, não duplica listener de componente
          nenhum porque só entra aqui o que muda de tamanho). */}
      <div ref={fullActionsRef} className="pointer-events-none invisible absolute -z-10 flex items-center gap-3" aria-hidden="true">
        {fullActions}
      </div>
    </div>
  );
}
