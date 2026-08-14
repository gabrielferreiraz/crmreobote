"use client";

import { useEffect, useState } from "react";

// Sempre o horário local da operação (Campo Grande/MS, America/Campo_Grande,
// UTC-4), não o fuso de onde quer que o servidor rode e NÃO
// "America/Sao_Paulo" — são fusos diferentes (SP é UTC-3), usar o de SP aqui
// deixava o relógio da TV 1h adiantado. Mesmo raciocínio de lib/timezone.ts
// pro resto do app, só que formatado direto aqui (client-only, não precisa
// de cálculo de boundary de dia, só de exibição).
const TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Campo_Grande",
});
const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "America/Campo_Grande",
});

/**
 * Relógio fixo no canto da TV — atualiza sozinho a cada segundo, isolado num
 * componente próprio pra ISSO não re-renderizar o resto de tv-view.tsx a
 * cada tick (o carrossel de anúncio/métricas não tem nada a ver com o
 * relógio andando). `now` começa null e só é definido dentro do
 * useEffect (nunca no render inicial) pra evitar descompasso de hidratação —
 * a hora que o servidor via ao renderizar a página quase nunca bate
 * exatamente com a hora de quem está vendo no momento em que o JS liga.
 *
 * `stale`: aviso discreto de "os números na tela podem estar desatualizados"
 * (ver STALE_AFTER_MS em tv-view.tsx) — um ponto âmbar pulsando ao lado da
 * hora. É uma tela na parede sem console de erro visível; sem isso, uma
 * falha silenciosa de rede/sessão deixava a TV mostrando dados cada vez
 * mais velhos pra sempre, sem ninguém perceber.
 */
export function TvClock({ stale = false }: { stale?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!now) return null;

  return (
    <div
      className="surface-glass-panel pointer-events-none absolute flex items-start gap-2 rounded-[var(--tv-radius)] text-white"
      style={{ top: "var(--tv-gap)", left: "var(--tv-gap)", padding: "calc(var(--tv-card-py) * 0.55) calc(var(--tv-card-px) * 0.7)" }}
    >
      <div>
        <p className="leading-none font-bold tabular-nums text-[length:var(--tv-clock-time)]">
          {TIME_FORMATTER.format(now)}
        </p>
        <p className="mt-1 leading-none font-medium text-white/70 capitalize text-[length:var(--tv-clock-date)]">
          {DATE_FORMATTER.format(now)}
        </p>
      </div>
      {stale && (
        <span
          title="Sem conseguir atualizar os dados há alguns minutos — os números podem estar desatualizados."
          className="animate-tv-glow-pulse mt-0.5 shrink-0 rounded-full bg-amber-400"
          style={{ width: "clamp(6px, 0.5vw, 10px)", height: "clamp(6px, 0.5vw, 10px)" }}
        />
      )}
    </div>
  );
}
