"use client";

import { useEffect, useRef } from "react";

/** Silhueta exata do ícone "flame" do lucide-react (viewBox 0 0 24 24) — não
 * redesenhar: o Churrascômetro precisa continuar com essa mesma chama, só
 * que animada. */
const FLAME_PATH =
  "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4";

// A chama ocupa aproximadamente y=[3,21] dentro do viewBox 24x24 — usado
// tanto pro retângulo de preenchimento (de baixo pra cima) quanto pro pivô
// de rotação do balanço do topo (ver FLAME_BASE_Y).
const FLAME_TOP_Y = 3;
const FLAME_BOTTOM_Y = 21;
const FLAME_HEIGHT = FLAME_BOTTOM_Y - FLAME_TOP_Y;
// Pivô da oscilação: perto da base da chama, não no centro do viewBox — é
// isso que faz a base ficar "presa" e só a ponta balançar (rotação em torno
// de um ponto baixo desloca muito mais os pontos distantes dele, ou seja, o
// topo).
const FLAME_BASE_Y = 20;

const MAX_SPARKS = 12;
const SPARK_COLORS = ["#fff0a6", "#ffbb32", "#ff6518"];

// ~30 FPS: a TV fica ligada o dia inteiro, não precisamos de 60.
const FRAME_INTERVAL_MS = 1000 / 30;

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(from: string, to: string, t: number) {
  const f = parseInt(from.slice(1), 16);
  const to2 = parseInt(to.slice(1), 16);
  const fr = (f >> 16) & 255,
    fg = (f >> 8) & 255,
    fb = f & 255;
  const tr = (to2 >> 16) & 255,
    tg = (to2 >> 8) & 255,
    tb = to2 & 255;
  const r = Math.round(lerp(fr, tr, t));
  const g = Math.round(lerp(fg, tg, t));
  const b = Math.round(lerp(fb, tb, t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Chama animada do Churrascômetro — consome um `progress` (0-100) que já
 * vem pronto de fora (churrascometroProgress, calculado em tv-dashboard.ts a
 * partir das vendas do mês); este componente não sabe nada sobre metas ou
 * vendas, só reage ao número.
 *
 * 0-50%: só contorno, interior vazio, quase parada, sem faíscas — um ícone
 * elegante e estático. Acima de 50% ela vai "acendendo": preenche de baixo
 * pra cima, ganha brilho e o topo passa a balançar cada vez mais (a base
 * fica sempre parada), até o estado máximo em 100%.
 *
 * Toda a animação roda fora do React (refs + requestAnimationFrame,
 * ~30 FPS) — o componente só re-renderiza quando `progress` muda de verdade,
 * nunca a cada frame. As faíscas são um <canvas> pequeno, não dezenas de
 * divs. */
export function AnimatedFire({
  progress,
  className,
  style,
}: {
  progress: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const targetProgressRef = useRef(0);
  const smoothedProgressRef = useRef(0);
  const fillRectRef = useRef<SVGRectElement>(null);
  const swayGroupRef = useRef<SVGGElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const timeRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    targetProgressRef.current = Math.max(0, Math.min(100, progress || 0));
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    let acc = 0;

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (lastFrameRef.current === null) lastFrameRef.current = now;
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      acc += dt;
      if (acc < FRAME_INTERVAL_MS) return;
      const stepMs = acc;
      acc = 0;

      // Interpolação suave (~600ms) do percentual real pro valor usado na
      // animação — evita o preenchimento "pular" quando uma venda nova
      // muda o Churrascômetro de uma vez.
      const smoothing = 1 - Math.pow(0.001, stepMs / 600);
      smoothedProgressRef.current = lerp(
        smoothedProgressRef.current,
        targetProgressRef.current,
        smoothing,
      );
      const progress = smoothedProgressRef.current;
      const fireProgress = progress <= 50 ? 0 : Math.min((progress - 50) / 50, 1);
      timeRef.current += stepMs / 1000;
      const t = timeRef.current;

      // --- Preenchimento (de baixo pra cima) ---
      if (fillRectRef.current) {
        const filledHeight = FLAME_HEIGHT * fireProgress;
        fillRectRef.current.setAttribute("y", String(FLAME_BOTTOM_Y - filledHeight));
        fillRectRef.current.setAttribute("height", String(filledHeight));
      }

      // --- Balanço do topo (pivô perto da base = base parada, topo solto) ---
      // Velocidade cresce com fireProgress; ganha um "pop" extra bem perto
      // de 100% (recompensa visual do estado máximo).
      const maxBoost = progress >= 99.5 ? 1.5 : 1;
      const speed = (0.6 + 1.8 * fireProgress) * maxBoost;
      const amplitude = 6 * fireProgress * maxBoost; // graus
      const angle =
        amplitude * (0.7 * Math.sin(t * speed) + 0.3 * Math.sin(t * speed * 2.3 + 1.2));
      swayGroupRef.current?.setAttribute("transform", `rotate(${angle.toFixed(2)} 12 ${FLAME_BASE_Y})`);

      // --- Contorno: cor e brilho ---
      const glowT = fireProgress;
      const strokeColor = lerpColor("#ff7a00", "#ffc13a", glowT * 0.7);
      if (outlineRef.current) outlineRef.current.setAttribute("stroke", strokeColor);
      if (glowRef.current) {
        glowRef.current.setAttribute("stroke", "#ff8c0a");
        glowRef.current.style.opacity = String(glowT * 0.55 + (progress >= 99.5 ? 0.15 : 0));
      }

      // --- Faíscas (canvas) ---
      if (ctx && canvas) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Chance de nascer uma faísca nova neste frame, crescendo com
        // fireProgress: raras perto de 0.2-0.4, algumas em 0.6-0.8, mais
        // presentes em 1.0. Zero abaixo de 50% (fireProgress = 0).
        const spawnChance = fireProgress <= 0 ? 0 : 0.015 + fireProgress * 0.085;
        if (sparksRef.current.length < MAX_SPARKS && Math.random() < spawnChance) {
          const spawnX = w * (0.35 + Math.random() * 0.3);
          const spawnY = h * (FLAME_TOP_Y / 24) + 4;
          sparksRef.current.push({
            x: spawnX,
            y: spawnY,
            vx: (Math.random() - 0.5) * 10,
            vy: -(14 + Math.random() * 10),
            life: 0,
            maxLife: 0.7 + Math.random() * 0.5,
            size: 1.4 + Math.random() * 1.2,
            color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
          });
        }

        const stepS = stepMs / 1000;
        sparksRef.current = sparksRef.current.filter((s) => {
          s.life += stepS;
          if (s.life >= s.maxLife) return false;
          s.x += s.vx * stepS;
          s.y += s.vy * stepS;
          s.vy += 6 * stepS; // leve desaceleração da subida
          const lifeT = s.life / s.maxLife;
          const alpha = 1 - lifeT;
          const size = s.size * (1 - lifeT * 0.7);
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(s.x, s.y, Math.max(0.2, size), 0, Math.PI * 2);
          ctx.fill();
          return true;
        });
        ctx.globalAlpha = 1;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const clampedProgress = Math.max(0, Math.min(100, progress || 0));
  // Cresce em degraus de 10 em 10% (0..10 degraus) até ficar nitidamente
  // maior em 100% — pedido explícito: "aumente a cada 10%". Escala via
  // `transform` num wrapper interno, NUNCA mexendo na largura/altura reais
  // do wrapper externo (esse continua do tamanho fixo que o chamador passou
  // em `style`, o mesmo espaço que ele sempre ocupou no layout flex) — o
  // crescimento é só visual, por cima, sem empurrar nada ao redor.
  // `transformOrigin: "right center"` ancora o lado que fica colado no
  // texto "Churrascômetro" (à direita) parado, e cresce pra
  // esquerda/cima/baixo — espaço vazio do card, que já é `overflow-hidden`
  // (ver GlassCard) e contém qualquer sobra visual sem cortar feio.
  const growthStep = Math.floor(clampedProgress / 10); // 0..10
  const fireScale = 1 + growthStep * 0.08; // 1.0 (0-9%) até 1.8 (100%)

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${fireScale})`,
          transformOrigin: "right center",
          transition: "transform 700ms ease-out",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="100%"
          height="100%"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ overflow: "visible" }}
        >
          <defs>
            <clipPath id="fire-clip">
              <path d={FLAME_PATH} />
            </clipPath>
            <radialGradient id="fire-core-gradient" cx="50%" cy="72%" r="65%">
              <stop offset="0%" stopColor="#ffd35a" />
              <stop offset="55%" stopColor="#ff9b16" />
              <stop offset="100%" stopColor="#e9460b" />
            </radialGradient>
          </defs>

          {/* Preenchimento interno — clipado pela silhueta da chama, sobe de
              baixo pra cima conforme fireProgress. */}
          <g clipPath="url(#fire-clip)">
            <rect ref={fillRectRef} x={0} y={FLAME_BOTTOM_Y} width={24} height={0} fill="url(#fire-core-gradient)" />
          </g>

          {/* Contorno — sempre visível, único elemento que balança (pivô perto
              da base, então a base fica parada e o topo é o que se move). */}
          <g ref={swayGroupRef}>
            {/* Cópia levemente desfocada por trás pra dar brilho sem exagerar
                (sem blur gigante, sem neon). */}
            <path
              ref={glowRef}
              d={FLAME_PATH}
              stroke="#ff8c0a"
              style={{ opacity: 0, filter: "blur(1.5px)" }}
            />
            <path ref={outlineRef} d={FLAME_PATH} stroke="#ff7a00" />
          </g>
        </svg>

        <canvas
          ref={canvasRef}
          width={48}
          height={64}
          style={{
            position: "absolute",
            left: "-25%",
            top: "-40%",
            width: "150%",
            height: "180%",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
