"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, Loader2, Users } from "lucide-react";
import { Select } from "@/components/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { requestJson } from "@/lib/client-request";
import { trackUse } from "@/lib/feature-usage/track";
import { formatCurrency } from "@/lib/format";

type MemberOption = { id: string; name: string; email: string };
type OriginOption = MemberOption & { active: boolean };

type PortfolioContact = { id: string; name: string; phone: string | null; whatsapp: string | null };
type PortfolioDeal = {
  id: string;
  name: string;
  value: string | number | null;
  contactId: string;
  stageName: string;
  pipelineName: string;
};

/**
 * "Passar carteira de clientes" — pensado pro consultor que saiu: escolhe de
 * quem e pra quem, marca os clientes (e, se quiser, os negócios em andamento
 * deles) e transfere tudo de uma vez. Marcar só o cliente não mexe na
 * Pipeline da pessoa nova; marcar um negócio exige o próprio cliente junto
 * (o próprio checkbox já garante isso, ver toggleDeal). Tarefas e andamentos
 * dos negócios transferidos seguem junto — ver POST .../portfolio no
 * servidor pra regra completa.
 */
export function PortfolioTransferManager({
  fromCandidates,
  toCandidates,
  preselectFromUserId,
}: {
  /** Inclui gente DESATIVADA de propósito — o caso de uso real é o
   * consultor que já saiu (e já foi desativado) antes de alguém lembrar de
   * passar a carteira dele adiante. */
  fromCandidates: OriginOption[];
  /** Só gente ativa — não faz sentido receber carteira quem não acessa mais o CRM. */
  toCandidates: MemberOption[];
  /** ?from=<userId> — vindo do atalho de "Desativar" em Configurações →
   * Usuários (ver members-table.tsx). Só preseleciona se bater com um dos
   * candidatos já autorizados pelo escopo de quem está vendo a tela. */
  preselectFromUserId?: string;
}) {
  const [fromUserId, setFromUserId] = useState(() =>
    preselectFromUserId && fromCandidates.some((m) => m.id === preselectFromUserId) ? preselectFromUserId : "",
  );
  const [toUserId, setToUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [contacts, setContacts] = useState<PortfolioContact[]>([]);
  const [deals, setDeals] = useState<PortfolioDeal[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const dealsByContact = new Map<string, PortfolioDeal[]>();
  for (const deal of deals) {
    const list = dealsByContact.get(deal.contactId) ?? [];
    list.push(deal);
    dealsByContact.set(deal.contactId, list);
  }

  async function loadPortfolio(idOverride?: string) {
    const id = idOverride ?? fromUserId;
    if (!id) return;
    setLoading(true);
    setLoaded(false);
    setResult(null);
    const res = await requestJson<{ contacts: PortfolioContact[]; deals: PortfolioDeal[] }>(
      `/api/org/members/${id}/portfolio`,
    );
    setLoading(false);
    if (!res.ok) return;
    setContacts(res.data.contacts);
    setDeals(res.data.deals);
    setSelectedContactIds(new Set());
    setSelectedDealIds(new Set());
    setLoaded(true);
  }

  // Veio do atalho "Passar carteira" ao desativar alguém (ver members-table.tsx)
  // — preseleciona e já carrega, só roda uma vez.
  useEffect(() => {
    if (!preselectFromUserId) return;
    if (!fromCandidates.some((m) => m.id === preselectFromUserId)) return;
    // setTimeout (não chamar direto): loadPortfolio começa com setState
    // síncrono, e chamar isso direto no corpo do efeito é o que o linter
    // (react-hooks/set-state-in-effect) está de olho — empurrar pra depois
    // de um tick deixa claro que é uma reação assíncrona, não uma cascata.
    const id = setTimeout(() => loadPortfolio(preselectFromUserId), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectFromUserId]);

  function toggleContact(contactId: string) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
        // Tirou o cliente: os negócios dele saem junto (negócio nunca viaja sem o cliente).
        setSelectedDealIds((prevDeals) => {
          const nextDeals = new Set(prevDeals);
          for (const deal of dealsByContact.get(contactId) ?? []) nextDeals.delete(deal.id);
          return nextDeals;
        });
      } else {
        next.add(contactId);
      }
      return next;
    });
  }

  function toggleDeal(deal: PortfolioDeal) {
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(deal.id)) {
        next.delete(deal.id);
      } else {
        next.add(deal.id);
        // Marcar o negócio marca o cliente dele automaticamente — pedido
        // explícito: negócio nunca vai sem o próprio cliente junto.
        setSelectedContactIds((prevContacts) => {
          if (prevContacts.has(deal.contactId)) return prevContacts;
          const nextContacts = new Set(prevContacts);
          nextContacts.add(deal.contactId);
          return nextContacts;
        });
      }
      return next;
    });
  }

  function selectAllContacts() {
    setSelectedContactIds(new Set(contacts.map((c) => c.id)));
  }

  function clearSelection() {
    setSelectedContactIds(new Set());
    setSelectedDealIds(new Set());
  }

  async function confirmTransfer() {
    setConfirmError(null);
    const res = await requestJson<{
      contactsTransferred: number;
      dealsTransferred: number;
    }>(`/api/org/members/${fromUserId}/portfolio`, {
      method: "POST",
      json: { toUserId, contactIds: Array.from(selectedContactIds), dealIds: Array.from(selectedDealIds) },
    });
    if (!res.ok) {
      setConfirmError(res.error);
      return;
    }
    trackUse("equipes.carteira.transferir");
    setConfirming(false);
    setResult(
      `${res.data.contactsTransferred} ${res.data.contactsTransferred === 1 ? "cliente transferido" : "clientes transferidos"}` +
        (res.data.dealsTransferred > 0
          ? ` e ${res.data.dealsTransferred} ${res.data.dealsTransferred === 1 ? "negócio" : "negócios"} pra Pipeline nova`
          : ""),
    );
    loadPortfolio();
  }

  const fromOptions = fromCandidates.filter((m) => m.id !== toUserId);
  const toOptions = toCandidates.filter((m) => m.id !== fromUserId);
  const fromName = fromCandidates.find((m) => m.id === fromUserId)?.name ?? "";
  const toName = toCandidates.find((m) => m.id === toUserId)?.name ?? "";
  const canTransfer = loaded && toUserId && selectedContactIds.size > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Passar carteira de clientes
        </h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Pra quando um consultor sai: escolha de quem e pra quem, marque os clientes (e, se quiser, os negócios em
          andamento deles — tarefas e andamentos vão junto) e transfira tudo de uma vez.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">De</p>
          <Select
            value={fromUserId}
            onChange={(v) => {
              setFromUserId(v);
              setLoaded(false);
              setContacts([]);
              setDeals([]);
              clearSelection();
              setResult(null);
            }}
            placeholder="Consultor que está saindo"
            options={fromOptions.map((m) => ({ value: m.id, label: m.active ? m.name : `${m.name} (inativo)` }))}
          />
        </div>
        <ArrowRightLeft className="mx-auto hidden h-4 w-4 shrink-0 text-neutral-400 sm:block" strokeWidth={2} />
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">Para</p>
          <Select
            value={toUserId}
            onChange={setToUserId}
            placeholder="Quem vai receber"
            options={toOptions.map((m) => ({ value: m.id, label: m.name }))}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => loadPortfolio()}
        disabled={!fromUserId || loading}
        className="btn-secondary"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Users className="h-4 w-4" strokeWidth={2} />}
        Carregar carteira
      </button>

      {result && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
          {result}
        </p>
      )}

      {loaded && (
        <div className="card space-y-3 p-4">
          {contacts.length === 0 ? (
            <EmptyState icon={Users} title="Sem carteira" description="Esta pessoa não tem clientes no nome dela." />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {contacts.length} {contacts.length === 1 ? "cliente" : "clientes"} · {deals.length}{" "}
                  {deals.length === 1 ? "negócio em andamento" : "negócios em andamento"}
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={selectAllContacts} className="text-xs font-medium text-brand hover:underline">
                    Selecionar todos
                  </button>
                  <button type="button" onClick={clearSelection} className="text-xs font-medium text-neutral-400 hover:underline dark:text-neutral-500">
                    Limpar
                  </button>
                </div>
              </div>

              <div className="scrollbar-thin max-h-96 space-y-1 overflow-y-auto">
                {contacts.map((contact) => {
                  const contactDeals = dealsByContact.get(contact.id) ?? [];
                  const contactSelected = selectedContactIds.has(contact.id);
                  return (
                    <div key={contact.id} className="rounded-md border border-neutral-100 px-2.5 py-2 dark:border-neutral-800">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={contactSelected}
                          onChange={() => toggleContact(contact.id)}
                          className="h-4 w-4 shrink-0 rounded border-neutral-300 text-brand focus:ring-brand dark:border-neutral-600"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-neutral-800 dark:text-neutral-200">
                          {contact.name}
                        </span>
                        {(contact.whatsapp ?? contact.phone) && (
                          <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                            {contact.whatsapp ?? contact.phone}
                          </span>
                        )}
                      </label>

                      {contactDeals.length > 0 && (
                        <div className="mt-1.5 ml-6 space-y-1 border-l border-neutral-100 pl-3 dark:border-neutral-800">
                          {contactDeals.map((deal) => (
                            <label key={deal.id} className="flex cursor-pointer items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={selectedDealIds.has(deal.id)}
                                onChange={() => toggleDeal(deal)}
                                className="h-3.5 w-3.5 shrink-0 rounded border-neutral-300 text-brand focus:ring-brand dark:border-neutral-600"
                              />
                              <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-400">
                                {deal.name} · {deal.pipelineName} / {deal.stageName}
                              </span>
                              <span className="shrink-0 tabular-nums text-neutral-400 dark:text-neutral-500">
                                {formatCurrency(deal.value)}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {selectedContactIds.size} {selectedContactIds.size === 1 ? "cliente selecionado" : "clientes selecionados"}
                  {selectedDealIds.size > 0 &&
                    ` · ${selectedDealIds.size} ${selectedDealIds.size === 1 ? "negócio" : "negócios"} pra Pipeline`}
                </p>
                <button
                  type="button"
                  disabled={!canTransfer}
                  onClick={() => setConfirming(true)}
                  className="btn-primary"
                >
                  <ArrowRightLeft className="h-4 w-4" strokeWidth={2} />
                  Transferir
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Transferir carteira de ${fromName} para ${toName}?`}
          description={
            `${selectedContactIds.size} ${selectedContactIds.size === 1 ? "cliente" : "clientes"}` +
            (selectedDealIds.size > 0
              ? ` e ${selectedDealIds.size} ${selectedDealIds.size === 1 ? "negócio vai" : "negócios vão"} junto pra Pipeline de ${toName} (com tarefas e andamentos).`
              : " — sem negócio selecionado, nada muda na Pipeline.")
          }
          error={confirmError}
          confirmLabel="Transferir"
          onConfirm={confirmTransfer}
          onClose={() => {
            setConfirming(false);
            setConfirmError(null);
          }}
        />
      )}
    </div>
  );
}
