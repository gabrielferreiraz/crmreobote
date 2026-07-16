"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock } from "lucide-react";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

const TIME_STEP_MINUTES = 15;

function generateTimes(): string[] {
  const times: string[] = [];
  for (let m = 0; m < 24 * 60; m += TIME_STEP_MINUTES) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    times.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return times;
}

const TIMES = generateTimes();

export function TimePicker({
  value,
  onChange,
  className = "",
  placeholder = "--:--",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const coords = useFloatingDropdown({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
  });

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, [open]);

  function selectTime(t: string) {
    onChange(t);
    setOpen(false);
  }

  function selectNow() {
    const now = new Date();
    const rounded = Math.round((now.getHours() * 60 + now.getMinutes()) / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
    const h = Math.floor(rounded / 60) % 24;
    const m = rounded % 60;
    selectTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`field-input flex items-center gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        } ${className}`}
      >
        <Clock className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className={`truncate ${value ? "" : "text-neutral-400 dark:text-neutral-500"}`}>
          {value || placeholder}
        </span>
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className="surface-glass animate-pop-in fixed z-50 w-32 rounded-md p-1 shadow-lg"
            style={{ top: coords.top, left: coords.left }}
          >
            <div ref={listRef} className="scrollbar-thin max-h-48 overflow-y-auto">
              {TIMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-selected={t === value}
                  onClick={() => selectTime(t)}
                  className={`w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                    t === value
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-neutral-200/60 pt-1 text-xs dark:border-neutral-800/60">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="px-1.5 py-1 font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={selectNow}
                className="px-1.5 py-1 font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                Agora
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
