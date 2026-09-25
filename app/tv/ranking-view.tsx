"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
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

  return (
    // relative: o TvClock se posiciona em absolute contra este contêiner (canto
    // superior esquerdo), igual ao painel de propaganda da TV principal.
    <div className="relative flex h-full w-full flex-col" style={{ gap: "var(--tv-gap)", padding: "var(--tv-gap)" }}>
      <TvClock stale={stale} />

      <header className="flex shrink-0 flex-col items-center" style={{ gap: "calc(var(--tv-gap) * 0.5)" }}>
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
        <div className="flex items-center gap-2">
          <Trophy
            style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: "#eab308" }}
            strokeWidth={2.5}
          />
          <h1 className="font-semibold tracking-widest text-neutral-300 uppercase text-[length:var(--tv-text-name)]">
            Ranking do mês
          </h1>
          <span className="text-neutral-500 capitalize text-[length:var(--tv-text-body)]">· {data.monthLabel}</span>
        </div>
      </header>

      {/* Largura limitada e centralizada: numa TV larga, uma barra de 100% da
          tela por linha fica gigante e difícil de acompanhar de longe. */}
      <div
        className="surface-glass-panel mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        style={{
          maxWidth: "clamp(40rem, 78cqw, 100rem)",
          borderRadius: "var(--tv-radius)",
          padding: "var(--tv-card-py) var(--tv-card-px)",
          marginBottom: "var(--tv-gap)",
        }}
      >
        <TvRankingScroll ranking={data.ranking} hideHeader />
      </div>
    </div>
  );
}
