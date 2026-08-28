"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PartyPopper } from "lucide-react";
import { CountUpValue } from "@/components/count-up-value";

// Tempo total na tela / quanto antes do fim começa a desvanecer — dá pra
// perceber o card e o valor subindo com folga sem travar a TV numa
// comemoração longa demais.
const VISIBLE_MS = 7000;
const EXIT_MS = 500;

// Voo da foto até o card "Última venda" — em vez da foto só desaparecer
// junto com o resto da comemoração, ela viaja de verdade da posição do card
// (centro da tela) até a posição REAL do avatar em tv-view.tsx
// (#tv-last-sale-avatar), medida em tempo real via getBoundingClientRect().
// Não dá pra usar um ponto fixo em % pra esse destino: a posição desse
// card não é fixa, depende de quais widgets estão ligados acima dele e da
// largura fluida do painel. Termina a viagem com folga antes do resto da
// comemoração começar a desvanecer (FLIGHT_START_MS termina bem antes de
// VISIBLE_MS - EXIT_MS), senão o clone voador ia ficar competindo com o
// fade geral do overlay. Se o widget "Última venda" estiver desligado nas
// configurações da TV, o elemento alvo simplesmente não existe no DOM — a
// viagem é pulada e a foto só desvanece junto com o card, como antes.
const FLIGHT_DURATION_MS = 700;
const FLIGHT_START_MS = VISIBLE_MS - 1500;

// Confete no lugar dos fogos de artifício (fireworks-js) — a lib desenhava
// física de partícula de verdade em canvas (rastro com brilho, explosão,
// gravidade) e a TV física não estava aguentando o tanto de canvas
// simultâneo (placa de vídeo fraca, ver relato: "os fogos a TV não está
// aguentando"). Confete é só `<span>` com CSS `transform`/`opacity`
// animados (mesma técnica de components/confetti-burst.tsx, que já
// funciona bem numa tela comum) — sem canvas, sem cálculo de física por
// frame, ordens de grandeza mais leve pro hardware.
//
// Mais partículas (70) e delay espalhado por até 4,5s (não só os ~0,15s do
// confete "rápido" de components/confetti-burst.tsx) — aqui o confete
// precisa preencher boa parte dos 7s da comemoração inteira, não só um
// instante; sem isso ia cair tudo de uma vez nos 2 primeiros segundos e
// sobrar 5s de tela vazia. Cores douradas/âmbar de propósito — mesma
// linguagem visual do resto da comemoração (borda/halo/texto âmbar do
// card), não confete multicolorido genérico.
const CONFETTI_COUNT = 70;
const CONFETTI_COLORS = ["#fbbf24", "#f59e0b", "#fde047", "#fff7cc", "#eab308", "#ffffff"];
const CONFETTI_MAX_DELAY_S = 4.5;

type ConfettiParticle = {
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

function makeConfettiParticles(): ConfettiParticle[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * CONFETTI_MAX_DELAY_S,
    duration: 2.2 + Math.random() * 2,
    drift: (Math.random() - 0.5) * 220,
    rotate: (Math.random() - 0.5) * 900,
    size: 6 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    shape: Math.random() > 0.5 ? "rect" : "circle",
  }));
}

type WinSale = { id: string; name: string; image: string | null; value: number };

/**
 * Comemoração em tela cheia quando um negócio vira Ganho — tv-view.tsx
 * dispara isso comparando o id da última venda entre um refresh de 30s e o
 * outro (nunca no 1º carregamento da página, só numa venda nova de
 * verdade). Confete + foto/nome do consultor + valor subindo, some sozinha
 * depois de alguns segundos — é uma TV sem interação, ninguém vai fechar
 * isso clicando em algo.
 *
 * Era fogos de artifício de verdade (lib fireworks-js, física de partícula
 * em canvas) — trocado por confete em CSS puro (ver CONFETTI_* acima)
 * porque a TV física não estava aguentando o canvas: "os fogos a TV não
 * está aguentando, acho que a placa gráfica não tanka". Confete tem o mesmo
 * espírito de comemoração sem pesar no hardware — só `<span>`
 * transform/opacity, nada de canvas nem cálculo de física por frame.
 *
 * A foto do consultor não só desvanece no fim: ela literalmente voa do card
 * até "pousar" no avatar do card "Última venda" do painel de métricas (ver
 * FLIGHT_* acima) — técnica FLIP (First-Last-Invert-Play), com origem e
 * destino medidos de verdade via getBoundingClientRect() no momento do voo,
 * nunca em posição estimada (o card de destino não tem posição fixa na
 * tela).
 */
export function TvWinCelebration({ sale, onDone }: { sale: WinSale; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  // Gerado uma vez por comemoração (lazy init) — cada venda nova remonta
  // este componente inteiro (ver `key={celebration.id}` em tv-view.tsx),
  // então não precisa regenerar em nenhum outro momento.
  const [confetti] = useState(makeConfettiParticles);

  // Origem/destino do voo, medidos de verdade em pixel (getBoundingClientRect)
  // no momento em que a viagem começa — nunca estimado. `launched` esconde a
  // foto original do card pelo resto da vida do componente assim que o clone
  // nasce (evita a foto aparecer em dois lugares ao mesmo tempo); `landed`
  // controla se o clone está parado na origem (recém criado, sem transição
  // ainda) ou animando pro destino.
  const [flight, setFlight] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const [landed, setLanded] = useState(false);
  const [launched, setLaunched] = useState(false);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const photoDivRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let landTimer: ReturnType<typeof setTimeout> | undefined;

    const flightTimer = setTimeout(() => {
      const target = document.getElementById("tv-last-sale-avatar");
      const source = photoImgRef.current ?? photoDivRef.current;
      if (!target || !source) return; // widget desligado ou algo não montado — sem viagem, some junto com o resto
      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      setFlight({ from, to });
      setLaunched(true);
      // Dois rAF em sequência: garante que o navegador pinta o clone parado
      // na ORIGEM (sem transição) antes de aplicar o destino com transição —
      // com um só, às vezes cai no mesmo frame do 1º paint e o navegador
      // "pula" a origem direto, sem animar nada.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setLanded(true));
      });
      landTimer = setTimeout(() => setFlight(null), FLIGHT_DURATION_MS + 100);
    }, FLIGHT_START_MS);

    const leaveTimer = setTimeout(() => setLeaving(true), VISIBLE_MS - EXIT_MS);
    const doneTimer = setTimeout(onDone, VISIBLE_MS);
    return () => {
      clearTimeout(flightTimer);
      clearTimeout(landTimer);
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
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

      {/* Confete — ver CONFETTI_* acima pra explicação da troca. Só
          `<span>` com transform/opacity animados via CSS (mesmo
          @keyframes confetti-fall de components/confetti-burst.tsx,
          definido em globals.css), nada de canvas. */}
      <div className="absolute inset-0 overflow-hidden">
        {confetti.map((p) => (
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

      <div
        className={`relative flex flex-col items-center gap-3 rounded-[var(--tv-radius-lg)] border border-white/10 bg-neutral-900/85 text-center shadow-2xl backdrop-blur-xl ${
          leaving ? "" : "animate-tv-win-in"
        }`}
        style={{ padding: "calc(var(--tv-card-py) * 2.3) calc(var(--tv-card-px) * 2.6)" }}
      >
        <div
          className="relative mb-2 transition-opacity duration-150"
          style={{ perspective: "800px", opacity: launched ? 0 : 1 }}
        >
          <span className="animate-tv-glow-pulse absolute inset-0 -m-4 rounded-full bg-amber-400/40 blur-2xl" />
          {/* A própria foto gira no eixo Y dentro da moldura redonda que já
              tem — só nesse instante mesmo, o próprio ciclo de vida deste
              componente (monta/some em ~7s) já garante isso. `perspective`
              precisa estar no PAI (acima), não no elemento que gira.
              `launched` some com ela assim que o clone voador (mais abaixo)
              nasce, pra nunca mostrar a foto em dois lugares ao mesmo tempo. */}
          {sale.image ? (
            <img
              ref={photoImgRef}
              src={sale.image}
              alt={sale.name}
              className="animate-tv-photo-spin relative rounded-full border-4 border-amber-400 object-cover shadow-xl"
              style={{ width: "var(--tv-avatar-lg)", height: "var(--tv-avatar-lg)" }}
            />
          ) : (
            <div
              ref={photoDivRef}
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

    {/* Clone voador — portal direto pro body (não pro <div> acima) pra ficar
        num sistema de coordenadas de viewport puro, igual o que
        getBoundingClientRect() devolve, sem herdar o flex/overflow do
        overlay. z-index mais alto que o overlay (z-[200]) garante que ele
        aparece por cima de confete/card/tudo durante o voo. 1º render fica
        parado na origem sem transição (`landed` ainda false); no render
        seguinte (2 rAF depois) pula pra transição + posição de destino — é
        a técnica FLIP (First-Last-Invert-Play). Depois de aterrissar, some
        (ver landTimer no efeito acima): o avatar de verdade no card "Última
        venda" já está lá, com a mesma imagem, desde antes do voo começar. */}
    {flight &&
      createPortal(
        <div
          className="pointer-events-none fixed z-[210] overflow-hidden rounded-full border-4 border-amber-400 shadow-2xl"
          style={{
            left: landed ? flight.to.left : flight.from.left,
            top: landed ? flight.to.top : flight.from.top,
            width: landed ? flight.to.width : flight.from.width,
            height: landed ? flight.to.height : flight.from.height,
            transition: landed
              ? `left ${FLIGHT_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1), top ${FLIGHT_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1), width ${FLIGHT_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1), height ${FLIGHT_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1)`
              : "none",
          }}
        >
          {sale.image ? (
            <img src={sale.image} alt={sale.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-neutral-800 font-semibold text-white text-[length:var(--tv-text-value-lg)]">
              {sale.name.charAt(0)}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
