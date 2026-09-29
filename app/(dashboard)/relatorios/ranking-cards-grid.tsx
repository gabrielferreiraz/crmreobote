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
import { GripVertical } from "lucide-react";

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

function SortableCard({ card }: { card: RankingCardData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 1 : undefined };

  return (
    <div ref={setNodeRef} style={style} className="card group flex min-w-[260px] flex-1 basis-[260px] flex-col p-6">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {card.icon}
          <h3 className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{card.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {card.headerExtra}
          {/* Só o ícone arrasta (não o card inteiro) — o corpo tem lista com scroll próprio,
              e um card inteiro "pegável" ia competir com o gesto de rolar a lista no touch.
              coarse:opacity-100 mantém visível em touch (onde não existe hover pra revelar). */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="icon-btn cursor-grab touch-none opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100"
            title="Arrastar para reordenar"
            aria-label={`Arrastar "${card.title}" para reordenar entre os rankings`}
          >
            <GripVertical className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
      {card.subheader}
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
 * flex-1 + min-w-[260px] por card (ver SortableCard): cresce pra preencher
 * quando sobra espaço (poucos cards, tela larga — mesmo visual de antes) e
 * encolhe até 260px antes de estourar a fileira e ativar o scroll — nunca
 * aperta um card menor que isso.
 */
export function RankingCardsGrid({ cards }: { cards: RankingCardData[] }) {
  const ids = cards.map((c) => c.id);
  const idsKey = ids.join("|");
  const [order, setOrder] = useState(ids);

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

  return (
    <DndContext id="ranking-cards" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        {/* pb-3 (não pb-0) dá lugar pra barra de rolagem fina sem colar na borda
            de baixo dos cards — mesmo ajuste de app/(dashboard)/pipeline/kanban-board.tsx. */}
        <div className="scrollbar-thin flex gap-5 overflow-x-auto pb-3">
          {ordered.map((card) => (
            <SortableCard key={card.id} card={card} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
