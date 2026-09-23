"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy, Crown } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/format";

/** Mesmo formato que lib/tv-dashboard.ts devolve em `metrics.ranking` — o
 * valor vendido no mês vem em `total` (não `value`, que é do tipo WinSale da
 * comemoração de venda). */
type RankingUser = { id: string; name: string; image: string | null; total: number };

/** Tempo parado no topo, com os 10 primeiros à vista, antes de começar a
 * descer. Pedido explícito: 30s. */
const STATIC_MS = 30_000;
/** Descida até o último e volta até o primeiro — 25s cada, fechando o ciclo
 * total em 80s (1min20s) junto com STATIC_MS acima. Precisa bater com
 * RANKING_SCROLL_DURATION_MS em tv-view.tsx, que é quem tira esta tela do ar. */
const SCROLL_DOWN_MS = 25_000;
const SCROLL_UP_MS = 25_000;

/** Aceleração/desaceleração suave nas pontas de cada rolagem (ease-in-out
 * cúbico). Sem isso o movimento "estala": salta de parado pra velocidade
 * cheia no instante em que os 30s acabam, e trava seco ao encostar no último.
 * Com a curva, ele desencosta devagar, cruza o meio no ritmo normal e encaixa
 * suave na outra ponta. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Cor do anel/medalha por posição — mesma paleta do pódio (PODIUM_RING em
 * tv-view.tsx): ouro, prata, bronze. Do 4º em diante fica neutro. */
const PLACE_COLOR = ["#eab308", "#cbd5e1", "#b45309"];
const PLACE_COLOR_REST = "rgba(255,255,255,0.25)";

function placeColor(index: number) {
  return PLACE_COLOR[index] ?? PLACE_COLOR_REST;
}

/** Mostra o ranking de vendas do mês INTEIRO (não só o top 10): os 10
 * primeiros cabem na altura do painel e ficam parados por STATIC_MS; a
 * rolagem depois é justamente o que revela quem está do 11º pra baixo. Quem
 * limita o tamanho da lista é a consulta (ver rankingRaw em
 * lib/tv-dashboard.ts), não este componente. */
export function TvRankingScroll({ ranking }: { ranking: RankingUser[] }) {
  /** Janela recortada (altura fixa, overflow escondido). */
  const viewportRef = useRef<HTMLDivElement>(null);
  /** Lista inteira, que desliza pra cima por dentro da janela acima. */
  const listRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);

  // Barra proporcional ao 1º lugar — ele sempre ocupa 100% da largura
  // disponível e todo mundo abaixo é uma fração dele. `ranking` já vem
  // ordenado do maior pro menor, então o 1º é o teto. Guarda contra divisão
  // por zero (mês sem venda nenhuma registrada com valor).
  const maxTotal = ranking.length > 0 ? ranking[0].total : 0;

  useEffect(() => {
    const viewport = viewportRef.current;
    const list = listRef.current;
    if (!viewport || !list || ranking.length === 0) return;

    let frame: number;
    let start: number | null = null;

    const tick = (now: number) => {
      if (start === null) start = now;
      const elapsed = now - start;
      // Quanto da lista sobra pra fora da janela. Com o time inteiro cabendo
      // na tela isso dá 0 e nada se move o ciclo todo, que é o certo nesse
      // caso (não há "resto" pra revelar).
      const distance = Math.max(0, list.scrollHeight - viewport.clientHeight);

      let progress: number;
      if (elapsed < STATIC_MS) {
        progress = 0;
      } else if (elapsed < STATIC_MS + SCROLL_DOWN_MS) {
        progress = easeInOutCubic((elapsed - STATIC_MS) / SCROLL_DOWN_MS);
      } else if (elapsed < STATIC_MS + SCROLL_DOWN_MS + SCROLL_UP_MS) {
        progress = 1 - easeInOutCubic((elapsed - STATIC_MS - SCROLL_DOWN_MS) / SCROLL_UP_MS);
      } else {
        // Ciclo fechou — recomeça do topo. Na prática tv-view.tsx já trocou
        // pra tela de cards antes disso; é só uma rede de segurança pra nunca
        // travar no fim da lista se esta tela ficar montada mais tempo.
        start = now;
        progress = 0;
      }

      // translate3d (não scrollTop): o navegador embutido desta TV engasga
      // rolando 60fps por scrollTop — cada quadro força recálculo de layout na
      // CPU. Um translate em Z vira camada composta na GPU, que é o caminho
      // barato o bastante pra manter o movimento liso num hardware fraco.
      list.style.transform = `translate3d(0, ${-(distance * progress)}px, 0)`;

      // Guarda contra re-render: este tick roda ~60x por segundo, e esta tela
      // fica de pé 24/7. Sem comparar antes, seriam 60 setState/s só pra
      // mostrar/esconder uma legenda que muda 2x por ciclo.
      const nextAtTop = progress < 0.02;
      if (nextAtTop !== atTopRef.current) {
        atTopRef.current = nextAtTop;
        setAtTop(nextAtTop);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ranking.length]);

  if (ranking.length === 0) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center">
        <Trophy
          style={{ width: "var(--tv-icon-lg)", height: "var(--tv-icon-lg)", color: "#eab308" }}
          strokeWidth={2}
        />
        <p className="mt-3 text-neutral-500 text-[length:var(--tv-text-body)]">Sem vendas este mês ainda.</p>
      </div>
    );
  }

  return (
    // --row-avatar: não existe um --tv-avatar-sm nos tokens globais (só md/lg,
    // ver app/globals.css) e esta lista precisa de um avatar menor que os dois
    // pros 10 caberem empilhados na altura do painel. Derivado do md pra
    // continuar crescendo/encolhendo junto com o resto da TV, em vez de virar
    // um px fixo que desentoaria em outra resolução.
    // flex-1 + min-h-0 (não h-full): o pai é a coluna do painel de métricas,
    // e é esse par que faz esta tela ficar presa na altura disponível em vez
    // de crescer com a lista. Sem o teto, não sobra nada pra fora da janela e
    // a rolagem simplesmente não teria pra onde ir.
    <div
      className="flex min-h-0 w-full flex-1 flex-col"
      style={{ gap: "calc(var(--tv-gap) * 0.6)", ["--row-avatar" as string]: "calc(var(--tv-avatar-md) * 0.72)" }}
    >
      {/* Cabeçalho — mesma gramática dos outros cards do painel (ícone +
          rótulo em caixa alta com tracking largo), pra esta tela não ler
          como um app diferente do resto da TV. */}
      <div className="flex shrink-0 items-center justify-center gap-2">
        <Trophy
          style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: "#eab308" }}
          strokeWidth={2.5}
        />
        <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
          Ranking do mês
        </p>
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={listRef}
          className="flex flex-col"
          // willChange avisa o navegador pra promover a lista a camada própria
          // ANTES do primeiro quadro do movimento — sem isso, a TV monta a
          // camada só quando o transform muda, e o primeiro passo da descida
          // sai travado.
          style={{ gap: "calc(var(--tv-gap) * 0.45)", willChange: "transform" }}
        >
          {ranking.map((user, index) => {
            const ring = placeColor(index);
            const isFirst = index === 0;
            const barPct = maxTotal > 0 ? (user.total / maxTotal) * 100 : 0;
            return (
              <div
                key={user.id}
                className="flex shrink-0 items-center rounded-xl border border-white/10 bg-white/[0.04]"
                style={{
                  gap: "calc(var(--tv-gap) * 0.6)",
                  padding: "calc(var(--tv-gap) * 0.45) calc(var(--tv-gap) * 0.6)",
                }}
              >
                {/* Posição */}
                <div
                  className="flex shrink-0 items-center justify-center font-extrabold tabular-nums"
                  style={{
                    width: "calc(var(--row-avatar) * 0.8)",
                    fontSize: "var(--tv-text-value-sm)",
                    color: isFirst ? "#eab308" : "rgba(255,255,255,0.55)",
                  }}
                >
                  {index + 1}
                </div>

                {/* Avatar — mesmo anel colorido por posição do pódio */}
                <div className="relative shrink-0" style={{ width: "var(--row-avatar)", height: "var(--row-avatar)" }}>
                  {isFirst && (
                    <Crown
                      className="absolute left-1/2 -translate-x-1/2"
                      style={{
                        top: "calc(var(--tv-icon-sm) * -0.7)",
                        width: "var(--tv-icon-sm)",
                        height: "var(--tv-icon-sm)",
                        color: "#eab308",
                      }}
                      strokeWidth={2.5}
                    />
                  )}
                  {user.image ? (
                    <img
                      src={user.image}
                      alt={user.name}
                      className="h-full w-full rounded-full object-cover"
                      style={{ border: `3px solid ${ring}` }}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center rounded-full bg-neutral-700 font-semibold text-[length:var(--tv-text-body)]"
                      style={{ border: `3px solid ${ring}` }}
                    >
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Nome + barra proporcional ao 1º lugar */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[length:var(--tv-text-body)] ${isFirst ? "font-bold text-white" : "font-medium text-neutral-300"}`}
                    title={user.name}
                  >
                    {user.name}
                  </p>
                  <div
                    className="mt-1 w-full overflow-hidden rounded-full bg-white/10"
                    style={{ height: "clamp(0.4rem, 0.7cqw, 0.75rem)" }}
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-1000"
                      style={{
                        width: `${barPct}%`,
                        background: isFirst
                          ? "linear-gradient(90deg, #eab308, #fde047)"
                          : `linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 45%, white))`,
                      }}
                    />
                  </div>
                </div>

                {/* Valor vendido */}
                <div
                  className="shrink-0 text-right font-extrabold tabular-nums text-[length:var(--tv-text-value-sm)]"
                  style={{ color: isFirst ? "#eab308" : "var(--brand)" }}
                >
                  {formatCurrencyCompact(user.total)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legenda só enquanto está parado no topo — some assim que começa a
          rolar, pra não competir com a lista em movimento. Diz o tamanho do
          time no mês, que é o aviso de que a lista continua abaixo do que
          está à vista. */}
      {atTop && (
        <p className="shrink-0 text-center font-semibold tracking-widest text-neutral-500 uppercase text-[length:var(--tv-text-label)]">
          {ranking.length} consultores com venda no mês
        </p>
      )}
    </div>
  );
}
