import { formatCurrency } from "@/lib/format";

type Point = { label: string; value: number; tooltipLabel?: string };

/**
 * Área/linha em SVG puro. Os pontos são renderizados como <span> HTML por
 * cima (não dentro do SVG) porque o viewBox usa preserveAspectRatio="none"
 * pra esticar livremente — um <circle> ali dentro viraria elipse distorcida;
 * um <span> posicionado em % do container real fica sempre redondo.
 */
export function TrendAreaChart({
  data,
  formatValue = formatCurrency,
}: {
  data: Point[];
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const points = data.map((d, i) => ({
    ...d,
    x: data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    y: 100 - (d.value / max) * 92,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L 100 100 L 0 100 Z`;

  // Com muitos pontos (ex.: 31 dias), um rótulo por ponto vira uma fileira de
  // texto colada/sobreposta em tela estreita — mostra só um subconjunto bem
  // espaçado (sempre incluindo o primeiro e o último), como qualquer lib de
  // gráfico faz com o eixo X.
  const MAX_LABELS = 6;
  const labelStep = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const axisLabels = points.filter((_, i) => i % labelStep === 0 || i === points.length - 1);

  return (
    <div>
      <div className="relative h-32 w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#trend-fill)" stroke="none" className="text-neutral-900 dark:text-neutral-100" />
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-neutral-900 dark:text-neutral-100"
          />
        </svg>
        {points.map((p, i) => (
          <div
            key={i}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-neutral-900 dark:bg-neutral-100" />
            {/* Balão custom em vez do title nativo do navegador — aparece na hora
                (o title nativo demora ~1s) e já vem formatado em reais. */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-active:opacity-100 dark:bg-white dark:text-neutral-900">
              <span className="capitalize opacity-70">{p.tooltipLabel ?? p.label}</span> · {formatValue(p.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-neutral-400 capitalize dark:text-neutral-500">
        {axisLabels.map((p, i) => {
          const isFirst = p.x === 0;
          const isLast = p.x === 100;
          return (
            <span
              key={i}
              className={`absolute whitespace-nowrap ${isFirst ? "left-0" : isLast ? "right-0" : "-translate-x-1/2"}`}
              style={isFirst || isLast ? undefined : { left: `${p.x}%` }}
            >
              {p.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
