"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { ChatWindow } from "@/components/whatsapp-chat";

type Conversation = {
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: string | Date;
  unreadCount: number;
  deal: { id: string; name: string } | null;
};

function formatWhen(value: string | Date): string {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ConversationsView({
  initialConversations,
  currentUserName,
  currentUserPhotoUrl,
}: {
  initialConversations: Conversation[];
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    initialConversations[0]?.contactId ?? null,
  );

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/whatsapp/conversations");
        if (res.ok) setConversations(await res.json());
      } catch {
        // Silencioso: mantém a última lista boa em caso de falha temporária de rede.
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const selected = conversations.find((c) => c.contactId === selectedContactId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="card scrollbar-thin flex w-80 shrink-0 flex-col gap-0.5 overflow-y-auto p-1.5">
        {conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={MessageCircle}
              title="Nenhuma conversa ainda"
              description="Assim que um lead te escrever, a conversa aparece aqui."
            />
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.contactId}
              type="button"
              onClick={() => setSelectedContactId(c.contactId)}
              className={`flex items-start gap-2.5 rounded-md p-2.5 text-left transition-colors ${
                c.contactId === selectedContactId
                  ? "bg-neutral-100 dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              }`}
            >
              <Avatar name={c.contactName} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {c.contactName}
                  </p>
                  <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
                    {formatWhen(c.lastMessageAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {c.lastMessageDirection === "OUTBOUND" ? "Você: " : ""}
                    {c.lastMessagePreview}
                  </p>
                  {c.unreadCount > 0 && (
                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                {c.deal && (
                  <p className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-500">{c.deal.name}</p>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="card min-h-0 flex-1 overflow-hidden p-4">
        {selected ? (
          <div className="flex h-full flex-col">
            {selected.deal && (
              <Link
                href={`/negocios/${selected.deal.id}`}
                className="mb-2 shrink-0 self-start text-xs font-medium text-neutral-500 hover:underline dark:text-neutral-400"
              >
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
              onClose={() => setSelectedContactId(null)}
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
