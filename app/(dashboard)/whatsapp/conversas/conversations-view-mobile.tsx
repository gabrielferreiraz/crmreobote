"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, BriefcaseBusiness, MessageCircle, Search, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { ChatWindow } from "@/components/whatsapp-chat";
import { QuickAddDealPanel } from "@/components/quick-add-deal-panel";
import { formatBrazilianPhone } from "@/lib/phone-normalize";
import { useSearchParams } from "next/navigation";
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
  currentUserId,
  notificationPrefs: initialNotificationPrefs,
}: {
  initialConversations: Conversation[];
  currentUserId?: string;
  notificationPrefs?: NotificationPrefs;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const searchParams = useSearchParams();
  const paramThreadId = searchParams?.get("threadId");
  const paramContactId = searchParams?.get("contactId");

  const initialSelectedId = useMemo(() => {
    if (paramThreadId) return paramThreadId;
    if (paramContactId) {
      const found = conversations.find((c) => c.contactId === paramContactId);
      if (found) return found.threadId;
    }
    return null;
  }, [paramThreadId, paramContactId, conversations]);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialSelectedId);

  useEffect(() => {
    if (initialSelectedId) {
      setSelectedThreadId(initialSelectedId);
    }
  }, [initialSelectedId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedThreadId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [tab, setTab] = useState<ConversationTab>(() => {
    if (paramContactId) return "crm";
    if (paramThreadId) {
      const found = conversations.find((c) => c.threadId === paramThreadId);
      return found?.contactId ? "crm" : "geral";
    }
    return "crm";
  });
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
    // "Você" sempre em primeiro, o resto por ordem alfabética.
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => {
      if (a.value === currentUserId) return -1;
      if (b.value === currentUserId) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [tabConversations, currentUserId]);
  const showOwnerInfo = ownerOptions.length > 1;

  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tabConversations.filter((c) => {
      if (onlyUnread && c.unreadCount === 0) return false;
      // Ver comentário equivalente em conversations-view.tsx (desktop).
      if (ownerFilter && !c.senderIds.includes(ownerFilter)) return false;
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

  // Reserva a altura real do menu inferior do celular (#mobile-bottom-nav,
  // ver mobile-nav.tsx) quando uma conversa está aberta — ele é
  // `position:fixed`, fica POR CIMA do conteúdo em vez de empurrá-lo
  // (não entra no fluxo normal), então h-full/flex-1 sozinhos não sabem que
  // aquela faixa de baixo está coberta (mesmo ajuste já feito na fileira do
  // Kanban, ver kanban-board.tsx). Sem isso, a caixa "Digite uma mensagem"
  // do ChatWindow ficava atrás do menu, inalcançável (relatado com print).
  // Em telas lg+ o menu some (lg:hidden) e getBoundingClientRect já retorna
  // altura 0 sozinho, sem precisar de tratamento especial aqui.
  const [bottomNavHeight, setBottomNavHeight] = useState(0);
  useLayoutEffect(() => {
    function measure() {
      const nav = document.getElementById("mobile-bottom-nav");
      setBottomNavHeight(nav ? nav.getBoundingClientRect().height : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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
      <div className="flex h-full flex-col" style={{ paddingBottom: bottomNavHeight }}>
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
        <div className="mx-3 mt-2 mb-1 flex flex-wrap items-center gap-1.5">
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
          onRenamed={(name) =>
            setConversations((prev) =>
              prev.map((c) => (c.threadId === selected.threadId ? { ...c, displayName: name } : c)),
            )
          }
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
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
              ? "border-transparent bg-brand text-white"
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

      {/* pb-24, não pb-4: esse componente só existe em telas lg:hidden (só
          celular, ver conversas/page.tsx), onde a barra de navegação
          inferior é fixa e fica por cima do conteúdo — pb-4 não bastava pra
          limpar a altura real dela, e as últimas conversas ficavam
          escondidas atrás mesmo rolando até o fim (mesmo ajuste em
          deals-list.tsx/process-list.tsx). */}
      <div className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-24">
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
