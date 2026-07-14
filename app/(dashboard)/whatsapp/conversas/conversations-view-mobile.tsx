"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, BriefcaseBusiness, MessageCircle, Search, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { ChatWindow } from "@/components/whatsapp-chat";
import { QuickAddDealPanel } from "@/components/quick-add-deal-panel";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import {
  ConversationRow,
  TabSwitcher,
  groupByOwner,
  type Conversation,
  type ConversationTab,
  type NotificationPrefs,
} from "./conversations-view";

/**
 * Conversas no celular: nunca duas colunas ao mesmo tempo — ou a lista
 * ocupa a tela inteira, ou a conversa ocupa. Tocar num contato entra na
 * conversa; a seta de voltar (dentro do ChatWindow, via backMode) retorna
 * pra lista. Esse padrão mestre-detalhe é o que todo app de chat usa no
 * toque, porque duas colunas lado a lado não cabem numa tela de celular.
 */
export function ConversationsMobile({
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
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [tab, setTab] = useState<ConversationTab>("crm");
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
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

  const groupedConversations = useMemo(() => {
    if (!showOwnerInfo || ownerFilter) return null;
    return groupByOwner(filteredConversations);
  }, [showOwnerInfo, ownerFilter, filteredConversations]);

  const selected = conversations.find((c) => c.threadId === selectedThreadId) ?? null;

  function handleDealAdded(threadId: string, result: { contactId: string; deal: { id: string; name: string } }) {
    setConversations((prev) =>
      prev.map((c) => (c.threadId === threadId ? { ...c, contactId: result.contactId, deal: result.deal } : c)),
    );
    setQuickAddOpen(false);
    setTab("crm");
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col">
        {selected.deal ? (
          <Link
            href={`/negocios/${selected.deal.id}`}
            className="mx-3 mt-2 mb-1 inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:active:bg-neutral-700"
          >
            <Briefcase className="h-3 w-3" strokeWidth={2} />
            Ver negócio: {selected.deal.name}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="mx-3 mt-2 mb-1 inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400"
          >
            <BriefcaseBusiness className="h-3 w-3" strokeWidth={2} />
            Adicionar negócio
          </button>
        )}
        <ChatWindow
          key={selected.threadId}
          threadId={selected.threadId}
          contactName={selected.displayName}
          contactPhone={selected.phoneNormalized}
          currentUserName={currentUserName}
          currentUserPhotoUrl={currentUserPhotoUrl}
          onClose={() => setSelectedThreadId(null)}
          backMode
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
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Conversas</h1>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Todas as conversas de WhatsApp num só lugar.</p>
      </div>

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

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversa"
            className="field-input py-2 pr-7 pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="tap-target absolute top-1/2 right-0 -translate-y-1/2 text-neutral-400 active:text-neutral-700 dark:active:text-neutral-200"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOnlyUnread((v) => !v)}
          className={`tap-target shrink-0 rounded-md border px-2.5 text-xs font-medium transition-colors ${
            onlyUnread
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
              : "border-neutral-300 bg-white text-neutral-500 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:active:bg-neutral-800"
          }`}
        >
          Não lidas{unreadTotal > 0 && ` · ${unreadTotal}`}
        </button>
      </div>

      {showOwnerInfo && (
        <Select
          value={ownerFilter}
          onChange={setOwnerFilter}
          className="w-full py-2 text-sm"
          options={[{ value: "", label: "Todos os responsáveis" }, ...ownerOptions]}
        />
      )}

      <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto">
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
          <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhuma conversa encontrada.</p>
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
                  isActive={false}
                  justArrived={justArrived.has(c.threadId)}
                  onSelect={() => setSelectedThreadId(c.threadId)}
                />
              ))}
            </div>
          ))
        ) : (
          filteredConversations.map((c) => (
            <ConversationRow
              key={c.threadId}
              conversation={c}
              isActive={false}
              showOwner={showOwnerInfo}
              isCurrentUser={c.ownerId === currentUserId}
              justArrived={justArrived.has(c.threadId)}
              onSelect={() => setSelectedThreadId(c.threadId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
