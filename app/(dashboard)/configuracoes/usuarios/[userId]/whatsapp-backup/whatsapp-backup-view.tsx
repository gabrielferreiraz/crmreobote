"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Archive, ImageOff, User, QrCode, Search, X } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";

type ThreadSummary = {
  id: string;
  displayName: string;
  phoneFormatted: string;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: string;
};

type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  status: string;
  createdAt: string;
  metadata?: { amount?: number; key?: string; name?: string; phone?: string } | null;
};

function MessageContent({ message }: { message: Message }) {
  switch (message.type) {
    case "IMAGE":
      return message.mediaUrl ? (
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={message.mediaUrl} alt="Imagem" className="max-h-72 max-w-full rounded-md object-contain" />
          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs italic opacity-60">
          <ImageOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Imagem expirada
        </p>
      );
    case "AUDIO":
      return message.mediaUrl ? (
        <audio controls src={message.mediaUrl} className="h-8 w-56 max-w-full" />
      ) : (
        <p className="text-xs italic opacity-60">Áudio expirado</p>
      );
    case "STICKER":
      return message.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={message.mediaUrl} alt="Figurinha" className="h-28 w-28 object-contain" />
      ) : (
        <p className="text-xs italic opacity-60">Figurinha — não suportado</p>
      );
    case "CONTACT":
      return (
        <div className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 dark:bg-white/10">
          <User className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
          <div className="min-w-0">
            <p className="truncate font-medium">{message.metadata?.name ?? "Contato"}</p>
            <p className="truncate text-xs opacity-70">{message.metadata?.phone ?? ""}</p>
          </div>
        </div>
      );
    case "PIX":
      return (
        <div className="space-y-1 rounded-md bg-black/5 px-2.5 py-2 dark:bg-white/10">
          <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
            <QrCode className="h-3.5 w-3.5" strokeWidth={2} />
            Cobrança Pix
          </p>
          <p className="text-base font-semibold">
            {message.metadata?.amount != null ? formatCurrency(message.metadata.amount) : "—"}
          </p>
          {message.metadata?.key && <p className="truncate text-xs opacity-70">Chave: {message.metadata.key}</p>}
        </div>
      );
    default:
      return <p className="whitespace-pre-wrap">{message.body || "—"}</p>;
  }
}

/** Master-detail simples e só-leitura: lista de conversas à esquerda, mensagens da selecionada à direita — sem composer, sem ações (é backup, não é o chat do dia a dia). */
export function WhatsAppBackupView({ userId }: { userId: string }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`/api/org/members/${userId}/whatsapp-backup`)
      .then((r) => r.json())
      .then((data) => setThreads(data.threads ?? []))
      .catch(() => setError("Não foi possível carregar as conversas."));
  }, [userId]);

  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(null);
    setMessagesError(null);
    fetch(`/api/org/members/${userId}/whatsapp-backup/${selectedId}`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => setMessagesError("Não foi possível carregar as mensagens."));
  }, [userId, selectedId]);

  // Filtro em memória sobre a lista já carregada — instantâneo (sem round-trip
  // de rede a cada tecla), igual ao padrão já usado em Conversas
  // (conversations-view.tsx). Casa nome, telefone e prévia da última mensagem.
  const filteredThreads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return threads ?? [];
    return (threads ?? []).filter(
      (t) =>
        t.displayName.toLowerCase().includes(term) ||
        t.phoneFormatted.toLowerCase().includes(term) ||
        t.lastMessagePreview.toLowerCase().includes(term),
    );
  }, [threads, search]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  if (!threads) {
    return (
      <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
        Carregando...
      </p>
    );
  }

  if (threads.length === 0) {
    return <EmptyState icon={Archive} title="Nenhuma conversa" description="Este usuário nunca teve uma conversa de WhatsApp registrada." />;
  }

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou mensagem"
            className="field-input w-full py-1.5 pr-8 pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="scrollbar-thin card min-h-0 flex-1 overflow-y-auto p-2">
          {filteredThreads.length === 0 ? (
            <p className="p-3 text-center text-xs text-neutral-400 dark:text-neutral-500">Nenhuma conversa encontrada.</p>
          ) : (
            filteredThreads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedId(t.id)}
            className={`flex w-full items-center gap-2.5 rounded-md p-2.5 text-left text-sm transition-colors ${
              selectedId === t.id
                ? "bg-neutral-100 dark:bg-neutral-800"
                : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            }`}
          >
            <Avatar name={t.displayName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-medium text-neutral-900 dark:text-neutral-100">
                <span className="truncate">{t.displayName}</span>
                {t.archived && (
                  <span title="Instância apagada — histórico congelado">
                    <Archive className="h-3 w-3 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{t.lastMessagePreview}</p>
            </div>
            <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
              {new Date(t.lastMessageAt).toLocaleDateString("pt-BR")}
            </span>
          </button>
            ))
          )}
        </div>
      </div>

      <div className="card flex min-h-0 flex-col p-4">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-500">
            Selecione uma conversa
          </div>
        ) : (
          <>
            <div className="mb-3 flex shrink-0 items-center gap-2.5 border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <Avatar name={selected.displayName} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{selected.displayName}</p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{selected.phoneFormatted}</p>
              </div>
              {selected.archived && (
                <span className="ml-auto shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  Arquivada
                </span>
              )}
            </div>

            {messagesError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{messagesError}</p>
            ) : !messages ? (
              <p className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                Carregando...
              </p>
            ) : (
              <div className="scrollbar-thin chat-bg-dots min-h-0 flex-1 space-y-1.5 overflow-y-auto rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-950/50">
                {messages.map((m) => {
                  const isOut = m.direction === "OUTBOUND";
                  return (
                    <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
                          isOut
                            ? "rounded-br-sm bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                            : "rounded-bl-sm bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                        }`}
                      >
                        <MessageContent message={m} />
                        <p className="mt-0.5 text-[10px] opacity-60">{new Date(m.createdAt).toLocaleString("pt-BR")}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
