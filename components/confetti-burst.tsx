"use client";

import { useEffect, useState } from "react";

const CONFETTI_COLORS = ["#059669", "#34d399", "#f59e0b", "#fbbf24", "#e5e5e5", "#a3a3a3"];
const PARTICLE_COUNT = 28;

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

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.15,
    duration: 1.1 + Math.random() * 0.6,
    drift: (Math.random() - 0.5) * 140,
    rotate: (Math.random() - 0.5) * 720,
    size: 5 + Math.random() * 5,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    shape: Math.random() > 0.5 ? "rect" : "circle",
  }));
}

/** Comemoração rápida ao ganhar um negócio — dispara uma vez e some sozinha, sem travar interação nem precisar ser fechada. */
export function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  const [particles] = useState(makeParticles);

  useEffect(() => {
    const timeout = setTimeout(() => onDone?.(), 1900);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
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
              borderRadius: p.shape === "circle" ? "9999px" : "1px",
              animation: `confetti-fall ${p.duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${p.delay}s forwards`,
              "--drift": `${p.drift}px`,
              "--rotate": `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
