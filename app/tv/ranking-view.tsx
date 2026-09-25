"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw, Trophy } from "lucide-react";
import { fetchTvRanking } from "./actions";
import { TvClock } from "./tv-clock";
import { TvRankingScroll } from "./tv-ranking-scroll";
import { getBrazilParts } from "@/lib/timezone";

type RankingData = Awaited<ReturnType<typeof fetchTvRanking>>;

// Mesmos ritmos da TV principal (ver METRICS_POLL_MS/STALE_AFTER_MS/
// DAILY_RELOAD_HOUR em tv-view.tsx) — é uma tela na parede do mesmo jeito:
// atualiza sozinha, avisa quando parou de conseguir atualizar, e se recarrega
// de madrugada pra nunca acumular estado de dias seguidos ligada.
const POLL_MS = 15_000;
const STALE_AFTER_MS = POLL_MS * 3;
const BUILD_POLL_MS = 60_000;
const DAILY_RELOAD_HOUR = 4;
// Botão de girar a tela: aparece quando o mouse/ponteiro se mexe e some POR
// COMPLETO depois disto sem nenhuma interação (pedido explícito, ~5s) — numa
// TV na parede um botão parado na tela seria só sujeira.
const CONTROL_HIDE_MS = 5000;
// A rotação escolhida sobrevive a recarga (diária das 4h, deploy, TV que
// reinicia) — senão a tela voltaria pra posição de fábrica toda madrugada.
const ROTATION_STORAGE_KEY = "tv_ranking_rotation";
type Rotation = 0 | 90 | 180 | 270;

// Mesma proporção da logo usada na TV principal (ver LOGO_ASPECT_RATIO lá,
// com o histórico de por que largura E altura são sempre explícitas).
const LOGO_ASPECT_RATIO = 3144 / 1784;

/**
 * Tela do Ranking do mês — a TV INTERNA, separada do dashboard principal.
 *
 * Existe porque o ranking saiu da TV principal: ela fica à vista de cliente,
 * e um cliente na Reobote podia ver, por exemplo, que um consultor ainda não
 * tinha fechado nada no mês (pedido da diretoria, 09/2026). Aqui aparecem
 * TODOS os que venderam no mês. NUNCA exige login (a TV não faz login): só
 * quem tem o código do tipo RANKING em /r/CÓDIGO (ver
 * lib/require-tv-link.ts) enxerga.
 *
 * `publicCode`: o polling leva o código junto a cada atualização — é a única
 * credencial (ver fetchTvRanking em app/tv/actions.ts).
 */
export function TvRankingView({
  initialData,
  publicCode,
}: {
  initialData: RankingData;
  publicCode: string;
}) {
  const [data, setData] = useState<RankingData>(initialData);
  // Aviso discreto (ponto âmbar no relógio) quando ~45s de tentativas
  // seguidas falharam — sem isso, uma falha silenciosa deixava a TV mostrando
  // números cada vez mais velhos sem ninguém perceber. Ver STALE_AFTER_MS.
  const [stale, setStale] = useState(false);
  const lastFetchOkAt = useRef<number>(0);
  // Id do PROCESSO do servidor que respondeu o carregamento inicial — mudou =
  // houve deploy, recarrega a página pra pegar o build novo (mesma estratégia
  // de dois pollings de tv-view.tsx; ver o comentário longo lá sobre por que
  // Server Action sozinha não basta depois de um deploy).
  const serverInstanceIdRef = useRef(initialData.serverInstanceId);

  useEffect(() => {
    lastFetchOkAt.current = Date.now();
    const interval = setInterval(async () => {
      try {
        const updated = await fetchTvRanking(publicCode);
        if (updated.serverInstanceId !== serverInstanceIdRef.current) {
          window.location.reload();
          return;
        }
        setData(updated);
        lastFetchOkAt.current = Date.now();
        setStale(false);
      } catch (err) {
        console.error("Failed to fetch TV ranking", err);
        if (Date.now() - lastFetchOkAt.current > STALE_AFTER_MS) setStale(true);
      }
    }, POLL_MS);
    return () => clearInterval(interval);
    // publicCode nunca muda depois de montado (vem fixo da página).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2º caminho de detecção de deploy: rota HTTP comum, que continua
  // respondendo mesmo quando o ID da Server Action acima já mudou (ver
  // /api/tv/build-id e o comentário em tv-view.tsx).
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/tv/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const body: { serverInstanceId: string } = await res.json();
        if (body.serverInstanceId !== serverInstanceIdRef.current) window.location.reload();
      } catch (err) {
        console.error("Failed to check TV build id", err);
      }
    }, BUILD_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // Recarga diária de madrugada (ver DAILY_RELOAD_HOUR).
  useEffect(() => {
    const parts = getBrazilParts(new Date());
    const nowMinutes = parts.hour * 60 + parts.minute;
    const targetMinutes = DAILY_RELOAD_HOUR * 60;
    const diffMinutes = nowMinutes < targetMinutes ? targetMinutes - nowMinutes : 24 * 60 - nowMinutes + targetMinutes;
    const timer = setTimeout(() => window.location.reload(), diffMinutes * 60_000);
    return () => clearTimeout(timer);
  }, []);

  // ── Rotação da tela ────────────────────────────────────────────────────
  // Girar em passos de 90° (0 → 90 → 180 → 270 → 0): dá tanto o "ver em pé"
  // quanto o "ver deitado" nos dois sentidos, sem precisar mexer na
  // configuração da TV. 90°/270° trocam largura e altura do palco abaixo.
  const [rotation, setRotation] = useState<Rotation>(0);
  const [controlVisible, setControlVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Lido DEPOIS de montar (não no valor inicial do state): o servidor não
    // conhece o localStorage do aparelho, e ler direto na 1ª renderização
    // causaria descompasso de hidratação. setState direto no efeito é
    // proposital, mesmo padrão de tv-view.tsx.
    try {
      const saved = Number(window.localStorage.getItem(ROTATION_STORAGE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 90 || saved === 180 || saved === 270) setRotation(saved);
    } catch {
      // localStorage indisponível (modo privado, navegador de TV restrito): fica em 0°.
    }
  }, []);

  /** Mostra o botão e (re)arma o sumiço — cada movimento/toque/tecla adia por mais CONTROL_HIDE_MS. */
  const revealControl = useCallback(() => {
    setControlVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlVisible(false), CONTROL_HIDE_MS);
  }, []);

  useEffect(() => {
    // Controle remoto de TV não tem mouse: qualquer tecla também mostra o botão
    // (que aí recebe foco/Enter). Mouse e toque entram pelo palco, abaixo.
    window.addEventListener("keydown", revealControl);
    return () => {
      window.removeEventListener("keydown", revealControl);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [revealControl]);

  function rotate() {
    const next = ((rotation + 90) % 360) as Rotation;
    setRotation(next);
    try {
      window.localStorage.setItem(ROTATION_STORAGE_KEY, String(next));
    } catch {
      // sem persistência: vale só até a próxima recarga.
    }
    // Depois do clique o botão fica mais ~5s e some por completo.
    revealControl();
  }

  const swapped = rotation === 90 || rotation === 270;

  return (
    // PALCO: ocupa a tela real, sem girar. O botão de girar mora aqui (não
    // dentro do conteúdo que gira), então continua no mesmo canto físico da tela
    // em qualquer rotação.
    <div className="relative h-full w-full overflow-hidden" onMouseMove={revealControl} onPointerDown={revealControl}>
      {/* O conteúdo gira dentro de uma caixa que TROCA largura e altura quando
          está de lado (100cqh × 100cqw — unidades do contêiner da TV, ver
          components/tv-shell.tsx) e é centralizada antes de rotacionar. E ela
          própria vira um contêiner "tv-canvas": todos os tamanhos --tv-* (cq*) e
          a regra de tela em pé (.tv-portrait-scale, app/globals.css) passam a
          medir ESTA caixa girada, não a tela física — é o que faz o layout
          escolher sozinho o formato certo (deitado/em pé) pra cada rotação. */}
      <div
        className="absolute"
        style={{
          left: "50%",
          top: "50%",
          width: swapped ? "100cqh" : "100cqw",
          height: swapped ? "100cqw" : "100cqh",
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          containerType: "size",
          containerName: "tv-canvas",
        }}
      >
        <div
          className="tv-portrait-scale flex h-full w-full flex-col"
          style={{ gap: "var(--tv-gap)", padding: "var(--tv-gap)" }}
        >
          {/* Relógio, logo e título no MESMO cabeçalho, sem nada em posição
              absoluta: ver .tv-ranking-header em app/globals.css (grade de 3
              colunas quando há largura, empilhado quando não há) — assim os
              três nunca ficam um em cima do outro em nenhum tamanho/rotação. */}
          <header className="tv-ranking-header shrink-0">
            <TvClock stale={stale} className="tv-clock" />

            <div className="tv-ranking-header__center flex flex-col items-center" style={{ gap: "calc(var(--tv-gap) * 0.5)" }}>
              <div
                className="relative shrink-0"
                style={{ height: "var(--tv-logo-h)", width: `calc(var(--tv-logo-h) * ${LOGO_ASPECT_RATIO})` }}
              >
                <img
                  src="/images/LOGO-BRANCA.png"
                  alt="Reobote"
                  width={140}
                  height="auto"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0">
                <Trophy
                  style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: "#eab308" }}
                  strokeWidth={2.5}
                />
                <h1 className="font-semibold tracking-widest text-neutral-300 uppercase text-[length:var(--tv-text-name)]">
                  Ranking do mês
                </h1>
                {/* inline-block: ::first-letter só age em bloco. O mês vem minúsculo do servidor
                    ("setembro de 2026") — `capitalize` deixava "Setembro De 2026". */}
                <span className="inline-block text-neutral-500 first-letter:uppercase text-[length:var(--tv-text-body)]">
                  · {data.monthLabel}
                </span>
              </div>
            </div>
          </header>

          {/* Largura limitada e centralizada em tela deitada (ver .tv-ranking-list em
              app/globals.css); em tela em pé ocupa a largura toda. */}
          <div
            className="tv-ranking-list surface-glass-panel mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden"
            style={{
              borderRadius: "var(--tv-radius)",
              padding: "var(--tv-card-py) var(--tv-card-px)",
              marginBottom: "var(--tv-gap)",
            }}
          >
            <TvRankingScroll ranking={data.ranking} hideHeader />
          </div>
        </div>
      </div>

      {/* Some por COMPLETO (desmonta) — não fica só transparente clicável. */}
      {controlVisible && (
        <button
          type="button"
          onClick={rotate}
          aria-label="Girar a tela em 90 graus"
          title="Girar a tela em 90°"
          className="absolute z-50 flex items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          style={{
            right: "var(--tv-gap)",
            bottom: "var(--tv-gap)",
            width: "clamp(2rem, 3.4vmin, 3.25rem)",
            height: "clamp(2rem, 3.4vmin, 3.25rem)",
          }}
        >
          <RotateCw style={{ width: "55%", height: "55%" }} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}
