"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Search, Briefcase, BriefcaseBusiness, X, Bell, BellOff, WifiOff, CheckSquare, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Select } from "@/components/select";
import { SelectionBar } from "@/components/selection-bar";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { ChatWindow, withViewTransition } from "@/components/whatsapp-chat";
import { QuickAddDealPanel } from "@/components/quick-add-deal-panel";
import { ContactInfoPanel } from "./contact-info-panel";
import { BulkSendConversationsDialog } from "@/components/bulk-send-conversations-dialog";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import { formatChatListTime } from "@/lib/whatsapp/format-time";
import { useConversationsList, type Conversation, type ConversationTab, type NotificationPrefs } from "./use-conversations-list";

// Tipos e regras da lista moram em use-conversations-list.ts (compartilhado com o celular).
export type { Conversation, ConversationTab, NotificationPrefs } from "./use-conversations-list";

const SIDEBAR_WIDTH_KEY = "wa-conversations-sidebar-width";
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 360;

/** Horário da lista — mesma régua (e fuso) de Atendimentos e do chat (lib/whatsapp/format-time.ts). */
export function formatWhen(value: string | Date): string {
  return formatChatListTime(value);
}

/** Abas "WhatsApp CRM" (vinculado a um Contact) / "WhatsApp Geral" (todo o resto) — compartilhado entre desktop e mobile. */
export function TabSwitcher({
  tab,
  onChange,
  counts,
  notificationPrefs,
  onToggleNotifications,
  whatsappConnected = true,
}: {
  tab: ConversationTab;
  onChange: (tab: ConversationTab) => void;
  counts: { crm: number; geral: number };
  /** Sem instância própria conectada não tem o que configurar — some o sino. */
  notificationPrefs?: NotificationPrefs;
  onToggleNotifications?: (tab: ConversationTab) => void;
  whatsappConnected?: boolean;
}) {
  const notifyEnabled =
    tab === "crm" ? notificationPrefs?.notifyOnCrmMessage : notificationPrefs?.notifyOnGeralMessage;

  return (
    <header className="shrink-0 border-b border-neutral-200 px-3 pt-3 pb-2.5 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Conversas</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span
              className={`h-1.5 w-1.5 rounded-full ${whatsappConnected ? "bg-emerald-500" : "bg-red-500"}`}
              aria-hidden="true"
            />
            {whatsappConnected ? "WhatsApp conectado" : "WhatsApp desconectado"}
          </p>
        </div>
        {notificationPrefs && onToggleNotifications && (
          <button
            type="button"
            onClick={() => onToggleNotifications(tab)}
            className={`icon-btn shrink-0 ${notifyEnabled ? "bg-brand-light text-brand" : ""}`}
            aria-label={notifyEnabled ? `Desativar notificações do ${tab === "crm" ? "CRM" : "Geral"}` : `Ativar notificações do ${tab === "crm" ? "CRM" : "Geral"}`}
            title={notifyEnabled ? "Notificações ativadas" : "Notificações desativadas"}
          >
            {notifyEnabled ? (
              <Bell className="h-4 w-4" strokeWidth={2} />
            ) : (
              <BellOff className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-900" role="tablist" aria-label="Tipo de conversa">
        {(
          [
            { value: "crm" as const, label: "WhatsApp CRM" },
            { value: "geral" as const, label: "WhatsApp Geral" },
          ]
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={tab === opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-2 text-xs font-medium transition-colors ${
              tab === opt.value
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            <span className="truncate">{opt.label}</span>
            {counts[opt.value] > 0 && (
              <span
                className={`shrink-0 rounded-full px-1 text-[10px] font-semibold leading-4 ${
                  tab === opt.value
                    ? "bg-brand text-white"
                    : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                }`}
              >
                {counts[opt.value] > 999 ? "999+" : counts[opt.value]}
              </span>
            )}
          </button>
        ))}
      </div>
    </header>
  );
}

export function ConversationsView({
  initialConversations,
  currentUserId,
  notificationPrefs: initialNotificationPrefs,
  whatsappConnected = true,
}: {
  initialConversations: Conversation[];
  currentUserId?: string;
  notificationPrefs?: NotificationPrefs;
  /** Sem instância própria conectada, o chat avisa isso no lugar do "Selecione uma conversa". */
  whatsappConnected?: boolean;
}) {
  const router = useRouter();
  // Multi-seleção — só na aba "crm", só conversas do próprio usuário.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const {
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
  } = useConversationsList({
    initialConversations,
    currentUserId,
    initialNotificationPrefs,
    onTabChange: () => {
      setSelectMode(false);
      setSelectedThreadIds(new Set());
    },
  });

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
        if (saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) setSidebarWidth(saved);
      } catch {
        // localStorage indisponível (modo privado etc.) — mantém a largura padrão.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function startSidebarResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setSidebarWidth(next);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth((w) => {
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        } catch {
          // localStorage indisponível — só não persiste, sem quebrar o resize.
        }
        return w;
      });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function selectConversation(threadId: string) {
    if (threadId === selectedThreadId) return;
    withViewTransition(() => setSelectedThreadId(threadId));
  }

  function toggleThreadSelection(threadId: string) {
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function handleDealAdded(threadId: string, result: { contactId: string; deal: { id: string; name: string } }) {
    applyDealAdded(threadId, result);
    setQuickAddOpen(false);
  }

  return (
    <div className="hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:flex">
      {/* min-h-0: sem isso, a coluna crescia pro tamanho da lista de
          conversas inteira em vez de ficar presa à altura da tela — a
          página inteira acabava rolando junto (mesmo ajuste já feito em
          pipeline-view.tsx/processes-view.tsx). Só a lista (overflow-y-auto
          abaixo) deve rolar, nunca a tela toda. */}
      <div className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-white dark:bg-neutral-950" style={{ width: sidebarWidth }}>
        <TabSwitcher
          tab={tab}
          onChange={changeTab}
          counts={tabCounts}
          notificationPrefs={notificationPrefs}
          onToggleNotifications={toggleNotifications}
          whatsappConnected={whatsappConnected}
        />

        {notificationError && (
          <p className="shrink-0 bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {notificationError}
          </p>
        )}

        <div className="shrink-0 border-b border-neutral-100 p-2.5 dark:border-neutral-800/70">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa"
              className="field-input py-2 pr-8 pl-9 text-sm"
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
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyUnread((v) => !v)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                onlyUnread
                  ? "border-brand bg-brand-light text-brand"
                  : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
              }`}
              title="Mostrar só não lidas"
            >
              Não lidas{unreadConversationCount > 0 && ` · ${unreadConversationCount}`}
            </button>
            {/* Botão "Selecionar" — só na aba CRM e quando conectado. */}
            {tab === "crm" && whatsappConnected && (
              <button
                type="button"
                onClick={() => {
                  setSelectMode((v) => !v);
                  setSelectedThreadIds(new Set());
                }}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectMode
                    ? "border-neutral-800 bg-neutral-800 text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
                }`}
                title={selectMode ? "Cancelar seleção" : "Selecionar conversas para envio em massa"}
              >
                {selectMode ? "Cancelar" : "Selecionar"}
              </button>
            )}
          </div>
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

        {/* min-h-0: era o último elo faltando — sem ele, essa lista crescia pro
            tamanho de TODAS as conversas em vez de ficar presa aqui dentro e
            rolar sozinha, vazando a barra de rolagem pra página inteira
            (ver comentário mais detalhado no início do componente). */}
        {/* SelectionBar + botão "Selecionar todas" — flutua sobre a lista. */}
        {selectMode && (
          <div className="shrink-0 space-y-1.5 px-1.5 pb-1.5">
            {selectedThreadIds.size > 0 ? (
              <SelectionBar
                count={selectedThreadIds.size}
                onClear={() => setSelectedThreadIds(new Set())}
              >
                <button
                  type="button"
                  onClick={() => setBulkSendOpen(true)}
                  className="btn-primary py-0.5 text-xs"
                >
                  Enviar em massa
                </button>
              </SelectionBar>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  // Marca todas as visíveis do próprio usuário de uma só vez.
                  const eligible = filteredConversations
                    .filter((c) => c.ownerId === currentUserId)
                    .map((c) => c.threadId);
                  setSelectedThreadIds(new Set(eligible));
                }}
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <CheckSquare className="h-3 w-3" strokeWidth={2} />
                Selecionar todas as visíveis
              </button>
              {/* Só faz sentido explicar a regra quando dá pra ver conversa de
                  mais de um responsável (dono/gerente) — pra quem só vê as
                  próprias, toda linha já é selecionável, não há o que avisar. */}
              {showOwnerInfo && (
                <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                  Só suas próprias conversas
                </span>
              )}
            </div>
          </div>
        )}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {tabConversations.length === 0 ? (
            <div className="flex h-full min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
                <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nenhuma conversa ainda</p>
              <p className="mt-1 max-w-56 text-xs text-neutral-400 dark:text-neutral-500">
                {tab === "crm"
                  ? "Os contatos do CRM aparecem aqui."
                  : "Os números ainda não cadastrados aparecem aqui."}
              </p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
              Nenhuma conversa encontrada.
            </p>
          ) : groupedConversations ? (
            groupedConversations.map((group) => (
              <div key={group.ownerId}>
                <p className="sticky top-0 z-10 truncate border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500">
                  {group.ownerId === currentUserId ? "Você" : group.ownerName}
                </p>
                {group.items.map((c) => (
                  <ConversationRow
                    key={c.threadId}
                    conversation={c}
                    viewerId={currentUserId}
                    isActive={c.threadId === selectedThreadId}
                    justArrived={justArrived.has(c.threadId)}
                    isCurrentUser={c.ownerId === currentUserId}
                    selectMode={selectMode}
                    selected={selectedThreadIds.has(c.threadId)}
                    onToggleSelect={() => toggleThreadSelection(c.threadId)}
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
                viewerId={currentUserId}
                isActive={c.threadId === selectedThreadId}
                showOwner={showOwnerInfo}
                isCurrentUser={c.ownerId === currentUserId}
                justArrived={justArrived.has(c.threadId)}
                selectMode={selectMode}
                selected={selectedThreadIds.has(c.threadId)}
                onToggleSelect={() => toggleThreadSelection(c.threadId)}
                onSelect={() => selectConversation(c.threadId)}
              />
            ))
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar lista de conversas"
        onMouseDown={startSidebarResize}
        onDoubleClick={() => {
          setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
          try {
            localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT_WIDTH));
          } catch {
            // localStorage indisponível — só não persiste o reset.
          }
        }}
        title="Arraste pra redimensionar · duplo clique pra restaurar"
        className="relative z-10 flex w-px shrink-0 cursor-col-resize items-center justify-center bg-neutral-200 before:absolute before:inset-y-0 before:-left-2 before:-right-2 hover:bg-neutral-400 active:bg-neutral-500 dark:bg-neutral-800 dark:hover:bg-neutral-600 dark:active:bg-neutral-500"
      >
        <span className="sr-only">Redimensionar lista</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-neutral-950">
        {selected ? (
          <div className="flex h-full flex-col p-3">
            {/* Não é mais um "ou" — ver comentário equivalente em
                conversations-view-mobile.tsx (mesmo pedido: cliente já tinha
                negócio, mas o consultor queria registrar OUTRA venda pro
                mesmo cliente sem sair do WhatsApp).
                Rótulo do botão de criar usa `contactId` (existe um Contact
                de verdade?), NUNCA `deal` — `selected.deal` só reflete
                negócio OPEN (ver listConversations em
                lib/whatsapp/conversations.ts, filtra status:"OPEN" de
                propósito, é só o atalho pra negociação ATIVA). Cliente com
                negócio já Ganho/Perdido tem `deal: null` mas `contactId`
                preenchido — usar `deal` aqui mostrava "Adicionar negócio"
                de novo pra esse caso, exatamente o relato original (negócio
                já fechado, sem indicação nenhuma de que dava pra criar
                outro). */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {selected.deal && (
                <Link
                  href={`/negocios/${selected.deal.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                >
                  <Briefcase className="h-3 w-3" strokeWidth={2} />
                  Ver negócio: {selected.deal.name}
                </Link>
              )}
              <button
                type="button"
                onClick={() => setQuickAddOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <BriefcaseBusiness className="h-3 w-3" strokeWidth={2} />
                {selected.contactId ? "Novo negócio" : "Adicionar negócio"}
              </button>
            </div>
            <ChatWindow
              key={selected.threadId}
              threadId={selected.threadId}
              contactId={selected.contactId}
              contactName={selected.displayName}
              contactPhone={formatBrazilianPhone(selected.phoneNormalized)}
              onClose={() => withViewTransition(() => setSelectedThreadId(null))}
              onRenamed={(name) => renameConversation(selected.threadId, name)}
              className="min-h-0 flex-1"
            />

            {quickAddOpen && (
              <QuickAddDealPanel
                onClose={() => setQuickAddOpen(false)}
                suggestedName={selected.whatsappName ?? ""}
                phoneFormatted={formatBrazilianPhone(selected.phoneNormalized) ?? selected.phoneNormalized}
                ownerId={selected.ownerId}
                ownerName={selected.ownerName}
                existingContactId={selected.contactId ?? undefined}
                onCreated={(result) => handleDealAdded(selected.threadId, result)}
              />
            )}
          </div>
        ) : !whatsappConnected ? (
          <div className="flex h-full flex-col items-center justify-center bg-white px-6 text-center dark:bg-neutral-950">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400">
              <WifiOff className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">WhatsApp desconectado</p>
            <p className="mt-1 max-w-sm text-xs text-neutral-400 dark:text-neutral-500">
              Reconecte para enviar e receber mensagens.
            </p>
            <Link href="/configuracoes/perfil" className="btn-secondary mt-4 text-xs">
              Reconectar
            </Link>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-white px-6 text-center dark:bg-neutral-950">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
              <MessageCircle className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Abra uma conversa</p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">Escolha um contato na lista.</p>
          </div>
        )}
      </div>

      {/* Painel "Informações" (ver contact-info-panel.tsx) — só quando a
          conversa já está vinculada a um Contact de verdade (threads
          "Geral", ainda não vinculados, não têm o que mostrar aqui). key
          reseta o componente ao trocar de conversa, senão o painel antigo
          ficava visível por um instante com o contato errado enquanto o
          novo fetch ainda não tinha voltado. */}
      {selected?.contactId && (
        <ContactInfoPanel key={selected.contactId} contactId={selected.contactId} whatsappConnected={whatsappConnected} />
      )}

      {bulkSendOpen && (
        <BulkSendConversationsDialog
          recipients={filteredConversations
            .filter((c) => selectedThreadIds.has(c.threadId) && c.contactId)
            .map((c) => ({ contactId: c.contactId!, dealId: c.deal?.id ?? null }))}
          onClose={() => setBulkSendOpen(false)}
          onSent={() => {
            setBulkSendOpen(false);
            setSelectMode(false);
            setSelectedThreadIds(new Set());
          }}
          onCreateScript={() => router.push(`/whatsapp/scripts/novo?returnTo=${encodeURIComponent("/whatsapp/conversas")}`)}
        />
      )}
    </div>
  );
}

/**
 * Uma linha da lista de conversas — usada tanto aqui (desktop) quanto no
 * mestre-detalhe do mobile (conversations-view-mobile.tsx), pra não duplicar
 * essa marcação bem detalhada em dois lugares.
 */
/**
 * "Você: " só quando foi quem está vendo que mandou a última mensagem. Pra
 * dono/gerente olhando a conversa de um consultor, mostra o nome de quem
 * mandou — antes toda mensagem enviada aparecia como "Você:", mesmo sendo
 * de outra pessoa.
 */
function outboundPrefix(c: Conversation, viewerId: string | undefined): string {
  if (c.lastMessageDirection !== "OUTBOUND") return "";
  const from = c.lastMessageFrom;
  if (!from || !viewerId || from.id === viewerId) return "Você: ";
  const firstName = from.name.trim().split(/\s+/)[0];
  return firstName ? `${firstName}: ` : "";
}

export function ConversationRow({
  conversation: c,
  viewerId,
  isActive,
  showOwner,
  isCurrentUser,
  justArrived,
  selectMode,
  selected,
  onToggleSelect,
  onSelect,
}: {
  conversation: Conversation;
  /** Quem está vendo a lista — decide o "Você:" da prévia. */
  viewerId?: string;
  isActive: boolean;
  showOwner?: boolean;
  isCurrentUser?: boolean;
  justArrived?: boolean;
  /** Modo de seleção em massa ativo — revela checkboxes. */
  selectMode?: boolean;
  /** Esta linha está selecionada. */
  selected?: boolean;
  /** Chamado quando o usuário clica no checkbox desta linha. */
  onToggleSelect?: () => void;
  onSelect: () => void;
}) {
  const unread = c.unreadCount > 0;

  const canSelect = selectMode && isCurrentUser && !!onToggleSelect;

  return (
    <div
      className={`relative flex items-stretch border-b border-neutral-100 transition-colors dark:border-neutral-800/60 ${
        selected ? "bg-brand-light" : ""
      }`}
    >
      {/* Checkbox — irmão do botão, nunca dentro dele. A coluna aparece pra
          TODA linha durante selectMode (mesmo alinhamento pra lista
          inteira); só é clicável nas conversas do próprio usuário — nas
          demais mostra um quadrado apagado, deixando claro que a linha
          existe mas não pode ser marcada (em vez de sumir sem explicação). */}
      {selectMode && (
        canSelect ? (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={selected ? "Desmarcar conversa" : "Selecionar conversa"}
            aria-pressed={selected}
            className="flex w-9 shrink-0 items-center justify-center transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-brand" strokeWidth={2} />
            ) : (
              <Square className="h-4 w-4 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
            )}
          </button>
        ) : (
          <span
            title="Só é possível enviar mensagem em massa pelas suas próprias conversas"
            className="flex w-9 shrink-0 cursor-not-allowed items-center justify-center"
          >
            <Square className="h-4 w-4 text-neutral-200 dark:text-neutral-800" strokeWidth={2} />
          </span>
        )
      )}
      <button
        type="button"
        onClick={canSelect ? onToggleSelect : onSelect}
        className={`flex min-w-0 flex-1 items-start gap-3 border-l-2 px-3 py-3 text-left transition-colors ${
          isActive
            ? "border-l-brand bg-brand-light dark:border-l-brand dark:bg-brand-light"
            : "border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-900"
        } ${justArrived ? "animate-highlight-once" : ""}`}
      >
        <div className="group relative mt-0.5 shrink-0">
          <Avatar
            name={c.displayName}
            src={c.profilePicUrl}
            size="sm"
            className="transition-shadow group-hover:ring-2 group-hover:ring-brand/30 group-hover:ring-offset-1 group-hover:ring-offset-transparent dark:group-hover:ring-brand/50"
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
              {outboundPrefix(c, viewerId)}
              {c.lastMessagePreview}
            </p>
            {unread && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">
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
    </div>
  );
}
