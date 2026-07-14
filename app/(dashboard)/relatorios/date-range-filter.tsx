"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar as CalendarIcon } from "lucide-react";
import { DatePicker } from "@/components/date-picker";
import { buildQuickRanges } from "@/lib/date-ranges";

const QUICK_RANGES = buildQuickRanges();

const PILL_BASE = "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97]";
const PILL_ACTIVE = "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900";
const PILL_INACTIVE =
  "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:active:bg-neutral-800";

/**
 * Filtro de período do relatório — muda a URL (?from=&to=), que a página
 * (Server Component) lê de novo e refaz as agregações no banco. Não dá pra
 * filtrar só no cliente porque os números vêm de agregação do Prisma, não de
 * uma lista já carregada.
 */
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customOpen, setCustomOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeFrom = searchParams.get("from") ?? "";
  const activeTo = searchParams.get("to") ?? "";
  const [draftFrom, setDraftFrom] = useState(activeFrom);
  const [draftTo, setDraftTo] = useState(activeTo);

  useEffect(() => {
    if (!customOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setCustomOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [customOpen]);

  function applyRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("from", from);
    else params.delete("from");
    if (to) params.set("to", to);
    else params.delete("to");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const activeQuickKey = QUICK_RANGES.find((q) => {
    const r = q.range();
    return r.from === activeFrom && r.to === activeTo;
  })?.key;
  const isAllActive = !activeFrom && !activeTo;
  const isCustomActive = !activeQuickKey && !isAllActive;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => applyRange("", "")} className={`${PILL_BASE} ${isAllActive ? PILL_ACTIVE : PILL_INACTIVE}`}>
        Tudo
      </button>
      {QUICK_RANGES.map((q) => (
        <button
          key={q.key}
          type="button"
          onClick={() => {
            const r = q.range();
            applyRange(r.from, r.to);
          }}
          className={`${PILL_BASE} ${activeQuickKey === q.key ? PILL_ACTIVE : PILL_INACTIVE}`}
        >
          {q.label}
        </button>
      ))}

      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setDraftFrom(activeFrom);
            setDraftTo(activeTo);
            setCustomOpen((v) => !v);
          }}
          className={`${PILL_BASE} inline-flex items-center gap-1.5 ${isCustomActive ? PILL_ACTIVE : PILL_INACTIVE}`}
        >
          <CalendarIcon className="h-3.5 w-3.5" strokeWidth={2} />
          {isCustomActive
            ? `${new Date(`${activeFrom}T00:00:00`).toLocaleDateString("pt-BR")} – ${new Date(`${activeTo}T00:00:00`).toLocaleDateString("pt-BR")}`
            : "Personalizado"}
        </button>

        {customOpen && (
          <div className="surface-glass absolute right-0 z-30 mt-2 w-72 space-y-3 rounded-lg p-4 shadow-xl">
            <div className="space-y-1">
              <label className="field-label">De</label>
              <DatePicker value={draftFrom} onChange={setDraftFrom} className="w-full" />
            </div>
            <div className="space-y-1">
              <label className="field-label">Até</label>
              <DatePicker value={draftTo} onChange={setDraftTo} className="w-full" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCustomOpen(false)} className="btn-ghost btn-sm">
                Cancelar
              </button>
              <button
                type="button"
                disabled={!draftFrom || !draftTo}
                onClick={() => {
                  applyRange(draftFrom, draftTo);
                  setCustomOpen(false);
                }}
                className="btn-primary btn-sm"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
