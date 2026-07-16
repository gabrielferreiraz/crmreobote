"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar as CalendarIcon, Check, ChevronDown, ChevronLeft } from "lucide-react";
import { DateRangeCalendar } from "@/components/date-range-calendar";
import { buildQuickRanges } from "@/lib/date-ranges";

const QUICK_RANGES = buildQuickRanges();

function optionClass(active: boolean) {
  return `flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
    active
      ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
      : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
  }`;
}

/**
 * Filtro de período do relatório — muda a URL (?from=&to=), que a página
 * (Server Component) lê de novo e refaz as agregações no banco. Um único
 * botão de largura fixa (nunca reflui o resto da barra, não importa o
 * tamanho do rótulo) que abre um menu com os atalhos + calendário
 * personalizado — em vez da fileira de pills de antes.
 */
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeFrom = searchParams.get("from") ?? "";
  const activeTo = searchParams.get("to") ?? "";
  const [draftFrom, setDraftFrom] = useState(activeFrom);
  const [draftTo, setDraftTo] = useState(activeTo);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustom(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setShowCustom(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function applyRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("from", from);
    else params.delete("from");
    if (to) params.set("to", to);
    else params.delete("to");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
    setShowCustom(false);
  }

  const activeQuickKey = QUICK_RANGES.find((q) => {
    const r = q.range();
    return r.from === activeFrom && r.to === activeTo;
  })?.key;
  const isAllActive = !activeFrom && !activeTo;
  const isCustomActive = !activeQuickKey && !isAllActive;

  const activeLabel = isAllActive
    ? "Tudo"
    : isCustomActive
      ? `${new Date(`${activeFrom}T00:00:00`).toLocaleDateString("pt-BR")} – ${new Date(`${activeTo}T00:00:00`).toLocaleDateString("pt-BR")}`
      : (QUICK_RANGES.find((q) => q.key === activeQuickKey)?.label ?? "Tudo");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setDraftFrom(activeFrom);
          setDraftTo(activeTo);
          setShowCustom(false);
          setOpen((v) => !v);
        }}
        className={`field-input flex w-64 items-center gap-1.5 text-left text-sm ${
          open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""
        }`}
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className="flex-1 truncate">{activeLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 dark:text-neutral-500 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="surface-glass animate-pop-in absolute right-0 z-30 mt-1 w-72 rounded-lg p-2 shadow-xl">
          {!showCustom ? (
            <div className="space-y-0.5">
              <button type="button" onClick={() => applyRange("", "")} className={optionClass(isAllActive)}>
                Tudo
                {isAllActive && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </button>
              {QUICK_RANGES.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => {
                    const r = q.range();
                    applyRange(r.from, r.to);
                  }}
                  className={optionClass(activeQuickKey === q.key)}
                >
                  {q.label}
                  {activeQuickKey === q.key && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                </button>
              ))}
              <button type="button" onClick={() => setShowCustom(true)} className={optionClass(isCustomActive)}>
                Personalizado
                {isCustomActive && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </button>
            </div>
          ) : (
            <div className="space-y-3 p-1">
              <button
                type="button"
                onClick={() => setShowCustom(false)}
                className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                Voltar
              </button>
              <DateRangeCalendar
                from={draftFrom}
                to={draftTo}
                onSelect={(r) => {
                  setDraftFrom(r.from);
                  setDraftTo(r.to);
                }}
              />
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost btn-sm">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!draftFrom || !draftTo}
                  onClick={() => applyRange(draftFrom, draftTo)}
                  className="btn-primary btn-sm"
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
