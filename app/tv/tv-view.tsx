"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { TrendingUp, Sparkles, Waypoints, PartyPopper, Cake } from "lucide-react";
import { AnimatedFire } from "@/components/animated-fire";
// import { ReoboteLogo } from "@/components/reobote-logo"; // desligado — ver comentário de LOGO_ASPECT_RATIO mais abaixo
import { fetchTvMetrics } from "./actions";
import { formatCurrency, formatCurrencyCompact } from "@/lib/format";
import { getBrazilParts, brazilDateTime } from "@/lib/timezone";
import { TvWinCelebration } from "./tv-win-celebration";
import { TvClock } from "./tv-clock";

type Metrics = Awaited<ReturnType<typeof fetchTvMetrics>>;
type WinSale = { id: string; name: string; image: string | null; value: number };

// Só o carrossel de propaganda gira sozinho — o painel de métricas mostra
// TODOS os widgets habilitados ao mesmo tempo (ver corpo do componente
// abaixo), num "bento" de tamanhos variados em vez de retângulos idênticos
// empilhados: hero pra vendas do mês, última venda, tiras pro funil, e o
// churrascômetro numa barra full-width embaixo. (O Ranking do mês NÃO faz
// parte desta tela: ela fica à vista de cliente, e o ranking vive numa TV
// interna à parte — ver app/tv/ranking-view.tsx.)
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
// Carrossel do card ÚLTIMA VENDA (ver renderLastSaleContent no componente
// abaixo) — alterna entre o conteúdo normal (a venda mais recente) e o(s)
// aniversariante(s) de HOJE, mesma lógica de "roda sozinho num intervalo
// fixo" que o carrossel de propaganda já usa (ver AD_DURATION_MS). Só entra
// no rodízio quando alguém faz aniversário HOJE de verdade (ver
// hasBirthdayToday mais abaixo); sem isso o card fica só no conteúdo normal.
// Vendas do mês e Leads no funil NUNCA trocam de conteúdo. (Antes este mesmo
// relógio também girava o card Ranking entre o pódio e a lista de
// aniversariantes do mês; o Ranking saiu desta TV — ver getTvRanking em
// lib/tv-dashboard.ts — e essa lista virou um card fixo próprio.)
const BIRTHDAY_CAROUSEL_INTERVAL_MS = 3 * 60 * 1000;
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
  // Logo: ver components/reobote-logo.tsx pro histórico (arquivo pesado,
  // depois um clip-path de fragmento, depois SVG inline) — mesmo assim
  // relatado de novo ao vivo na TV real. Achado novo, provável causa raiz
  // de verdade: a logo era o ÚNICO elemento desta tela dimensionado só por
  // ALTURA (`height: var(--tv-logo-h)`, `width` deixado em "auto"),
  // confiando no navegador calcular a largura pela proporção intrínseca do
  // SVG (viewBox) — todo ícone lucide-react da tela (que claramente
  // renderiza bem, sem relato nenhum de problema) sempre fixa altura E
  // largura explícitas, nunca "auto". Cálculo de proporção intrínseca de
  // SVG-como-elemento-substituído é um dos cantos mais inconsistentes de
  // engine pra engine — plausível que esse navegador embutido resolva mal
  // (largura 0 ou o padrão de substituído sem proporção, 300px, nenhum dos
  // dois "aparece certo"). Corrigido abaixo: largura agora é `calc()` puro
  // a partir da MESMA variável de altura + a proporção real do desenho
  // (3144×1784), nunca mais "auto" — mesma aritmética simples que toda
  // variável --tv-* já usa, sem depender de cálculo de proporção nenhum.
  //
  // Mesmo assim, como já foi "a causa certa" 2 vezes e continuou quebrado,
  // agora tem uma 2ª camada de verdade, independente: um PNG (gerado do
  // mesmo SVG via sharp, mesma pasta pública) por BAIXO do SVG, do mesmo
  // tamanho exato. Se o SVG pintar normalmente, cobre o PNG por completo
  // (mesmo desenho, nunca aparece dobrado); se o SVG falhar por qualquer
  // motivo (o de cima ou outro ainda não identificado), o PNG - o formato
  // de imagem mais universalmente suportado que existe, sem exigir nada
  // além de decodificar bytes - aparece por baixo. Camadas independentes
  // de propósito: nenhuma depende da outra ter funcionado.
  const LOGO_ASPECT_RATIO = 3144 / 1784;
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
  // Qual "lado" está visível no card Última venda — 0 = a venda mais recente,
  // 1 = aniversário de hoje (ver BIRTHDAY_CAROUSEL_INTERVAL_MS). Alterna (não
  // avança sempre pro mesmo lado) de propósito — com só 2 conteúdos,
  // ping-pong é o carrossel mais simples que ainda dá a sensação de "girar",
  // sem precisar de um 3º estado só pra voltar.
  const [birthdaySlide, setBirthdaySlide] = useState<0 | 1>(0);
  // Lado que acabou de SAIR — fica montado por SLIDE_TRANSITION_MS depois de
  // cada troca de birthdaySlide só pra poder animar arrastando pra fora da
  // tela (ver JSX mais abaixo). Sem isso, a troca de `key` desmontava o
  // conteúdo anterior na hora — só o lado novo aparecia entrando, sem
  // nenhum lado saindo visível, e não passava a sensação de "arrastar pro
  // lado" pedida, só de "aparecer".
  const [outgoingSlide, setOutgoingSlide] = useState<0 | 1 | null>(null);
  const prevBirthdaySlideRef = useRef<0 | 1>(0);
  useEffect(() => {
    if (prevBirthdaySlideRef.current === birthdaySlide) return;
    const prev = prevBirthdaySlideRef.current;
    prevBirthdaySlideRef.current = birthdaySlide;
    setOutgoingSlide(prev);
    const timer = setTimeout(() => setOutgoingSlide(null), SLIDE_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [birthdaySlide]);

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

  // `birthdaysThisMonth` já vem do servidor filtrado pelo mês/dia ATUAIS de
  // verdade (getBrazilParts(new Date()) em lib/tv-dashboard.ts, nunca um valor
  // fixo), recorrente ano após ano.
  // - hasBirthdayThisMonth: mostra o card fixo "Aniversariantes do Mês" (ver
  //   renderBirthdaysContent) — só existe quando alguém faz aniversário no mês.
  // - hasBirthdayToday: além dele, liga o rodízio do card Última venda com o(s)
  //   aniversariante(s) de HOJE — 2 dias antes/depois não é suficiente pra esse
  //   card sair do lugar (pedido explícito).
  const hasBirthdayThisMonth = metrics.birthdaysThisMonth.length > 0;
  const hasBirthdayToday = metrics.birthdaysThisMonth.some((b) => b.isToday);

  // Rodízio do card Última venda (conteúdo normal ↔ aniversariantes de HOJE,
  // ver BIRTHDAY_CAROUSEL_INTERVAL_MS) — só roda quando há de fato alguém
  // fazendo aniversário hoje; sem isso, ligar o intervalo do mesmo jeito só
  // re-renderizaria a tela à toa. Reavalia a cada refresh de métricas — se o
  // carrossel estava ativo e o dia virou, volta pro conteúdo normal e para de
  // girar sozinho.
  useEffect(() => {
    if (!hasBirthdayToday) {
      // setState direto no corpo do efeito é proposital — sincroniza o
      // slide com uma condição EXTERNA (deixou de haver aniversariante hoje)
      // que só este efeito observa; não tem outro lugar certo pra fazer esse
      // reset sem duplicar a lógica.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBirthdaySlide(0);
      return;
    }
    const interval = setInterval(() => {
      setBirthdaySlide((s) => (s === 0 ? 1 : 0));
    }, BIRTHDAY_CAROUSEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasBirthdayToday]);

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
  // Nenhum widget habilitado — checa os 4 direto (antes passava por uma
  // variável intermediária `showPairRow`, nome de um design antigo em que
  // Última venda dividia linha com o Churrascômetro; hoje ela divide CARD
  // com Leads no funil, não tem "row" pareado nenhum mais — o nome não
  // correspondia a mais nada real, só a lógica em si estava certa).
  const nothingEnabled = !showHero && !showChurrasco && !showLastSale && !showFunnels;
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
      // reset de birthdaySlide acima: sincroniza com uma condição externa
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
  // troca: uma vez como o que está ENTRANDO (birthdaySlide atual) e, por
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
              {/* Pacote de comemoração com visual alegre e vibrante */}
              <div className="relative shrink-0" style={{ width: "var(--tv-avatar-md)", height: "var(--tv-avatar-md)", perspective: "800px" }}>
                <span
                  className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-70 blur-lg"
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
                    style={{ border: `3px solid ${BIRTHDAY_COLOR}` }}
                  />
                ) : (
                  <div
                    className={`animate-tv-photo-spin relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br ${getBirthdayAvatarGradient(b.name)} text-[length:var(--tv-text-value-sm)] font-bold text-white shadow-lg`}
                    style={{ border: `3px solid ${BIRTHDAY_COLOR}` }}
                  >
                    {b.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0 max-w-[var(--tv-truncate-lg)] text-left">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 mb-1">
                  <Cake
                    className="shrink-0"
                    style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: BIRTHDAY_COLOR }}
                    strokeWidth={2.5}
                  />
                  <p className="font-semibold tracking-widest uppercase text-[length:var(--tv-text-label)]">
                    Aniversário hoje
                  </p>
                </div>
                <p className="truncate font-semibold text-white text-[length:var(--tv-text-name)]">{b.name}</p>
                <p className="font-extrabold text-[length:var(--tv-text-value-sm)] flex items-center gap-1.5" style={{ color: BIRTHDAY_COLOR }}>
                  <span className="inline-block animate-bounce">🎉</span> Parabéns pelo seu dia!
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

  // Conteúdo do card fixo ANIVERSARIANTES DO MÊS — a lista do mês inteiro (ver
  // hasBirthdayThisMonth); quem faz aniversário HOJE ganha borda rosa pra se
  // destacar dentro dela. Era o 2º "lado" do card Ranking, que girava entre o
  // pódio e esta lista; com o Ranking fora desta TV (ver getTvRanking) virou um
  // card próprio, sem rodízio.
  const renderBirthdaysContent = () => (
    <>
      <div className="relative flex items-center justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 shadow-sm">
          <PartyPopper style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: BIRTHDAY_COLOR }} strokeWidth={2.5} />
          <p className="font-semibold tracking-wider uppercase text-[length:var(--tv-text-label)]">
            Aniversariantes do Mês
          </p>
        </div>
      </div>
      <div
        className="relative flex flex-wrap items-start justify-center"
        style={{ gap: "calc(var(--tv-gap) * 1.1)", marginTop: "var(--tv-gap)" }}
      >
        {metrics.birthdaysThisMonth.map((b) => (
          <div key={b.id} className="flex flex-col items-center">
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
                    className="animate-tv-glow-pulse pointer-events-none absolute rounded-full opacity-70 blur-lg"
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
                  style={{ border: `${b.isToday ? 4 : 3}px solid ${b.isToday ? BIRTHDAY_COLOR : BIRTHDAY_COLOR_MUTED}` }}
                />
              ) : (
                <div
                  className={`relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br ${getBirthdayAvatarGradient(b.name)} text-white font-bold text-[length:var(--tv-text-name)] shadow-lg ${b.isToday ? "animate-tv-photo-spin" : ""}`}
                  style={{ border: `${b.isToday ? 4 : 3}px solid ${b.isToday ? BIRTHDAY_COLOR : BIRTHDAY_COLOR_MUTED}` }}
                >
                  {b.name.charAt(0)}
                </div>
              )}
            </div>
            <p
              className="mt-1.5 max-w-[var(--tv-truncate-md)] truncate text-[length:var(--tv-text-body)] font-semibold text-white"
              title={b.name}
            >
              {b.name}
            </p>
            <div className="mt-0.5">
              {b.isToday ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/25 px-2 py-0.5 text-[length:var(--tv-text-body)] font-bold text-rose-200 border border-rose-400/40 shadow-sm">
                  <span className="inline-block animate-bounce">🎉</span> HOJE!
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[length:var(--tv-text-body)] font-medium text-neutral-300 border border-white/10">
                  dia {b.day}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );

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
    // paddingBottom: 0 — pedido explícito: "abaixar o Churrascômetro até o
    // rodapé". A margem de segurança (--tv-safe-margin, ver tv-shell.tsx)
    // já protege as 4 bordas contra overscan por conta própria; esse
    // --tv-gap extra embaixo era um respiro redundante SÓ nessa borda —
    // faz sentido em cima (separa a logo do topo) e nas laterais, mas o
    // Churrascômetro, sendo o último elemento, não precisa da mesma folga
    // antes de encostar na margem de segurança.
    <div className="flex h-full w-full flex-col" style={{ gap: "var(--tv-gap)", padding: "var(--tv-gap)", paddingBottom: 0 }}>
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
                  className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${i === safeAdIndex ? "opacity-100" : "opacity-0"
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
                  birthdaySlide) — fica fora do bloco que troca de
                  conteúdo, sempre no mesmo lugar. Duas camadas
                  independentes (ver comentário de LOGO_ASPECT_RATIO lá em
                  cima) — largura e altura SEMPRE explícitas nas duas,
                  nunca "auto". */}
              <div className="relative shrink-0" style={{ height: "var(--tv-logo-h)", width: `calc(var(--tv-logo-h) * ${LOGO_ASPECT_RATIO})` }}>
                <img
                  src="/images/LOGO-BRANCA.png"
                  alt="Reobote"
                  width={140}
                  height="auto"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                  onError={(event) => {
                    console.error(
                      "❌ Erro ao carregar logo Reobote:",
                      event.currentTarget.src,
                      "Status: falha de carregamento"
                    );
                    console.error(
                      "📍 Caminho esperado: /images/logo-reobote.png"
                    );
                  }}
                />
                {/* SVG desligado — relatado quebrado na TV real de novo,
                    mesmo depois de 2 correções (proporção intrínseca, depois
                    o PNG por baixo como rede de segurança — ver comentário
                    de LOGO_ASPECT_RATIO acima). O PNG sozinho é o formato
                    mais universalmente suportado que existe; sem o SVG por
                    cima não tem mais nada nesse navegador embutido pra
                    quebrar o desenho da logo. Reative só se algum dia
                    precisar de novo do SVG vetorial (ex.: telas de
                    resolução muito maior que o PNG fonte). */}
                {/* <ReoboteLogo className="absolute inset-0 h-full w-full" /> */}
              </div>
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
                  {formatCurrency(metrics.vendasMes)}
                </div>
                {/* marginTop/paddingTop reduzidos (eram var(--tv-gap) cheio
                    nos dois, 2× o respiro) — pedido explícito: "diminuir a
                    altura" desta fileira, só o espaçamento, fonte
                    intocada. */}
                <div
                  className="relative flex divide-x divide-white/10 border-t border-white/10 text-[length:var(--tv-text-body)]"
                  style={{ marginTop: "calc(var(--tv-gap) * 0.5)", paddingTop: "calc(var(--tv-gap) * 0.5)" }}
                >
                  <div className="flex-1">
                    <div className="font-semibold text-neutral-400">Anuais</div>
                    <div className="font-bold text-[length:var(--tv-text-value-sm)]">
                      {formatCurrencyCompact(metrics.vendasAnuais)}
                    </div>
                  </div>
                  <div className="flex-1">
                    {/* Rótulo trocado de "Cotas" pra "Valor Bruto" (pedido
                        explícito) — valor é o BRUTO (Deal.grossValue) do mês
                        corrente (ver vendasBrutoMes em lib/tv-dashboard.ts).
                        Zera sozinho na virada do mês, mesmo limite de
                        `closedAt >= início do mês` que "Vendas do mês" já usa. */}
                    <div className="font-semibold text-neutral-400">Valor Bruto</div>
                    <div className="font-bold text-[length:var(--tv-text-value-sm)]">
                      {formatCurrencyCompact(metrics.vendasBrutoMes)}
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
                normal, mesmo havendo aniversariantes em outro dia do mês
                (esses aparecem no card fixo de Aniversariantes do Mês, mais
                abaixo).

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
                        className={`absolute inset-0 flex items-center justify-center ${outgoingSlide === 0 ? "animate-tv-slide-out-to-left" : "animate-tv-slide-out-to-right"
                          }`}
                      >
                        {renderLastSaleContent(outgoingSlide)}
                      </div>
                    )}
                    <div
                      key={hasBirthdayToday ? birthdaySlide : 0}
                      className={
                        hasBirthdayToday && birthdaySlide === 1
                          ? "animate-tv-slide-in-from-right"
                          : "animate-tv-slide-in-from-left"
                      }
                    >
                      {renderLastSaleContent(hasBirthdayToday ? birthdaySlide : 0)}
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
                    {/* Ícone/fonte/altura reduzidos aqui — pedido explícito
                        ("diminuir a fonte e altura"), ajuda a sobrar mais
                        espaço vertical pro Ranking, o card mais importante
                        do painel. icon-md→icon-sm no cabeçalho,
                        text-value-md→text-value-lg (menor lg? não — ver
                        abaixo) no número: usa um tamanho intermediário
                        entre value-sm e value-md via calc(), não pulando
                        direto pra value-sm (perderia demais a hierarquia
                        de "número que se lê rápido"). */}
                    <div className="flex items-center justify-center gap-2">
                      <Waypoints
                        style={{ width: "var(--tv-icon-sm)", height: "var(--tv-icon-sm)", color: "var(--brand)" }}
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
                      <div className="flex divide-x divide-white/10" style={{ marginTop: "calc(var(--tv-gap) * 0.6)" }}>
                        {metrics.leadsInFunnels.map((stage) => (
                          <div key={stage.id} className="min-w-0 flex-1 px-2">
                            <div
                              className="font-extrabold tabular-nums"
                              style={{ color: "var(--brand)", fontSize: "calc((var(--tv-text-value-sm) + var(--tv-text-value-md)) / 2)" }}
                            >
                              {stage.count}
                            </div>
                            <div className="truncate font-medium text-neutral-400 text-[length:var(--tv-text-label)]">
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

            {/* Aniversariantes do mês — card FIXO (sem rodízio), só existe quando
                alguém faz aniversário no mês. Ocupa o lugar do antigo card
                Ranking, que saiu desta TV (ver getTvRanking em
                lib/tv-dashboard.ts); a lista era o 2º lado dele. */}
            {hasBirthdayThisMonth && (
              <GlassCard delay={360} className="shrink-0 text-center">
                <Glow color={BIRTHDAY_COLOR} />
                {renderBirthdaysContent()}
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
          className={`pointer-events-none fixed inset-0 z-[150] flex items-center justify-center overflow-hidden bg-black/90 transition-opacity duration-[600ms] ${churrascoBannerPhase === "visible" ? "opacity-100" : "opacity-0"
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

const BIRTHDAY_COLOR = "#fb7185";
const BIRTHDAY_COLOR_MUTED = "#f472b6";

const BIRTHDAY_AVATAR_GRADIENTS = [
  "from-rose-500 to-amber-500",
  "from-pink-500 to-rose-500",
  "from-amber-500 to-orange-500",
  "from-violet-500 to-pink-500",
  "from-fuchsia-500 to-rose-500",
  "from-emerald-500 to-teal-500",
];

function getBirthdayAvatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % BIRTHDAY_AVATAR_GRADIENTS.length;
  return BIRTHDAY_AVATAR_GRADIENTS[index];
}
