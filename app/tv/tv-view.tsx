"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { TrendingUp, Sparkles, Waypoints, Trophy, PartyPopper, Crown, Cake } from "lucide-react";
import { AnimatedFire } from "@/components/animated-fire";
import { fetchTvMetrics } from "./actions";
import { formatCurrencyCompact } from "@/lib/format";
import { getBrazilParts, brazilDateTime } from "@/lib/timezone";
import { TvWinCelebration } from "./tv-win-celebration";
import { TvClock } from "./tv-clock";
import { CountUpValue } from "@/components/count-up-value";

type Metrics = Awaited<ReturnType<typeof fetchTvMetrics>>;
type WinSale = { id: string; name: string; image: string | null; value: number };

// Só o carrossel de propaganda gira sozinho — o painel de métricas mostra
// TODOS os widgets habilitados ao mesmo tempo (ver corpo do componente
// abaixo), num "bento" de tamanhos variados em vez de retângulos idênticos
// empilhados: hero pra vendas do mês, última venda, tiras pro funil, pódio
// de verdade pro ranking, e o churrascômetro numa barra full-width embaixo.
const AD_DURATION_MS = 10000;
// Intervalo do refresh de métricas (venda nova, ranking, funil, etc.) —
// 15s: rápido o bastante pra uma venda nova (ou uma venda desfeita — ver
// lastSeenClosedAtMs mais abaixo) aparecer/sumir do painel quase na hora,
// sem virar uma enxurrada de consultas ao banco (15s = 240 buscas/hora).
const METRICS_POLL_MS = 15000;
// Se 3 ciclos de refresh seguidos falharem (~45s sem conseguir atualizar),
// mostra um aviso discreto — ver `stale` mais abaixo. Sem isso, uma falha
// silenciosa (sessão inválida, banco fora do ar) deixava a TV mostrando
// números cada vez mais desatualizados pra sempre, sem ninguém perceber —
// é uma tela na parede, não tem um console de erro visível pra quem olha.
const STALE_AFTER_MS = METRICS_POLL_MS * 3;
// Hora do dia (Brasília) pra recarregar a página inteira sozinha, uma vez
// por dia — rede de segurança pra uma tela que fica ligada 24/7 sem NUNCA
// receber um F5 manual: zera qualquer acúmulo de memória do navegador ao
// longo de dias/semanas, força uma sessão nova do zero, e recupera sozinha
// de qualquer estado travado que o polling por si não resolveria. 4h da
// manhã — fora de qualquer expediente, ninguém vai notar a tela apagar por
// um instante.
const DAILY_RELOAD_HOUR = 4;
// A cada 5 minutos, as fotos do pódio do Ranking giram (mesmo efeito 3D
// "moeda" da comemoração de venda, ver .animate-tv-photo-spin em
// globals.css) por alguns segundos — um destaque periódico pros líderes do
// mês, não preso a nenhum evento (diferente da comemoração de venda, que só
// acontece quando uma venda de verdade acontece).
const RANKING_SPIN_INTERVAL_MS = 5 * 60 * 1000;
const RANKING_SPIN_VISIBLE_MS = 6000;
// Carrossel de SÓ 2 cards do painel (Última venda e Ranking — ver
// renderLastSaleContent/renderRankingContent no componente abaixo, cada um
// com seu próprio slide independente) — alterna entre o conteúdo normal de
// cada card e um conteúdo de aniversário, mesma lógica de "roda sozinho num
// intervalo fixo" que o carrossel de propaganda já usa (ver AD_DURATION_MS).
// Vendas do mês e Leads no funil NUNCA trocam de conteúdo — ficam estáticos
// o tempo todo. Só entra nesse rodízio quando alguém faz aniversário este
// mês (ver hasBirthdayThisMonth mais abaixo) — sem ninguém fazendo
// aniversário no mês, os dois cards ficam só no conteúdo normal pra sempre.
// Quem faz aniversário especificamente HOJE ainda ganha destaque à parte
// dentro do conteúdo (ver renderLastSaleContent/renderRankingContent).
const RANKING_CAROUSEL_INTERVAL_MS = 3 * 60 * 1000;
// Quanto tempo o lado que está SAINDO fica montado depois da troca, animando
// pra fora da tela (ver outgoingSlide mais abaixo) — precisa bater com a
// duração das animações tv-slide-in-from-*/tv-slide-out-to-* em globals.css,
// senão o lado antigo é desmontado no meio da própria animação de saída
// (corte seco) ou fica um resto de tempo parado depois dela já ter acabado.
const SLIDE_TRANSITION_MS = 650;
// Quanto tempo o banner "TÁ NA HORA DO CHURRASCO" fica na tela (ver
// churrascoBannerPhase mais abaixo) e quanto ele leva pra desvanecer no
// final — mesmo espírito do EXIT_MS de tv-win-celebration.tsx.
const CHURRASCO_BANNER_MS = 10_000;
const CHURRASCO_BANNER_EXIT_MS = 600;
// A tela vai FECHANDO (fade suave, ver fase "entering" em
// churrascoBannerPhase, não um corte seco pra escuro), e o texto/foguinhos
// só aparecem DEPOIS desse tanto de tela já escura — pedido explícito, dá
// um instante de suspense antes do recado "chegar". Aplicado
// como `animationDelay` no próprio texto/glow (ver JSX mais abaixo), não
// como uma fase de estado nova — mais simples, CSS puro cuidando de tudo.
const CHURRASCO_BANNER_TEXT_DELAY_MS = 3000;

/**
 * "há 12 min" em vez de só uma data fixa (26/07/2026) — numa TV ligada o dia
 * inteiro, uma data parada não passa a sensação de painel ao vivo que "há
 * 12 min" passa.
 *
 * Recebe `nowMs` de fora em vez de chamar `Date.now()` aqui dentro: o
 * servidor renderiza isso num instante e o cliente hidrata alguns
 * milissegundos (às vezes segundos) depois — cada `Date.now()` próprio dá um
 * "agora" ligeiramente diferente, e cruzar um limite de minuto entre os dois
 * bastava pra virar "há 12 min" no servidor e "há 13 min" no cliente, outro
 * hydration mismatch. `nowMs` vem de um state que só existe depois de
 * montado no cliente (ver `nowMs` em TvView) — mesma estratégia do relógio
 * (TvClock): valor inicial determinístico (ausente) até montar, atualiza só
 * depois.
 */
function formatRelativeTime(date: Date, nowMs: number): string {
  const diffMs = nowMs - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `há ${diffD}d`;
}

/** "26/08" — dia de fechamento por extenso curto (calendário de Brasília,
 * ver getBrazilParts), ao lado de formatRelativeTime ("há 3d") no card
 * Última venda — pedido explícito: mostrar a DATA de verdade ali, não só o
 * relativo (que antes só existia como `title`, invisível numa TV sem
 * mouse pra passar por cima e ver o tooltip). Sem ano de propósito: é
 * sempre a venda mais recente do mês corrente ou perto dele, nunca algo de
 * anos atrás — ano deixaria a data mais longa à toa. */
function formatShortDate(date: Date): string {
  const { day, month } = getBrazilParts(date);
  return `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}`;
}

export function TvView({
  initialMetrics,
  publicCode,
}: {
  initialMetrics: Metrics;
  /** Só quando montado a partir do link público (ver
   * app/t/[code]/page.tsx) — sem sessão nenhuma pra repetir a cada refresh,
   * o polling abaixo precisa levar o código junto pra fetchTvMetrics saber
   * de qual organização buscar (ver app/tv/actions.ts). */
  publicCode?: string;
}) {
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [currentAdIndex, setCurrentAdIndex] = useState(0);
  const [celebration, setCelebration] = useState<WinSale | null>(null);
  // Aviso discreto de "os números na tela podem estar desatualizados" — ver
  // STALE_AFTER_MS. `lastFetchOkAt` não é state de propósito (não precisa
  // re-renderizar a cada busca bem-sucedida, só quando `stale` muda de
  // verdade).
  const [stale, setStale] = useState(false);
  // `Date.now()` não pode rodar direto no corpo do componente (regra
  // react-hooks/purity — cada render chamaria de novo, valor instável) —
  // 0 aqui é só placeholder; o valor de verdade é escrito no início do
  // efeito de polling de métricas abaixo, antes do 1º tick do interval
  // poder disparar (Date.now() - 0 nunca chega a ser lido nesse meio
  // tempo).
  const lastFetchOkAt = useRef<number>(0);
  // "Agora" usado pro rótulo relativo da última venda ("há 12 min" — ver
  // formatRelativeTime). Começa null tanto no servidor quanto na 1ª pintura
  // do cliente e só ganha valor depois de montado: chamar `Date.now()`
  // direto no corpo do componente daria um "agora" diferente entre o
  // instante em que o servidor renderizou a página e o instante em que o
  // cliente hidrata, o que é exatamente o tipo de valor não-determinístico
  // que causa "hydration mismatch". Atualiza a cada 30s depois — sobra de
  // granularidade pra um rótulo em minutos.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    // setState direto no corpo do efeito é proposital aqui — é exatamente
    // o padrão "valor só existe no cliente, null até montar" descrito
    // acima (evitar hydration mismatch), não dá pra resolver de outro
    // jeito sem reintroduzir o próprio problema que isso evita.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);
  // Giro nas fotos do pódio do Ranking — liga a cada 5min, desliga sozinho
  // alguns segundos depois (ver RANKING_SPIN_INTERVAL_MS/RANKING_SPIN_VISIBLE_MS).
  const [rankingSpinActive, setRankingSpinActive] = useState(false);
  // Qual "lado" está visível nos cards Última venda/Ranking — 0 = conteúdo
  // normal, 1 = aniversário de hoje (ver RANKING_CAROUSEL_INTERVAL_MS). Os
  // dois cards trocam JUNTOS, no mesmo instante (um estado só controla os
  // dois). Alterna (não avança sempre pro mesmo lado) de propósito — com só
  // 2 conteúdos, ping-pong é o carrossel mais simples que ainda dá a
  // sensação de "girar", sem precisar de um 3º estado só pra voltar.
  const [rankingSlide, setRankingSlide] = useState<0 | 1>(0);
  // Lado que acabou de SAIR — fica montado por SLIDE_TRANSITION_MS depois de
  // cada troca de rankingSlide só pra poder animar arrastando pra fora da
  // tela (ver JSX mais abaixo). Sem isso, a troca de `key` desmontava o
  // conteúdo anterior na hora — só o lado novo aparecia entrando, sem
  // nenhum lado saindo visível, e não passava a sensação de "arrastar pro
  // lado" pedida, só de "aparecer".
  const [outgoingSlide, setOutgoingSlide] = useState<0 | 1 | null>(null);
  const prevRankingSlideRef = useRef<0 | 1>(0);
  useEffect(() => {
    if (prevRankingSlideRef.current === rankingSlide) return;
    const prev = prevRankingSlideRef.current;
    prevRankingSlideRef.current = rankingSlide;
    setOutgoingSlide(prev);
    const timer = setTimeout(() => setOutgoingSlide(null), SLIDE_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [rankingSlide]);

  // Data (timestamp) da venda mais recente já vista — começa com a data que
  // já veio pronta do servidor, então o 1º carregamento da página (ou um F5)
  // NUNCA dispara confete sozinho; só uma venda de fato NOVA depois de
  // montado. Guarda a data (não o id): se um negócio for revertido de Ganho
  // pra "Em andamento", a "última venda" da organização passa a ser outra —
  // mais antiga, já vista antes — e comparar só por id ia achar que era
  // "diferente" (é um id novo pro comparador) e disparar confete de novo
  // pra uma venda velha. Comparando por data, só dispara quando a data for
  // estritamente MAIOR que a mais recente já vista — e nunca anda pra trás
  // (uma venda desfeita não "rebaixa" essa marca), então uma venda antiga
  // reaparecendo nunca passa no teste de novo.
  const lastSeenClosedAtMs = useRef<number>(initialMetrics.lastSale?.date.getTime() ?? 0);

  // Detecção de deploy novo (ver lib/server-instance.ts) — guarda o id do
  // PROCESSO do servidor que respondeu o carregamento inicial desta página.
  // Um deploy reinicia o container = processo novo = id diferente; quando
  // algum dos dois pollings abaixo perceber isso, recarrega a página
  // inteira sozinha (pega o HTML/JS/CSS do build novo) em vez de esperar a
  // recarga diária das 4h (DAILY_RELOAD_HOUR) — antes disso, deployar às
  // 14h só aparecia na TV às 4h do dia SEGUINTE, quase 14h pra ver o
  // resultado de uma mudança sem precisar dar F5 manual numa tela
  // pendurada na parede ("depois que eu dei deploy ela não atualizou
  // sozinha").
  //
  // Precisa dos DOIS pollings (este daqui embutido em fetchTvMetrics, MAIS
  // o /api/tv/build-id logo abaixo) por um motivo específico: o 1º relato
  // de "não atualizou sozinha" era porque fetchTvMetrics é uma SERVER
  // ACTION, e o Next.js troca o ID de toda Server Action A CADA DEPLOY
  // (ver node_modules/next/dist/docs/01-app/02-guides/server-actions.md
  // #deployment-considerations) — então, depois de um deploy de verdade, a
  // TV (ainda com o bundle ANTIGO carregado) chamava fetchTvMetrics e a
  // chamada em si já FALHAVA ("Failed to find Server Action") antes de
  // qualquer resposta chegar — nunca dava tempo de comparar
  // serverInstanceId nenhum, o polling só caía direto no catch (linha
  // abaixo) achando que era uma falha comum de rede/banco. Uma rota HTTP
  // comum (não Server Action) não tem esse problema — o endereço
  // `/api/tv/build-id` é o MESMO antes e depois de qualquer deploy, então
  // sempre responde com o que estiver rodando agora, não importa o quão
  // velho o bundle de quem pergunta esteja. É esse 2º polling que garante
  // o reload de verdade; o check aqui dentro do fetchTvMetrics fica como
  // um 2º caminho, redundante mas inofensivo, pro caso raro do polling de
  // métricas conseguir responder mesmo assim.
  const serverInstanceIdRef = useRef(initialMetrics.serverInstanceId);

  // Auto-refresh das métricas — fetchTvMetrics não recebe organizationId
  // daqui (ver app/tv/actions.ts): a action descobre sozinha a organização
  // pela sessão de quem está logado nesta TV. Isso também é o que faz um
  // negócio revertido pra "Em andamento" sumir do painel (Última
  // venda/Ranking/Vendas do mês) rapidinho — cada busca é sempre fresca no
  // banco, sem cache no meio, então o próximo refresh já reflete a reversão
  // sozinho, sem precisar de nenhuma lógica extra pra "esconder" nada.
  useEffect(() => {
    // Marca "agora" como o último sucesso conhecido assim que monta — sem
    // isso, lastFetchOkAt ficaria no placeholder (0) até o 1º fetch bem-
    // sucedido de verdade, e uma falha logo cedo (antes do 1º sucesso)
    // calcularia "desde 1970" pro aviso de stale.
    lastFetchOkAt.current = Date.now();
    const interval = setInterval(async () => {
      try {
        const updated = await fetchTvMetrics(publicCode);
        // Checa deploy novo ANTES de qualquer outra coisa — se mudou, só
        // recarrega e para por aqui; não faz sentido atualizar state pra
        // uma tela que já vai ser substituída pelo reload no instante
        // seguinte.
        if (updated.serverInstanceId !== serverInstanceIdRef.current) {
          window.location.reload();
          return;
        }
        if (updated.lastSale) {
          const closedAtMs = updated.lastSale.date.getTime();
          if (closedAtMs > lastSeenClosedAtMs.current) {
            setCelebration({
              id: updated.lastSale.id,
              name: updated.lastSale.name,
              image: updated.lastSale.image,
              value: updated.lastSale.value,
            });
            lastSeenClosedAtMs.current = closedAtMs;
          }
        }
        setMetrics(updated);
        lastFetchOkAt.current = Date.now();
        setStale(false);
      } catch (err) {
        console.error("Failed to fetch TV metrics", err);
        if (Date.now() - lastFetchOkAt.current > STALE_AFTER_MS) setStale(true);
      }
    }, METRICS_POLL_MS);
    return () => clearInterval(interval);
    // publicCode nunca muda depois de montado (vem fixo da página, ver
    // app/t/[code]/page.tsx) — não precisa recriar o interval por causa
    // dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2º polling de detecção de deploy — ver o comentário longo em
  // serverInstanceIdRef acima pra entender POR QUE precisa dos dois. Este
  // aqui usa `fetch` comum (rota HTTP normal, app/api/tv/build-id/route.ts)
  // em vez de Server Action — nunca quebra por causa de ID de Server
  // Action desatualizado depois de um deploy, é justamente o caminho que
  // continua funcionando quando o outro falha. Roda num intervalo próprio
  // (não precisa ser tão frequente quanto o de métricas — detectar um
  // deploy em até 1 minuto já é rápido o bastante pra uma tela na parede).
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/tv/build-id", { cache: "no-store" });
        if (!res.ok) return;
        const data: { serverInstanceId: string } = await res.json();
        if (data.serverInstanceId !== serverInstanceIdRef.current) {
          window.location.reload();
        }
      } catch (err) {
        // Silencioso de propósito — isto é só um "ainda é o mesmo
        // deploy?", não uma busca de dado nenhuma; uma falha aqui não deve
        // acender o aviso "stale" (esse já é tratado pelo polling de
        // métricas acima).
        console.error("Failed to check TV build id", err);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Giro nas fotos do pódio do Ranking a cada 5min (ver RANKING_SPIN_*
  // acima) — sem cleanup do setTimeout interno de propósito: mesmo se o
  // componente desmontasse entre o `true` e o `false`, a TV nunca desmonta
  // esse componente sozinha (só um F5 inteiro faria isso), não vale a pena
  // a complexidade extra de rastrear esse timeout também.
  useEffect(() => {
    const interval = setInterval(() => {
      setRankingSpinActive(true);
      setTimeout(() => setRankingSpinActive(false), RANKING_SPIN_VISIBLE_MS);
    }, RANKING_SPIN_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Dois gatilhos diferentes, um pra cada card — `birthdaysThisMonth` já vem
  // do servidor filtrado pelo mês/dia ATUAIS de verdade (getBrazilParts(new
  // Date()) em lib/tv-dashboard.ts, nunca um valor fixo), recorrente ano
  // após ano.
  // - hasBirthdayThisMonth: liga o TIMER do carrossel (compartilhado pelos
  //   dois cards) — o Ranking mostra a lista do mês inteiro assim que tem
  //   qualquer aniversariante no mês.
  // - hasBirthdayToday: além do timer estar ligado, o card Última venda só
  //   participa da troca quando alguém faz aniversário HOJE de verdade — 2
  //   dias antes/depois não é suficiente pra ele sair do lugar (pedido
  //   explícito); nesse caso ele fica sempre no conteúdo normal, mesmo com
  //   o Ranking girando ao lado (ver JSX mais abaixo).
  const hasBirthdayThisMonth = metrics.birthdaysThisMonth.length > 0;
  const hasBirthdayToday = metrics.birthdaysThisMonth.some((b) => b.isToday);

  // Carrossel dos cards Última venda/Ranking (conteúdo normal ↔
  // aniversariantes, ver RANKING_CAROUSEL_* acima) — só roda quando há de
  // fato algum aniversariante este mês; sem isso, ligar o intervalo do mesmo
  // jeito faria os cards "girarem" pra um conteúdo de aniversário vazio, à
  // toa. Reavalia a cada refresh de métricas — se o carrossel estava ativo e
  // a lista esvaziar (virou o mês), volta pro conteúdo normal e para de
  // girar sozinho.
  useEffect(() => {
    if (!hasBirthdayThisMonth) {
      // setState direto no corpo do efeito é proposital — sincroniza o
      // slide com uma condição EXTERNA (esvaziou a lista de
      // aniversariantes) que só este efeito observa; não tem outro lugar
      // certo pra fazer esse reset sem duplicar a lógica.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRankingSlide(0);
      return;
    }
    const interval = setInterval(() => {
      setRankingSlide((s) => (s === 0 ? 1 : 0));
    }, RANKING_CAROUSEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasBirthdayThisMonth]);

  // Recarga diária de madrugada (ver DAILY_RELOAD_HOUR) — calcula os ms até
  // a próxima ocorrência UMA vez ao montar; depois do reload, a página monta
  // de novo do zero e recalcula pra o dia seguinte sozinha, sem precisar de
  // um `setInterval` verificando a hora toda hora.
  useEffect(() => {
    const parts = getBrazilParts(new Date());
    const nowMinutes = parts.hour * 60 + parts.minute;
    const targetMinutes = DAILY_RELOAD_HOUR * 60;
    const diffMinutes = nowMinutes < targetMinutes ? targetMinutes - nowMinutes : 24 * 60 - nowMinutes + targetMinutes;
    const timer = setTimeout(() => window.location.reload(), diffMinutes * 60_000);
    return () => clearTimeout(timer);
  }, []);

  // Carrossel de propagandas.
  useEffect(() => {
    if (!metrics.adsUrls || metrics.adsUrls.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentAdIndex((prev) => (prev + 1) % metrics.adsUrls.length);
    }, AD_DURATION_MS);
    return () => clearInterval(interval);
  }, [metrics.adsUrls]);

  const safeAdIndex = Math.min(currentAdIndex, Math.max(0, (metrics.adsUrls?.length || 1) - 1));

  const has = useMemo(() => new Set(metrics.visibleWidgets), [metrics.visibleWidgets]);
  const showHero = has.has("sales_summary");
  const showChurrasco = has.has("churrascometro");
  const showLastSale = has.has("last_sale");
  const showFunnels = has.has("funnels");
  const showRanking = has.has("ranking");
  // Nenhum widget habilitado — checa os 5 direto (antes passava por uma
  // variável intermediária `showPairRow`, nome de um design antigo em que
  // Última venda dividia linha com o Churrascômetro; hoje ela divide CARD
  // com Leads no funil, não tem "row" pareado nenhum mais — o nome não
  // correspondia a mais nada real, só a lógica em si estava certa).
  const nothingEnabled = !showHero && !showChurrasco && !showLastSale && !showFunnels && !showRanking;
  // Meta do mês batida — o Churrascômetro merece um "final feliz" em vez de
  // só continuar mostrando "134%" na mesma cor de sempre, como se nada
  // tivesse acontecido.
  const churrascoGoalHit = metrics.churrascometroProgress >= 100;
  const churrascoGradient = churrascoGoalHit
    ? "linear-gradient(90deg, #eab308, #fbbf24, #fde68a)"
    : "linear-gradient(90deg, #ef4444, #f97316, #fbbf24)";

  // Banner "TÁ NA HORA DO CHURRASCO" (tela escurecida + recado) — aparece
  // por CHURRASCO_BANNER_MS e some sozinho, uma vez por "sessão" de meta
  // batida (churrascoBannerShownRef reseta quando o progresso cai de 100%,
  // ex.: virada de mês, então na PRÓXIMA vez que a meta for batida ele
  // aparece de novo). Não aparece em cima do confete de venda nova: se uma
  // comemoração (TvWinCelebration) estiver na tela quando a meta é batida, o
  // banner espera ela terminar (`celebration` virar null de novo) pra só
  // então aparecer — os dois competindo por atenção ao mesmo tempo ficava
  // poluído. Sem venda/confete rolando (ex.: a TV já carrega com a meta já
  // batida), não tem o que esperar — aparece direto.
  //
  // 4 fases, não 3 — "entering" existe só por 2 frames (pedido explícito:
  // "tem que ir fechando a tela e não escurecer do nada"). Sem essa fase, a
  // primeira renderização já nasce com a classe `opacity-100` — o CSS
  // `transition-opacity` não tem NADA pra interpolar a partir daí (ele só
  // anima quando a propriedade MUDA depois de já montado), então o
  // escurecimento aparecia de um frame pro outro, instantâneo. Com
  // "entering" (opacity-0, igual à fase "leaving") no primeiro paint e só
  // DOIS `requestAnimationFrame` depois virando "visible" (opacity-100), o
  // navegador pinta o quadro escuro-zero uma vez de verdade antes de pedir
  // pra transicionar — aí sim o `transition-opacity` anima o closing de
  // verdade (mesmo truque de "2 rAF" já usado pro voo da foto em
  // tv-win-celebration.tsx, mesmo motivo: garantir que o estado inicial
  // pintou antes de mudar pro seguinte).
  const [churrascoBannerPhase, setChurrascoBannerPhase] = useState<"hidden" | "entering" | "visible" | "leaving">(
    "hidden",
  );
  const churrascoBannerShownRef = useRef(false);
  useEffect(() => {
    if (!churrascoGoalHit) {
      churrascoBannerShownRef.current = false;
      // setState direto no corpo do efeito é proposital — mesmo motivo do
      // reset de rankingSlide acima: sincroniza com uma condição externa
      // (meta deixou de estar batida) que só este efeito observa.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChurrascoBannerPhase("hidden");
      return;
    }
    if (celebration || churrascoBannerShownRef.current) return;
    churrascoBannerShownRef.current = true;
    setChurrascoBannerPhase("entering");
    let showFrame: number | undefined;
    const enterFrame = requestAnimationFrame(() => {
      showFrame = requestAnimationFrame(() => setChurrascoBannerPhase("visible"));
    });
    const leaveTimer = setTimeout(() => setChurrascoBannerPhase("leaving"), CHURRASCO_BANNER_MS);
    const hideTimer = setTimeout(() => setChurrascoBannerPhase("hidden"), CHURRASCO_BANNER_MS + CHURRASCO_BANNER_EXIT_MS);
    return () => {
      cancelAnimationFrame(enterFrame);
      if (showFrame !== undefined) cancelAnimationFrame(showFrame);
      clearTimeout(leaveTimer);
      clearTimeout(hideTimer);
    };
  }, [churrascoGoalHit, celebration]);

  // Conteúdo de cada lado do card ÚLTIMA VENDA (0 = venda mais recente, 1 =
  // aniversário de hoje) — função em vez de JSX duplicado, porque o MESMO
  // lado pode precisar ser desenhado duas vezes ao mesmo tempo durante uma
  // troca: uma vez como o que está ENTRANDO (rankingSlide atual) e, por
  // SLIDE_TRANSITION_MS, também como o que acabou de SAIR (outgoingSlide,
  // ver JSX mais abaixo) — arrastando pra fora enquanto o outro arrasta pra
  // dentro, ao mesmo tempo. Slide 1 usa a MESMA forma visual do slide 0
  // (avatar + rótulo/nome/linha colorida) de propósito — o card não muda de
  // "formato" ao trocar, só de conteúdo/cor.
  const renderLastSaleContent = (slide: 0 | 1) => {
    if (slide === 1) {
      // Só chega aqui quando hasBirthdayToday é verdadeiro (ver JSX mais
      // abaixo, que nem monta este carrossel senão) — então todo mundo em
      // `todayBirthdays` faz aniversário HOJE de verdade, nunca uma
      // "prévia" de outro dia do mês.
      const todayBirthdays = metrics.birthdaysThisMonth.filter((b) => b.isToday);
      return (
        <div className="relative flex flex-wrap items-center justify-center" style={{ gap: "calc(var(--tv-gap) * 1.2)" }}>
          {todayBirthdays.map((b) => (
            <div key={b.id} className="flex items-center" style={{ gap: "calc(var(--tv-gap) * 0.8)" }}>
              {/* Mesmo pacote de comemoração do card Ranking (ver
                  renderRankingContent) — foto girando 3D + sparkles
                  pulsando, pra quem faz aniversário hoje ganhar mais
                  destaque que só a borda colorida. */}
              <div className="relative shrink-0" style={{ width: "var(--tv-avatar-md)", height: "var(--tv-avatar-md)", perspective: "800px" }}>
                <span
                  className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-60 blur-lg"
                  style={{ inset: "-25%", backgroundColor: BIRTHDAY_COLOR }}
                />
                <Sparkles
                  className="absolute -top-1.5 -right-1.5 animate-pulse"
                  style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: BIRTHDAY_COLOR }}
                  strokeWidth={2.5}
                />
                <Sparkles
                  className="absolute -bottom-1 -left-1.5 animate-pulse"
                  style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: BIRTHDAY_COLOR, animationDelay: "0.6s" }}
                  strokeWidth={2.5}
                />
                {b.image ? (
                  <img
                    src={b.image}
                    alt={b.name}
                    className="animate-tv-photo-spin relative h-full w-full rounded-full object-cover shadow-lg"
                    style={{ border: `2px solid ${BIRTHDAY_COLOR}` }}
                  />
                ) : (
                  <div
                    className="animate-tv-photo-spin relative flex h-full w-full items-center justify-center rounded-full bg-neutral-700 text-[length:var(--tv-text-value-sm)]"
                    style={{ border: `2px solid ${BIRTHDAY_COLOR}` }}
                  >
                    {b.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0 max-w-[var(--tv-truncate-lg)] text-left">
                <div className="flex items-center gap-1.5">
                  <Cake
                    className="shrink-0"
                    style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: BIRTHDAY_COLOR }}
                    strokeWidth={2.5}
                  />
                  <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
                    Aniversário hoje
                  </p>
                </div>
                <p className="truncate font-medium text-[length:var(--tv-text-name)]">{b.name}</p>
                <p className="font-extrabold text-[length:var(--tv-text-value-sm)]" style={{ color: BIRTHDAY_COLOR }}>
                  <span className="inline-block animate-bounce">🎉</span> Parabéns!
                </p>
              </div>
            </div>
          ))}
        </div>
      );
    }
    return metrics.lastSale ? (
      <div className="relative flex items-center justify-center" style={{ gap: "calc(var(--tv-gap) * 0.8)" }}>
        {metrics.lastSale.image ? (
          <img
            id="tv-last-sale-avatar"
            src={metrics.lastSale.image}
            alt={metrics.lastSale.name}
            className="shrink-0 rounded-full object-cover shadow-lg"
            style={{
              width: "var(--tv-avatar-md)",
              height: "var(--tv-avatar-md)",
              outline: "2px solid var(--brand)",
              outlineOffset: 2,
            }}
          />
        ) : (
          <div
            id="tv-last-sale-avatar"
            className="flex shrink-0 items-center justify-center rounded-full bg-neutral-700 text-[length:var(--tv-text-value-sm)]"
            style={{
              width: "var(--tv-avatar-md)",
              height: "var(--tv-avatar-md)",
              outline: "2px solid var(--brand)",
              outlineOffset: 2,
            }}
          >
            {metrics.lastSale.name?.charAt(0)}
          </div>
        )}
        {/* min-w-0 sem flex-1 de propósito — sem flex-1 o bloco de texto some
            ao seu próprio tamanho em vez de esticar até preencher o resto do
            card, o que é o que deixa o par avatar+texto centralizar como uma
            unidade só via justify-center acima, em vez de ficar "grudado" à
            esquerda com um vão vazio sobrando à direita. */}
        <div className="min-w-0 max-w-[var(--tv-truncate-lg)] text-left">
          <div className="flex items-center gap-1.5">
            <Sparkles
              className="shrink-0"
              style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: "var(--brand)" }}
              strokeWidth={2.5}
            />
            <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
              Última venda
            </p>
          </div>
          <p className="truncate font-medium text-[length:var(--tv-text-name)]">{metrics.lastSale.name}</p>
          {/* Data de fechamento visível de verdade (não só no `title`,
              inútil numa TV sem mouse), com "há Xd" como legenda menor ao
              lado — pedido explícito. */}
          <div className="flex items-baseline gap-2">
            <p className="font-extrabold tabular-nums text-[length:var(--tv-text-value-sm)]" style={{ color: "var(--brand)" }}>
              {formatCurrencyCompact(metrics.lastSale.value)}
            </p>
            <p
              className="text-neutral-500 text-[length:var(--tv-text-label)]"
              title={brazilDateTime(metrics.lastSale.date)}
            >
              {formatShortDate(metrics.lastSale.date)}
            </p>
            {nowMs !== null && (
              <p
                className="text-neutral-500/70 text-[length:calc(var(--tv-text-label)*0.75)]"
                title={brazilDateTime(metrics.lastSale.date)}
              >
                ({formatRelativeTime(metrics.lastSale.date, nowMs)})
              </p>
            )}
          </div>
        </div>
      </div>
    ) : (
      <div className="relative">
        <div className="flex items-center justify-center gap-1.5">
          <Sparkles style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: "var(--brand)" }} strokeWidth={2.5} />
          <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
            Última venda
          </p>
        </div>
        <p className="mt-2 text-neutral-500 text-[length:var(--tv-text-body)]">Nenhuma venda registrada.</p>
      </div>
    );
  };

  // Conteúdo de cada lado do card RANKING (0 = pódio, 1 = aniversariantes do
  // mês) — mesmo motivo de renderLastSaleContent acima (precisa poder
  // desenhar o mesmo lado 2x ao mesmo tempo durante uma troca). Slide 1
  // mostra o MÊS inteiro (ver hasBirthdayThisMonth); quem faz aniversário
  // HOJE ganha borda rosa pra se destacar dentro da lista.
  const renderRankingContent = (slide: 0 | 1) => {
    if (slide === 1) {
      return (
        <>
          <div className="relative flex items-center justify-center gap-2">
            <Cake style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: BIRTHDAY_COLOR }} strokeWidth={2.5} />
            <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
              Aniversariantes do mês
            </p>
          </div>
          {/* Mesma linguagem visual do pódio (avatar em círculo com anel
              colorido, nome truncado embaixo, legenda pequena embaixo do
              nome) em vez da pílula com fundo/borda de antes — aquilo
              destoava do resto do dashboard (nenhum outro card usa esse
              estilo de chip pra pessoas, só pra contagem tipo "Leads no
              funil"). Quem faz aniversário HOJE ganha anel mais grosso +
              halo pulsante, igual o destaque do 1º lugar do pódio — o resto
              do mês fica discreto, anel fino neutro. */}
          <div
            className="relative flex flex-wrap items-start justify-center"
            style={{ gap: "calc(var(--tv-gap) * 1.1)", marginTop: "var(--tv-gap)" }}
          >
            {metrics.birthdaysThisMonth.map((b) => (
              <div key={b.id} className="flex flex-col items-center">
                {/* Quem faz aniversário HOJE ganha o pacote completo de
                    "comemoração" — mesma linguagem já usada na TV pra venda
                    fechada: foto girando 3D (animate-tv-photo-spin, mesma
                    animação do pódio/win-celebration — `perspective` no PAI,
                    não no elemento que gira), sparkles pulsando nos cantos, e
                    o emoji quicando (animate-bounce, nativo do Tailwind). O
                    resto do mês fica parado, sem competir com o destaque. */}
                <div
                  className="relative"
                  style={{
                    width: "var(--tv-avatar-lg)",
                    height: "var(--tv-avatar-lg)",
                    perspective: b.isToday ? "800px" : undefined,
                  }}
                >
                  {b.isToday && (
                    <>
                      <span
                        className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-60 blur-lg"
                        style={{ inset: "-25%", backgroundColor: BIRTHDAY_COLOR }}
                      />
                      <Sparkles
                        className="absolute -top-1.5 -right-1.5 animate-pulse"
                        style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: BIRTHDAY_COLOR }}
                        strokeWidth={2.5}
                      />
                      <Sparkles
                        className="absolute -bottom-1 -left-1.5 animate-pulse"
                        style={{
                          width: "var(--tv-icon-sm)",
                          height: "var(--tv-icon-sm)",
                          color: BIRTHDAY_COLOR,
                          animationDelay: "0.6s",
                        }}
                        strokeWidth={2.5}
                      />
                    </>
                  )}
                  {b.image ? (
                    <img
                      src={b.image}
                      alt={b.name}
                      className={`relative h-full w-full rounded-full object-cover shadow-lg ${b.isToday ? "animate-tv-photo-spin" : ""}`}
                      style={{ border: `${b.isToday ? 5 : 4}px solid ${b.isToday ? BIRTHDAY_COLOR : BIRTHDAY_COLOR_MUTED}` }}
                    />
                  ) : (
                    <div
                      className={`relative flex h-full w-full items-center justify-center rounded-full bg-neutral-700 text-[length:var(--tv-text-name)] ${b.isToday ? "animate-tv-photo-spin" : ""}`}
                      style={{ border: `${b.isToday ? 5 : 4}px solid ${b.isToday ? BIRTHDAY_COLOR : BIRTHDAY_COLOR_MUTED}` }}
                    >
                      {b.name.charAt(0)}
                    </div>
                  )}
                </div>
                <p
                  className={`mt-1.5 max-w-[var(--tv-truncate-md)] truncate text-[length:var(--tv-text-body)] ${b.isToday ? "font-bold text-white" : "font-medium"}`}
                  style={b.isToday ? undefined : { color: BIRTHDAY_COLOR_MUTED }}
                  title={b.name}
                >
                  {b.name}
                </p>
                <p
                  className="font-semibold text-[length:var(--tv-text-body)]"
                  style={{ color: b.isToday ? BIRTHDAY_COLOR : BIRTHDAY_COLOR_MUTED }}
                >
                  {b.isToday ? (
                    <>
                      <span className="inline-block animate-bounce">🎉</span> hoje
                    </>
                  ) : (
                    `dia ${b.day}`
                  )}
                </p>
              </div>
            ))}
          </div>
        </>
      );
    }
    return (
      <>
        <div className="relative flex items-center justify-center gap-2">
          <Trophy style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: "#eab308" }} strokeWidth={2.5} />
          <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
            Ranking do mês
          </p>
        </div>
        {metrics.ranking.length > 0 ? (
          <div className="relative flex items-end justify-center" style={{ gap: "var(--tv-gap)", marginTop: "var(--tv-gap)" }}>
            {podiumOrder(metrics.ranking).map(({ user, place }) => (
              <RankingPodiumSlot key={user.id} user={user} place={place} spinPhoto={rankingSpinActive} />
            ))}
          </div>
        ) : (
          <p className="relative mt-2 text-neutral-500 text-[length:var(--tv-text-body)]">Sem vendas este mês ainda.</p>
        )}
      </>
    );
  };

  return (
    // Todo o tamanho/espaçamento daqui pra baixo (padding da página, vão
    // entre painel de propaganda e de métricas, cards, barra do
    // Churrascômetro) usa os tokens fluidos --tv-* de app/globals.css, em
    // unidade `cq*` (CSS Container Query) — resolvida contra o ÚNICO
    // contêiner de medida que envolve esta página inteira, de ponta a
    // ponta nos dois eixos, sem sobra nenhuma nas laterais (ver
    // components/tv-shell.tsx). É por isso que não existe mais nenhum
    // `container-type`/tokens escopados aqui dentro de tv-view.tsx: um
    // único contêiner pra composição inteira já garante que TUDO —
    // banner, painel, cards, Churrascômetro — lê a MESMA largura/altura
    // real ao mesmo tempo, sem nenhum bloco medindo contra uma referência
    // diferente do resto (era exatamente esse descompasso entre
    // referências, não a ausência de uma moldura de proporção fixa, que
    // fazia o painel parecer "gordo" demais/o banner "fino" demais numa
    // janela fora de 16:9).
    <div className="flex h-full w-full flex-col" style={{ gap: "var(--tv-gap)", padding: "var(--tv-gap)" }}>
      {/* flex-col abaixo de 900px / flex-row a partir daí: o painel de
          métricas tem uma largura mínima (--tv-panel-w, piso de 320px) —
          numa janela mais estreita que isso, o painel de propaganda (que
          divide o espaço HORIZONTAL restante) encolhia até sumir de vista.
          Nenhuma TV de verdade é mais estreita que ~1280px, mas essa é uma
          rede de segurança barata: empilhado verticalmente, os dois sempre
          têm onde caber, em vez de brigar pela mesma largura escassa. */}
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--tv-gap)] min-[900px]:flex-row">
        {/* Propagandas — crossfade fluido entre imagens empilhadas (em vez de
            trocar o src de uma única <img>, que só "pipoca" sem transição
            real) + zoom lento contínuo (Ken Burns) pra nunca ficar estática.
            Wrapper EXTERNO (sem overflow-hidden) só pro halo de marca poder
            vazar pra fora da moldura arredondada — colocar o glow por dentro
            do painel (com overflow-hidden) simplesmente sumia atrás da
            propaganda em tela cheia, que cobre 100% da área. Antes esse lado
            ficava discreto demais (borda cinza sem graça) perto do painel de
            métricas cheio de detalhe; os dois liam como telas separadas em
            vez de uma composição só. */}
        <div className="relative min-h-0 flex-1">
          <div
            className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-25 blur-3xl"
            style={{
              top: "calc(var(--tv-gap) * -2)",
              left: "calc(var(--tv-gap) * -2)",
              width: "clamp(180px, 18cqw, 320px)",
              height: "clamp(180px, 18cqw, 320px)",
              backgroundColor: "var(--brand)",
            }}
          />
          <div
            className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-20 blur-3xl"
            style={{
              bottom: "calc(var(--tv-gap) * -2)",
              right: "calc(var(--tv-gap) * -2)",
              width: "clamp(180px, 18cqw, 320px)",
              height: "clamp(180px, 18cqw, 320px)",
              backgroundColor: "var(--brand)",
              animationDelay: "1.2s",
            }}
          />
          <div
            className="relative h-full w-full overflow-hidden bg-neutral-950"
            style={{
              borderRadius: "var(--tv-radius-lg)",
              border: "1px solid rgba(139, 141, 243, 0.25)",
              boxShadow: "0 0 0 1px rgba(139, 141, 243, 0.08), 0 30px 70px -25px rgba(90, 91, 230, 0.45)",
            }}
          >
            {metrics.adsUrls && metrics.adsUrls.length > 0 ? (
              metrics.adsUrls.map((url, i) => (
                <div
                  key={url}
                  className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
                    i === safeAdIndex ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {/* Cópia da mesma imagem, ampliada e borrada, preenchendo a
                      moldura inteira atrás — resolve imagem de proporção
                      diferente do quadro (celular vertical, quadrada etc.) sem
                      cortar nada nem esticar: a imagem real fica INTEIRA
                      (object-contain) por cima, nunca com tarja preta feia do
                      lado. */}
                  <div
                    className="absolute inset-0 scale-110 bg-cover bg-center opacity-60 blur-2xl"
                    style={{ backgroundImage: `url(${url})` }}
                  />
                  <img
                    src={url}
                    alt={`Propaganda ${i + 1}`}
                    className="animate-tv-ken-burns relative h-full w-full object-contain"
                  />
                </div>
              ))
            ) : (
              <div className="flex h-full items-center justify-center text-neutral-500">
                Nenhuma propaganda configurada.
              </div>
            )}
            {metrics.adsUrls && metrics.adsUrls.length > 1 && (
              <div className="absolute left-1/2 flex -translate-x-1/2 gap-1.5" style={{ bottom: "var(--tv-gap)" }}>
                {metrics.adsUrls.map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: i === safeAdIndex ? 24 : 6,
                      backgroundColor: i === safeAdIndex ? "var(--brand)" : "rgba(255,255,255,0.3)",
                    }}
                  />
                ))}
              </div>
            )}
            <TvClock stale={stale} />
          </div>
        </div>

        {/* Separador sutil entre os dois painéis — um fio de gradiente na cor
            de marca em vez de só um vão vazio. Horizontal quando empilhado
            (abaixo de 900px), vertical a partir daí — acompanha a mesma
            troca de direção do container acima. */}
        <div
          className="h-px w-full shrink-0 min-[900px]:h-auto min-[900px]:w-px min-[900px]:self-stretch"
          style={{ background: "linear-gradient(to bottom, transparent, var(--brand), transparent)", opacity: 0.35 }}
        />

        {/* Painel de métricas — "bento" de tamanhos variados, todos os
            widgets habilitados ao mesmo tempo. Largura fluida (--tv-panel-w)
            só a partir de 900px (par com o breakpoint de empilhar acima) —
            abaixo disso ocupa a largura toda, já que os dois painéis não
            estão mais lado a lado. Numa TV bem menor que 1920px de
            referência, 600px sozinho já dominava a tela; numa 4K, ficava
            proporcionalmente pequeno demais perto do painel de propaganda
            gigante do lado.

            scrollbar-thin + overflow-y-auto + min-h-0: rede de segurança —
            a raiz da TV (app/tv/layout.tsx) tem overflow-hidden de
            propósito (uma TV de verdade nunca deve mostrar barra de
            rolagem), então QUALQUER conteúdo empilhado aqui que não coubesse
            na tela simplesmente sumia, cortado pela borda da PÁGINA inteira
            (não de um card específico) — sem nenhum indício visual de que
            faltava algo, sem overflow-hidden aparente em lugar nenhum (era o
            da raiz, três níveis acima, comendo o excesso em silêncio). Com
            isso, se o conteúdo empilhado (logo + até 4 cards) precisar de
            mais espaço vertical do que sobrou, ele rola dentro do próprio
            painel em vez de desaparecer sem deixar rastro — mas SÓ abaixo
            de 900px (celular/tela pequena de verdade, onde o piso dos
            tokens --tv-* pode legitimamente não caber). A partir de 900px
            (tablet, monitor, TV) o rolamento é DESLIGADO de propósito
            (`min-[900px]:overflow-hidden`) — pedido explícito: numa tela
            grande não pode existir a opção de "mexer"/arrastar o painel,
            nem que aparecesse sobrando por um instante; se algum dia não
            coubesse aí, o certo é ajustar os tokens, não deixar a rolagem
            mascarar o problema numa tela que deveria ter espaço de sobra.
            `shrink-0` virou responsivo pela mesma régua de 900px, onde a
            largura fixa do painel já garante espaço de sobra — abaixo
            disso ele pode encolher de verdade pra dividir a altura com o
            painel de propaganda. */}
        <div className="scrollbar-thin flex min-h-0 w-full flex-col overflow-y-auto min-[900px]:w-[var(--tv-panel-w)] min-[900px]:shrink-0 min-[900px]:overflow-hidden">
          {/* Sem container-type próprio aqui — desde a migração pro
              contêiner único (ver components/tv-shell.tsx e o comentário
              logo acima do `return`), logo+cards leem os MESMOS tokens
              `--tv-*` cq* de app/globals.css que o resto da página inteira
              usa, um único contêiner de referência pra tudo. A logo
              continua no MESMO wrapper que os cards de propósito: ela e os
              cards precisam manter a MESMA relação de tamanho entre si
              sempre. */}
          {/* justify-start (não justify-evenly — testado e revertido, pedido
              explícito: logo+cards não podem se separar verticalmente uns
              dos outros; e não justify-center — testado e revertido de
              novo, relato ao vivo na TV real: "a logo está abaixo demais")
              — se o conteúdo natural (logo + cards, já no tamanho cqh que
              a altura real disponível define) couber com sobra, essa
              sobra vira margem só embaixo do grupo (depois do Ranking),
              nunca em cima empurrando a logo pra baixo. O grupo continua
              compacto entre si de qualquer forma (mesmo `--tv-gap` fixo
              entre cada card, nunca um vão crescendo entre eles) — a única
              coisa que muda entre start/center/evenly é ONDE a sobra de
              espaço vai parar, nunca se os cards se separam uns dos
              outros. */}
          <div className="flex min-h-0 flex-1 flex-col justify-start" style={{ gap: "var(--tv-gap)" }}>
            <div className="flex shrink-0 justify-center">
              {/* A logo NUNCA participa do carrossel abaixo (ver
                  rankingSlide) — fica fora do bloco que troca de
                  conteúdo, sempre no mesmo lugar. */}
              <img
                src="/logo-reobote.svg"
                alt="Reobote Consórcios"
                className="w-auto"
                style={{ height: "var(--tv-logo-h)" }}
              />
            </div>
            {showHero && (
              <GlassCard delay={90} className="shrink-0 text-center">
                <Glow color="var(--brand)" />
                <div className="relative flex items-center justify-center gap-2">
                  <TrendingUp
                    className="shrink-0"
                    style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: "var(--brand)" }}
                    strokeWidth={2.5}
                  />
                  <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
                    Vendas do mês
                  </p>
                </div>
                <div
                  className="relative mt-2 font-extrabold tabular-nums text-[length:var(--tv-text-hero)]"
                  style={{ color: "var(--brand)" }}
                >
                  {formatCurrencyCompact(metrics.vendasMes)}
                </div>
                <div
                  className="relative flex divide-x divide-white/10 border-t border-white/10 text-[length:var(--tv-text-body)]"
                  style={{ marginTop: "var(--tv-gap)", paddingTop: "var(--tv-gap)" }}
                >
                  <div className="flex-1">
                    <div className="font-semibold text-neutral-400">Anuais</div>
                    <div className="mt-1 font-bold text-[length:var(--tv-text-value-sm)]">
                      {formatCurrencyCompact(metrics.vendasAnuais)}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-neutral-400">Cotas</div>
                    <div className="mt-1 font-bold text-[length:var(--tv-text-value-sm)]">
                      {formatCurrencyCompact(metrics.vendasCotas)}
                    </div>
                  </div>
                </div>
              </GlassCard>
            )}

            {/* Carrossel PRÓPRIO deste card (não do painel inteiro) — só
                participa da troca quando alguém faz aniversário HOJE de
                verdade (hasBirthdayToday, não hasBirthdayThisMonth — pedido
                explícito: 2 dias antes/depois não é suficiente pra este
                card sair do lugar). Sem isso, fica sempre no conteúdo
                normal, MESMO com o Ranking girando ao lado por causa de
                outro dia do mês — os dois cards têm o próprio gatilho,
                embora compartilhem o mesmo relógio (`rankingSlide`) pra
                trocar junto quando os dois estão de fato ativos.

                Quando ativo: o lado que está SAINDO (outgoingSlide) fica
                sobreposto (absolute inset-0) animando pra fora, ao mesmo
                tempo em que o lado que está ENTRANDO (normal, no fluxo)
                anima vindo do lado oposto — os dois cruzando dentro do
                próprio card. */}
            {/* Última venda + Leads no funil juntos no MESMO card agora
                (pedido explícito) — antes eram 2 GlassCard separados
                empilhados; viram 1 só, com um travessão horizontal
                (border-t) separando as duas seções em vez de 2 caixas de
                vidro distintas. Mesmo traço embutido em Tailwind que o
                card "Vendas do mês" já usa entre o valor principal e a
                fileira Anuais/Cotas — reaproveita a gramática visual que
                já existe, não inventa um 3º estilo de divisor.
                `relative` no wrapper da Última venda (não só no card
                inteiro) é necessário pro carrossel de aniversário
                (outgoingSlide, `absolute inset-0`) ficar restrito a ESSA
                seção — sem isso, o slide saindo cobriria o card inteiro,
                inclusive a parte de Leads no funil por baixo.
                minHeight (mesmo valor de --tv-avatar-md, que é sempre o
                elemento mais alto de qualquer um dos 3 estados possíveis
                aqui: venda normal, aniversário, ou "nenhuma venda
                registrada") evita que ESTE card mude de altura sozinho —
                sem isso, quando `metrics.lastSale` fica null (nenhuma
                venda no mês, ou uma venda desfeita — ver
                lastSeenClosedAtMs) o card encolhe bastante (o fallback não
                tem avatar), empurrando/puxando o Ranking logo abaixo pra
                cima e pra baixo cada vez que isso muda — era exatamente
                esse pulo que o usuário reportou ("Ranking não pode mexer
                pra cima e pra baixo"). Mesmo raciocínio do minHeight do
                Ranking, aplicado aqui pelo mesmo motivo. */}
            {(showLastSale || showFunnels) && (
              <GlassCard delay={180} className="shrink-0 text-center">
                <Glow color="var(--brand)" />

                {showLastSale && (
                  <div className="relative" style={{ minHeight: "var(--tv-avatar-md)" }}>
                    {hasBirthdayToday && outgoingSlide !== null && (
                      <div
                        className={`absolute inset-0 flex items-center justify-center ${
                          outgoingSlide === 0 ? "animate-tv-slide-out-to-left" : "animate-tv-slide-out-to-right"
                        }`}
                      >
                        {renderLastSaleContent(outgoingSlide)}
                      </div>
                    )}
                    <div
                      key={hasBirthdayToday ? rankingSlide : 0}
                      className={
                        hasBirthdayToday && rankingSlide === 1
                          ? "animate-tv-slide-in-from-right"
                          : "animate-tv-slide-in-from-left"
                      }
                    >
                      {renderLastSaleContent(hasBirthdayToday ? rankingSlide : 0)}
                    </div>
                  </div>
                )}

                {showLastSale && showFunnels && (
                  <div
                    className="relative border-t border-white/10"
                    style={{ marginTop: "var(--tv-gap)", paddingTop: "var(--tv-gap)" }}
                  />
                )}

                {showFunnels && (
                  <div className="relative">
                    <div className="flex items-center justify-center gap-2">
                      <Waypoints
                        style={{ width: "var(--tv-icon-md)", height: "var(--tv-icon-md)", color: "var(--brand)" }}
                        strokeWidth={2.5}
                      />
                      <p className="font-semibold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-label)]">
                        Leads no funil
                      </p>
                    </div>
                    {metrics.leadsInFunnels.length > 0 ? (
                      // Sem caixa nenhuma agora (nem pílula, nem tile com
                      // borda/fundo) — mesma gramática visual já usada logo
                      // ACIMA, no card "Vendas do mês" (Anuais | Cotas: colunas
                      // separadas só por um fio fino, sem contorno em cada
                      // uma). Reaproveitar o mesmo padrão em vez de inventar um
                      // 3º estilo é o que dá a leveza pedida.
                      <div className="flex divide-x divide-white/10" style={{ marginTop: "var(--tv-gap)" }}>
                        {metrics.leadsInFunnels.map((stage) => (
                          <div key={stage.id} className="min-w-0 flex-1 px-2">
                            <div
                              className="font-extrabold tabular-nums text-[length:var(--tv-text-value-md)]"
                              style={{ color: "var(--brand)" }}
                            >
                              {stage.count}
                            </div>
                            <div className="mt-1 truncate font-medium text-neutral-400 text-[length:var(--tv-text-label)]">
                              {stage.name}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-neutral-500 text-[length:var(--tv-text-body)]">Nenhum funil selecionado.</p>
                    )}
                  </div>
                )}
              </GlassCard>
            )}

            {/* Carrossel PRÓPRIO deste card — mesmo mecanismo do card Última
                venda acima, ver comentário lá. minHeight evita o card
                encolher/crescer demais entre o pódio (mais alto) e a lista
                de aniversariantes (mais baixa) — clamp() em cqh contra o
                canvas 16:9 (ver comentário no topo de app/globals.css),
                mesmo piso/teto de sempre. */}
            {showRanking && (
              <GlassCard
                delay={360}
                className="shrink-0 text-center"
                style={{ minHeight: "clamp(13rem, 28.17cqh, 19rem)" }}
              >
                <Glow color="#eab308" />
                {outgoingSlide !== null && (
                  <div
                    className={`absolute inset-0 flex flex-col items-center justify-center ${
                      outgoingSlide === 0 ? "animate-tv-slide-out-to-left" : "animate-tv-slide-out-to-right"
                    }`}
                  >
                    {renderRankingContent(outgoingSlide)}
                  </div>
                )}
                <div
                  key={rankingSlide}
                  className={rankingSlide === 1 ? "animate-tv-slide-in-from-right" : "animate-tv-slide-in-from-left"}
                >
                  {renderRankingContent(rankingSlide)}
                </div>
              </GlassCard>
            )}

            {nothingEnabled && (
              <p className="text-center text-neutral-500 text-[length:var(--tv-text-body)]">Nenhum widget habilitado.</p>
            )}
          </div>
        </div>
      </div>

      {showChurrasco && (
        <GlassCard delay={0} className="flex w-full shrink-0 items-center" style={{ gap: "calc(var(--tv-gap) * 1.6)" }}>
          <Glow color={churrascoGoalHit ? "#eab308" : "#f97316"} />

          <div className="relative flex shrink-0 items-center gap-3">
            {/* A chama fica sempre visível, inclusive em 100% — era trocada
                por um troféu na meta batida, o que "apagava" a animação bem
                na hora em que ela chega no estado mais aceso (ver
                AnimatedFire). O troféu virou o overlay de tela cheia logo
                abaixo (churrascoGoalHit). */}
            <AnimatedFire
              progress={metrics.churrascometroProgress}
              className="text-orange-400"
              style={{ width: "var(--tv-icon-lg)", height: "var(--tv-icon-lg)" }}
            />
            <p className="font-bold tracking-widest text-neutral-400 uppercase text-[length:var(--tv-text-body)]">
              Churrascômetro
            </p>
          </div>

          <div
            className="relative flex flex-1 items-center overflow-hidden rounded-full bg-white/10"
            style={{ height: "clamp(0.75rem, 1.1cqw, 1.25rem)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${Math.min(100, metrics.churrascometroProgress)}%`,
                background: churrascoGradient,
              }}
            />
          </div>

          <div className="relative flex shrink-0 items-center justify-end" style={{ minWidth: "clamp(8rem, 12cqw, 14rem)" }}>
            {churrascoGoalHit ? (
              <div className="flex items-center gap-2">
                <PartyPopper
                  className="shrink-0"
                  style={{ width: "var(--tv-icon-lg)", height: "var(--tv-icon-lg)", color: "#eab308" }}
                  strokeWidth={2.5}
                />
                <span
                  className="bg-clip-text font-extrabold text-transparent text-[length:var(--tv-text-value-sm)]"
                  style={{ backgroundImage: churrascoGradient }}
                >
                  Meta batida!
                </span>
              </div>
            ) : (
              <span
                className="bg-clip-text font-extrabold tabular-nums text-transparent text-[length:var(--tv-text-value-md)]"
                style={{ backgroundImage: churrascoGradient }}
              >
                {metrics.churrascometroProgress.toFixed(0)}%
              </span>
            )}
          </div>
        </GlassCard>
      )}

      {/* Banner "TÁ NA HORA DO CHURRASCO" — ver churrascoBannerPhase acima
          pra quando ele aparece/some. Escurece o painel inteiro por baixo
          (fixed inset-0) e estampa o recado por cima só por
          CHURRASCO_BANNER_MS, não pro resto do mês. z-[150], abaixo da
          comemoração de venda nova (z-[200] em TvWinCelebration) de
          propósito — mesmo que as janelas de tempo dos dois cheguem a se
          encostar, o confete nunca fica escondido atrás do escurecido.
          pointer-events-none: é uma TV, ninguém interage com a tela, então
          o overlay nunca pode bloquear nada.

          Escurecimento em fade, não corte seco: o wrapper vai de
          `opacity-0` (fases "entering" e "leaving") pra `opacity-100`
          (fase "visible") via `transition-opacity` — a fase "entering" (só
          2 frames, ver churrascoBannerPhase) existe pra garantir que o
          navegador PINTA o quadro zerado antes de pedir a transição, senão
          não tem o que animar (ver comentário lá em cima do state). Tela
          quase preta (`bg-black/90`, antes era /70) enquanto isso.

          Texto/glow entram DEPOIS, com seu próprio atraso: ficam
          invisíveis (`opacity: 0` estático, fora da animação) até
          CHURRASCO_BANNER_TEXT_DELAY_MS depois do mount — só aí o
          `animationDelay` deixa a animação ligar de verdade e eles aparecem
          (glow com um fade suave até opacity: 0.7, texto com o mesmo "pop"
          que a comemoração de venda usa). `forwards` no shorthand (em vez
          da classe `.animate-tv-win-in` compartilhada, que não tem
          `forwards`) é o que faz o estado final da animação GRUDAR depois
          dela terminar — sem isso, o elemento voltaria pro `opacity: 0`
          estático assim que a animação acabasse, e o texto sumiria de novo
          logo depois de aparecer (mesma armadilha corrigida no confete de
          tv-win-celebration.tsx, ver comentário lá). Quando a fase vira
          "leaving", a MESMA transição de opacidade do wrapper (600ms)
          desvanece TUDO junto — fundo escuro, glow e texto já
          "assentados" — de volta pra transparente, o texto some com o
          resto. */}
      {churrascoBannerPhase !== "hidden" && (
        <div
          className={`pointer-events-none fixed inset-0 z-[150] flex items-center justify-center overflow-hidden bg-black/90 transition-opacity duration-[600ms] ${
            churrascoBannerPhase === "visible" ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className="absolute h-[42cqw] w-[42cqw] rounded-full bg-[radial-gradient(circle,rgba(251,191,36,0.35),transparent_70%)] blur-3xl"
            style={{
              opacity: 0,
              animation: `tv-churrasco-glow-in 900ms var(--ease-smooth) ${CHURRASCO_BANNER_TEXT_DELAY_MS}ms forwards`,
            }}
          />
          {/* Mesma chama animada do Churrascômetro (AnimatedFire), não mais
              o emoji 🔥 estático — pedido explícito, "replica aquele mesmo
              fogo... dois animados 100%". progress={100} fixo (não
              metrics.churrascometroProgress): esse banner só aparece com a
              meta batida, e 100 é exatamente o estado "aceso ao máximo" que
              o componente já sabe desenhar (contorno brilhante, faíscas,
              balanço mais rápido) — não precisa ler a métrica de novo pra
              chegar no mesmo resultado visual. Tamanho relativo ao próprio
              --tv-text-hero (não --tv-icon-lg, pequeno demais perto de um
              texto desse tamanho) — 0.6× a fonte, porque o componente ainda
              cresce sozinho até 1.8× disso a 100% (ver `fireScale` em
              animated-fire.tsx), senão a chama ficava maior que o próprio
              texto.

              A chama da DIREITA vem dentro de um wrapper com
              `scaleX(-1)` — AnimatedFire sempre ancora o crescimento no
              próprio lado DIREITO (pensado originalmente só pro
              Churrascômetro, onde a chama fica à ESQUERDA do texto e cresce
              pra fora/esquerda) — sem espelhar, a chama da direita cresceria
              pra ESQUERDA também, ou seja, por CIMA do texto em vez de pra
              fora dele. Espelhar a silhueta da chama não faz diferença
              nenhuma (ela não tem "lado" que precise ficar certo). */}
          <div
            className="relative flex items-center px-8"
            style={{
              gap: "calc(var(--tv-gap) * 1.5)",
              opacity: 0,
              animation: `tv-win-in 650ms var(--ease-spring) ${CHURRASCO_BANNER_TEXT_DELAY_MS}ms forwards`,
            }}
          >
            <AnimatedFire
              progress={100}
              className="shrink-0 text-orange-400"
              style={{ width: "calc(var(--tv-text-hero) * 0.6)", height: "calc(var(--tv-text-hero) * 0.6)" }}
            />
            <h1 className="bg-gradient-to-r from-amber-300 via-yellow-400 to-orange-400 bg-clip-text text-center font-extrabold tracking-wide text-transparent drop-shadow-[0_0_50px_rgba(251,191,36,0.55)] text-[length:var(--tv-text-hero)]">
              TÁ NA HORA DO CHURRASCO
            </h1>
            <div className="shrink-0" style={{ transform: "scaleX(-1)" }}>
              <AnimatedFire
                progress={100}
                className="text-orange-400"
                style={{ width: "calc(var(--tv-text-hero) * 0.6)", height: "calc(var(--tv-text-hero) * 0.6)" }}
              />
            </div>
          </div>
        </div>
      )}

      {celebration && <TvWinCelebration key={celebration.id} sale={celebration} onDone={() => setCelebration(null)} />}
    </div>
  );
}

/** Card de vidro compacto reutilizado por todo o painel de métricas — entrada
 * em cascata via `delay` (ms), sempre `relative overflow-hidden` pra caber o
 * <Glow> decorativo atrás do conteúdo. Padding/raio fluidos (--tv-card-*,
 * --tv-radius) — `style` do chamador (ver churrascômetro) mescla por cima,
 * e uma classe Tailwind com `!important` (ver `!py-4` de antes) continua
 * conseguindo sobrescrever, já que inline style comum não tem prioridade
 * sobre `!important` de uma classe.
 *
 * `shrink-0` no className de CADA chamada empilhada dentro do bloco de
 * cards (não aqui dentro, cada chamador decide) é obrigatório, não estético:
 * sem ele, se o conteúdo natural de logo+cards (já no tamanho que os
 * tokens cqh mandam) ultrapassar por pouco a altura disponível, o flexbox
 * espreme os cards (flex-shrink:1 é o padrão) ATÉ que caibam — e como este
 * componente tem `overflow-hidden` (necessário pro <Glow> respeitar o
 * canto arredondado), o texto que não coube nesse espaço espremido some
 * CORTADO, sem aviso nenhum (foi exatamente o bug relatado: "Leads no
 * funil" cortado ao meio, base do pódio cortada). Com `shrink-0`, o card
 * NUNCA fica menor que seu conteúdo natural — se ainda assim não couber,
 * quem resolve é o `overflow-y-auto` do painel (ver comentário mais acima
 * sobre a "rede de segurança"), que rola em vez de cortar — só abaixo de
 * 900px, porém: a partir daí o rolamento é desligado de propósito
 * (`min-[900px]:overflow-hidden`), não pode existir a opção de arrastar o
 * painel numa tela grande. */
function GlassCard({
  children,
  delay = 0,
  className = "",
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`surface-glass-panel animate-tv-fade-slide-in relative overflow-hidden ${className}`}
      style={{
        borderRadius: "var(--tv-radius)",
        padding: "var(--tv-card-py) var(--tv-card-px)",
        animationDelay: `${delay}ms`,
        animationFillMode: "backwards",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Mancha de cor borrada num canto do card — dá um respiro de cor por trás
 * do conteúdo sem competir com o texto. Parada (sem pulsar) e bem discreta —
 * o pulso contínuo ficou só nos dois halos de fora da moldura de propaganda
 * (ver mais acima); dentro dos cards, muita luz pulsando ao mesmo tempo
 * competia demais com o próprio conteúdo. Opacidade mais baixa e blur mais
 * forte que antes, de propósito — quase um sussurro de cor, não um brilho. */
function Glow({ color }: { color: string }) {
  return (
    <div
      className="pointer-events-none absolute rounded-full opacity-10 blur-3xl"
      style={{
        top: "calc(var(--tv-gap) * -0.9)",
        right: "calc(var(--tv-gap) * -0.9)",
        // --tv-glow-size via var(--tv-glow-size), não um clamp() cru
        // repetido aqui — Glow é usado tanto dentro dos cards (Hero/
        // MergedCard/Ranking) quanto fora (Churrascômetro), e desde a
        // migração pro canvas 16:9 único (ver app/globals.css) é o MESMO
        // token, mesmo valor, nos dois lugares — sem precisar de um
        // segundo contexto de escala pra sincronizar os dois.
        width: "var(--tv-glow-size)",
        height: "var(--tv-glow-size)",
        backgroundColor: color,
      }}
    />
  );
}

type RankingUser = Metrics["ranking"][number];

/** Reordena pro formato de pódio de verdade — 2º à esquerda, 1º no meio (mais
 * alto), 3º à direita — em vez de só 1º/2º/3º em fila da esquerda pra
 * direita. Com menos de 2 vendedores no ranking, mantém a ordem simples
 * (não tem "pódio" com uma pessoa só). */
function podiumOrder(ranking: RankingUser[]): { user: RankingUser; place: number }[] {
  if (ranking.length < 2) return ranking.map((user, i) => ({ user, place: i }));
  return [1, 0, 2].filter((place) => place < ranking.length).map((place) => ({ user: ranking[place], place }));
}

const PODIUM_RING = ["#eab308", "#cbd5e1", "#b45309"];
// Alturas da base do pódio — 1º bem mais alta, 3º mais baixa, dá a forma de
// pódio de verdade em vez de só variar o tamanho do avatar. clamp() em cqh
// contra o canvas 16:9 (ver comentário no topo de app/globals.css) — a base
// precisa crescer/encolher junto com avatar/texto ao redor conforme o
// canvas muda de tamanho, em vez de ficar num valor fixo que desentoaria
// do resto.
const PODIUM_BASE_HEIGHT = ["clamp(1.1rem, 2.82cqh, 3.5rem)", "clamp(0.8rem, 2cqh, 2.5rem)", "clamp(0.55rem, 1.41cqh, 1.75rem)"];
const PODIUM_AVATAR_VAR = ["var(--tv-avatar-lg)", "var(--tv-avatar-md)", "var(--tv-avatar-md)"];
const PODIUM_MEDAL = ["", "🥈", "🥉"];

function RankingPodiumSlot({
  user,
  place,
  spinPhoto,
}: {
  user: RankingUser;
  place: number;
  /** Liga a cada 5min pras 3 fotos ao mesmo tempo (ver RANKING_SPIN_* em
   * tv-view.tsx) — destaque periódico pro pódio, não preso a nenhum evento. */
  spinPhoto: boolean;
}) {
  // A ordem visual (2º, 1º, 3º da esquerda pra direita) já vem pronta de
  // podiumOrder() acima — essa função só desenha o slot, não decide posição.
  const ring = PODIUM_RING[place] ?? "#525252";
  const avatarSize = PODIUM_AVATAR_VAR[place] ?? "var(--tv-avatar-md)";
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center justify-center text-[length:var(--tv-text-value-sm)]" style={{ height: "var(--tv-icon-lg)" }}>
        {place === 0 ? (
          <Crown style={{ width: "var(--tv-icon-lg)", height: "var(--tv-icon-lg)", color: ring }} strokeWidth={2.5} />
        ) : (
          PODIUM_MEDAL[place]
        )}
      </div>
      {/* perspective aqui no PAI (não no elemento que gira) é o que faz o
          giro no eixo Y (.animate-tv-photo-spin) parecer 3D de verdade — a
          própria foto gira dentro da moldura redonda que já tem. */}
      <div className="relative mt-1" style={{ width: avatarSize, height: avatarSize, perspective: "800px" }}>
        {/* Halo dourado pulsando só atrás do 1º lugar — o resto do pódio já
            se diferencia por tamanho de avatar/coroa, mas o vencedor do mês
            merecia um destaque que não depende de reparar em detalhe, bate o
            olho na hora (mesmo .animate-tv-glow-pulse já usado nos halos de
            fora da moldura de propaganda, só que aqui pequeno e centrado). */}
        {place === 0 && (
          <span
            className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-60 blur-xl"
            style={{ inset: "-30%", backgroundColor: ring }}
          />
        )}
        {user.image ? (
          <img
            src={user.image}
            alt={user.name}
            className={`relative h-full w-full rounded-full object-cover shadow-lg ${spinPhoto ? "animate-tv-photo-spin" : ""}`}
            style={{ border: `${place === 0 ? 4 : 3}px solid ${ring}` }}
          />
        ) : (
          <div
            className={`relative flex h-full w-full items-center justify-center rounded-full bg-neutral-700 text-[length:var(--tv-text-value-sm)] ${spinPhoto ? "animate-tv-photo-spin" : ""}`}
            style={{ border: `${place === 0 ? 4 : 3}px solid ${ring}` }}
          >
            {user.name.charAt(0)}
          </div>
        )}
      </div>
      <div
        className={`mt-2 max-w-[var(--tv-truncate-sm)] truncate ${place === 0 ? "font-bold text-[length:var(--tv-text-name)]" : "font-medium text-[length:var(--tv-text-body)]"}`}
        title={user.name}
      >
        {user.name.toLowerCase()}
      </div>
      <div
        className="font-bold"
        style={place === 0 ? { color: ring, fontSize: "var(--tv-text-value-sm)" } : { fontSize: "var(--tv-text-body)" }}
      >
        <CountUpValue value={user.total} format="currency-compact" />
      </div>
      {/* Só o 1º lugar ganha esse selo — reforça "é você mesmo, é o
          vendedor do mês" sem precisar ler número nenhum pra entender. */}
      {place === 0 && (
        <p
          className="mt-0.5 font-bold tracking-wide uppercase text-[length:var(--tv-text-label)]"
          style={{ color: ring }}
        >
          🏆 Vendedor do mês
        </p>
      )}
      {/* Barra da base do pódio — 1º mais alta, 3º mais baixa, dá a forma de
          pódio de verdade em vez de só variar o tamanho do avatar. Largura em
          clamp() cqh, mesmo motivo/proporção de PODIUM_BASE_HEIGHT acima. */}
      <div
        className="mt-2 rounded-t-md"
        style={{
          width: "clamp(2.3rem, 5.93cqh, 7.4rem)",
          height: PODIUM_BASE_HEIGHT[place],
          background: `linear-gradient(180deg, ${ring}55, ${ring}15)`,
        }}
      />
    </div>
  );
}

const BIRTHDAY_COLOR = "#f472b6";
// Versão apagada da mesma cor — pro anel/legenda de quem NÃO faz
// aniversário hoje, na lista do mês (ver renderRankingContent em
// tv-view.tsx). Antes era cinza neutro (mesmo tom do pódio sem posição),
// lia como "sem cor nenhuma" — isso aqui já é a cor do tema de aniversário,
// só discreta, pra quem faz hoje continuar claramente se destacando com a
// cor cheia ao lado.
//
// Cor SÓLIDA (não rgba com opacidade) de propósito — a 1ª tentativa usava
// `rgba(244,114,182,0.55)`, que misturado com o fundo quase preto do card
// vira um tom escuro/dessaturado, lendo como "cinza" de novo numa TV vista
// de longe (foi exatamente o que aconteceu: opacidade some contra fundo
// escuro, sólido não).
const BIRTHDAY_COLOR_MUTED = "#d98fb8";
