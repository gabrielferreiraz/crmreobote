"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useWhatsAppLive } from "@/lib/use-whatsapp-live";

/**
 * Estado e regras da lista de Conversas — UM lugar só, usado pela tela de
 * computador (conversations-view.tsx) e pela de celular
 * (conversations-view-mobile.tsx). Antes cada uma tinha a própria cópia de
 * ~240 linhas (busca, atualização ao vivo, preferências de notificação,
 * filtros) e as duas já tinham começado a divergir.
 */

export type Conversation = {
  threadId: string;
  /** null = ainda não vinculada a nenhum Contact do CRM ("WhatsApp Geral"). */
  contactId: string | null;
  displayName: string;
  phoneNormalized: string;
  whatsappName: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  /** Quem mandou a última mensagem enviada (ver lib/whatsapp/conversations.ts). */
  lastMessageFrom: { id: string; name: string } | null;
  lastMessageAt: string | Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
  ownerId: string;
  ownerName: string;
  /** userIds de quem já mandou mensagem nesta conversa (ver lib/whatsapp/conversations.ts). */
  senderIds: string[];
  profilePicUrl: string | null;
};

export type ConversationTab = "crm" | "geral";

export type NotificationPrefs = { notifyOnCrmMessage: boolean; notifyOnGeralMessage: boolean };

type DealAdded = { contactId: string; deal: { id: string; name: string } };

/** Minúsculo e sem acento, só pra comparar na busca ("joao" acha "João"). */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Busca por nome, negócio ou telefone. Telefone compara só os dígitos, então
 * "(67) 99123" acha 5567991230000 — antes o texto digitado com parêntese,
 * espaço ou traço nunca batia com o número guardado sem formatação.
 */
export function matchesConversationSearch(c: Conversation, rawTerm: string): boolean {
  const term = fold(rawTerm.trim());
  if (!term) return true;
  if (fold(c.displayName).includes(term)) return true;
  if (c.whatsappName && fold(c.whatsappName).includes(term)) return true;
  if (c.deal && fold(c.deal.name).includes(term)) return true;
  const digits = rawTerm.replace(/\D/g, "");
  return digits.length >= 2 && c.phoneNormalized.includes(digits);
}

/**
 * Agrupa por responsável preservando a ordem de primeira aparição — como a
 * lista já chega ordenada por mensagem mais recente, isso naturalmente põe o
 * grupo do vendedor mais ativo agora no topo, sem precisar reordenar nada.
 */
export function groupByOwner<T extends { ownerId: string; ownerName: string }>(
  conversations: T[],
): { ownerId: string; ownerName: string; items: T[] }[] {
  const groups = new Map<string, { ownerId: string; ownerName: string; items: T[] }>();
  for (const c of conversations) {
    const group = groups.get(c.ownerId);
    if (group) group.items.push(c);
    else groups.set(c.ownerId, { ownerId: c.ownerId, ownerName: c.ownerName, items: [c] });
  }
  return Array.from(groups.values());
}

export function useConversationsList({
  initialConversations,
  currentUserId,
  initialNotificationPrefs,
  onTabChange,
}: {
  initialConversations: Conversation[];
  currentUserId?: string;
  /** undefined = quem está vendo não tem WhatsApp próprio: não há preferência a mostrar. */
  initialNotificationPrefs?: NotificationPrefs;
  /** Chamado ao trocar de aba (o computador zera a seleção em massa). */
  onTabChange?: () => void;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const searchParams = useSearchParams();
  const paramThreadId = searchParams?.get("threadId");
  const paramContactId = searchParams?.get("contactId");

  // ─── Conversa aberta (vem da URL: ?threadId= ou ?contactId=) ──────────
  const initialSelectedId = useMemo(() => {
    if (paramThreadId) return paramThreadId;
    if (paramContactId) {
      const found = conversations.find((c) => c.contactId === paramContactId);
      if (found) return found.threadId;
    }
    return null;
  }, [paramThreadId, paramContactId, conversations]);

  const selectionSource = `${paramThreadId ?? ""}:${paramContactId ?? ""}:${initialSelectedId ?? ""}`;
  const [selection, setSelection] = useState({ source: selectionSource, threadId: initialSelectedId as string | null });
  const selectedThreadId = selection.source === selectionSource ? selection.threadId : initialSelectedId;
  const setSelectedThreadId = useCallback(
    (threadId: string | null) => setSelection({ source: selectionSource, threadId }),
    [selectionSource],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedThreadId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSelectedThreadId]);

  // ─── Aba e filtros ────────────────────────────────────────────────────
  const [tab, setTab] = useState<ConversationTab>(() => {
    if (paramContactId) return "crm";
    if (paramThreadId) {
      const found = conversations.find((c) => c.threadId === paramThreadId);
      return found?.contactId ? "crm" : "geral";
    }
    return "crm";
  });
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("");

  function changeTab(next: ConversationTab) {
    setTab(next);
    onTabChange?.();
  }

  // ─── Preferência de notificação (o sininho de cada aba) ──────────────
  const [notificationPrefs, setNotificationPrefs] = useState(initialNotificationPrefs);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  async function toggleNotifications(target: ConversationTab) {
    if (!notificationPrefs) return;
    const field = target === "crm" ? "notifyOnCrmMessage" : "notifyOnGeralMessage";
    const previous = notificationPrefs;
    const nextValue = !previous[field];
    setNotificationError(null);
    setNotificationPrefs({ ...previous, [field]: nextValue });
    try {
      const res = await fetch("/api/whatsapp/instance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: nextValue }),
      });
      if (!res.ok) {
        // Sem isso, uma falha deixava o sino "mudo" na tela sem nada gravado.
        const data = await res.json().catch(() => ({}));
        setNotificationPrefs(previous);
        setNotificationError(data.error ?? "Não foi possível salvar a preferência de notificação.");
      }
    } catch {
      setNotificationPrefs(previous);
      setNotificationError("Falha de conexão ao salvar a preferência de notificação.");
    }
  }

  // ─── Atualização: evento ao vivo + poll de segurança ─────────────────
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const unreadByThreadRef = useRef<Map<string, number>>(new Map(initialConversations.map((c) => [c.threadId, c.unreadCount])));
  const inFlightRef = useRef<AbortController | null>(null);
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrivedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refreshConversations() {
    // Uma busca por vez: a anterior ainda em voo é derrubada quando chega uma
    // nova (o SSE pode disparar várias seguidas, e o poll ainda cair em cima)
    // — só a última interessa, e esta é uma das consultas mais caras do sistema.
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    try {
      const res = await fetch("/api/whatsapp/conversations", { signal: controller.signal });
      if (!res.ok) return;
      const next: Conversation[] = await res.json();

      // Quem recebeu mensagem nova desde a última busca dá um piscar sutil na linha.
      const arrived = new Set<string>();
      for (const c of next) {
        if (c.unreadCount > (unreadByThreadRef.current.get(c.threadId) ?? 0)) arrived.add(c.threadId);
      }
      unreadByThreadRef.current = new Map(next.map((c) => [c.threadId, c.unreadCount]));
      setConversations(next);
      if (arrived.size > 0) {
        setJustArrived(arrived);
        if (arrivedTimerRef.current) clearTimeout(arrivedTimerRef.current);
        arrivedTimerRef.current = setTimeout(() => setJustArrived(new Set()), 1400);
      }
    } catch {
      // Silencioso: mantém a última lista boa (falha de rede, ou a própria tela cancelou).
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  }

  function scheduleLiveRefresh() {
    if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = setTimeout(() => {
      liveRefreshTimerRef.current = null;
      void refreshConversations();
    }, 180);
  }

  // Sair de Conversas no meio do carregamento derruba a requisição.
  useEffect(
    () => () => {
      inFlightRef.current?.abort();
      if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
      if (arrivedTimerRef.current) clearTimeout(arrivedTimerRef.current);
    },
    [],
  );

  // O evento ao vivo é o mecanismo principal; o poll (que para com a aba em
  // segundo plano e recarrega ao voltar) cobre só a conexão SSE cair calada.
  useVisiblePoll(() => refreshConversations(), 45_000, { immediate: false });
  // Qualquer evento pode mudar a lista (conversa nova, ordem, não lidas) — sem filtrar por thread.
  useWhatsAppLive(() => scheduleLiveRefresh());

  // ─── Derivados ────────────────────────────────────────────────────────
  const tabCounts = useMemo(
    () => ({ crm: conversations.filter((c) => c.contactId).length, geral: conversations.filter((c) => !c.contactId).length }),
    [conversations],
  );
  const tabConversations = useMemo(
    () => conversations.filter((c) => (tab === "crm" ? !!c.contactId : !c.contactId)),
    [conversations, tab],
  );
  /** Conversas (não mensagens) com algo não lido — é o que o filtro "Não lidas" mostra. */
  const unreadConversationCount = useMemo(() => tabConversations.filter((c) => c.unreadCount > 0).length, [tabConversations]);

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of tabConversations) seen.set(c.ownerId, c.ownerId === currentUserId ? "Você" : c.ownerName);
    // "Você" sempre em primeiro, o resto por ordem alfabética.
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => {
      if (a.value === currentUserId) return -1;
      if (b.value === currentUserId) return 1;
      return a.label.localeCompare(b.label, "pt-BR");
    });
  }, [tabConversations, currentUserId]);
  // Enxergar mais de um responsável já indica visibilidade ampliada (dono/gerente).
  const showOwnerInfo = ownerOptions.length > 1;

  const filteredConversations = useMemo(
    () =>
      tabConversations.filter((c) => {
        if (onlyUnread && c.unreadCount === 0) return false;
        // "Todos os responsáveis" → escolher uma pessoa mostra as conversas
        // dela (responsável) E as que ela atendeu (mandou mensagem). Antes era
        // só "quem mandou": a conversa do próprio consultor que o lead
        // escreveu e ele ainda não respondeu — justamente a que mais importa
        // — sumia do filtro com o nome dele.
        if (ownerFilter && c.ownerId !== ownerFilter && !c.senderIds.includes(ownerFilter)) return false;
        return matchesConversationSearch(c, search);
      }),
    [tabConversations, search, onlyUnread, ownerFilter],
  );

  // Sem pessoa escolhida e com visibilidade ampliada: uma seção por responsável.
  const groupedConversations = useMemo(
    () => (!showOwnerInfo || ownerFilter ? null : groupByOwner(filteredConversations)),
    [showOwnerInfo, ownerFilter, filteredConversations],
  );

  const selected = conversations.find((c) => c.threadId === selectedThreadId) ?? null;

  /** Negócio criado pelo painel rápido: a conversa passa a ser do CRM. */
  function applyDealAdded(threadId: string, result: DealAdded) {
    setConversations((prev) => prev.map((c) => (c.threadId === threadId ? { ...c, contactId: result.contactId, deal: result.deal } : c)));
    changeTab("crm");
  }

  function renameConversation(threadId: string, name: string) {
    setConversations((prev) => prev.map((c) => (c.threadId === threadId ? { ...c, displayName: name } : c)));
  }

  return {
    conversations,
    selected,
    selectedThreadId,
    setSelectedThreadId,
    tab,
    changeTab,
    search,
    setSearch,
    onlyUnread,
    setOnlyUnread,
    ownerFilter,
    setOwnerFilter,
    justArrived,
    notificationPrefs,
    notificationError,
    toggleNotifications,
    tabCounts,
    tabConversations,
    unreadConversationCount,
    ownerOptions,
    showOwnerInfo,
    filteredConversations,
    groupedConversations,
    applyDealAdded,
    renameConversation,
  };
}
