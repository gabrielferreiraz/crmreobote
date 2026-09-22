"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Inbox, Trash2, AlertCircle, Briefcase, UserCheck, ChevronRight } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatCurrency } from "@/lib/format";
import { useUndoToast } from "@/components/undo-provider";
import { CreateDealForContactDialog, type CreatedDeal } from "./create-deal-for-contact-dialog";

// O chat (com QR/mídia/áudio) só monta quando o cliente tem WhatsApp
// vinculado (ver `whatsapp &&` abaixo) — sem next/dynamic, o componente
// inteiro ia pro bundle desta página mesmo pra clientes sem WhatsApp.
const WhatsAppChat = dynamic(() => import("@/components/whatsapp-chat").then((m) => m.WhatsAppChat), { ssr: false });

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

type Deal = {
  id: string;
  name: string;
  status: "OPEN" | "WON" | "LOST";
  value: number | null;
  stageName: string;
  stageColor: string | null;
};
type InfoRow = { label: string; value: string };
type WhatsAppInfo = {
  threadId: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  sendAsAlternate?: { threadId: string; label: string; defaultLabel: string } | null;
};

type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };
type MemberOption = { id: string; name: string };
type CreditTypeOption = { id: string; label: string };

/**
 * Negócios e Dados de contato viviam lado a lado num grid 2/3 + 1/3 — numa
 * página que é, na prática, quase só isso, virava muita informação disputando
 * espaço ao mesmo tempo. Abas rápidas (troca local, sem navegação) separam
 * as duas visões sem perder a rapidez de alternar entre elas.
 */
export function ContactTabs({
  contactId,
  contactName,
  deals: initialDeals,
  infoRows,
  addressLines,
  tags,
  whatsapp,
  pipelines,
  members,
  creditTypes,
  canDeleteDeals,
  canDeleteContact,
}: {
  contactId: string;
  contactName: string;
  deals: Deal[];
  infoRows: InfoRow[];
  addressLines: string | null;
  tags: string[];
  whatsapp: WhatsAppInfo | null;
  pipelines: PipelineOption[];
  members: MemberOption[];
  creditTypes: CreditTypeOption[];
  /** Só Dono/Gerente — mesmo critério de canBulkDelete em pipeline/page.tsx (apagar negócio é destrutivo, não liberado pra todo mundo que só CONSEGUE ver o negócio). */
  canDeleteDeals: boolean;
  /** Idem, pro contato inteiro — ver app/api/contacts/[id]/route.ts. */
  canDeleteContact: boolean;
}) {
  const router = useRouter();
  const pushUndoToast = useUndoToast();
  const [tab, setTab] = useState<"deals" | "info">("deals");
  // Estado local (semeado do server, ver `deals: initialDeals` acima) — cria/
  // apaga aqui reflete na hora, sem esperar um refresh de página inteiro.
  const [deals, setDeals] = useState(initialDeals);
  // Resincroniza quando o server manda uma lista nova — necessário pro
  // Ctrl+Z (ver components/undo-provider.tsx): desfazer uma exclusão aqui
  // dispara router.refresh() de outro lugar (o aviso flutuante), e sem
  // isso o negócio restaurado só voltava a aparecer num F5 de verdade,
  // mesmo já restaurado no banco. Mesmo padrão de kanban-board.tsx.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeals(initialDeals);
  }, [initialDeals]);
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteContactOpen, setDeleteContactOpen] = useState(false);
  const [deleteContactError, setDeleteContactError] = useState<string | null>(null);

  // ConfirmDialog já mostra o próprio estado de "carregando" enquanto essa
  // Promise não resolve (ver components/confirm-dialog.tsx) — não precisa
  // de um segundo state de loading duplicado aqui. Fecha o diálogo nos dois
  // casos (mesmo padrão do bulk-delete em pipeline/deals-list.tsx) — falha
  // vira uma mensagem discreta na lista, não trava o diálogo aberto.
  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleteError(null);
    const res = await fetch(`/api/deals/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeals((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      pushUndoToast(data.undo);
    } else {
      setDeleteError("Não foi possível apagar esse negócio.");
    }
    setDeleteTarget(null);
  }

  // Apaga o CONTATO inteiro — diferente do negócio, sai desta página de
  // volta pra lista (o contato deixou de existir, não tem mais o que
  // mostrar aqui). Postgres barra com FK (P2003 → 409, ver a rota) se ainda
  // sobrar negócio vinculado; o botão já fica desabilitado nesse caso (ver
  // JSX abaixo), então só chega aqui uma mensagem de erro em caso de
  // corrida rara (2 abas abertas, negócio criado em outra aba etc.).
  async function handleDeleteContactConfirmed() {
    setDeleteContactError(null);
    const res = await fetch(`/api/contacts/${contactId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // Empurra o aviso ANTES de navegar — o UndoProvider vive no layout do
      // dashboard (nunca desmonta entre páginas), então continua na tela
      // mesmo depois do push pra /clientes.
      pushUndoToast(data.undo);
      router.push("/clientes");
      return;
    }
    setDeleteContactError(data.error ?? "Não foi possível apagar esse contato.");
    setDeleteContactOpen(false);
  }

  return (
    <div>
      <div className="relative mb-5 flex w-full max-w-[340px] rounded-xl border border-neutral-800 bg-neutral-950/80 p-1">
        <div
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-gradient-to-r from-brand to-brand-dark shadow-md shadow-brand/20 transition-transform duration-200 ease-spring"
          style={{ transform: tab === "info" ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
        />
        <button
          type="button"
          onClick={() => setTab("deals")}
          className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
            tab === "deals" ? "text-white" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <Briefcase className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Negócios</span>
          {deals.length > 0 && <span className="ml-0.5 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] tabular-nums text-white">({deals.length})</span>}
        </button>
        <button
          type="button"
          onClick={() => setTab("info")}
          className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
            tab === "info" ? "text-white" : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Dados de contato</span>
        </button>
      </div>

      {tab === "deals" ? (
        <div className="animate-bubble-in space-y-2.5">
          {deleteError && <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>}

          {deals.length === 0 ? (
            <div className="card border border-neutral-800">
              <EmptyState
                icon={Inbox}
                title="Nenhum negócio vinculado"
                action={
                  <CreateDealForContactDialog
                    contactId={contactId}
                    pipelines={pipelines}
                    members={members}
                    creditTypes={creditTypes}
                    onCreated={(deal: CreatedDeal) => setDeals((prev) => [deal, ...prev])}
                  />
                }
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-1">
                {deals.length > 1 ? (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                    {deals.length} negócios · {deals.filter((d) => d.status === "OPEN").length} em andamento
                    {deals.some((d) => d.status === "OPEN") && (
                      <> · <span className="text-emerald-400 font-semibold">{formatCurrency(deals.filter((d) => d.status === "OPEN").reduce((sum, d) => sum + (d.value ?? 0), 0))}</span> em aberto</>
                    )}
                  </p>
                ) : (
                  <span />
                )}
                <CreateDealForContactDialog
                  contactId={contactId}
                  pipelines={pipelines}
                  members={members}
                  creditTypes={creditTypes}
                  onCreated={(deal: CreatedDeal) => setDeals((prev) => [deal, ...prev])}
                />
              </div>
              {deals.map((deal) => {
                const statusBadgeStyle = {
                  OPEN: "bg-brand/20 text-brand-light border border-brand/30",
                  WON: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
                  LOST: "bg-red-500/20 text-red-400 border border-red-500/30",
                }[deal.status];

                return (
                  <div
                    key={deal.id}
                    className="card group relative border border-neutral-800/80 transition-all duration-200 hover:border-brand/40 hover:bg-neutral-900/90 shadow-sm"
                  >
                    <Link
                      href={`/negocios/${deal.id}`}
                      className="block p-4 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2 pr-8">
                        <span className="min-w-0 truncate font-semibold text-neutral-900 dark:text-neutral-100 group-hover:text-brand transition-colors">
                          {deal.name}
                        </span>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusBadgeStyle}`}>
                          {STATUS_LABEL[deal.status].label}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: deal.stageColor ?? "#a1a1aa" }}
                          />
                          <span className="truncate font-medium text-neutral-300">{deal.stageName}</span>
                        </span>
                        <span className="shrink-0 font-bold text-emerald-400 tabular-nums text-sm">
                          {formatCurrency(deal.value)}
                        </span>
                      </div>
                    </Link>
                    {canDeleteDeals && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteTarget(deal);
                        }}
                        className="icon-btn absolute top-3.5 right-3 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 coarse:opacity-100 dark:text-neutral-500 dark:hover:text-red-400"
                        title="Apagar negócio"
                        aria-label="Apagar negócio"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : (
        <div className="animate-bubble-in max-w-xl space-y-3">
          <div className="card space-y-2 p-4 text-sm">
            {infoRows.map((row) => (
              <Row key={row.label} label={row.label} value={row.value} />
            ))}
            {addressLines && (
              <div className="space-y-0.5">
                <span className="text-neutral-500 dark:text-neutral-400">Endereço</span>
                <p className="text-right text-neutral-800 dark:text-neutral-200">{addressLines}</p>
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Tags</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {whatsapp && (
              <WhatsAppChat
                threadId={whatsapp.threadId}
                contactId={whatsapp.contactId}
                contactName={whatsapp.contactName}
                contactPhone={whatsapp.contactPhone}
                sendAsAlternate={whatsapp.sendAsAlternate}
              />
            )}
          </div>

          {/* "Zona de perigo" — card separado do resto, de propósito (não é
              mais um dado do contato, é uma ação destrutiva sobre ele). Só
              Dono/Gerente vê (ver canDeleteContact). Desabilitado enquanto
              houver negócio vinculado — apagar em cascata sem avisar seria
              perigoso demais, e o Postgres já barra isso de qualquer jeito
              (FK, ver app/api/contacts/[id]/route.ts); melhor explicar ANTES
              de deixar clicar do que deixar clicar e devolver erro. */}
          {canDeleteContact && (
            <div className="card space-y-2 border-red-100 p-4 text-sm dark:border-red-900/40">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">Apagar contato</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {deals.length > 0
                      ? "Apague os negócios vinculados primeiro — não dá pra apagar o contato enquanto algum negócio ainda apontar pra ele."
                      : "Remove o contato e seus dados de vez. Essa ação não pode ser desfeita."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={deals.length > 0}
                  onClick={() => setDeleteContactOpen(true)}
                  className="btn-secondary btn-sm shrink-0 border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Apagar
                </button>
              </div>
              {deleteContactError && (
                <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  {deleteContactError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {deleteContactOpen && (
        <ConfirmDialog
          title={`Apagar "${contactName}"?`}
          description="Dá pra desfazer logo em seguida, pelo aviso que aparece no canto da tela (ou Ctrl+Z)."
          confirmLabel="Apagar"
          onConfirm={handleDeleteContactConfirmed}
          onClose={() => setDeleteContactOpen(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Apagar "${deleteTarget.name}"?`}
          description="Dá pra desfazer logo em seguida, pelo aviso que aparece no canto da tela (ou Ctrl+Z)."
          confirmLabel="Apagar"
          onConfirm={handleDeleteConfirmed}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="min-w-0 truncate text-right text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}
