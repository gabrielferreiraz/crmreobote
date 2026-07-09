"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

export function FilterPopover({
  active,
  onClear,
  children,
}: {
  active: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Filtros"
        className={`icon-btn relative h-9 w-9 border ${
          active
            ? "border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
            : "border-neutral-300 dark:border-neutral-700"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-neutral-900 dark:bg-white" />
        )}
      </button>

      {open && (
        <div className="surface-glass absolute right-0 z-40 mt-2 w-72 space-y-3 rounded-lg p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Filtros</p>
            {active && onClear && (
              <button
                onClick={onClear}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <X className="h-3 w-3" strokeWidth={2} />
                Limpar
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
