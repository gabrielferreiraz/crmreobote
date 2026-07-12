"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Search, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ChatWindow } from "@/components/whatsapp-chat";
import { ConversationRow, type Conversation } from "./conversations-view";

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
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const unreadByContactRef = useRef<Map<string, number>>(
    new Map(initialConversations.map((c) => [c.contactId, c.unreadCount])),
  );

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/whatsapp/conversations");
        if (!res.ok) return;
        const next: Conversation[] = await res.json();

        const arrived = new Set<string>();
        for (const c of next) {
          const prevCount = unreadByContactRef.current.get(c.contactId) ?? 0;
          if (c.unreadCount > prevCount) arrived.add(c.contactId);
        }
        unreadByContactRef.current = new Map(next.map((c) => [c.contactId, c.unreadCount]));

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

  const unreadTotal = useMemo(() => conversations.reduce((sum, c) => sum + c.unreadCount, 0), [conversations]);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (onlyUnread && c.unreadCount === 0) return false;
      if (
        term &&
        !c.contactName.toLowerCase().includes(term) &&
        !c.deal?.name.toLowerCase().includes(term) &&
        !(c.contactPhone ?? "").includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [conversations, search, onlyUnread]);

  const selected = conversations.find((c) => c.contactId === selectedContactId) ?? null;

  if (selected) {
    return (
      <ChatWindow
        key={selected.contactId}
        contactId={selected.contactId}
        contactName={selected.contactName}
        contactPhone={selected.contactPhone}
        currentUserName={currentUserName}
        currentUserPhotoUrl={currentUserPhotoUrl}
        onClose={() => setSelectedContactId(null)}
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
          className={`shrink-0 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
            onlyUnread
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
              : "border-neutral-300 bg-white text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
          }`}
        >
          Não lidas{unreadTotal > 0 && ` · ${unreadTotal}`}
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={MessageCircle}
              title="Nenhuma conversa ainda"
              description="Assim que um lead te escrever, a conversa aparece aqui."
            />
          </div>
        ) : filteredConversations.length === 0 ? (
          <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhuma conversa encontrada.</p>
        ) : (
          filteredConversations.map((c) => (
            <ConversationRow
              key={c.contactId}
              conversation={c}
              isActive={false}
              justArrived={justArrived.has(c.contactId)}
              onSelect={() => setSelectedContactId(c.contactId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
