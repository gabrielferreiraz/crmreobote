"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Search, Briefcase, BriefcaseBusiness, X, Bell, BellOff } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { ChatWindow, withViewTransition } from "@/components/whatsapp-chat";
import { QuickAddDealPanel } from "@/components/quick-add-deal-panel";
import { formatBrazilianPhone } from "@/lib/phone-normalize";

export type Conversation = {
  threadId: string;
  /** null = ainda não vinculada a nenhum Contact do CRM ("WhatsApp Geral"). */
  contactId: string | null;
  displayName: string;
  phoneNormalized: string;
  whatsappName: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: string | Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
  ownerId: string;
  ownerName: string;
};

export type ConversationTab = "crm" | "geral";

export type NotificationPrefs = { notifyOnCrmMessage: boolean; notifyOnGeralMessage: boolean };

const RELATIVE_UNITS: { limitMs: number; divisorMs: number; suffix: string }[] = [
  { limitMs: 60_000, divisorMs: 1, suffix: "agora" },
  { limitMs: 60 * 60_000, divisorMs: 60_000, suffix: "min" },
  { limitMs: 24 * 60 * 60_000, divisorMs: 60 * 60_000, suffix: "h" },
];

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

export function formatWhen(value: string | Date): string {
  const date = new Date(value);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    for (const unit of RELATIVE_UNITS) {
      if (diff < unit.limitMs) {
        if (unit.suffix === "agora") return "agora";
        return `${Math.max(1, Math.floor(diff / unit.divisorMs))} ${unit.suffix}`;
      }
    }
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Abas "WhatsApp CRM" (vinculado a um Contact) / "WhatsApp Geral" (todo o resto) — compartilhado entre desktop e mobile. */
export function TabSwitcher({
  tab,
  onChange,
  counts,
  notificationPrefs,
  onToggleNotifications,
}: {
  tab: ConversationTab;
  onChange: (tab: ConversationTab) => void;
  counts: { crm: number; geral: number };
  /** Sem instância própria conectada não tem o que configurar — some o sino. */
  notificationPrefs?: NotificationPrefs;
  onToggleNotifications?: (tab: ConversationTab) => void;
}) {
  const notifyEnabled =
    tab === "crm" ? notificationPrefs?.notifyOnCrmMessage : notificationPrefs?.notifyOnGeralMessage;

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-neutral-200/60 px-2.5 pt-2 dark:border-neutral-800/60">
      <div className="flex items-center gap-1">
        {(
          [
            { value: "crm" as const, label: "WhatsApp CRM" },
            { value: "geral" as const, label: "WhatsApp Geral" },
          ]
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === opt.value
                ? "border-b-2 border-neutral-900 text-neutral-900 dark:border-white dark:text-white"
                : "border-b-2 border-transparent text-neutral-400 hover:text-neutral-700 active:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-300 dark:active:text-neutral-100"
            }`}
          >
            {opt.label}
            {counts[opt.value] > 0 && <span className="ml-1 opacity-60">· {counts[opt.value]}</span>}
          </button>
        ))}
      </div>
      {notificationPrefs && onToggleNotifications && (
        <button
          type="button"
          onClick={() => onToggleNotifications(tab)}
          className="icon-btn mb-1 shrink-0"
          aria-label={notifyEnabled ? `Desativar notificações do ${tab === "crm" ? "CRM" : "Geral"}` : `Ativar notificações do ${tab === "crm" ? "CRM" : "Geral"}`}
          title={notifyEnabled ? "Notificações ativadas — clique pra desativar" : "Notificações desativadas — clique pra ativar"}
        >
          {notifyEnabled ? (
            <Bell className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <BellOff className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  );
}

export function ConversationsView({
  initialConversations,
  currentUserName,
  currentUserPhotoUrl,
  currentUserId,
  notificationPrefs: initialNotificationPrefs,
}: {
  initialConversations: Conversation[];
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  currentUserId?: string;
  notificationPrefs?: NotificationPrefs;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  // Sempre começa sem nenhuma conversa aberta — abrir uma automaticamente
  // marcaria ela como lida (GET /api/whatsapp/messages/[threadId]) sem a
  // pessoa ter escolhido nada, além de ser surpreendente entrar na tela já
  // "dentro" de uma conversa específica.
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [tab, setTab] = useState<ConversationTab>("crm");
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  // Filtro por responsável só faz sentido pra quem enxerga conversa de mais
  // de um vendedor (OWNER) — um MEMBER só vê as próprias mesmo.
  const [ownerFilter, setOwnerFilter] = useState("");
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
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
        // Sem isso, uma falha (sessão expirada, sem instância etc.) deixava o
        // sino "mudo" na tela mas nada gravado — voltava sozinho ao recarregar,
        // sem nenhum aviso de que não tinha salvo de verdade.
        const data = await res.json().catch(() => ({}));
        setNotificationPrefs(previous);
        setNotificationError(data.error ?? "Não foi possível salvar a preferência de notificação.");
      }
    } catch {
      setNotificationPrefs(previous);
      setNotificationError("Falha de conexão ao salvar a preferência de notificação.");
    }
  }
  const unreadByThreadRef = useRef<Map<string, number>>(
    new Map(initialConversations.map((c) => [c.threadId, c.unreadCount])),
  );

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/whatsapp/conversations");
        if (!res.ok) return;
        const next: Conversation[] = await res.json();

        // Marca quem recebeu mensagem nova desde o último poll pra dar um
        // piscar sutil na linha — sem isso, uma mensagem nova só se nota
        // reparando no número do badge, fácil de passar batido.
        const arrived = new Set<string>();
        for (const c of next) {
          const prevCount = unreadByThreadRef.current.get(c.threadId) ?? 0;
          if (c.unreadCount > prevCount) arrived.add(c.threadId);
        }
        unreadByThreadRef.current = new Map(next.map((c) => [c.threadId, c.unreadCount]));

        setConversations(next);
        if (arrived.size > 0) {
          setJustArrived(arrived);
          setTimeout(() => setJustArrived(new Set()), 1400);
        }
      } catch {
        // Silencioso: mantém a última lista boa em caso de falha temporária de rede.
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const tabCounts = useMemo(
    () => ({
      crm: conversations.filter((c) => c.contactId).length,
      geral: conversations.filter((c) => !c.contactId).length,
    }),
    [conversations],
  );

  const tabConversations = useMemo(
    () => conversations.filter((c) => (tab === "crm" ? !!c.contactId : !c.contactId)),
    [conversations, tab],
  );

  const unreadTotal = useMemo(() => tabConversations.reduce((sum, c) => sum + c.unreadCount, 0), [tabConversations]);

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of tabConversations) seen.set(c.ownerId, c.ownerId === currentUserId ? "Você" : c.ownerName);
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [tabConversations, currentUserId]);
  // Enxergar mais de um responsável nas conversas já indica visibilidade
  // ampliada (dono, ou admin líder de equipe) — não precisa checar role.
  const showOwnerInfo = ownerOptions.length > 1;

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tabConversations.filter((c) => {
      if (onlyUnread && c.unreadCount === 0) return false;
      if (ownerFilter && c.ownerId !== ownerFilter) return false;
      if (
        term &&
        !c.displayName.toLowerCase().includes(term) &&
        !c.deal?.name.toLowerCase().includes(term) &&
        !c.phoneNormalized.includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [tabConversations, search, onlyUnread, ownerFilter]);

  // Sem filtro de responsável escolhido e visibilidade ampliada: agrupa por
  // vendedor (cada um numa seção com cabeçalho) em vez de misturar tudo numa
  // lista só — é o "bem separado" que dá pra enxergar de quem é cada
  // conversa sem precisar abrir uma por uma.
  const groupedConversations = useMemo(() => {
    if (!showOwnerInfo || ownerFilter) return null;
    return groupByOwner(filteredConversations);
  }, [showOwnerInfo, ownerFilter, filteredConversations]);

  const selected = conversations.find((c) => c.threadId === selectedThreadId) ?? null;

  function selectConversation(threadId: string) {
    if (threadId === selectedThreadId) return;
    withViewTransition(() => setSelectedThreadId(threadId));
  }

  function handleDealAdded(threadId: string, result: { contactId: string; deal: { id: string; name: string } }) {
    setConversations((prev) =>
      prev.map((c) => (c.threadId === threadId ? { ...c, contactId: result.contactId, deal: result.deal } : c)),
    );
    setQuickAddOpen(false);
    setTab("crm");
  }

  return (
    <div className="hidden min-h-0 flex-1 gap-4 lg:flex">
      <div className="card flex w-80 shrink-0 flex-col overflow-hidden">
        <TabSwitcher
          tab={tab}
          onChange={setTab}
          counts={tabCounts}
          notificationPrefs={notificationPrefs}
          onToggleNotifications={toggleNotifications}
        />

        {notificationError && (
          <p className="shrink-0 bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {notificationError}
          </p>
        )}

        <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-200/60 p-2.5 dark:border-neutral-800/60">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa"
              className="field-input py-1.5 pr-7 pl-8 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label="Limpar busca"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOnlyUnread((v) => !v)}
            className={`shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
              onlyUnread
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
            title="Mostrar só não lidas"
          >
            Não lidas{unreadTotal > 0 && ` · ${unreadTotal}`}
          </button>
        </div>

        {showOwnerInfo && (
          <div className="shrink-0 border-b border-neutral-200/60 p-2.5 dark:border-neutral-800/60">
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              className="w-full py-1.5 text-sm"
              options={[{ value: "", label: "Todos os responsáveis" }, ...ownerOptions]}
            />
          </div>
        )}

        <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {tabConversations.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={MessageCircle}
                title="Nenhuma conversa ainda"
                description={
                  tab === "crm"
                    ? "Conversas de contatos já cadastrados no CRM aparecem aqui."
                    : "Conversas de números que ainda não são contato aparecem aqui."
                }
              />
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
              Nenhuma conversa encontrada.
            </p>
          ) : groupedConversations ? (
            groupedConversations.map((group) => (
              <div key={group.ownerId} className="space-y-0.5">
                <p className="sticky top-0 z-10 truncate bg-white px-1.5 py-1 text-[11px] font-semibold text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
                  {group.ownerId === currentUserId ? "Você" : group.ownerName}
                </p>
                {group.items.map((c) => (
                  <ConversationRow
                    key={c.threadId}
                    conversation={c}
                    isActive={c.threadId === selectedThreadId}
                    justArrived={justArrived.has(c.threadId)}
                    onSelect={() => selectConversation(c.threadId)}
                  />
                ))}
              </div>
            ))
          ) : (
            filteredConversations.map((c) => (
              <ConversationRow
                key={c.threadId}
                conversation={c}
                isActive={c.threadId === selectedThreadId}
                showOwner={showOwnerInfo}
                isCurrentUser={c.ownerId === currentUserId}
                justArrived={justArrived.has(c.threadId)}
                onSelect={() => selectConversation(c.threadId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {selected ? (
          <div className="flex h-full flex-col p-4">
            {selected.deal ? (
              <Link
                href={`/negocios/${selected.deal.id}`}
                className="mb-2 inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <Briefcase className="h-3 w-3" strokeWidth={2} />
                Ver negócio: {selected.deal.name}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setQuickAddOpen(true)}
                className="mb-2 inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <BriefcaseBusiness className="h-3 w-3" strokeWidth={2} />
                Adicionar negócio
              </button>
            )}
            <ChatWindow
              key={selected.threadId}
              threadId={selected.threadId}
              contactName={selected.displayName}
              contactPhone={formatBrazilianPhone(selected.phoneNormalized)}
              currentUserName={currentUserName}
              currentUserPhotoUrl={currentUserPhotoUrl}
              onClose={() => withViewTransition(() => setSelectedThreadId(null))}
              className="min-h-0 flex-1"
            />

            {quickAddOpen && (
              <QuickAddDealPanel
                onClose={() => setQuickAddOpen(false)}
                suggestedName={selected.whatsappName ?? ""}
                phoneFormatted={formatBrazilianPhone(selected.phoneNormalized) ?? selected.phoneNormalized}
                ownerId={selected.ownerId}
                ownerName={selected.ownerName}
                onCreated={(result) => handleDealAdded(selected.threadId, result)}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={MessageCircle}
              title="Selecione uma conversa"
              description="Escolha um contato à esquerda pra ver o histórico."
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Uma linha da lista de conversas — usada tanto aqui (desktop) quanto no
 * mestre-detalhe do mobile (conversations-view-mobile.tsx), pra não duplicar
 * essa marcação bem detalhada em dois lugares.
 */
export function ConversationRow({
  conversation: c,
  isActive,
  showOwner,
  isCurrentUser,
  justArrived,
  onSelect,
}: {
  conversation: Conversation;
  isActive: boolean;
  showOwner?: boolean;
  isCurrentUser?: boolean;
  justArrived?: boolean;
  onSelect: () => void;
}) {
  const unread = c.unreadCount > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-md border-l-2 p-2.5 text-left transition-colors active:scale-[0.98] ${
        isActive
          ? "border-l-neutral-900 bg-neutral-100 dark:border-l-white dark:bg-neutral-800"
          : "border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
      } ${justArrived ? "animate-highlight-once" : ""}`}
    >
      <div className="group relative mt-0.5 shrink-0">
        <Avatar
          name={c.displayName}
          size="sm"
          className="transition-shadow group-hover:ring-2 group-hover:ring-neutral-300 group-hover:ring-offset-2 group-hover:ring-offset-white dark:group-hover:ring-neutral-600 dark:group-hover:ring-offset-neutral-900"
        />
        <span className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-2 ring-white dark:bg-neutral-900 dark:ring-neutral-900">
          <WhatsAppIcon className="h-2.5 w-2.5 text-neutral-400 dark:text-neutral-500" strokeWidth={2.5} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-sm ${
              unread
                ? "font-semibold text-neutral-900 dark:text-neutral-100"
                : "font-medium text-neutral-700 dark:text-neutral-300"
            }`}
          >
            {c.displayName}
          </p>
          <span
            className={`shrink-0 text-[10px] ${
              unread ? "font-medium text-neutral-700 dark:text-neutral-300" : "text-neutral-400 dark:text-neutral-500"
            }`}
          >
            {formatWhen(c.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={`min-w-0 truncate text-xs ${
              unread ? "font-medium text-neutral-700 dark:text-neutral-300" : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {c.lastMessageDirection === "OUTBOUND" ? "Você: " : ""}
            {c.lastMessagePreview}
          </p>
          {unread && (
            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
              {c.unreadCount}
            </span>
          )}
        </div>
        {c.deal && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            <Briefcase className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
            {c.deal.name}
          </p>
        )}
        {showOwner && (
          <p className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            Responsável: {isCurrentUser ? "Você" : c.ownerName}
          </p>
        )}
      </div>
    </button>
  );
}
