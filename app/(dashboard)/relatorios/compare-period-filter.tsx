"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { GitCompareArrows, Check, ChevronDown, ChevronLeft, X } from "lucide-react";
import { DateRangeCalendar } from "@/components/date-range-calendar";
import { COMPARE_MODES, isCompareMode } from "@/lib/reports/period-compare";

function optionClass(active: boolean) {
  return `flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
    active
      ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
      : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
  }`;
}

/** "2026-06-15" → "15/06/2026" — só pro rótulo do botão (o cálculo de
 * verdade, com fuso de Brasília, mora em lib/reports/period-compare.ts; aqui
 * é só exibir de volta o que a própria pessoa acabou de escolher no
 * calendário, sem precisar de nenhuma conversão de fuso pra isso). */
function formatPtBr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * "Comparar período" — botão que, ao ser aberto, mostra os 5 modos de
 * comparação (Mesmo período/Mês/Últimos 3 meses/Ano/Personalizado — ver
 * lib/reports/period-compare.ts pro significado EXATO de cada um).
 * "Personalizado" abre um calendário (mesmo componente que DateRangeFilter
 * usa pro período principal) pra escolher os dois dias à mão. Muda a URL
 * (?compare=, + ?compareFrom=&compareTo= só pro personalizado), que
 * getCommercialReportData lê pra calcular o período de comparação e devolver
 * `compareData` — mesmo padrão de DateRangeFilter (?from=&to=) na mesma
 * barra de filtros, só que sem persistir em localStorage: diferente do
 * período principal (uma preferência de sessão que faz sentido lembrar
 * sempre), comparação é um modo de análise pontual — reaproveita o mesmo
 * raciocínio de ?filter= (quickFilter) no Pipeline, que também não persiste.
 *
 * Sem período principal com limites reais ("Tudo", ?range=all) não tem
 * "período anterior" que faça sentido pra nenhum dos 5 modos — o botão some
 * nesse caso em vez de oferecer uma comparação que a página vai ignorar
 * silenciosamente (ver mesma checagem em lib/reports/commercial-data.ts).
 */
export function ComparePeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isAllTime = searchParams.get("range") === "all";
  const activeCompareRaw = searchParams.get("compare") ?? undefined;
  const activeCompare = isCompareMode(activeCompareRaw) ? activeCompareRaw : null;
  const activeCompareFrom = searchParams.get("compareFrom") ?? "";
  const activeCompareTo = searchParams.get("compareTo") ?? "";
  const [draftFrom, setDraftFrom] = useState(activeCompareFrom);
  const [draftTo, setDraftTo] = useState(activeCompareTo);

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

  // "Tudo" não tem "período anterior" de duração real pra medir — some o
  // botão em vez de oferecer algo que a página ignora. Se o usuário tinha
  // comparação ligada e MUDA pra "Tudo", ?compare=/?compareFrom=/?compareTo=
  // ficam órfãos na URL (inofensivo: commercial-data.ts já ignora quando
  // rangeFrom/rangeTo são null), mas o botão já não aparece mais aqui pra
  // tirar de propósito.
  if (isAllTime) return null;

  function setMode(mode: string | null, custom?: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (mode) params.set("compare", mode);
    else params.delete("compare");
    if (custom) {
      params.set("compareFrom", custom.from);
      params.set("compareTo", custom.to);
    } else {
      params.delete("compareFrom");
      params.delete("compareTo");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
    setShowCustom(false);
  }

  const activeLabel =
    activeCompare === "custom"
      ? activeCompareFrom && activeCompareTo
        ? activeCompareFrom === activeCompareTo
          ? formatPtBr(activeCompareFrom)
          : `${formatPtBr(activeCompareFrom)} – ${formatPtBr(activeCompareTo)}`
        : "Personalizado"
      : activeCompare
        ? COMPARE_MODES.find((m) => m.key === activeCompare)?.label
        : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setDraftFrom(activeCompareFrom);
          setDraftTo(activeCompareTo);
          setShowCustom(false);
          setOpen((v) => !v);
        }}
        className={`field-input flex items-center gap-1.5 text-left text-sm ${
          activeCompare ? "border-brand/40 text-brand dark:border-brand/50" : ""
        } ${open ? "border-neutral-400 ring-1 ring-neutral-400 dark:border-neutral-500 dark:ring-neutral-500" : ""}`}
      >
        <GitCompareArrows className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className="whitespace-nowrap">{activeLabel ? `Comparando: ${activeLabel}` : "Comparar período"}</span>
        {activeCompare ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setMode(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                setMode(null);
              }
            }}
            className="icon-btn -my-1 -mr-1 h-5 w-5 shrink-0"
            aria-label="Desligar comparação de período"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </span>
        ) : (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        )}
      </button>

      {open && (
        <div className="surface-glass-filter animate-pop-in absolute right-0 z-30 mt-1 w-64 rounded-lg p-2 shadow-xl">
          {!showCustom ? (
            <>
              <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                Comparar com...
              </p>
              <div className="space-y-0.5">
                {COMPARE_MODES.filter((m) => m.key !== "custom").map((m) => (
                  <button key={m.key} type="button" onClick={() => setMode(m.key)} className={optionClass(activeCompare === m.key)}>
                    {m.label}
                    {activeCompare === m.key && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                  </button>
                ))}
                <button type="button" onClick={() => setShowCustom(true)} className={optionClass(activeCompare === "custom")}>
                  Personalizado
                  {activeCompare === "custom" && <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                </button>
              </div>
            </>
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
                  onClick={() => setMode("custom", { from: draftFrom, to: draftTo })}
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
