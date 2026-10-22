"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCheck, Inbox, MessageCircle, Search, Settings, UserPlus, UserRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ChatWindow } from "@/components/whatsapp-chat";
import { requestJson } from "@/lib/client-request";
import { useDesktopViewport } from "@/lib/use-desktop-viewport";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useWhatsAppLive } from "@/lib/use-whatsapp-live";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import { CentralSettingsDialog } from "./central-settings-dialog";
import { formatChatListTime } from "@/lib/whatsapp/format-time";
import { messagePreview } from "@/lib/whatsapp/message-preview";

type Tab = "mine" | "unassigned" | "team" | "closed";
type CentralState = "missing" | "noPool" | "CONNECTED" | "CONNECTING" | "DISCONNECTED";

type CentralItem = {
  id: string;
  displayName: string;
  phoneNormalized: string;
  profilePicUrl: string | null;
  lastMessageAt: string | null;
  status: "OPEN" | "CLOSED";
  assignee: { id: string; name: string } | null;
  unreadCount: number;
  lastMessage: { body: string | null; type: string; direction: "INBOUND" | "OUTBOUND" } | null;
  contact: {
    id: string;
    name: string;
    missingJobTitle: boolean;
    responsible: { id: string; name: string } | null;
    ownershipBlocked: boolean;
  } | null;
};

type InboxResponse = {
  enabled: boolean;
  canManageQueue?: boolean;
  central?: CentralState;
  items: CentralItem[];
  counts?: { mine: number; unassigned: number };
  selected?: CentralItem | null;
  assignableUsers?: { id: string; name: string }[];
};

const EMPTY_STATE: Record<Tab, { title: string; description: string }> = {
  mine: { title: "Tudo em dia", description: "Novos leads aparecem aqui." },
  unassigned: { title: "Fila vazia", description: "Nenhum lead aguardando atendimento." },
  team: { title: "Equipe sem atendimentos", description: "As conversas da equipe aparecem aqui." },
  closed: { title: "Nenhum encerrado", description: "Conversas concluídas aparecem aqui." },
};

/** Mesma régua de horário da lista de Conversas (lib/whatsapp/format-time.ts). */
function formatWhen(iso: string | null): string {
  return iso ? formatChatListTime(iso) : "";
}

export function CentralView({
  currentUserId,
  canManageQueue,
  isOwner,
  initialThreadId,
}: {
  currentUserId: string;
  canManageQueue: boolean;
  isOwner: boolean;
  initialThreadId: string | null;
}) {
  const desktop = useDesktopViewport();
  const [tab, setTab] = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<CentralItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [central, setCentral] = useState<CentralState | null>(null);
  const [counts, setCounts] = useState({ mine: 0, unassigned: 0 });
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<CentralItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Estado "de agora" em refs: o poll e o SSE chamam load() fora do ciclo de
  // render, e cada carga nova aborta a anterior (aba trocada no meio).
  const tabRef = useRef<Tab>("mine");
  const searchRef = useRef("");
  const selectedIdRef = useRef<string | null>(initialThreadId);
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const usersLoadedRef = useRef(false);
  const inFlightRef = useRef<AbortController | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    const params = new URLSearchParams({ tab: tabRef.current });
    if (searchRef.current.trim()) params.set("search", searchRef.current.trim());
    if (selectedIdRef.current) params.set("selected", selectedIdRef.current);
    if (!usersLoadedRef.current && canManageQueue) params.set("withUsers", "1");

    const res = await requestJson<InboxResponse>(
      `/api/whatsapp/central/conversations?${params}`,
      { signal: controller.signal },
      { silent: true },
    );
    if (res.aborted) return;
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setItems(res.data.items);
    visibleIdsRef.current = new Set(res.data.items.map((item) => item.id));
    if (res.data.central) setCentral(res.data.central);
    if (res.data.counts) setCounts(res.data.counts);
    if (res.data.assignableUsers) {
      usersLoadedRef.current = true;
      setAssignableUsers(res.data.assignableUsers);
    }
    // A conversa aberta vem sempre do servidor (mesmo fora da aba): status e
    // responsável mudam por outra pessoa e o painel não pode ficar velho.
    if (selectedIdRef.current) {
      const fresh = res.data.selected ?? null;
      if (fresh) setSelected(fresh);
      else {
        // Sumiu do alcance (transferida para fora da sua equipe, por exemplo).
        selectedIdRef.current = null;
        setSelected(null);
      }
    }
  }

  useVisiblePoll(load, 30_000);
  // Saindo da tela: nada de carga pendente nem timer acordando depois.
  useEffect(
    () => () => {
      inFlightRef.current?.abort();
      if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    },
    [],
  );
  useWhatsAppLive((event) => {
    // Só eventos da Central (ou de conversa que já está na tela) — mensagens
    // dos números pessoais da empresa toda não precisam recarregar esta lista.
    if (!event.central && !visibleIdsRef.current.has(event.threadId)) return;
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    liveTimerRef.current = setTimeout(() => void load(), 500);
  });

  function select(item: CentralItem | null) {
    setActionError(null);
    selectedIdRef.current = item?.id ?? null;
    setSelected(item);
  }

  function changeTab(next: Tab) {
    if (next === tabRef.current) return;
    tabRef.current = next;
    setTab(next);
    setItems(null);
    void load();
  }

  function changeSearch(value: string) {
    setSearch(value);
    searchRef.current = value;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => void load(), 300);
  }

  async function assign(item: CentralItem, assigneeId: string) {
    setBusy(true);
    setActionError(null);
    const res = await requestJson(
      `/api/whatsapp/central/conversations/${item.id}/assign`,
      { method: "POST", json: { assigneeId } },
      { silent: true },
    );
    setBusy(false);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    // Quem assumiu passa a ver a conversa em "Meus".
    if (assigneeId === currentUserId && tabRef.current !== "mine") {
      tabRef.current = "mine";
      setTab("mine");
    }
    void load();
  }

  async function close(item: CentralItem) {
    setBusy(true);
    setActionError(null);
    const res = await requestJson(`/api/whatsapp/central/conversations/${item.id}/close`, { method: "POST" }, { silent: true });
    setBusy(false);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    select(null);
    void load();
  }

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "mine", label: "Meus", badge: counts.mine },
    ...(canManageQueue
      ? [
          { key: "unassigned" as const, label: "Fila", badge: counts.unassigned },
          { key: "team" as const, label: "Equipe" },
        ]
      : []),
    { key: "closed", label: "Encerrados" },
  ];

  if (desktop === null) {
    return (
      <div
        className="h-full animate-pulse rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
        aria-label="Carregando Central"
      />
    );
  }

  const banner = centralBanner(central, isOwner);
  const status = centralStatus(central);

  const list = (
    <section className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950" aria-label="Lista de atendimentos">
      <header className="shrink-0 border-b border-neutral-200 px-3 pt-3 pb-2.5 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Atendimentos</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} aria-hidden="true" />
              {status.label}
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="icon-btn shrink-0"
              aria-label="Configurar Central"
              title="Configurar Central"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>

        <div
          className={`mt-3 grid rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-900 ${
            canManageQueue ? "grid-cols-4" : "grid-cols-2"
          }`}
          role="tablist"
          aria-label="Filtrar atendimentos"
        >
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeTab(item.key)}
                className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span
                    className={`min-w-4 shrink-0 rounded-full px-1 text-[10px] font-semibold leading-4 ${
                      active
                        ? "bg-brand text-white"
                        : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </header>
      {banner && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{banner}</span>
          {isOwner && (
            <button type="button" className="shrink-0 font-semibold underline" onClick={() => setSettingsOpen(true)}>
              {central === "missing" ? "Configurar" : central === "noPool" ? "Definir distribuição" : "Reconectar"}
            </button>
          )}
        </div>
      )}
      <div className="shrink-0 border-b border-neutral-100 p-2.5 dark:border-neutral-800/70">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Buscar conversa"
            className="field-input w-full pl-8"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadError && items === null ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-neutral-500">
            {loadError}
            <button type="button" className="btn-secondary text-xs" onClick={() => void load()}>
              Tentar de novo
            </button>
          </div>
        ) : items === null ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
              {search.trim() ? <Search className="h-4 w-4" /> : <Inbox className="h-4 w-4" />}
            </span>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {search.trim() ? "Nada encontrado" : EMPTY_STATE[tab].title}
            </p>
            <p className="mt-1 max-w-56 text-xs text-neutral-400 dark:text-neutral-500">
              {search.trim() ? "Tente outro nome ou número." : EMPTY_STATE[tab].description}
            </p>
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => select(item)}
              className={`flex w-full items-center gap-3 border-b border-l-2 border-neutral-100 px-3 py-3 text-left transition-colors dark:border-neutral-800/60 ${
                selected?.id === item.id
                  ? "border-l-brand bg-brand-light dark:border-l-brand dark:bg-brand-light"
                  : "border-l-transparent hover:bg-neutral-50 dark:border-l-transparent dark:hover:bg-neutral-900"
              }`}
            >
              <Avatar name={item.displayName} src={item.profilePicUrl} size="md" className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm text-neutral-900 dark:text-white ${item.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>
                    {item.displayName}
                  </span>
                  <span className="shrink-0 text-[11px] text-neutral-400">{formatWhen(item.lastMessageAt)}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-neutral-500">
                    {item.lastMessage?.direction === "OUTBOUND" ? "Enviada · " : ""}
                    {item.lastMessage ? messagePreview(item.lastMessage.body, item.lastMessage.type, "") : ""}
                  </span>
                  {item.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
                      {item.unreadCount}
                    </span>
                  )}
                </span>
                {(tab === "team" || tab === "closed") && item.assignee && (
                  <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-neutral-400">
                    <UserRound className="h-3 w-3 shrink-0" />
                    {item.assignee.name}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
        {loadError && items !== null && (
          <p className="p-2 text-center text-[11px] text-red-600 dark:text-red-400">Sem atualização: {loadError}</p>
        )}
      </div>
    </section>
  );

  const detail = selected ? (
    <div className="flex h-full min-h-0 flex-col bg-white px-3 py-2.5 dark:bg-neutral-950 sm:px-4 sm:py-3">
      <ThreadBar
        item={selected}
        currentUserId={currentUserId}
        canManageQueue={canManageQueue}
        assignableUsers={assignableUsers}
        busy={busy}
        error={actionError}
        onAssign={(assigneeId) => assign(selected, assigneeId)}
        onClose={() => close(selected)}
      />
      <ChatWindow
        key={selected.id}
        threadId={selected.id}
        // Cliente de outra pessoa: o atendente não tem acesso ao cadastro (nem
        // para etiquetar) — o chat fica só com a conversa.
        contactId={
          selected.contact && !(selected.contact.ownershipBlocked && selected.assignee?.id === currentUserId)
            ? selected.contact.id
            : null
        }
        contactName={selected.displayName}
        contactPhone={formatBrazilianPhone(selected.phoneNormalized) ?? selected.phoneNormalized}
        onClose={() => select(null)}
        onRenamed={(name) => {
          setSelected((current) => (current?.id === selected.id ? { ...current, displayName: name } : current));
          setItems((current) => current?.map((item) => (item.id === selected.id ? { ...item, displayName: name } : item)) ?? current);
        }}
        backMode={!desktop}
        className="min-h-0 flex-1"
        composerNotice={composerNoticeFor(selected, currentUserId, canManageQueue)}
      />
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center bg-white px-6 text-center dark:bg-neutral-950">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
        <MessageCircle className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Abra uma conversa</p>
      <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">Escolha um atendimento na lista.</p>
    </div>
  );

  return (
    <>
      <div className="h-full min-h-0 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {desktop ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
            {list}
            <div className="min-h-0 border-l border-neutral-200 dark:border-neutral-800">{detail}</div>
          </div>
        ) : (
          <div className="h-full min-h-0">{selected ? detail : list}</div>
        )}
      </div>
      {settingsOpen && (
        <CentralSettingsDialog
          onClose={() => {
            setSettingsOpen(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function centralStatus(central: CentralState | null): { label: string; dotClass: string } {
  if (central === "CONNECTED") return { label: "Central online", dotClass: "bg-emerald-500" };
  if (central === "CONNECTING") return { label: "Conectando", dotClass: "bg-amber-500" };
  if (central === "DISCONNECTED") return { label: "Central offline", dotClass: "bg-red-500" };
  if (central === "noPool") return { label: "Distribuição pendente", dotClass: "bg-amber-500" };
  if (central === "missing") return { label: "Não configurada", dotClass: "bg-neutral-400" };
  return { label: "Carregando", dotClass: "bg-neutral-300 dark:bg-neutral-700" };
}

function centralBanner(central: CentralState | null, isOwner: boolean): string | null {
  if (central === "missing") return isOwner ? "Central ainda não conectada." : "Central ainda não configurada pelo Dono.";
  if (central === "noPool") return "Sem distribuição: leads novos ficam na Fila.";
  if (central === "DISCONNECTED") return "Central desconectada: leads novos não estão chegando.";
  if (central === "CONNECTING") return "Central conectando…";
  return null;
}

/** Por que quem está vendo não pode digitar — null = pode responder. */
function composerNoticeFor(item: CentralItem, currentUserId: string, canManageQueue: boolean): string | null {
  const mine = item.assignee?.id === currentUserId;
  if (item.status === "CLOSED") return mine ? null : "Atendimento encerrado.";
  if (!item.assignee) return canManageQueue ? null : "Aguardando responsável.";
  // Só quem gerencia a fila pode transferir — pros outros a dica não serviria.
  if (!mine) return `Atendimento de ${item.assignee.name}.${canManageQueue ? " Transfira para você para responder." : ""}`;
  return null;
}

function ThreadBar({
  item,
  currentUserId,
  canManageQueue,
  assignableUsers,
  busy,
  error,
  onAssign,
  onClose,
}: {
  item: CentralItem;
  currentUserId: string;
  canManageQueue: boolean;
  assignableUsers: { id: string; name: string }[];
  busy: boolean;
  error: string | null;
  onAssign: (assigneeId: string) => void;
  onClose: () => void;
}) {
  const mine = item.assignee?.id === currentUserId;
  const open = item.status === "OPEN";
  const transferTargets = assignableUsers.filter((user) => user.id !== item.assignee?.id);
  const contact = item.contact;

  return (
    <div className="mb-2 shrink-0 space-y-1.5 border-b border-neutral-200 pb-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {!open
            ? `Encerrado${item.assignee ? ` · ${mine ? "você" : item.assignee.name}` : ""}`
            : item.assignee
              ? (mine ? "Com você" : `Com ${item.assignee.name}`)
              : "Sem responsável"}
        </span>
        {contact?.missingJobTitle && (
          // Sem link quando o cliente é de outra pessoa: o perfil não abriria para quem está atendendo.
          contact.ownershipBlocked ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              Sem cargo
            </span>
          ) : (
            <Link
              href={`/clientes/${contact.id}`}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:underline dark:bg-amber-500/15 dark:text-amber-300"
              title="Preencher o cargo do cliente"
            >
              Sem cargo · preencher
            </Link>
          )
        )}
        {contact?.ownershipBlocked && contact.responsible && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            Cliente de {contact.responsible.name}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {open && !item.assignee && canManageQueue && (
            <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => onAssign(currentUserId)}>
              <UserPlus className="h-3.5 w-3.5" /> Assumir
            </button>
          )}
          {canManageQueue && transferTargets.length > 0 && (
            <select
              className="field-input py-1 text-xs"
              value=""
              disabled={busy}
              onChange={(event) => event.target.value && onAssign(event.target.value)}
              aria-label="Transferir para"
            >
              <option value="">{open ? "Transferir…" : "Reabrir com…"}</option>
              {transferTargets.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.id === currentUserId ? "Para mim" : user.name}
                </option>
              ))}
            </select>
          )}
          {open && (mine || canManageQueue) && (
            <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={onClose} title="Encerra; reabre se o cliente escrever">
              <CheckCheck className="h-3.5 w-3.5" /> Concluir
            </button>
          )}
        </span>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
