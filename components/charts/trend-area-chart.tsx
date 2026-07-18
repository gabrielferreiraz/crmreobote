import { formatCurrency } from "@/lib/format";

type Point = {
  label: string;
  value: number;
  tooltipLabel?: string;
  /** Detalhamento opcional (ex.: por consultor) mostrado embaixo do total no balão do ponto. */
  breakdown?: { label: string; value: number }[];
};

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
        {points.map((p, i) => {
          // Perto das bordas do gráfico, um balão centrado no ponto vaza pra
          // fora do card — perto do início ele "nasce" grudado na esquerda do
          // ponto, perto do fim grudado na direita, só no meio fica centrado.
          const anchor = p.x < 15 ? "left" : p.x > 85 ? "right" : "center";
          const breakdown = p.breakdown?.filter((b) => b.value > 0) ?? [];
          return (
            <div
              key={i}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <span className="block h-1.5 w-1.5 rounded-full bg-neutral-900 dark:bg-neutral-100" />
              {/* Balão custom em vez do title nativo do navegador — aparece na hora
                  (o title nativo demora ~1s) e já vem formatado em reais. */}
              <div
                className={`pointer-events-none absolute bottom-full z-10 mb-1.5 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-active:opacity-100 dark:bg-white dark:text-neutral-900 ${
                  breakdown.length > 0 ? "w-48" : "whitespace-nowrap"
                } ${anchor === "left" ? "left-0" : anchor === "right" ? "right-0" : "left-1/2 -translate-x-1/2"}`}
              >
                <p className="whitespace-nowrap">
                  <span className="capitalize opacity-70">{p.tooltipLabel ?? p.label}</span> · {formatValue(p.value)}
                </p>
                {breakdown.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-white/15 pt-1 dark:border-neutral-900/10">
                    {breakdown.slice(0, 5).map((b, bi) => (
                      <div key={bi} className="flex items-center justify-between gap-2 opacity-80">
                        <span className="min-w-0 truncate">{b.label}</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums">{formatValue(b.value)}</span>
                      </div>
                    ))}
                    {breakdown.length > 5 && (
                      <p className="opacity-60">
                        +{breakdown.length - 5} outro{breakdown.length - 5 === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
