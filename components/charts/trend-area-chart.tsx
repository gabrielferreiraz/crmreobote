type Point = { label: string; value: number };

/**
 * Área/linha em SVG puro. Os pontos são renderizados como <span> HTML por
 * cima (não dentro do SVG) porque o viewBox usa preserveAspectRatio="none"
 * pra esticar livremente — um <circle> ali dentro viraria elipse distorcida;
 * um <span> posicionado em % do container real fica sempre redondo.
 */
export function TrendAreaChart({ data }: { data: Point[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const points = data.map((d, i) => ({
    ...d,
    x: data.length > 1 ? (i / (data.length - 1)) * 100 : 50,
    y: 100 - (d.value / max) * 92,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L 100 100 L 0 100 Z`;

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
          <span
            key={i}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-900 dark:bg-neutral-100"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            title={`${p.label}: ${p.value.toLocaleString("pt-BR")}`}
          />
        ))}
      </div>
      <div className="mt-2 flex">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[11px] text-neutral-400 capitalize dark:text-neutral-500">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
