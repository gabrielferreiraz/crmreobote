import { useLayoutEffect, useEffect, useState, type RefObject } from "react";

export type FloatingCoords = {
  /** Presente quando abre pra BAIXO do gatilho (o padrão). */
  top?: number;
  /** Presente quando abre pra CIMA do gatilho (pouco espaço embaixo, mais em cima — ver openUpward). Nunca os dois ao mesmo tempo. */
  bottom?: number;
  left?: number;
  right?: number;
  width: number;
  /**
   * Altura MÁXIMA segura, calculada a partir de quanto espaço sobra de
   * verdade na tela até a borda (pra baixo ou pra cima, o lado que foi
   * escolhido) — nunca um valor fixo tipo "80vh" cego à posição do
   * gatilho. Um gatilho perto do fim da página só tem uns 60px de sobra
   * até a borda da tela, por exemplo; um max-height que ignora isso e só
   * limita relativo à tela INTEIRA (100vh - alguma_margem) ainda estoura
   * pra fora, porque o painel começa (`top`) já perto do fim. Quem usa
   * isso deve aplicar como `max-height` no painel (e ter scroll próprio
   * por dentro pro conteúdo que não couber).
   */
  maxHeight: number;
};

// Nunca fica menor que isso mesmo espremido contra a borda — abaixo disso
// o painel vira inútil (não dá nem pra ver uma opção inteira).
const MIN_PANEL_HEIGHT = 160;
// Respiro até a borda da tela — nunca encosta, mesmo no limite.
const SCREEN_MARGIN = 8;

/**
 * Posiciona (via coordenadas de tela, pra usar com createPortal) e fecha um
 * dropdown/popover que precisa "escapar" de qualquer ancestral com overflow
 * (modal, painel lateral, ou o <main> sem scroll das rotas "app shell" como
 * Pipeline) — sem isso, `position: absolute` relativo ao próprio gatilho é
 * cortado pelo ancestral assim que o gatilho fica perto da borda dele.
 *
 * Também decide abrir pra CIMA em vez de pra baixo quando sobra pouco
 * espaço embaixo do gatilho e mais espaço em cima (mesma lógica de
 * qualquer menu/combobox nativo) — sem isso, um gatilho perto do fim da
 * página sempre abria pra baixo e ficava sem espaço nenhum, não importa
 * quanto o CSS tentasse limitar a altura.
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
      const spaceBelow = window.innerHeight - rect.bottom - 4 - SCREEN_MARGIN;
      const spaceAbove = rect.top - 4 - SCREEN_MARGIN;
      const openUpward = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow;
      const maxHeight = Math.max(MIN_PANEL_HEIGHT, openUpward ? spaceAbove : spaceBelow);
      const vertical = openUpward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 };
      const horizontal = align === "right" ? { right: window.innerWidth - rect.right } : { left: rect.left };
      setCoords({ ...vertical, ...horizontal, width: rect.width, maxHeight });
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
      // Um <Select> (ou outro dropdown que também use este hook) DENTRO
      // deste painel renderiza a própria lista de opções via portal direto
      // no body — não é descendente de panelRef no DOM, mesmo aparecendo
      // visualmente dentro dele. Sem essa checagem, clicar numa opção
      // fecha ESTE painel antes do onChange do Select de dentro disparar
      // (ver FilterPopover, que aninha Select).
      if (target instanceof HTMLElement && target.closest('[role="listbox"]')) return;
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
