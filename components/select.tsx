"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string; disabled?: boolean };

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
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
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

      {open && (
        <div
          role="listbox"
          className="surface-glass scrollbar-thin absolute z-30 mt-1 max-h-56 min-w-full overflow-y-auto rounded-md p-1 shadow-lg"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
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
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
