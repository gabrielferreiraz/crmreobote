"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { HelpTour } from "@/lib/help/types";

const PADDING = 8;
const CARD_WIDTH = 320;
const GAP = 14;
/** Quanto esperar o elemento aparecer depois de navegar pra outra rota. */
const TARGET_WAIT_MS = 2000;

type Spot = { top: number; left: number; width: number; height: number } | null;

/**
 * Acha o elemento do passo. `querySelectorAll` + primeiro VISÍVEL, nunca
 * `querySelector` direto: vários controles do CRM ficam montados em duplicata
 * (cabeçalho de desktop e de mobile existem os dois ao mesmo tempo, alternados
 * só por CSS — ver mobile-header.tsx), e o primeiro do DOM costuma ser
 * justamente o que está escondido. Mesma checagem de visibilidade do foco
 * preso do Modal.
 */
function findTarget(name: string | undefined): HTMLElement | null {
  if (!name || typeof document === "undefined") return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[data-help="${CSS.escape(name)}"]`);
  return Array.from(nodes).find((node) => node.getClientRects().length > 0) ?? null;
}

export function HelpTour({ tour, onClose }: { tour: HelpTour; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  // A medida guarda a QUAL passo ela pertence, e o recorte é derivado disso.
  // Sem o índice junto, trocar de passo exigiria um setSpot(null) dentro do
  // efeito só pra limpar — e, entre esse efeito e a medida nova, o recorte do
  // passo anterior aparecia por um quadro no lugar errado.
  const [measured, setMeasured] = useState<{ index: number; spot: Spot } | null>(null);
  const [mounted, setMounted] = useState(false);
  const stepRef = useRef(0);

  // Tira de uma vez os passos que dependem de um elemento que esta pessoa não
  // tem na tela (ver requiresTarget em lib/help/types.ts). Só na montagem: o
  // contador "passo 2 de 5" precisa bater com o que ela vai de fato ver.
  const [steps] = useState(() =>
    tour.steps.filter((s) => !(s.requiresTarget && !s.route && !findTarget(s.target))),
  );

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Navega antes de procurar o alvo, quando o passo mora em outra tela.
  useEffect(() => {
    if (step?.route && step.route !== pathname) router.push(step.route);
  }, [step?.route, pathname, router]);

  const spot = measured && measured.index === index ? measured.spot : null;

  const measure = useCallback(() => {
    const el = findTarget(step?.target);
    if (!el) {
      setMeasured({ index, spot: null });
      return;
    }
    const rect = el.getBoundingClientRect();
    setMeasured({
      index,
      spot: {
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      },
    });
  }, [step?.target, index]);

  // Procura o alvo repetidamente por um tempo curto: depois de navegar, a
  // tela seguinte pode levar um instante pra renderizar. Desiste em silêncio
  // — o passo vira um card centralizado (ver `spot === null` abaixo), que é o
  // que mantém o tour útil mesmo quando um botão mudou de lugar.
  useEffect(() => {
    stepRef.current = index;
    if (!step?.target) return;

    let raf = 0;
    const started = Date.now();
    const tick = () => {
      if (stepRef.current !== index) return;
      const el = findTarget(step.target);
      if (el) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        // Mede depois da rolagem suave terminar, senão o recorte nasce no
        // lugar antigo e "persegue" o elemento durante a animação.
        setTimeout(() => {
          if (stepRef.current === index) measure();
        }, 320);
        return;
      }
      if (Date.now() - started > TARGET_WAIT_MS) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, step?.target, measure]);

  // Acompanha rolagem e mudança de tamanho da janela enquanto o passo está aberto.
  useEffect(() => {
    if (!spot) return;
    const onChange = () => measure();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [spot, measure]);

  const next = useCallback(() => {
    if (isLast) onClose();
    else setIndex((i) => i + 1);
  }, [isLast, onClose]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(0, i - 1));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [next, onClose]);

  if (!mounted || !step) return null;

  // Posição do card: embaixo do elemento se couber, senão em cima; e sempre
  // dentro da janela na horizontal.
  let cardStyle: React.CSSProperties;
  if (spot) {
    const below = spot.top + spot.height + GAP;
    const fitsBelow = below + 190 < window.innerHeight;
    const left = Math.min(
      Math.max(GAP, spot.left + spot.width / 2 - CARD_WIDTH / 2),
      window.innerWidth - CARD_WIDTH - GAP,
    );
    cardStyle = fitsBelow
      ? { top: below, left, width: CARD_WIDTH }
      : { bottom: window.innerHeight - spot.top + GAP, left, width: CARD_WIDTH };
  } else {
    cardStyle = {
      top: "50%",
      left: "50%",
      width: Math.min(CARD_WIDTH + 40, window.innerWidth - 32),
      transform: "translate(-50%, -50%)",
    };
  }

  return createPortal(
    // z acima de tudo que o dashboard monta (cabeçalho 30, barra mobile 40,
    // avisos 70) — um tour que fica ATRÁS de um aviso não guia ninguém.
    <div className="fixed inset-0 z-[160]" role="dialog" aria-modal="true" aria-label={tour.title}>
      {spot ? (
        <>
          {/* O escurecido inteiro é a SOMBRA deste retângulo — um box-shadow
              gigante faz o "recorte" sem precisar de máscara SVG nem de
              quatro divs se encontrando em pixel exato nas quinas. */}
          <div
            className="pointer-events-auto absolute rounded-xl ring-2 ring-brand transition-all duration-300 ease-smooth"
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
              boxShadow: "0 0 0 9999px var(--help-spotlight-scrim)",
            }}
            onClick={next}
          />
          <div
            className="pointer-events-none absolute rounded-xl ring-4 ring-brand/30"
            style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "var(--help-spotlight-scrim)" }}
          onClick={next}
        />
      )}

      <div
        className="surface-glass-filter absolute rounded-xl p-4 shadow-2xl"
        style={{ ...cardStyle, animation: "pop-in 200ms var(--ease-spring)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{step.title}</p>
          <button
            type="button"
            onClick={onClose}
            className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label="Sair do tour"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === index ? "w-4 bg-brand" : "w-1.5 bg-neutral-300 dark:bg-neutral-700"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {!isFirst && (
              <button type="button" onClick={() => setIndex((i) => i - 1)} className="btn-ghost btn-sm" aria-label="Passo anterior">
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
                Voltar
              </button>
            )}
            <button type="button" onClick={next} className="btn-primary btn-sm">
              {isLast ? "Concluir" : "Próximo"}
              {!isLast && <ChevronRight className="-mr-1 h-3.5 w-3.5" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-neutral-400 dark:text-neutral-500">
          Passo {index + 1} de {steps.length} · Esc para sair
        </p>
      </div>
    </div>,
    document.body,
  );
}
