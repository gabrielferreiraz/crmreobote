"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Maximize2, Minimize2 } from "lucide-react";

export type RankingCardData = {
  id: string;
  icon: ReactNode;
  title: string;
  /** Canto direito do cabeçalho, ao lado do ícone de arrastar — ex.: a % de "Taxa de comparecimento". */
  headerExtra?: ReactNode;
  /** Entre o cabeçalho e a lista — ex.: o resumo de "Propostas enviadas". */
  subheader?: ReactNode;
  body: ReactNode;
};

const STORAGE_KEY = "crm:relatorios:ranking-order";

/** A ordem salva, só com ids que ainda existem hoje — um card novo que o código passar a
 * mandar no futuro (ou um que sumiu) nunca quebra a leitura, só entra/sai no fim. */
function loadOrder(ids: string[]): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ids;
    const saved = JSON.parse(raw) as unknown;
    if (!Array.isArray(saved)) return ids;
    const known = new Set(ids);
    const savedIds = saved.filter((id): id is string => typeof id === "string" && known.has(id));
    const missing = ids.filter((id) => !savedIds.includes(id));
    return [...savedIds, ...missing];
  } catch {
    return ids; // localStorage indisponível (modo privado, quota) — segue na ordem padrão
  }
}

function SortableCard({
  card,
  expanded,
  pinned,
  onHover,
  onLeave,
  onToggle,
  onPin,
}: {
  card: RankingCardData;
  expanded: boolean;
  pinned: boolean;
  onHover: (id: string) => void;
  onLeave: (id: string) => void;
  onToggle: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    transition: { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 2 : expanded ? 1 : undefined };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-expanded={expanded}
      onMouseEnter={() => onHover(card.id)}
      onMouseLeave={() => onLeave(card.id)}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-ranking-action]") || (!expanded && target.closest("[data-ranking-select]"))) onPin(card.id);
      }}
      className={`card group/ranking flex shrink-0 flex-col p-4 transition-[width,border-color,box-shadow] duration-500 ease-smooth motion-reduce:transition-none sm:p-5 ${
        expanded ? "w-[min(94vw,720px)] border-brand/40 shadow-lg dark:border-brand/50" : "w-[min(82vw,320px)]"
      }`}
    >
      {/* items-start (não items-center) + min-h de 2 linhas no bloco do título: um
          título de 1 linha ao lado de outro de 2 desalinhava onde cada card começa
          a listar gente — o rank "1" de um ficava mais alto que o de outro vizinho
          (pedido explícito: "está tudo desalinhado"). Com a altura do cabeçalho
          travada em 2 linhas pra TODOS, o corpo sempre começa na mesma régua,
          título curto ou longo. O filete embaixo fecha o cabeçalho como um bloco
          próprio, separado da lista — mesmo recurso já usado nos títulos de
          seção do PDF de proposta (ver components/proposals/proposal-document.tsx),
          reaproveitado aqui pela mesma razão: corta a sensação de tudo grudado. */}
      <div className="mb-3 flex shrink-0 items-start justify-between gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
        <div className="flex min-h-10 min-w-0 items-start gap-2.5">
          {/* mt-0.5: no topo (items-start), o ícone de 16px fica meio alto sem esse
              empurrão — alinha com a altura-x da 1ª linha do título. */}
          <span className="mt-0.5 shrink-0 text-brand">{card.icon}</span>
          <h3 className="line-clamp-2 text-base font-semibold text-neutral-900 group-data-[expanded=true]/ranking:text-lg dark:text-neutral-100">{card.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {card.headerExtra}
          <button
            type="button"
            onClick={() => onToggle(card.id)}
            className="icon-btn text-neutral-500 hover:text-brand dark:text-neutral-400 dark:hover:text-brand"
            title={pinned ? "Recolher ranking" : "Manter ranking expandido"}
            aria-label={`${pinned ? "Recolher" : "Expandir"} ${card.title}`}
            aria-pressed={pinned}
          >
            {pinned ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {/* O arraste fica no ícone para não disputar o gesto de rolagem da lista. */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="icon-btn cursor-grab touch-none text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            title="Arrastar para reordenar"
            aria-label={`Arrastar "${card.title}" para reordenar entre os rankings`}
          >
            <GripVertical className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
      {expanded && card.subheader}
      {card.body}
    </div>
  );
}

/**
 * Os cards do ranking do time, numa fileira ÚNICA que rola de lado (nunca
 * quebra linha) — pedido explícito do usuário: "era apenas um scroll lateral,
 * segurando shift daria pra ver os outros rankings". overflow-x-auto sozinho
 * já basta pro navegador: Shift+roda do mouse e o gesto de arrastar de lado no
 * trackpad/touch já rolam horizontal de graça, sem handler nenhum daqui (mesmo
 * princípio de app/(dashboard)/top-nav-links.tsx).
 *
 * Cada card também arrasta pelo ícone ⠿ pra mudar de posição NA fileira,
 * passando por cima dos outros — a ordem escolhida fica salva só NESTE
 * navegador (localStorage, mesmo padrão de lib/use-persisted-filters.ts), sem
 * afetar o que outra pessoa vê. horizontalListSortingStrategy (não rect/
 * vertical) porque agora é mesmo uma lista de um eixo só, não uma grade que
 * quebra linha.
 *
 * Os cards têm largura compacta estável e se alargam na própria fileira
 * quando recebem hover ou são fixados pelo botão de expansão.
 */
export function RankingCardsGrid({ cards }: { cards: RankingCardData[] }) {
  const ids = cards.map((c) => c.id);
  const idsKey = ids.join("|");
  const [order, setOrder] = useState(ids);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Só no cliente, depois da montagem — o 1º render (inclusive o do servidor)
  // usa a ordem padrão do código, então não há descompasso de hidratação; a
  // troca pra ordem salva acontece um instante depois, como o filtro persistido.
  useEffect(() => {
    // Leitura síncrona do localStorage na montagem — mesmo padrão/motivo de lib/use-persisted-filters.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(loadOrder(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    setHoveredId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id)));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Idem loadOrder — não persistir não pode quebrar o arrastar em si.
      }
      return next;
    });
  }

  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered = order.map((id) => byId.get(id)).filter((c): c is RankingCardData => !!c);
  const expandedId = pinnedId ?? hoveredId;

  return (
    <DndContext
      id="ranking-cards"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setDraggingId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setDraggingId(null); setHoveredId(null); }}
    >
      <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        {/* pb-3 (não pb-0) dá lugar pra barra de rolagem fina sem colar na borda
            de baixo dos cards — mesmo ajuste de app/(dashboard)/pipeline/kanban-board.tsx. */}
        <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-4 sm:gap-4">
          {ordered.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              expanded={expandedId === card.id}
              pinned={pinnedId === card.id}
              onHover={(id) => {
                if (!draggingId && window.matchMedia("(hover: hover)").matches) setHoveredId(id);
              }}
              onLeave={(id) => {
                if (!draggingId) setHoveredId((current) => current === id ? null : current);
              }}
              onToggle={(id) => setPinnedId((current) => current === id ? null : id)}
              onPin={setPinnedId}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
