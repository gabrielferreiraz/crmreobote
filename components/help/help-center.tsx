"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Search,
  SearchX,
  Sparkles,
  X,
  Check,
} from "lucide-react";
import { HELP_CATEGORIES, HELP_TOPIC_BY_ID } from "@/lib/help/topics";
import { isVisibleTo, searchTopics, visibleTopics, type HelpAudience } from "@/lib/help/search";
import { screenForPath } from "@/lib/help/screens";
import { HELP_TOUR_BY_ID } from "@/lib/help/tours";
import { CHECKLIST_ITEMS } from "@/lib/help/checklist";
import { DISCOVERY_ORDER, EVERGREEN_TOPIC_IDS } from "@/lib/help/discovery";
import type { HelpCategoryId, HelpOverview, HelpRole, HelpTopic } from "@/lib/help/types";
import { trackUse } from "@/lib/feature-usage/track";
import { HELP_ICONS, HELP_FALLBACK_ICON } from "./help-icons";
import { HelpTopicView } from "./help-topic-view";
import { HelpTour } from "./help-tour";

/** Atraso pra buscar o dado personalizado: a tela que a pessoa abriu vem primeiro. */
const OVERVIEW_DELAY_MS = 2500;
const SEEN_TIPS_KEY = "help.seen-tips";
const LAST_OPEN_DAY_KEY = "help.last-open-day";
const MAX_SEEN_TIPS = 40;
/** Folga acima da animação de saída mais longa (.help-panel-exit, globals.css). */
const PANEL_EXIT_MS = 240;

/** Dia em Brasília, pro aviso do botão ser "uma vez por dia" de verdade. */
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });
}

const HelpContext = createContext<((topicId?: string) => void) | null>(null);

/**
 * Abre a Central de Ajuda de qualquer lugar do dashboard — usado pelo menu
 * do celular, que não tem o botão flutuante (ver comentário no launcher).
 * Aceita um tópico pra abrir direto no verbete certo.
 */
export function useHelpCenter(): (topicId?: string) => void {
  const open = useContext(HelpContext);
  // Devolve um no-op fora do provider em vez de lançar: um componente
  // compartilhado com tela pública (fora do dashboard) não pode quebrar só
  // por existir um botão de ajuda nele.
  return open ?? (() => {});
}

function readSeenTips(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_TIPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // Aba anônima / storage bloqueado — a dica só volta a aparecer, sem quebrar nada.
    return [];
  }
}

function rememberSeenTip(topicId: string) {
  try {
    const next = [...readSeenTips().filter((id) => id !== topicId), topicId].slice(-MAX_SEEN_TIPS);
    localStorage.setItem(SEEN_TIPS_KEY, JSON.stringify(next));
  } catch {
    /* idem acima */
  }
}

function readLastOpenDay(): string | null {
  try {
    return localStorage.getItem(LAST_OPEN_DAY_KEY);
  } catch {
    return null;
  }
}

type View = { kind: "home" } | { kind: "topic"; id: string };

/**
 * Central de Ajuda — botão fixo no canto + painel, no espírito do widget de
 * suporte que o usuário pediu, mas resolvendo o problema de verdade em vez
 * de abrir um chat: quem usa o CRM não quer conversar com alguém, quer
 * achar a tela e entender o recurso.
 *
 * Três camadas, da mais específica pra mais geral — é o que evita a "parede
 * de FAQ" em que ninguém acha nada:
 *  1. NESTA TELA — casa a rota atual com os tópicos certos (a pessoa não
 *     precisa saber o nome do que procura pra receber a resposta).
 *  2. PERSONALIZADO — checklist do que falta configurar e "você sabia?" do
 *     que esta pessoa nunca usou (dado real de FeatureUsageDaily).
 *  3. CATÁLOGO — busca e tópicos por assunto, pra quem sabe o que quer.
 *
 * Montado uma vez em app/(dashboard)/layout.tsx, igual UndoProvider e
 * CommandPaletteProvider, pelo mesmo motivo deles: um estado só, um listener
 * só de teclado, não importa quantos botões chamem.
 */
export function HelpCenterProvider({
  role,
  isAdministrativo,
  children,
}: {
  role: HelpRole;
  isAdministrativo: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");
  const [openCategory, setOpenCategory] = useState<HelpCategoryId | null>(null);
  const [overview, setOverview] = useState<HelpOverview | null>(null);
  const [seenTips, setSeenTips] = useState<string[]>([]);
  const [lastOpenDay, setLastOpenDay] = useState<string | null>(null);
  const [tourId, setTourId] = useState<string | null>(null);
  // `closing` mantém o painel montado durante a animação de saída — sem isso
  // ele simplesmente some do DOM e a saída nunca é vista.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const audience: HelpAudience = useMemo(() => ({ role, isAdministrativo }), [role, isAdministrativo]);

  // Só depois de montado: `mounted` guarda o portal (document não existe no
  // SSR) e localStorage não pode ser lido no primeiro render, senão servidor
  // e cliente renderizariam coisas diferentes no mesmo ponto da árvore — o
  // erro de hidratação já documentado no UndoProvider.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setSeenTips(readSeenTips());
    setLastOpenDay(readLastOpenDay());
  }, []);

  // Dado personalizado: uma vez, com atraso, e só com a aba visível. Nunca em
  // polling — é ajuda, não monitoramento, e não pode disputar banco com a
  // tela que a pessoa está usando.
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/help/overview", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: HelpOverview | null) => {
          if (!cancelled && data) setOverview(data);
        })
        .catch(() => {
          // Silencioso de propósito: a ajuda continua inteira sem a parte
          // personalizada, e um erro aqui não pode virar aviso pra quem só
          // queria usar o CRM.
        });
    }, OVERVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  // ─── Checklist ────────────────────────────────────────────────────

  // `overview === null` é "ainda não sei", não "nada feito": sem esta guarda,
  // quem já configurou tudo via por um instante uma checklist zerada mandando
  // refazer o que já fez — o tipo de erro que faz perder a confiança na ajuda.
  const checklist = useMemo(() => {
    if (!overview) return null;
    const items = CHECKLIST_ITEMS.filter((item) => !(item.salesOnly && isAdministrativo));
    const done = new Set(overview.done);
    return { items, done, missing: items.filter((item) => !done.has(item.id)) };
  }, [overview, isAdministrativo]);

  // ─── "Você sabia?" ────────────────────────────────────────────────

  /**
   * A primeira dica cujo recurso esta pessoa nunca usou e que ela ainda não
   * viu por aqui. Sem dado ainda (overview não chegou), nenhuma dica — melhor
   * não mostrar nada do que sugerir pra alguém algo que ele já domina.
   */
  const discovery = useMemo((): HelpTopic | null => {
    if (!overview) return null;
    const seen = new Set(seenTips);
    const neverUsed = new Set(overview.neverUsed);
    const pick = (id: string) => {
      const topic = HELP_TOPIC_BY_ID.get(id);
      if (!topic || seen.has(id)) return null;
      return isVisibleTo(topic, audience) ? topic : null;
    };
    for (const entry of DISCOVERY_ORDER) {
      if (!neverUsed.has(entry.feature)) continue;
      const topic = pick(entry.topicId);
      if (topic) return topic;
    }
    for (const id of EVERGREEN_TOPIC_IDS) {
      const topic = pick(id);
      if (topic) return topic;
    }
    return null;
  }, [overview, seenTips, audience]);

  // ─── Abrir / fechar ───────────────────────────────────────────────

  const openHelp = useCallback((topicId?: string) => {
    trackUse("ajuda.abrir");
    // Reabrir no meio da saída cancela a saída — no iOS toda apresentação é
    // interrompível; esperar a animação terminar pra poder tocar de novo é o
    // que faz uma interface parecer travada.
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    setQuery("");
    setView(topicId ? { kind: "topic", id: topicId } : { kind: "home" });
    setOpen(true);
    // Abriu hoje: o aviso do botão só volta amanhã (ver `hasNews`).
    const today = todayKey();
    setLastOpenDay(today);
    try {
      localStorage.setItem(LAST_OPEN_DAY_KEY, today);
    } catch {
      /* aba anônima — no pior caso o aviso aparece de novo */
    }
  }, []);

  /**
   * Fechar é também quando a dica sai da fila: `rememberSeenTip` grava no
   * localStorage assim que o painel abre, mas o estado `seenTips` só é
   * relido aqui de propósito — se fosse atualizado na hora, o card que a
   * pessoa está lendo sumiria debaixo dos olhos dela. Relendo no fechamento,
   * a próxima abertura já traz uma dica nova.
   */
  const closePanel = useCallback(() => {
    if (closeTimer.current) return; // já está saindo
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setClosing(false);
      setSeenTips(readSeenTips());
    }, PANEL_EXIT_MS);
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const closeHelp = useCallback(() => {
    closePanel();
    launcherRef.current?.focus({ preventScroll: true });
  }, [closePanel]);

  useEffect(() => {
    if (!open || !discovery) return;
    rememberSeenTip(discovery.id);
  }, [open, discovery]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(timeout);
  }, [open, view.kind]);

  // Esc fecha; clique fora fecha. Não é modal (dá pra continuar vendo a tela
  // por trás — é o ponto de uma ajuda que acompanha o trabalho), então não
  // prende o foco nem escurece o fundo.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !tourId) {
        e.preventDefault();
        closeHelp();
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || launcherRef.current?.contains(target)) return;
      closePanel();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, tourId, closeHelp, closePanel]);

  const goTo = useCallback(
    (href: string, newTab?: boolean) => {
      trackUse("ajuda.ir");
      if (newTab) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      closePanel();
      router.push(href);
    },
    [router, closePanel],
  );

  const startTour = useCallback(
    (id: string) => {
      trackUse("ajuda.tour");
      closePanel();
      setTourId(id);
    },
    [closePanel],
  );

  const showTopic = useCallback((id: string) => {
    trackUse("ajuda.topico");
    setView({ kind: "topic", id });
  }, []);

  // ─── Conteúdo ─────────────────────────────────────────────────────

  const screen = useMemo(() => screenForPath(pathname), [pathname]);
  const screenTopics = useMemo(
    () =>
      (screen?.topicIds ?? [])
        .map((id) => HELP_TOPIC_BY_ID.get(id))
        .filter((t): t is HelpTopic => !!t && isVisibleTo(t, audience)),
    [screen, audience],
  );
  const results = useMemo(() => searchTopics(query, audience), [query, audience]);
  const categories = useMemo(
    () =>
      HELP_CATEGORIES.map((category) => ({
        ...category,
        topics: visibleTopics(audience).filter((t) => t.category === category.id),
      })).filter((c) => c.topics.length > 0),
    [audience],
  );

  const activeTopic = view.kind === "topic" ? HELP_TOPIC_BY_ID.get(view.id) : undefined;
  const tour = tourId ? HELP_TOUR_BY_ID.get(tourId) : undefined;
  // Aviso no botão: no máximo UM por dia, e só quando existe mesmo uma dica
  // nova pra esta pessoa. Sem a trava de dia, o ponto ficaria aceso quase
  // sempre (sempre sobra alguma dica não vista) e viraria ruído — que é
  // exatamente como um recurso de aprendizado morre.
  const hasNews = !!discovery && !open && lastOpenDay !== todayKey();
  /** "Aberto de verdade" — durante a saída o botão já volta a ser um chat. */
  const panelOpen = open && !closing;

  return (
    <HelpContext.Provider value={openHelp}>
      {children}

      {mounted &&
        createPortal(
          <>
            {/* Botão flutuante só no desktop: no celular a barra inferior já
                tem um botão "+" flutuante nesse mesmo canto (ver
                mobile-nav.tsx), e dois botões redondos disputando o polegar é
                pior que não ter o segundo. Lá a ajuda entra como item do menu
                "Mais", que chama este mesmo painel via useHelpCenter(). */}
            <button
              ref={launcherRef}
              type="button"
              data-help="help-launcher"
              onClick={() => (panelOpen ? closeHelp() : openHelp())}
              aria-expanded={panelOpen}
              aria-label={panelOpen ? "Fechar a ajuda" : "Abrir a Central de ajuda"}
              title="Central de ajuda"
              // Quadrado arredondado (não círculo) de propósito: o círculo é a
              // linguagem de AÇÃO deste app — é o "+" da barra do celular. A
              // ajuda é um lugar permanente, não uma ação, e o squircle é o
              // que a referência de widget de suporte usa.
              //
              // active:scale-[0.88] com --ease-spring: o afundar no toque e o
              // repique na soltura são o que dá "tato" de iOS. Mesma curva dos
              // botões do app (ver .btn-primary em globals.css), só com um
              // afundar mais fundo, porque este é um alvo grande e isolado.
              className="fixed right-4 bottom-4 z-40 hidden h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-brand/30 transition-[transform,box-shadow] duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.88] lg:flex dark:shadow-brand/20"
              style={{ background: "var(--brand-gradient)" }}
            >
              {/* Os dois ícones ficam empilhados e trocam por escala+giro+fade,
                  em vez de um sumir e o outro aparecer: é a mesma troca dos
                  botões do Control Center do iOS, e é ela que faz o botão
                  parecer "virar" o painel em vez de piscar. */}
              <span className="relative flex h-6 w-6 items-center justify-center">
                <MessageSquare
                  aria-hidden
                  fill="currentColor"
                  strokeWidth={1.5}
                  className={`absolute h-6 w-6 transition-all duration-300 ease-spring ${
                    panelOpen ? "rotate-45 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"
                  }`}
                />
                <ChevronDown
                  aria-hidden
                  strokeWidth={2.75}
                  className={`absolute h-6 w-6 transition-all duration-300 ease-spring ${
                    panelOpen ? "rotate-0 scale-100 opacity-100" : "-rotate-45 scale-50 opacity-0"
                  }`}
                />
              </span>
              {hasNews && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-amber-400 ring-2 ring-white dark:ring-neutral-950" />
                </span>
              )}
            </button>

            {open && (
              <>
                {/* Fundo só no celular, onde o painel vira folha de baixo pra
                    cima: no desktop ele é um popover — a tela continua à
                    vista, que é o que permite seguir a instrução lendo. */}
                <div
                  className={`fixed inset-0 z-[44] bg-neutral-950/40 lg:hidden dark:bg-neutral-950/60 ${
                    closing ? "help-backdrop-exit" : "help-backdrop-enter"
                  }`}
                  aria-hidden
                />
                <div
                  ref={panelRef}
                  role="dialog"
                  aria-label="Central de ajuda"
                  // pb-[env(safe-area-inset-bottom)]: no celular o painel é
                  // uma folha colada na base da tela, e sem isso o último item
                  // fica embaixo da barra de gestos do iPhone. No desktop o
                  // valor é 0, então a mesma classe serve pros dois.
                  className={`surface-glass-filter fixed inset-x-0 bottom-0 z-[45] flex max-h-[86dvh] flex-col overflow-hidden rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-2xl lg:inset-x-auto lg:right-4 lg:bottom-[5.5rem] lg:max-h-[min(38rem,calc(100dvh-9rem))] lg:w-[23.5rem] lg:rounded-2xl lg:pb-0 ${
                    closing ? "help-panel-exit" : "help-panel-enter"
                  }`}
                >
                  <HelpHeader onClose={closeHelp} />

                  <div className="border-b border-neutral-200/70 px-4 pb-3 dark:border-neutral-800">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
                        strokeWidth={2}
                      />
                      <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Mede o início de uma busca, não cada tecla — senão
                          // uma palavra digitada viraria 8 "usos" no relatório.
                          if (value.trim() && !query.trim()) trackUse("ajuda.buscar");
                          if (value.trim()) setView({ kind: "home" });
                          setQuery(value);
                        }}
                        placeholder="O que você quer fazer?"
                        className="field-input w-full py-2 pl-9"
                      />
                    </div>
                  </div>

                  <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                    {activeTopic ? (
                      <HelpTopicView
                        topic={activeTopic}
                        onBack={() => setView({ kind: "home" })}
                        onNavigate={goTo}
                        onStartTour={startTour}
                      />
                    ) : query.trim() ? (
                      <SearchResults results={results} query={query} onPick={showTopic} />
                    ) : (
                      <div className="space-y-5 p-4">
                        {screen && screenTopics.length > 0 && (
                          <section>
                            <SectionLabel>Nesta tela</SectionLabel>
                            <div className="mt-2 rounded-xl bg-brand-light/60 p-3 dark:bg-brand-light">
                              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                {screen.title}
                              </p>
                              <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                                {screen.purpose}
                              </p>
                              <div className="mt-2.5 space-y-1">
                                {screenTopics.map((topic) => (
                                  <TopicRow key={topic.id} topic={topic} onPick={showTopic} tone="brand" />
                                ))}
                              </div>
                            </div>
                          </section>
                        )}

                        {checklist && checklist.missing.length > 0 && (
                          <Checklist
                            items={checklist.items}
                            done={checklist.done}
                            onPick={showTopic}
                            onGo={goTo}
                          />
                        )}

                        {discovery && (
                          <section>
                            <SectionLabel>Você sabia?</SectionLabel>
                            <button
                              type="button"
                              onClick={() => showTopic(discovery.id)}
                              className="group mt-2 flex w-full items-start gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 text-left transition-colors hover:bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
                            >
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/25 text-amber-700 dark:text-amber-300">
                                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                  {discovery.title}
                                </span>
                                <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-300">
                                  {discovery.summary}
                                </span>
                              </span>
                              <ChevronRight
                                className="mt-1 h-4 w-4 shrink-0 text-amber-600 transition-transform group-hover:translate-x-0.5 dark:text-amber-400"
                                strokeWidth={2.5}
                              />
                            </button>
                          </section>
                        )}

                        <section>
                          <SectionLabel>Todos os assuntos</SectionLabel>
                          <div className="mt-2 space-y-1">
                            {categories.map((category) => {
                              const Icon = HELP_ICONS[category.icon] ?? HELP_FALLBACK_ICON;
                              const expanded = openCategory === category.id;
                              return (
                                <div key={category.id}>
                                  <button
                                    type="button"
                                    onClick={() => setOpenCategory(expanded ? null : category.id)}
                                    aria-expanded={expanded}
                                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60"
                                  >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-light">
                                      <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={2} />
                                    </span>
                                    <span className="min-w-0 flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                      {category.title}
                                    </span>
                                    <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{category.topics.length}</span>
                                    <ChevronDown
                                      className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 dark:text-neutral-500 ${expanded ? "rotate-180" : ""}`}
                                      strokeWidth={2}
                                    />
                                  </button>
                                  {expanded && (
                                    <div className="mt-0.5 space-y-0.5 pb-1 pl-9">
                                      {category.topics.map((topic) => (
                                        <TopicRow key={topic.id} topic={topic} onPick={showTopic} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {tour && <HelpTour tour={tour} onClose={() => setTourId(null)} />}
          </>,
          document.body,
        )}
    </HelpContext.Provider>
  );
}

// ─── Pedaços ────────────────────────────────────────────────────────

function HelpHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm shadow-brand/30"
          style={{ background: "var(--brand-gradient)" }}
        >
          <MessageSquare className="h-4 w-4" fill="currentColor" strokeWidth={1.5} />
        </span>
        <div>
          <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Central de ajuda</p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Achar, entender e ir direto ao ponto</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        aria-label="Fechar a ajuda"
      >
        <X className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
      {children}
    </p>
  );
}

function TopicRow({
  topic,
  onPick,
  tone = "plain",
}: {
  topic: HelpTopic;
  onPick: (id: string) => void;
  tone?: "plain" | "brand";
}) {
  const Icon = HELP_ICONS[topic.icon] ?? HELP_FALLBACK_ICON;
  return (
    <button
      type="button"
      onClick={() => onPick(topic.id)}
      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        tone === "brand" ? "hover:bg-white/70 dark:hover:bg-white/10" : "hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400 group-hover:text-brand dark:text-neutral-500" strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-300">{topic.title}</span>
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand dark:text-neutral-600"
        strokeWidth={2.5}
      />
    </button>
  );
}

function SearchResults({
  results,
  query,
  onPick,
}: {
  results: HelpTopic[];
  query: string;
  onPick: (id: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <SearchX className="h-7 w-7 text-neutral-300 dark:text-neutral-600" strokeWidth={1.5} />
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Nada encontrado pra “{query}”.
        </p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Tente uma palavra mais simples — “campanha”, “planilha”, “atrasada”.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 p-4">
      <SectionLabel>
        {results.length} {results.length === 1 ? "resultado" : "resultados"}
      </SectionLabel>
      <div className="mt-2 space-y-0.5">
        {results.map((topic) => {
          const Icon = HELP_ICONS[topic.icon] ?? HELP_FALLBACK_ICON;
          const category = HELP_CATEGORIES.find((c) => c.id === topic.category);
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => onPick(topic.id)}
              className="group flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-light">
                <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                {category && (
                  <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{category.title}</span>
                )}
                <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">{topic.title}</span>
                <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">{topic.summary}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Checklist({
  items,
  done,
  onPick,
  onGo,
}: {
  items: typeof CHECKLIST_ITEMS;
  done: Set<string>;
  onPick: (topicId: string) => void;
  onGo: (href: string) => void;
}) {
  const total = items.length;
  const completed = items.filter((item) => done.has(item.id)).length;
  const pct = Math.round((completed / total) * 100);

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Primeiros passos</SectionLabel>
        <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
          {completed} de {total}
        </span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-smooth"
          style={{ width: `${pct}%`, background: "var(--brand-gradient)" }}
        />
      </div>

      <div className="mt-2.5 space-y-1">
        {items.map((item) => {
          const isDone = done.has(item.id);
          return (
            <div
              key={item.id}
              className={`flex items-start gap-2.5 rounded-lg px-2 py-2 ${isDone ? "opacity-55" : ""}`}
            >
              <span
                className={`mt-0.5 flex shrink-0 items-center justify-center rounded-full border ${
                  isDone
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-neutral-300 dark:border-neutral-600"
                }`}
                style={{ height: "1.125rem", width: "1.125rem" }}
              >
                {isDone && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium text-neutral-800 dark:text-neutral-200 ${isDone ? "line-through" : ""}`}
                >
                  {item.title}
                </p>
                {!isDone && (
                  <>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{item.why}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button type="button" onClick={() => onGo(item.action.href)} className="btn-primary btn-sm">
                        {item.action.label}
                      </button>
                      <button type="button" onClick={() => onPick(item.topicId)} className="btn-ghost btn-sm">
                        Como funciona
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
