"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

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

export function DatePicker({
  value,
  onChange,
  className = "",
  placeholder = "dd/mm/aaaa",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);
  const [viewDate, setViewDate] = useState(() => selected ?? new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = parseISODate(value);
    if (next) setViewDate(next);
  }, [value]);

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

  const today = new Date();

  function selectDay(d: Date) {
    onChange(toISODate(d));
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`field-input flex items-center gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        } ${className}`}
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className={`truncate ${selected ? "" : "text-neutral-400 dark:text-neutral-500"}`}>
          {selected ? selected.toLocaleDateString("pt-BR") : placeholder}
        </span>
      </button>

      {open && (
        <div className="surface-glass absolute z-30 mt-1 w-64 rounded-md p-3 shadow-lg">
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

          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={i} className="py-1">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {weeks.flatMap((week, wi) =>
              week.map((day, di) => {
                const inMonth = day.getMonth() === viewDate.getMonth();
                const isSelected = !!selected && isSameDay(day, selected);
                const isToday = isSameDay(day, today);
                return (
                  <button
                    key={`${wi}-${di}`}
                    type="button"
                    onClick={() => selectDay(day)}
                    className={`flex h-7 w-7 items-center justify-center rounded-md text-xs transition-colors ${
                      isSelected
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                        : inMonth
                          ? "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                          : "text-neutral-300 hover:bg-neutral-50 dark:text-neutral-700 dark:hover:bg-neutral-800/50"
                    } ${
                      isToday && !isSelected
                        ? "font-semibold text-neutral-900 ring-1 ring-inset ring-neutral-900 dark:text-neutral-100 dark:ring-white"
                        : ""
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              }),
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-neutral-200/60 pt-2 text-xs dark:border-neutral-800/60">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => selectDay(new Date())}
              className="font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
