"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PartyPopper } from "lucide-react";
import { Fireworks, type FireworksHandlers } from "@fireworks-js/react";
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
// Não dá pra usar um ponto fixo em % como HERO_END abaixo: a posição desse
// card não é fixa, depende de quais widgets estão ligados acima dele e da
// largura fluida do painel. Termina a viagem com folga antes do resto da
// comemoração começar a desvanecer (FLIGHT_START_MS termina bem antes de
// VISIBLE_MS - EXIT_MS), senão o clone voador ia ficar competindo com o
// fade geral do overlay. Se o widget "Última venda" estiver desligado nas
// configurações da TV, o elemento alvo simplesmente não existe no DOM — a
// viagem é pulada e a foto só desvanece junto com o card, como antes.
const FLIGHT_DURATION_MS = 700;
const FLIGHT_START_MS = VISIBLE_MS - 1500;

// Foguete de destaque — não faz parte do show ambiente da lib (fireworks-js
// não tem API pra mandar um foguete pra um ponto exato, só aleatório, ver
// comentário mais abaixo), então esse aqui é feito à mão, um só, ancorado
// no ponto de ESTOURO (não no canto de partida): o rastro nasce deslocado
// (--heroDx/--heroDy) e "chega" em (0,0) da div, onde o flash/raios já
// estão. Sai do canto inferior esquerdo, viaja na diagonal em direção ao
// canto superior direito, mas só estoura ao passar perto da foto do
// consultor no meio — pedido explícito, não é lançamento aleatório.
const HERO_START = { left: 6, top: 92 };
const HERO_END = { left: 50, top: 40 };
const HERO_TRAVEL_S = 1.1;
const HERO_START_DELAY_S = 0.4;
const HERO_COLOR = "#fde047";
const HERO_RAY_COUNT = 16;
const HERO_RAY_LENGTH = 110;
const HERO_RAY_ANGLES = Array.from({ length: HERO_RAY_COUNT }, (_, i) => (360 / HERO_RAY_COUNT) * i);

type WinSale = { id: string; name: string; image: string | null; value: number };

/**
 * Comemoração em tela cheia quando um negócio vira Ganho — tv-view.tsx
 * dispara isso comparando o id da última venda entre um refresh de 30s e o
 * outro (nunca no 1º carregamento da página, só numa venda nova de
 * verdade). Fogos de artifício + foto/nome do consultor + valor subindo,
 * some sozinha depois de alguns segundos — é uma TV sem interação, ninguém
 * vai fechar isso clicando em algo.
 *
 * Fogos são a lib fireworks-js (física de partícula de verdade em canvas —
 * gravidade, rastro, brilho), não mais CSS na mão: já tentamos simular à
 * mão (canto da tela → converge na foto) duas vezes e não convenceu — essa
 * trajetória customizada não existe pronta em NENHUMA lib de fogos (todas
 * modelam "sobe de uma faixa embaixo, estoura em cima", não "viaja até um
 * alvo"), então a decisão foi trocar por física de verdade em vez de
 * continuar tentando simular à mão. `rocketsPoint` mantém o lançamento
 * numa faixa larga (não só o centro), pra sensação de "vários fogos", e
 * `boundaries` prende a explosão na região onde o card está, não a tela
 * inteira — o efeito lê como "fogos comemorando perto do consultor", só
 * não converge literalmente na foto dele.
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
  const fireworksRef = useRef<FireworksHandlers>(null);

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

    const leaveTimer = setTimeout(() => {
      setLeaving(true);
      // Para de LANÇAR fogo novo assim que a comemoração começa a
      // desvanecer — o que já estava no ar termina sozinho (a lib não
      // interrompe uma explosão no meio), só evita começar algo novo bem
      // na hora que a tela já está sumindo.
      fireworksRef.current?.stop();
    }, VISIBLE_MS - EXIT_MS);
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
      {/* Escurece um pouco + glow dourado atrás do card — dá contraste pros
          fogos/card sem apagar o resto da TV, ainda dá pra perceber o
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

      <Fireworks
        ref={fireworksRef}
        autostart
        options={{
          opacity: 0.55,
          intensity: 22,
          explosion: 6,
          particles: 60,
          traceSpeed: 9,
          gravity: 1.2,
          // Cores quentes (dourado/âmbar) predominando — combina com o
          // resto da identidade da comemoração (halo/borda âmbar do card,
          // ver abaixo) — sem travar num hue só, pra não ficar monocromático.
          hue: { min: 20, max: 50 },
          rocketsPoint: { min: 15, max: 85 },
          // Padrão da lib é bem fino (explosion 1-3px, trace 1-2px) — quase
          // some numa TV vista de longe. Mais grosso nos dois lê melhor à
          // distância sem ficar espesso a ponto de parecer desenhado.
          lineWidth: {
            explosion: { min: 3, max: 6 },
            trace: { min: 2, max: 4 },
          },
          // Prende a explosão na metade de cima da tela, onde o card fica
          // (ele é centralizado verticalmente) — sem isso os fogos
          // estourariam em qualquer altura, inclusive por baixo do card.
          boundaries: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight * 0.62 },
        }}
        className="absolute inset-0"
      />

      <div
        className="absolute"
        style={
          {
            left: `${HERO_END.left}%`,
            top: `${HERO_END.top}%`,
            "--heroDx": `${HERO_START.left - HERO_END.left}vw`,
            "--heroDy": `${HERO_START.top - HERO_END.top}vh`,
          } as React.CSSProperties
        }
      >
        {/* Rastro viajando do canto até aqui. */}
        <span
          className="absolute rounded-full"
          style={{
            width: 8,
            height: 8,
            left: -4,
            top: -4,
            backgroundColor: HERO_COLOR,
            boxShadow: `0 0 16px 5px ${HERO_COLOR}`,
            opacity: 0,
            animation: `tv-hero-travel ${HERO_TRAVEL_S}s cubic-bezier(0.25, 0.1, 0.4, 1) ${HERO_START_DELAY_S}s forwards`,
          }}
        />
        {/* Flash branco do estouro, dispara assim que o rastro chega. */}
        <span
          className="absolute rounded-full bg-white"
          style={{
            width: 22,
            height: 22,
            left: -11,
            top: -11,
            opacity: 0,
            animation: `tv-hero-flash 0.5s ease-out ${HERO_START_DELAY_S + HERO_TRAVEL_S}s forwards`,
          }}
        />
        {/* Raios grossos se espalhando — mesma linguagem visual (linha
            grossa, não bolinha) dos fogos da lib logo acima, pra este
            foguete ler como parte do mesmo show, não um efeito à parte. */}
        {HERO_RAY_ANGLES.map((angle, i) => (
          <div key={i} className="absolute" style={{ left: 0, top: 0, width: 0, height: 0, transform: `rotate(${angle}deg)` }}>
            <span
              className="absolute"
              style={{
                left: -2,
                top: 0,
                width: 4,
                height: HERO_RAY_LENGTH,
                background: `linear-gradient(to bottom, ${HERO_COLOR}, rgba(253, 224, 71, 0))`,
                transformOrigin: "top center",
                opacity: 0,
                animation: `tv-hero-ray 1s ease-out ${HERO_START_DELAY_S + HERO_TRAVEL_S}s forwards`,
              }}
            />
          </div>
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
        aparece por cima de fogos/card/tudo durante o voo. 1º render fica
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
