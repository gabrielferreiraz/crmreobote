"use client";

import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { CountUpValue } from "@/components/count-up-value";

const CONFETTI_COLORS = ["#fbbf24", "#f59e0b", "#8b8df3", "#a3a5f6", "#ffffff", "#34d399"];
const PARTICLE_COUNT = 70;
// Tempo total na tela / quanto antes do fim começa a desvanecer — dá pra
// perceber o card e o valor subindo com folga sem travar a TV numa
// comemoração longa demais.
const VISIBLE_MS = 7000;
const EXIT_MS = 500;

type WinSale = { id: string; name: string; image: string | null; value: number };

type Particle = {
  id: number;
  left: number;
  delay: number;
  duration: number;
  drift: number;
  rotate: number;
  size: number;
  color: string;
  shape: "rect" | "circle";
};

// Mesma técnica/keyframe de components/confetti-burst.tsx (confetti-fall, já
// em globals.css), só que com bem mais partículas e uma queda mais longa e
// espalhada no tempo (delay até 1.2s) — a versão "rápida" existente é pra um
// flash de UI de 2s; aqui é uma comemoração de tela cheia numa TV, precisa
// de mais sustentação.
function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    duration: 2.4 + Math.random() * 1.4,
    drift: (Math.random() - 0.5) * 220,
    rotate: (Math.random() - 0.5) * 900,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    shape: Math.random() > 0.5 ? "rect" : "circle",
  }));
}

/**
 * Comemoração em tela cheia quando um negócio vira Ganho — tv-view.tsx
 * dispara isso comparando o id da última venda entre um refresh de 30s e o
 * outro (nunca no 1º carregamento da página, só numa venda nova de
 * verdade). Confete + foto/nome do consultor + valor subindo, some sozinha
 * depois de alguns segundos — é uma TV sem interação, ninguém vai fechar
 * isso clicando em algo.
 */
export function TvWinCelebration({ sale, onDone }: { sale: WinSale; onDone: () => void }) {
  const [particles] = useState(makeParticles);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const leaveTimer = setTimeout(() => setLeaving(true), VISIBLE_MS - EXIT_MS);
    const doneTimer = setTimeout(onDone, VISIBLE_MS);
    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[200] flex items-center justify-center overflow-hidden transition-opacity duration-500 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Escurece um pouco + glow dourado atrás do card — dá contraste pro
          confete/card sem apagar o resto da TV, ainda dá pra perceber o
          carrossel continuando atrás. */}
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="absolute rounded-full opacity-70 blur-3xl"
        style={{
          width: "clamp(320px, 32vw, 640px)",
          height: "clamp(320px, 32vw, 640px)",
          background: "radial-gradient(circle, rgba(251,191,36,0.35), transparent 70%)",
        }}
      />

      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute top-0"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.shape === "rect" ? p.size * 2.2 : p.size,
              backgroundColor: p.color,
              borderRadius: p.shape === "circle" ? "9999px" : "2px",
              animation: `confetti-fall ${p.duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${p.delay}s forwards`,
              "--drift": `${p.drift}px`,
              "--rotate": `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}

      <div
        className={`relative flex flex-col items-center gap-3 rounded-[var(--tv-radius-lg)] border border-white/10 bg-neutral-900/85 text-center shadow-2xl backdrop-blur-xl ${
          leaving ? "" : "animate-tv-win-in"
        }`}
        style={{ padding: "calc(var(--tv-card-py) * 2.3) calc(var(--tv-card-px) * 2.6)" }}
      >
        <div className="relative mb-2" style={{ perspective: "800px" }}>
          <span className="animate-tv-glow-pulse absolute inset-0 -m-4 rounded-full bg-amber-400/40 blur-2xl" />
          {/* A própria foto gira no eixo Y dentro da moldura redonda que já
              tem — só nesse instante mesmo, o próprio ciclo de vida deste
              componente (monta/some em ~7s) já garante isso. `perspective`
              precisa estar no PAI (acima), não no elemento que gira. */}
          {sale.image ? (
            <img
              src={sale.image}
              alt={sale.name}
              className="animate-tv-photo-spin relative rounded-full border-4 border-amber-400 object-cover shadow-xl"
              style={{ width: "var(--tv-avatar-lg)", height: "var(--tv-avatar-lg)" }}
            />
          ) : (
            <div
              className="animate-tv-photo-spin relative flex items-center justify-center rounded-full border-4 border-amber-400 bg-neutral-800 font-semibold text-white shadow-xl text-[length:var(--tv-text-value-lg)]"
              style={{ width: "var(--tv-avatar-lg)", height: "var(--tv-avatar-lg)" }}
            >
              {sale.name.charAt(0)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-amber-400">
          <PartyPopper className="shrink-0" style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)" }} strokeWidth={2} />
          <p className="font-semibold tracking-[0.2em] uppercase text-[length:var(--tv-text-label)]">
            Nova venda fechada
          </p>
          <PartyPopper
            className="-scale-x-100 shrink-0"
            style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)" }}
            strokeWidth={2}
          />
        </div>

        <p className="font-bold text-white text-[length:var(--tv-text-value-lg)]">{sale.name}</p>

        <p className="font-extrabold tabular-nums text-amber-400 text-[length:var(--tv-text-hero)]">
          <CountUpValue value={sale.value} format="currency" />
        </p>
      </div>
    </div>
  );
}
