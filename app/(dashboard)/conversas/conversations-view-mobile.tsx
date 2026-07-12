"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Search, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ChatWindow } from "@/components/whatsapp-chat";
import { ConversationRow, TabSwitcher, type Conversation, type ConversationTab } from "./conversations-view";

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
}: {
  initialConversations: Conversation[];
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [tab, setTab] = useState<ConversationTab>("crm");
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
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

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tabConversations.filter((c) => {
      if (onlyUnread && c.unreadCount === 0) return false;
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
  }, [tabConversations, search, onlyUnread]);

  const selected = conversations.find((c) => c.threadId === selectedThreadId) ?? null;

  if (selected) {
    return (
      <ChatWindow
        key={selected.threadId}
        threadId={selected.threadId}
        contactName={selected.displayName}
        contactPhone={selected.phoneNormalized}
        currentUserName={currentUserName}
        currentUserPhotoUrl={currentUserPhotoUrl}
        onClose={() => setSelectedThreadId(null)}
        backMode
        className="h-full"
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Conversas</h1>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Todas as conversas de WhatsApp num só lugar.</p>
      </div>

      <TabSwitcher tab={tab} onChange={setTab} counts={tabCounts} />

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
        ) : (
          filteredConversations.map((c) => (
            <ConversationRow
              key={c.threadId}
              conversation={c}
              isActive={false}
              justArrived={justArrived.has(c.threadId)}
              onSelect={() => setSelectedThreadId(c.threadId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
