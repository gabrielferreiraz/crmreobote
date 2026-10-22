"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, BriefcaseBusiness, MessageCircle, Search, WifiOff, X } from "lucide-react";
import { Select } from "@/components/select";
import { ChatWindow } from "@/components/whatsapp-chat";
import { QuickAddDealPanel } from "@/components/quick-add-deal-panel";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import { ConversationRow, TabSwitcher } from "./conversations-view";
import { useConversationsList, type Conversation, type NotificationPrefs } from "./use-conversations-list";

/**
 * Conversas no celular: nunca duas colunas ao mesmo tempo — ou a lista
 * ocupa a tela inteira, ou a conversa ocupa. Tocar num contato entra na
 * conversa; a seta de voltar (dentro do ChatWindow, via backMode) retorna
 * pra lista. Esse padrão mestre-detalhe é o que todo app de chat usa no
 * toque, porque duas colunas lado a lado não cabem numa tela de celular.
 *
 * Estado, atualização e filtros são os MESMOS do computador
 * (use-conversations-list.ts) — só a montagem da tela muda.
 */
export function ConversationsMobile({
  initialConversations,
  currentUserId,
  notificationPrefs: initialNotificationPrefs,
  whatsappConnected = true,
}: {
  initialConversations: Conversation[];
  currentUserId?: string;
  notificationPrefs?: NotificationPrefs;
  /** Sem WhatsApp próprio conectado: avisa no topo da lista (no computador o aviso fica na área do chat). */
  whatsappConnected?: boolean;
}) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const {
    selected,
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
  } = useConversationsList({ initialConversations, currentUserId, initialNotificationPrefs });

  function handleDealAdded(threadId: string, result: { contactId: string; deal: { id: string; name: string } }) {
    applyDealAdded(threadId, result);
    setQuickAddOpen(false);
  }

  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {/* As duas linhas abaixo NÃO são mais um "ou" — antes, ter negócio
            escondia por completo a opção de criar outro, e um cliente que já
            tinha negócio aberto ficava sem jeito de registrar uma NOVA venda
            pro mesmo cliente direto do WhatsApp (relatado: "cliente já tem
            negócio, mas quer dar ganho em outro"). "Ver negócio" só some
            quando de fato não existe nenhum (nada pra ver); "Novo negócio"/
            "Adicionar negócio" aparece sempre — o painel decide sozinho se
            precisa criar o Contact junto (ver existingContactId em
            QuickAddDealPanel).
            Rótulo usa `contactId` (existe Contact de verdade?), nunca
            `deal` — `selected.deal` só reflete negócio OPEN (ver
            listConversations em lib/whatsapp/conversations.ts, filtra
            status:"OPEN" de propósito). Cliente com negócio já
            Ganho/Perdido tem `deal: null` mas `contactId` preenchido — usar
            `deal` aqui mostrava "Adicionar negócio" de novo pra esse caso,
            exatamente o relato original. */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
          {selected.deal && (
            <Link
              href={`/negocios/${selected.deal.id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:active:bg-neutral-700"
            >
              <Briefcase className="h-3 w-3" strokeWidth={2} />
              Ver negócio: {selected.deal.name}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400"
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
          onClose={() => setSelectedThreadId(null)}
          onRenamed={(name) => renameConversation(selected.threadId, name)}
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
            existingContactId={selected.contactId ?? undefined}
            onCreated={(result) => handleDealAdded(selected.threadId, result)}
          />
        )}
      </div>
    );
  }

  return (
    // min-h-0: mesmo ajuste do desktop (ver conversations-view.tsx) — sem
    // isso a lista de conversas empurrava a tela inteira pra rolar junto.
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
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
      {!whatsappConnected && (
        <Link
          href="/configuracoes/perfil"
          className="flex shrink-0 items-center gap-2 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="flex-1">Seu WhatsApp está desconectado — não dá pra enviar nem receber.</span>
          <span className="font-semibold underline underline-offset-2">Reconectar</span>
        </Link>
      )}

      <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 p-2.5 dark:border-neutral-800/70">
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
              ? "border-brand bg-brand-light text-brand"
              : "border-neutral-300 bg-white text-neutral-500 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:active:bg-neutral-800"
          }`}
        >
          Não lidas{unreadConversationCount > 0 && ` · ${unreadConversationCount}`}
        </button>
      </div>

      {showOwnerInfo && (
        <div className="shrink-0 border-b border-neutral-100 p-2.5 dark:border-neutral-800/70">
          <Select
            value={ownerFilter}
            onChange={setOwnerFilter}
            className="w-full py-2 text-sm"
            options={[{ value: "", label: "Todos os responsáveis" }, ...ownerOptions]}
          />
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
          <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhuma conversa encontrada.</p>
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
              viewerId={currentUserId}
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
