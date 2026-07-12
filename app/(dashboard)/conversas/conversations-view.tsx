"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Search, Briefcase, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { ChatWindow, withViewTransition } from "@/components/whatsapp-chat";

export type Conversation = {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: string | Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
  ownerId: string;
  ownerName: string;
};

const RELATIVE_UNITS: { limitMs: number; divisorMs: number; suffix: string }[] = [
  { limitMs: 60_000, divisorMs: 1, suffix: "agora" },
  { limitMs: 60 * 60_000, divisorMs: 60_000, suffix: "min" },
  { limitMs: 24 * 60 * 60_000, divisorMs: 60 * 60_000, suffix: "h" },
];

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

export function ConversationsView({
  initialConversations,
  currentUserName,
  currentUserPhotoUrl,
  isOwner,
}: {
  initialConversations: Conversation[];
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  isOwner?: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    initialConversations[0]?.contactId ?? null,
  );
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  // Filtro por responsável só faz sentido pra quem enxerga conversa de mais
  // de um vendedor (OWNER) — um MEMBER só vê as próprias mesmo.
  const [ownerFilter, setOwnerFilter] = useState("");
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

        // Marca quem recebeu mensagem nova desde o último poll pra dar um
        // piscar sutil na linha — sem isso, uma mensagem nova só se nota
        // reparando no número do badge, fácil de passar batido.
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

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of conversations) seen.set(c.ownerId, c.ownerName);
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (onlyUnread && c.unreadCount === 0) return false;
      if (ownerFilter && c.ownerId !== ownerFilter) return false;
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
  }, [conversations, search, onlyUnread, ownerFilter]);

  const selected = conversations.find((c) => c.contactId === selectedContactId) ?? null;

  function selectConversation(contactId: string) {
    if (contactId === selectedContactId) return;
    withViewTransition(() => setSelectedContactId(contactId));
  }

  return (
    <div className="hidden min-h-0 flex-1 gap-4 lg:flex">
      <div className="card flex w-80 shrink-0 flex-col overflow-hidden">
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

        {isOwner && ownerOptions.length > 1 && (
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
          {conversations.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                icon={MessageCircle}
                title="Nenhuma conversa ainda"
                description="Assim que um lead te escrever, a conversa aparece aqui."
              />
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
              Nenhuma conversa encontrada.
            </p>
          ) : (
            filteredConversations.map((c) => (
              <ConversationRow
                key={c.contactId}
                conversation={c}
                isActive={c.contactId === selectedContactId}
                isOwner={isOwner}
                justArrived={justArrived.has(c.contactId)}
                onSelect={() => selectConversation(c.contactId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {selected ? (
          <div className="flex h-full flex-col p-4">
            {selected.deal && (
              <Link
                href={`/negocios/${selected.deal.id}`}
                className="mb-2 inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <Briefcase className="h-3 w-3" strokeWidth={2} />
                Ver negócio: {selected.deal.name}
              </Link>
            )}
            <ChatWindow
              key={selected.contactId}
              contactId={selected.contactId}
              contactName={selected.contactName}
              contactPhone={selected.contactPhone}
              currentUserName={currentUserName}
              currentUserPhotoUrl={currentUserPhotoUrl}
              onClose={() => withViewTransition(() => setSelectedContactId(null))}
              className="min-h-0 flex-1"
            />
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
  isOwner,
  justArrived,
  onSelect,
}: {
  conversation: Conversation;
  isActive: boolean;
  isOwner?: boolean;
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
          name={c.contactName}
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
            {c.contactName}
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
        {isOwner && (
          <p className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
            Responsável: {c.ownerName}
          </p>
        )}
      </div>
    </button>
  );
}
