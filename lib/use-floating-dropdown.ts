import { useLayoutEffect, useEffect, useState, type RefObject } from "react";

export type FloatingCoords = { top: number; left?: number; right?: number; width: number };

/**
 * Posiciona (via coordenadas de tela, pra usar com createPortal) e fecha um
 * dropdown/popover que precisa "escapar" de qualquer ancestral com overflow
 * (modal, painel lateral) — sem isso, `position: absolute` relativo ao
 * próprio gatilho é cortado pelo `overflow-y-auto` do ancestral assim que o
 * gatilho fica perto da borda dele (ex.: Select perto do fim de um formulário
 * dentro de Modal — a lista de opções aparecia cortada, faltando item).
 */
export function useFloatingDropdown({
  open,
  onClose,
  triggerRef,
  panelRef,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  align?: "left" | "right";
}): FloatingCoords | null {
  const [coords, setCoords] = useState<FloatingCoords | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setCoords(null);
      return;
    }
    function update() {
      const rect = triggerRef.current!.getBoundingClientRect();
      setCoords(
        align === "right"
          ? { top: rect.bottom + 4, right: window.innerWidth - rect.right, width: rect.width }
          : { top: rect.bottom + 4, left: rect.left, width: rect.width },
      );
    }
    update();
    // captura=true pra pegar scroll de QUALQUER ancestral rolável (não só a
    // janela) — é exatamente o scroll do modal que precisa reposicionar isto.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  return coords;
}
