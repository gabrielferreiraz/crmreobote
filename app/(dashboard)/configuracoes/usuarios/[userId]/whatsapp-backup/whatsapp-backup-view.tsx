"use client";

import { requestJson } from "@/lib/client-request";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  ImageOff,
  Loader2,
  MessageSquareText,
  QrCode,
  Search,
  Snowflake,
  User,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { BackupExportMenu } from "@/components/whatsapp-backup/export-menu";
import { formatCurrency } from "@/lib/format";
import { dayKey, dayLabel, formatCount, formatDay, formatPeriod, formatTime } from "@/lib/whatsapp/backup-format";

type ThreadSummary = {
  id: string;
  displayName: string;
  phoneFormatted: string;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageDirection: "INBOUND" | "OUTBOUND";
  lastMessageAt: string;
  firstMessageAt: string;
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

type ThreadFilter = "all" | "live" | "frozen";

function MessageContent({ message, out }: { message: Message; out: boolean }) {
  const tile = out ? "bg-white/20" : "bg-black/5 dark:bg-white/10";
  switch (message.type) {
    case "IMAGE":
      return message.mediaUrl ? (
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={message.mediaUrl} alt="Imagem" loading="lazy" className="max-h-72 max-w-full rounded-lg object-contain" />
          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs italic opacity-70">
          <ImageOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Imagem expirada
        </p>
      );
    case "VIDEO":
      return message.mediaUrl ? (
        <div className="space-y-1">
          <video controls playsInline preload="metadata" src={message.mediaUrl} className="max-h-72 max-w-full rounded-lg bg-black" />
          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs italic opacity-70">
          <ImageOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Vídeo expirado
        </p>
      );
    case "AUDIO":
      return message.mediaUrl ? (
        <audio controls preload="none" src={message.mediaUrl} className="h-8 w-56 max-w-full" />
      ) : (
        <p className="text-xs italic opacity-70">Áudio expirado</p>
      );
    case "STICKER":
      return message.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={message.mediaUrl} alt="Figurinha" loading="lazy" className="h-28 w-28 object-contain" />
      ) : (
        <p className="text-xs italic opacity-70">Figurinha — não suportado</p>
      );
    case "CONTACT":
      return (
        <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${tile}`}>
          <User className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
          <div className="min-w-0">
            <p className="truncate font-medium">{message.metadata?.name ?? "Contato"}</p>
            <p className="truncate text-xs opacity-70">{message.metadata?.phone ?? ""}</p>
          </div>
        </div>
      );
    case "PIX":
      return (
        <div className={`space-y-1 rounded-lg px-2.5 py-2 ${tile}`}>
          <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
            <QrCode className="h-3.5 w-3.5" strokeWidth={2} />
            Cobrança Pix
          </p>
          <p className="text-base font-semibold">{message.metadata?.amount != null ? formatCurrency(message.metadata.amount) : "—"}</p>
          {message.metadata?.key && <p className="truncate text-xs opacity-70">Chave: {message.metadata.key}</p>}
        </div>
      );
    default:
      return <p className="break-words whitespace-pre-wrap">{message.body || "—"}</p>;
  }
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function ThreadListSkeleton() {
  return (
    <div className="space-y-1 p-2" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg p-2.5">
          <div className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-2.5 w-full rounded bg-neutral-100 dark:bg-neutral-800/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Leitura do backup: lista de conversas à esquerda, mensagens da selecionada à
 * direita. Só leitura (sem composer, sem ações) — é histórico, não o chat do dia
 * a dia. No celular mostra uma coisa de cada vez (lista → conversa, com voltar).
 */
export function WhatsAppBackupView({ userId, ownerName }: { userId: string; ownerName: string }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>("all");
  const [inChatSearch, setInChatSearch] = useState("");
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestJson(`/api/org/members/${userId}/whatsapp-backup`, undefined, { silent: true }).then((res) => {
      if (res.ok) setThreads(res.data?.threads ?? []);
      else setError("Não foi possível carregar as conversas.");
    });
  }, [userId]);

  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(null);
    setMessagesError(null);
    setInChatSearch("");
    setShowChatSearch(false);
    requestJson(`/api/org/members/${userId}/whatsapp-backup/${selectedId}`, undefined, { silent: true }).then((res) => {
      if (res.ok) setMessages(res.data?.messages ?? []);
      else setMessagesError("Não foi possível carregar as mensagens.");
    });
  }, [userId, selectedId]);

  // Abre a conversa já no fim (a mensagem mais recente), como num chat de verdade.
  useEffect(() => {
    if (messages && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAtBottom(true);
    }
  }, [messages]);

  const frozenCount = useMemo(() => (threads ?? []).filter((t) => t.archived).length, [threads]);

  // Filtro em memória sobre a lista já carregada — instantâneo (sem ida à rede a
  // cada tecla). Casa nome, telefone e prévia da última mensagem.
  const filteredThreads = useMemo(() => {
    const term = normalize(search.trim());
    return (threads ?? []).filter((t) => {
      if (threadFilter === "live" && t.archived) return false;
      if (threadFilter === "frozen" && !t.archived) return false;
      if (!term) return true;
      return normalize(`${t.displayName} ${t.phoneFormatted} ${t.lastMessagePreview}`).includes(term);
    });
  }, [threads, search, threadFilter]);

  const visibleMessages = useMemo(() => {
    const term = normalize(inChatSearch.trim());
    if (!messages) return null;
    if (!term) return messages;
    return messages.filter((m) => normalize(m.body ?? "").includes(term));
  }, [messages, inChatSearch]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  if (threads && threads.length === 0) {
    return <EmptyState icon={Archive} title="Nenhuma conversa" description="Este usuário nunca teve uma conversa de WhatsApp registrada." />;
  }

  const selected = threads?.find((t) => t.id === selectedId) ?? null;
  const today = new Date();

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
      {/* ── Lista de conversas ─────────────────────────────────────────── */}
      <div className={`min-h-0 flex-col gap-2.5 ${selected ? "hidden lg:flex" : "flex"}`}>
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou mensagem"
            className="field-input w-full py-2 pr-9 pl-9 text-sm"
            aria-label="Buscar conversas"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>

        {frozenCount > 0 && (
          <div role="tablist" aria-label="Tipo de conversa" className="flex shrink-0 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
            {(
              [
                { v: "all", label: "Todas", n: threads?.length ?? 0 },
                { v: "live", label: "Ativas", n: (threads?.length ?? 0) - frozenCount },
                { v: "frozen", label: "Congeladas", n: frozenCount },
              ] as const
            ).map((c) => (
              <button
                key={c.v}
                type="button"
                role="tab"
                aria-selected={threadFilter === c.v}
                onClick={() => setThreadFilter(c.v)}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  threadFilter === c.v
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {c.label} <span className="tabular-nums opacity-60">{c.n}</span>
              </button>
            ))}
          </div>
        )}

        <div className="scrollbar-thin card min-h-0 flex-1 overflow-y-auto p-1.5 pb-3">
          {!threads ? (
            <ThreadListSkeleton />
          ) : filteredThreads.length === 0 ? (
            <p className="p-6 text-center text-xs text-neutral-400 dark:text-neutral-500">Nenhuma conversa encontrada.</p>
          ) : (
            filteredThreads.map((t) => {
              const active = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  aria-current={active ? "true" : undefined}
                  className={`relative flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-sm transition-colors ${
                    active ? "bg-brand-light/70 dark:bg-white/[0.07]" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  }`}
                >
                  {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-0.5 rounded-full bg-brand" />}
                  <Avatar name={t.displayName} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                        <span className="truncate">{t.displayName}</span>
                        {t.archived && (
                          <span title="Histórico congelado (instância apagada)">
                            <Snowflake className="h-3 w-3 shrink-0 text-sky-500" strokeWidth={2.25} />
                          </span>
                        )}
                      </p>
                      <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">{formatDay(t.lastMessageAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {t.lastMessageDirection === "OUTBOUND" ? (
                        <ArrowUpRight className="h-3 w-3 shrink-0 text-neutral-400" strokeWidth={2.25} />
                      ) : (
                        <ArrowDownLeft className="h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2.25} />
                      )}
                      <p className="min-w-0 flex-1 truncate text-xs text-neutral-500 dark:text-neutral-400">{t.lastMessagePreview}</p>
                      <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-px text-[10px] font-medium text-neutral-500 tabular-nums dark:bg-neutral-800 dark:text-neutral-400">
                        {formatCount(t.messageCount)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Conversa ───────────────────────────────────────────────────── */}
      <div className={`card min-h-0 flex-col overflow-hidden p-0 ${selected ? "flex" : "hidden lg:flex"}`}>
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
              <MessageSquareText className="h-7 w-7" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Escolha uma conversa</p>
              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">As mensagens aparecem aqui, em ordem, só para leitura.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-3 border-b border-neutral-100 px-3 py-2.5 sm:px-4 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="icon-btn lg:hidden"
                aria-label="Voltar para as conversas"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <Avatar name={selected.displayName} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium text-neutral-900 dark:text-neutral-100">
                  <span className="truncate">{selected.displayName}</span>
                  {selected.archived && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-400">
                      <Snowflake className="h-3 w-3" strokeWidth={2.25} /> Congelada
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {selected.phoneFormatted} · {formatCount(selected.messageCount)} {selected.messageCount === 1 ? "mensagem" : "mensagens"} ·{" "}
                  {formatPeriod(selected.firstMessageAt, selected.lastMessageAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowChatSearch((v) => !v);
                  if (showChatSearch) setInChatSearch("");
                }}
                className={`icon-btn ${showChatSearch ? "bg-brand-light text-brand" : ""}`}
                aria-label="Buscar nesta conversa"
                aria-pressed={showChatSearch}
                title="Buscar nesta conversa"
              >
                <Search className="h-4 w-4" strokeWidth={2} />
              </button>
              <div className="hidden sm:block">
                <BackupExportMenu userId={userId} threadId={selected.id} label="Exportar conversa" />
              </div>
              <div className="sm:hidden">
                <BackupExportMenu userId={userId} threadId={selected.id} label="Baixar" />
              </div>
            </div>

            {showChatSearch && (
              <div className="flex shrink-0 items-center gap-2 border-b border-neutral-100 bg-neutral-50/70 px-3 py-2 sm:px-4 dark:border-neutral-800 dark:bg-neutral-900/60">
                <Search className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={2} />
                <input
                  autoFocus
                  value={inChatSearch}
                  onChange={(e) => setInChatSearch(e.target.value)}
                  placeholder="Buscar texto nesta conversa"
                  className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
                  aria-label="Buscar texto nesta conversa"
                />
                {inChatSearch && visibleMessages && (
                  <span className="shrink-0 text-xs text-neutral-500 tabular-nums dark:text-neutral-400">
                    {visibleMessages.length} {visibleMessages.length === 1 ? "resultado" : "resultados"}
                  </span>
                )}
              </div>
            )}

            {messagesError ? (
              <p className="p-4 text-sm text-red-600 dark:text-red-400">{messagesError}</p>
            ) : !visibleMessages ? (
              <p className="flex items-center gap-2 p-4 text-sm text-neutral-400 dark:text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                Carregando mensagens...
              </p>
            ) : (
              <div className="relative min-h-0 flex-1">
                <div
                  ref={scrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 160);
                  }}
                  className="scrollbar-thin chat-bg-dots h-full space-y-1 overflow-y-auto bg-neutral-50 px-3 py-3 pb-6 sm:px-5 dark:bg-neutral-950/50"
                >
                  {visibleMessages.length === 0 ? (
                    <p className="py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhuma mensagem com esse texto.</p>
                  ) : (
                    visibleMessages.map((m, i) => {
                      const out = m.direction === "OUTBOUND";
                      const prev = visibleMessages[i - 1];
                      const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                      const sameSender = prev && !newDay && prev.direction === m.direction;
                      return (
                        <Fragment key={m.id}>
                          {newDay && (
                            <div className="sticky top-1 z-10 flex justify-center py-2">
                              <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-neutral-500 shadow-sm ring-1 ring-neutral-200/70 backdrop-blur dark:bg-neutral-800/90 dark:text-neutral-300 dark:ring-white/10">
                                {dayLabel(m.createdAt, today)}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${out ? "justify-end" : "justify-start"} ${sameSender ? "" : "pt-1.5"}`}>
                            <div
                              className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm shadow-sm sm:max-w-[70%] ${
                                out
                                  ? "rounded-br-md bg-brand text-white"
                                  : "rounded-bl-md bg-white text-neutral-900 ring-1 ring-neutral-200/70 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-white/5"
                              }`}
                            >
                              {out && !sameSender && <p className="mb-0.5 text-[11px] font-semibold opacity-80">{ownerName}</p>}
                              <MessageContent message={m} out={out} />
                              <p className="mt-0.5 text-right text-[10px] opacity-60 tabular-nums">{formatTime(m.createdAt)}</p>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })
                  )}
                </div>

                {!atBottom && visibleMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
                    className="absolute right-4 bottom-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-600 shadow-lg ring-1 ring-neutral-200 transition-transform hover:scale-105 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-white/10"
                    aria-label="Ir para a mensagem mais recente"
                  >
                    <ArrowDown className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
