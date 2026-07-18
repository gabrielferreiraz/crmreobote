import { formatCurrency } from "@/lib/format";

type FunnelStage = { id: string; label: string; count: number; value: number; color?: string | null };

/** Barras cinza semitransparentes na forma de um funil decrescente — ocupa o
 * mesmo espaço físico que o gráfico populado teria, em vez de um ícone com
 * uma frase perdida num card enorme, quando o filtro de período não pega
 * nenhum negócio aberto. */
export function FunnelSkeleton({ message }: { message: string }) {
  const widths = [92, 68, 46, 30];
  return (
    <div className="space-y-2.5">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-3 opacity-50">
          <span className="h-2.5 w-20 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-6 min-w-0 flex-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full rounded-md bg-neutral-200 dark:bg-neutral-700" style={{ width: `${w}%` }} />
          </div>
          <span className="h-2.5 w-16 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
        </div>
      ))}
      <p className="pt-1 text-center text-sm text-neutral-400 dark:text-neutral-500">{message}</p>
    </div>
  );
}

/**
 * Funil horizontal decrescente (estilo Pipedrive): a largura de cada barra é
 * proporcional à primeira etapa (o "topo" do funil), e cada etapa mostra a
 * variação de quantidade em relação à etapa anterior — bate o olho e já vê
 * onde a maior parte dos negócios "vaza". Importante: é uma foto do que está
 * aberto agora em cada etapa, não um funil de coorte (não acompanha os MESMOS
 * negócios ao longo do tempo) — então uma etapa pode até "crescer" em relação
 * à anterior, dependendo de quando cada negócio foi criado.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const baseline = Math.max(1, stages[0]?.count ?? 0);

  return (
    <div className="space-y-2.5">
      {stages.map((stage, i) => {
        const prev = stages[i - 1];
        const pct = (stage.count / baseline) * 100;
        const dropPct = prev && prev.count > 0 ? Math.round(((prev.count - stage.count) / prev.count) * 100) : null;

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
            <div className="flex items-center gap-3">
              <p
                className="w-28 shrink-0 truncate text-xs font-medium text-neutral-700 dark:text-neutral-300"
                title={stage.label}
              >
                {stage.label}
              </p>
              <div className="h-6 min-w-0 flex-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-md transition-all"
                  style={{
                    // Clamp pro caso (comum: isto é uma foto do pipeline agora,
                    // não um funil de coorte) de uma etapa depois da primeira ter
                    // MAIS negócios abertos do que ela — sem isso a barra
                    // ultrapassava 100% e vazava pra fora do card.
                    width: `${stage.count > 0 ? Math.min(Math.max(pct, 3), 100) : 0}%`,
                    backgroundColor: stage.color ?? "#525252",
                  }}
                />
              </div>
              <div className="w-24 shrink-0 text-right text-xs tabular-nums whitespace-nowrap text-neutral-500 dark:text-neutral-400 sm:w-32">
                <p>{stage.count} neg.</p>
                <p>{formatCurrency(stage.value)}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
