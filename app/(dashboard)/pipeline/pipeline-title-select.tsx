"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

type PipelineOption = { id: string; name: string };

/**
 * Nome do funil ativo como TÍTULO da página — mesma fonte/peso do <h1> que
 * outras telas do app usam (ex.: "Processos" em app/(dashboard)/processos/
 * page.tsx: text-xl font-semibold tracking-tight), não mais um <Select>
 * pequeno e encaixotado escondido na barra de ferramentas. Continua sendo o
 * seletor de funil de verdade — clicar no nome abre a lista pra trocar,
 * mesmo mecanismo de posicionamento/fechamento (useFloatingDropdown) que
 * components/select.tsx já usa em todo o app, só com o GATILHO redesenhado
 * (texto grande sem moldura de campo, em vez de um botão de formulário).
 *
 * Com 1 funil só (nada pra trocar), vira um <h1> estático — sem seta, sem
 * comportamento de clique, sem <button> nem around nele: não faz sentido
 * oferecer um menu com uma opção só.
 */
export function PipelineTitleSelect({
  pipelines,
  activeId,
  onSelect,
}: {
  pipelines: PipelineOption[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = pipelines.find((p) => p.id === activeId);

  const coords = useFloatingDropdown({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
  });

  if (pipelines.length <= 1) {
    return (
      <h1 className="text-xl leading-none font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        {active?.name ?? "Pipeline"}
      </h1>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group -m-1 inline-flex items-center gap-1.5 rounded-md p-1 text-xl leading-none font-semibold tracking-tight text-neutral-900 transition-colors hover:text-brand dark:text-neutral-100"
      >
        {active?.name ?? "Selecionar funil"}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth group-hover:text-brand dark:text-neutral-500 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2.5}
        />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className="surface-glass-dense animate-pop-in scrollbar-thin fixed z-50 overflow-y-auto rounded-md p-1 pb-1.5 shadow-lg"
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              minWidth: coords.width,
              width: "max-content",
              maxWidth: `calc(100vw - ${(coords.left ?? 0) + 16}px)`,
              maxHeight: Math.min(280, coords.maxHeight),
            }}
          >
            {pipelines.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === activeId}
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors ${
                  p.id === activeId
                    ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
                }`}
              >
                {p.name}
                {p.id === activeId && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
