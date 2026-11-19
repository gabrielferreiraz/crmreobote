"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, CircleCheck, CircleX, Info } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type FunnelStage = {
  id: string;
  label: string;
  count: number;
  value?: number;
  unit?: string;
  color?: string | null;
  advanced?: number;
  won?: number;
  lost?: number;
};

function SnapshotFunnel({ stages, openTotal, hovered, setHovered, pinnedStage, setPinnedStage }: {
  stages: FunnelStage[];
  openTotal: number;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  pinnedStage: string | null;
  setPinnedStage: (id: string | null) => void;
}) {
  const largestCount = Math.max(1, ...stages.map((stage) => stage.count));
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);

  function positionTooltip(clientX: number, clientY: number) {
    const tooltipWidth = Math.min(360, window.innerWidth * 0.92);
    const tooltipHeight = 210;
    const gap = 14;
    const left = clientX + gap + tooltipWidth > window.innerWidth
      ? Math.max(8, clientX - tooltipWidth - gap)
      : clientX + gap;
    const top = clientY + gap + tooltipHeight > window.innerHeight
      ? Math.max(8, clientY - tooltipHeight - gap)
      : clientY + gap;
    setTooltipPosition({ left, top });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <div>
          <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Jornada dos negócios</p>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Abertos hoje · resultados no período</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1"><ArrowUpRight className="h-3.5 w-3.5 text-brand" /> Avançaram</span>
          <span className="inline-flex items-center gap-1"><CircleCheck className="h-3.5 w-3.5 text-emerald-600" /> Ganhos</span>
          <span className="inline-flex items-center gap-1"><CircleX className="h-3.5 w-3.5 text-red-500" /> Perdidos</span>
        </div>
      </div>

      <div className="space-y-1.5" role="group" aria-label="Funil de negócios por etapa">
        {stages.map((stage) => {
          const width = 54 + (stage.count / largestCount) * 46;
          const isHovered = hovered === stage.id;
          const isExpanded = isHovered || pinnedStage === stage.id;
          const share = openTotal > 0 ? Math.round((stage.count / openTotal) * 100) : 0;

          return (
            <div key={stage.id} className="flex w-full justify-center">
              <div className={`relative flex w-full justify-center ${isExpanded ? "z-30" : ""}`}>
                <button
                type="button"
                aria-expanded={isExpanded}
                aria-describedby={isExpanded ? `funnel-stage-${stage.id}` : undefined}
                className="flex min-h-[72px] cursor-pointer flex-col justify-center border-0 px-3 py-1.5 text-center text-white transition-[width,filter] duration-500 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:min-h-[76px] sm:px-5"
                style={{
                  width: `${width}%`,
                  clipPath: "polygon(0 0, 100% 0, calc(100% - 12px) 100%, 12px 100%)",
                  backgroundColor: stage.color ?? "#2a78d6",
                  backgroundImage: "linear-gradient(180deg, rgba(0,0,0,.2), rgba(0,0,0,.38))",
                  filter: isHovered ? "brightness(1.13)" : undefined,
                }}
                onMouseEnter={() => setHovered(stage.id)}
                onMouseMove={(event) => positionTooltip(event.clientX, event.clientY)}
                onMouseLeave={() => setHovered(null)}
                onFocus={(event) => {
                  setHovered(stage.id);
                  const rect = event.currentTarget.getBoundingClientRect();
                  positionTooltip(rect.left + rect.width / 2, rect.top + rect.height / 2);
                }}
                onBlur={() => setHovered(null)}
                onClick={(event) => {
                  if (event.detail === 0) {
                    const rect = event.currentTarget.getBoundingClientRect();
                    positionTooltip(rect.left + rect.width / 2, rect.top + rect.height / 2);
                  } else {
                    positionTooltip(event.clientX, event.clientY);
                  }
                  setPinnedStage(pinnedStage === stage.id ? null : stage.id);
                }}
              >
                <div className="flex min-w-0 items-center justify-center gap-1.5">
                  <span className="truncate text-xs font-semibold sm:text-sm" title={stage.label}>{stage.label}</span>
                  <Info className="h-3 w-3 shrink-0 text-white/70" aria-hidden="true" />
                </div>
                <p className="mt-0.5 tabular-nums leading-none">
                  <strong className="text-xl font-bold sm:text-2xl">{stage.count.toLocaleString("pt-BR")}</strong>
                  <span className="ml-1 text-[11px] text-white/85 sm:text-xs">abertos</span>
                </p>
                <div className="mt-1.5 flex items-center justify-center gap-3 text-[11px] tabular-nums text-white/90 sm:gap-4 sm:text-xs">
                  <span aria-label={`${stage.advanced ?? 0} negócios avançaram`} title="Avançaram" className="inline-flex items-center gap-1 font-semibold">
                    <ArrowUpRight className="h-3 w-3 text-violet-200" />{(stage.advanced ?? 0).toLocaleString("pt-BR")}
                  </span>
                  <span aria-label={`${stage.won ?? 0} negócios ganhos`} title="Ganhos" className="inline-flex items-center gap-1">
                    <CircleCheck className="h-3 w-3 text-emerald-300" />{(stage.won ?? 0).toLocaleString("pt-BR")}
                  </span>
                  <span aria-label={`${stage.lost ?? 0} negócios perdidos`} title="Perdidos" className="inline-flex items-center gap-1">
                    <CircleX className="h-3 w-3 text-red-300" />{(stage.lost ?? 0).toLocaleString("pt-BR")}
                  </span>
                </div>
                </button>

                {isExpanded && tooltipPosition && createPortal(
                  <div
                    id={`funnel-stage-${stage.id}`}
                    role="tooltip"
                    className="pointer-events-none fixed z-[100] max-h-[min(70vh,280px)] w-[min(360px,92vw)] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 text-neutral-900 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 sm:p-4"
                    style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <strong className="truncate text-sm">{stage.label}</strong>
                      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{share}% do estoque aberto</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <p className="text-neutral-500 dark:text-neutral-400">Negócios abertos</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{stage.count.toLocaleString("pt-BR")}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 dark:text-neutral-400">Valor em aberto</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{formatCurrency(stage.value ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 dark:text-neutral-400">Avançaram no período</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{(stage.advanced ?? 0).toLocaleString("pt-BR")}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 dark:text-neutral-400">Ganhos no período</p>
                        <p className="mt-0.5 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{(stage.won ?? 0).toLocaleString("pt-BR")}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 dark:text-neutral-400">Perdidos no período</p>
                        <p className="mt-0.5 font-semibold tabular-nums text-red-600 dark:text-red-400">{(stage.lost ?? 0).toLocaleString("pt-BR")}</p>
                      </div>
                    </div>
                  </div>,
                  document.body,
                  `funnel-tooltip-${stage.id}`,
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="pt-3 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        A largura acompanha a quantidade de negócios abertos em cada etapa. Avanços, ganhos e perdas mostram movimentações no período selecionado.
      </p>
    </div>
  );
}

export function FunnelChart({ stages, variant = "sequence", openTotal }: { stages: FunnelStage[]; variant?: "sequence" | "snapshot"; openTotal?: number }) {
  const baseline = Math.max(1, stages[0]?.count ?? 0);
  const [grown, setGrown] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinnedStage, setPinnedStage] = useState<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (variant === "snapshot") {
    return <SnapshotFunnel stages={stages} openTotal={openTotal ?? stages.reduce((sum, stage) => sum + stage.count, 0)} hovered={hovered} setHovered={setHovered} pinnedStage={pinnedStage} setPinnedStage={setPinnedStage} />;
  }

  return (
    <div className="space-y-2.5">
      {stages.map((stage, i) => {
        const prev = stages[i - 1];
        const pct = (stage.count / baseline) * 100;
        const dropPct = prev && prev.count > 0 ? Math.round(((prev.count - stage.count) / prev.count) * 100) : null;
        const isHovered = hovered === stage.id;

        return (
          <div key={stage.id}>
            {dropPct !== null && dropPct !== 0 && (
              <p className="mb-1 pl-1 text-[11px] font-medium">
                <span className={dropPct > 0 ? "text-red-500 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                  {dropPct > 0 ? "▼" : "▲"} {Math.abs(dropPct)}%
                </span>
                <span className="ml-1 text-neutral-400 dark:text-neutral-500">em relação a {prev!.label}</span>
              </p>
            )}
            <div
              className="group/funnel flex items-center gap-3"
              onMouseEnter={() => setHovered(stage.id)}
              onMouseLeave={() => setHovered((h) => (h === stage.id ? null : h))}
            >
              <p
                className={`w-28 shrink-0 truncate text-xs font-medium transition-colors ${
                  isHovered ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-700 dark:text-neutral-300"
                }`}
                title={stage.label}
              >
                {stage.label}
              </p>
              <div className="h-7 min-w-0 flex-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-md transition-[width,filter,box-shadow] duration-700 ease-out"
                  style={{
                    width: grown ? `${stage.count > 0 ? Math.min(Math.max(pct, 3), 100) : 0}%` : "0%",
                    backgroundColor: stage.color ?? "#2a78d6",
                    filter: isHovered ? "brightness(1.12)" : undefined,
                    boxShadow: isHovered ? "0 2px 10px -3px rgba(0,0,0,0.4)" : undefined,
                  }}
                />
              </div>
              <div className="w-24 shrink-0 text-right text-xs tabular-nums whitespace-nowrap text-neutral-500 dark:text-neutral-400 sm:w-32">
                <p className={isHovered ? "font-semibold text-neutral-900 dark:text-neutral-100" : ""}>
                  {stage.count} {stage.unit ?? "neg."}
                </p>
                {stage.value !== undefined && <p>{formatCurrency(stage.value)}</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
