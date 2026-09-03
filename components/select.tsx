"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

export type SelectOption = { value: string; label: string; disabled?: boolean };

// Tempo sem digitar que reseta a busca por digitação — mesmo padrão do
// <select> nativo do navegador: teclas em sequência rápida estendem a busca,
// uma pausa recomeça do zero. Só usado quando NÃO tem campo de busca (ver
// SEARCH_THRESHOLD abaixo) — com busca, digitar já filtra a lista, não
// precisa mais desse comportamento de "pular pro próximo que bate".
const TYPEAHEAD_RESET_MS = 700;

// A partir de quantas opções o campo de busca aparece sozinho, sem precisar
// de nenhum select pedir — pedido explícito: pesquisa em TODAS as listas
// suspensas do sistema. Abaixo disso (ex.: Sim/Não, um Select de 3-4
// opções) o campo só ocuparia espaço à toa — dá pra ver a lista inteira de
// uma vez, escrever pra filtrar não ajuda em nada.
const SEARCH_THRESHOLD = 6;

/** Minúsculo + sem acento, só pra COMPARAR — nunca usado pra exibir nada.
 * Local (não importado de lib/voice) de propósito: este é um componente de
 * UI genérico, sem nenhuma razão pra depender do pipeline de voz só por
 * causa de uma função de 6 linhas. */
function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  className = "",
  disabled = false,
  autoFocus = false,
  /** Força mostrar (true) ou esconder (false) o campo de busca — sem
   * passar nada, decide sozinho pelo tamanho da lista (ver SEARCH_THRESHOLD). */
  searchable,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.find((o) => o.value === value);
  const instanceId = useId();
  const isSearchable = searchable ?? options.length > SEARCH_THRESHOLD;

  // Lista de fato mostrada/navegada — igual a `options` quando não é
  // pesquisável OU quando a busca está vazia (evita recalcular/realocar um
  // array novo à toa nesse caso comum).
  const visibleOptions = useMemo(() => {
    if (!isSearchable) return options;
    const term = foldForSearch(search.trim());
    if (!term) return options;
    return options.filter((o) => foldForSearch(o.label).includes(term));
  }, [options, search, isSearchable]);

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
    setSearch("");
    setHighlightedIndex(options.findIndex((o) => o.value === value));
    typeaheadBuffer.current = "";
    // Foca a busca só depois do painel/input existirem de verdade no DOM
    // (o portal monta no mesmo commit, mas focar direto aqui perdia a mão
    // às vezes) — raf garante 1 frame de folga, sem precisar de setTimeout
    // arbitrário.
    if (isSearchable) {
      const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    // Só reresetar quando o painel ABRE — reagir a mudanças de `options`/
    // `value` enquanto já está aberto reiniciaria a marcação a cada
    // re-render do componente pai (ex.: `options` recriado por um novo
    // array a cada render), atrapalhando a navegação por teclado em curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Busca mudou (usuário digitando) — a marcação precisa ficar na 1ª opção
  // da lista FILTRADA agora, senão o índice antigo aponta pra outra opção
  // (ou nem existe mais na lista atual).
  useEffect(() => {
    if (!open || !isSearchable) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedIndex(visibleOptions.length > 0 ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function scrollIntoView(index: number) {
    optionRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }

  // Acha a próxima opção habilitada (não-disabled) que bate no predicado,
  // andando em `step` a partir de `fromIndex` e dando a volta no fim/início
  // da lista — usado tanto pelas setas (predicado sempre verdadeiro) quanto
  // pela busca por digitação SEM campo de busca (predicado = label começa
  // com o texto buscado, ver handleTriggerKeyDown).
  function findNext(fromIndex: number, step: 1 | -1, predicate: (opt: SelectOption) => boolean): number {
    const list = visibleOptions;
    const n = list.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (((fromIndex + step * offset) % n) + n) % n;
      if (!list[idx].disabled && predicate(list[idx])) return idx;
    }
    return -1;
  }

  function selectHighlighted() {
    const opt = visibleOptions[highlightedIndex];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  // Setas/Enter/Escape — comuns aos dois jeitos de navegar (com ou sem
  // campo de busca), só o que dispara a digitação normal muda entre eles
  // (ver handleTriggerKeyDown e o onKeyDown do <input> mais abaixo).
  function handleNavigationKeys(e: React.KeyboardEvent): boolean {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = findNext(highlightedIndex, e.key === "ArrowDown" ? 1 : -1, () => true);
      if (idx !== -1) {
        setHighlightedIndex(idx);
        scrollIntoView(idx);
      }
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      selectHighlighted();
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return true;
    }
    return false;
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) return;
    if (handleNavigationKeys(e)) return;

    // Busca por digitação (só quando NÃO tem campo de busca — com campo, o
    // foco já está lá, esse handler do botão nem dispara mais nesse caso):
    // só letra/número/espaço, sem tecla modificadora — o resto (Tab, etc.)
    // segue o comportamento padrão.
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
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${
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
            className="surface-glass-dense animate-pop-in fixed z-50 flex flex-col overflow-hidden rounded-md shadow-lg"
            // Mesmo raciocínio de largura/altura de sempre — só que agora o
            // teto de altura (maxHeight) é do PAINEL inteiro (busca + lista),
            // não só da lista; o campo de busca não cresce, quem sobra de
            // espaço pra lista vai pro <div role="listbox"> logo abaixo.
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              minWidth: coords.width,
              width: "max-content",
              maxWidth: `calc(100vw - ${(coords.left ?? 0) + 16}px)`,
              maxHeight: Math.min(224 + (isSearchable ? 40 : 0), coords.maxHeight),
            }}
          >
            {isSearchable && (
              <div className="relative shrink-0 border-b border-neutral-200/70 p-1 dark:border-neutral-700/70">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
                  strokeWidth={2}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleNavigationKeys}
                  placeholder="Buscar..."
                  className="w-full rounded bg-transparent py-1.5 pr-2 pl-8 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-200 dark:placeholder:text-neutral-500"
                />
              </div>
            )}
            <div id={`${instanceId}-listbox`} role="listbox" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1 pb-1.5">
              {visibleOptions.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-neutral-400 dark:text-neutral-500">Nenhum resultado</p>
              ) : (
                visibleOptions.map((opt, i) => (
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
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
