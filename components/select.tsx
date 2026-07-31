"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

export type SelectOption = { value: string; label: string; disabled?: boolean };

// Tempo sem digitar que reseta a busca por digitação — mesmo padrão do
// <select> nativo do navegador: teclas em sequência rápida estendem a busca,
// uma pausa recomeça do zero.
const TYPEAHEAD_RESET_MS = 700;

export function Select({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  className = "",
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((o) => o.value === value);
  const instanceId = useId();

  // Item "marcado" pela busca por digitação/setas — não é o valor
  // selecionado (esse só muda com clique ou Enter). Digitar "aju" com o
  // painel aberto só move essa marcação até a opção correspondente, sem
  // esconder as outras opções nem confirmar a escolha sozinho.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const typeaheadBuffer = useRef("");
  const lastKeyTime = useRef(0);

  const coords = useFloatingDropdown({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
  });

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIndex(options.findIndex((o) => o.value === value));
    typeaheadBuffer.current = "";
    // Só reresetar quando o painel ABRE — reagir a mudanças de `options`/
    // `value` enquanto já está aberto reiniciaria a marcação a cada
    // re-render do componente pai (ex.: `options` recriado por um novo
    // array a cada render), atrapalhando a navegação por teclado em curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function scrollIntoView(index: number) {
    optionRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }

  // Acha a próxima opção habilitada (não-disabled) que bate no predicado,
  // andando em `step` a partir de `fromIndex` e dando a volta no fim/início
  // da lista — usado tanto pelas setas (predicado sempre verdadeiro) quanto
  // pela busca por digitação (predicado = label começa com o texto buscado).
  function findNext(fromIndex: number, step: 1 | -1, predicate: (opt: SelectOption) => boolean): number {
    const n = options.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (((fromIndex + step * offset) % n) + n) % n;
      if (!options[idx].disabled && predicate(options[idx])) return idx;
    }
    return -1;
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = findNext(highlightedIndex, e.key === "ArrowDown" ? 1 : -1, () => true);
      if (idx !== -1) {
        setHighlightedIndex(idx);
        scrollIntoView(idx);
      }
      return;
    }

    if (e.key === "Enter") {
      if (highlightedIndex !== -1) {
        e.preventDefault();
        onChange(options[highlightedIndex].value);
        setOpen(false);
      }
      return;
    }

    // Busca por digitação: só letra/número/espaço, sem tecla modificadora —
    // o resto (Tab, Escape, etc.) segue o comportamento padrão.
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    const now = Date.now();
    if (now - lastKeyTime.current > TYPEAHEAD_RESET_MS) typeaheadBuffer.current = "";
    lastKeyTime.current = now;
    typeaheadBuffer.current += e.key.toLowerCase();

    // A mesma letra repetida (s, s, s...) cicla entre as opções que começam
    // com ela, em vez de procurar literalmente "sss" — mesmo comportamento
    // do <select> nativo do navegador.
    const chars = [...typeaheadBuffer.current];
    const search = chars.every((c) => c === chars[0]) ? chars[0] : typeaheadBuffer.current;

    const idx = findNext(highlightedIndex, 1, (opt) => opt.label.toLowerCase().startsWith(search));
    if (idx !== -1) {
      e.preventDefault();
      setHighlightedIndex(idx);
      scrollIntoView(idx);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${instanceId}-listbox`}
        aria-activedescendant={open && highlightedIndex !== -1 ? `${instanceId}-opt-${highlightedIndex}` : undefined}
        className={`field-input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        } ${className}`}
      >
        <span className={`truncate ${selected ? "" : "text-neutral-400 dark:text-neutral-500"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 dark:text-neutral-500 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={2}
        />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={`${instanceId}-listbox`}
            role="listbox"
            className="surface-glass animate-pop-in scrollbar-thin fixed z-50 max-h-56 overflow-y-auto rounded-md p-1 shadow-lg"
            style={{ top: coords.top, left: coords.left, width: coords.width }}
          >
            {options.map((opt, i) => (
              <button
                key={opt.value}
                id={`${instanceId}-opt-${i}`}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                disabled={opt.disabled}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  opt.value === value
                    ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
                } ${i === highlightedIndex ? "ring-1 ring-inset ring-neutral-900 dark:ring-white" : ""}`}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
