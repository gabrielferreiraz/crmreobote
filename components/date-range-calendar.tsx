"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import type { QuickRange } from "@/lib/date-ranges";

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTH_LABELS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Calendário único com seleção de intervalo: clica no primeiro dia, clica no
 * último — ou clica duas vezes no mesmo dia pra selecionar só ele. Substitui
 * o padrão antigo de dois campos "De"/"Até" separados.
 */
export function DateRangeCalendar({
  from,
  to,
  onSelect,
  onClear,
}: {
  from: string;
  to: string;
  onSelect: (range: { from: string; to: string }) => void;
  onClear?: () => void;
}) {
  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);
  const [viewDate, setViewDate] = useState(() => fromDate ?? new Date());
  const [hoverDay, setHoverDay] = useState<Date | null>(null);

  const today = new Date();
  const singlePending = !!fromDate && !!toDate && isSameDay(fromDate, toDate);

  const weeks = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const start = new Date(year, month, 1 - firstOfMonth.getDay());
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    const result: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7));
    return result;
  }, [viewDate]);

  function handleDayClick(day: Date) {
    const isFullRange = !!fromDate && !!toDate && !isSameDay(fromDate, toDate);
    if (!fromDate || isFullRange) {
      onSelect({ from: toISODate(day), to: toISODate(day) });
      return;
    }
    if (isSameDay(day, fromDate)) {
      onSelect({ from: toISODate(day), to: toISODate(day) });
      return;
    }
    const start = day < fromDate ? day : fromDate;
    const end = day < fromDate ? fromDate : day;
    onSelect({ from: toISODate(start), to: toISODate(end) });
  }

  // Enquanto só o primeiro dia foi marcado, mostra uma prévia do range ao passar o mouse.
  const previewEnd = singlePending && hoverDay ? hoverDay : null;
  const rangeStart = fromDate && previewEnd ? (previewEnd < fromDate ? previewEnd : fromDate) : fromDate;
  const rangeEnd = fromDate && previewEnd ? (previewEnd < fromDate ? fromDate : previewEnd) : toDate;

  return (
    <div onMouseLeave={() => setHoverDay(null)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {MONTH_LABELS[viewDate.getMonth()]} de {viewDate.getFullYear()}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
            className="icon-btn h-6 w-6"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
            className="icon-btn h-6 w-6"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {weeks.flatMap((week, wi) =>
          week.map((day, di) => {
            const inMonth = day.getMonth() === viewDate.getMonth();
            const isToday = isSameDay(day, today);
            const isStart = !!rangeStart && isSameDay(day, rangeStart);
            const isEnd = !!rangeEnd && isSameDay(day, rangeEnd);
            const inRange = !!rangeStart && !!rangeEnd && day > rangeStart && day < rangeEnd;
            const isEdge = isStart || isEnd;
            const isPreview = singlePending && !!previewEnd;

            const showBar = inRange || (isEdge && !(isStart && isEnd));

            return (
              <div key={`${wi}-${di}`} className="relative flex h-8 items-stretch">
                {showBar && (
                  <span
                    className={`pointer-events-none absolute inset-y-0.5 bg-neutral-100 dark:bg-neutral-800/70 ${isPreview ? "opacity-60" : ""}`}
                    style={{ left: isStart ? "50%" : 0, right: isEnd ? "50%" : 0 }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => handleDayClick(day)}
                  onMouseEnter={() => setHoverDay(day)}
                  className={`relative z-10 m-auto flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors ${
                    isEdge
                      ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900"
                      : inMonth
                        ? "text-neutral-700 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-700/60"
                        : "text-neutral-300 hover:bg-neutral-100 dark:text-neutral-700 dark:hover:bg-neutral-800/50"
                  } ${
                    isToday && !isEdge
                      ? "font-semibold text-neutral-900 ring-1 ring-inset ring-neutral-900 dark:text-neutral-100 dark:ring-white"
                      : ""
                  }`}
                >
                  {day.getDate()}
                </button>
              </div>
            );
          }),
        )}
      </div>

      {(onClear || from || to) && (
        <div className="mt-2 flex items-center justify-between border-t border-neutral-200/60 pt-2 text-xs dark:border-neutral-800/60">
          <button
            type="button"
            onClick={() => (onClear ? onClear() : onSelect({ from: "", to: "" }))}
            className="font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Limpar
          </button>
          <span className="text-neutral-400 dark:text-neutral-500">
            {fromDate && toDate
              ? isSameDay(fromDate, toDate)
                ? fromDate.toLocaleDateString("pt-BR")
                : `${fromDate.toLocaleDateString("pt-BR")} – ${toDate.toLocaleDateString("pt-BR")}`
              : "Selecione um período"}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Campo recolhido (igual ao DatePicker de dia único) que só abre o
 * DateRangeCalendar num dropdown ao clicar — pra não deixar o calendário
 * sempre expandido ocupando a tela dentro de um popover de filtros.
 */
export function DateRangeField({
  from,
  to,
  onSelect,
  placeholder = "Selecionar período",
  className = "",
  quickRanges,
}: {
  from: string;
  to: string;
  onSelect: (range: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
  /** Atalhos ("Hoje", "Mês passado"...) mostrados dentro do dropdown, junto do
   * calendário — só aparecem quando o campo é aberto, não antes. */
  quickRanges?: QuickRange[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);
  const label =
    fromDate && toDate
      ? isSameDay(fromDate, toDate)
        ? fromDate.toLocaleDateString("pt-BR")
        : `${fromDate.toLocaleDateString("pt-BR")} – ${toDate.toLocaleDateString("pt-BR")}`
      : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`field-input flex items-center gap-1.5 text-left ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        } ${className}`}
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className={`truncate ${label ? "" : "text-neutral-400 dark:text-neutral-500"}`}>{label ?? placeholder}</span>
      </button>

      {open && (
        <div className="surface-glass animate-pop-in absolute z-30 mt-1 w-64 rounded-md p-3 shadow-lg">
          {quickRanges && quickRanges.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 border-b border-neutral-200/60 pb-2 dark:border-neutral-800/60">
              {quickRanges.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => {
                    onSelect(q.range());
                    setOpen(false);
                  }}
                  className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <DateRangeCalendar from={from} to={to} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
