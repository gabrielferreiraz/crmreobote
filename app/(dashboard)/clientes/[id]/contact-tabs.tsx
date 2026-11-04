"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Inbox, Trash2, AlertCircle, Briefcase, UserCheck } from "lucide-react";
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

  const openDeals = deals.filter((deal) => deal.status === "OPEN");
  const openValue = openDeals.reduce((sum, deal) => sum + (deal.value ?? 0), 0);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 border-b border-neutral-200 dark:border-neutral-800 lg:hidden">
        <button
          type="button"
          onClick={() => setTab("deals")}
          className={`relative flex h-12 items-center justify-center gap-2 text-sm font-medium transition-colors ${
            tab === "deals" ? "text-brand" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          <Briefcase className="h-4 w-4" strokeWidth={2} />
          Negócios
          {deals.length > 0 && <span className="text-xs tabular-nums text-neutral-400">{deals.length}</span>}
          {tab === "deals" && <span className="absolute inset-x-3 -bottom-px h-0.5 bg-brand" />}
        </button>
        <button
          type="button"
          onClick={() => setTab("info")}
          className={`relative flex h-12 items-center justify-center gap-2 text-sm font-medium transition-colors ${
            tab === "info" ? "text-brand" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          <UserCheck className="h-4 w-4" strokeWidth={2} />
          Dados
          {tab === "info" && <span className="absolute inset-x-3 -bottom-px h-0.5 bg-brand" />}
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] lg:gap-8 xl:gap-10">
        <section className={`${tab === "deals" ? "block" : "hidden"} min-w-0 lg:block`}>
          <div className="space-y-0 lg:space-y-2.5">
          {deleteError && <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>}

          {deals.length === 0 ? (
            <div className="contact-info-card card border border-neutral-200 dark:border-neutral-800">
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
              <div className="block lg:flex lg:items-end lg:justify-between lg:gap-4 lg:border-b lg:border-neutral-200 lg:pb-3 dark:lg:border-neutral-800">
                <div className="hidden lg:block">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Negócios</h2>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                      {deals.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                    {openDeals.length} em andamento
                    {openDeals.length > 0 && (
                      <> · <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(openValue)}</span> em aberto</>
                    )}
                  </p>
                </div>
                <CreateDealForContactDialog
                  contactId={contactId}
                  pipelines={pipelines}
                  members={members}
                  creditTypes={creditTypes}
                  onCreated={(deal: CreatedDeal) => setDeals((prev) => [deal, ...prev])}
                  triggerClassName="flex h-12 w-full items-center gap-2 border-b border-neutral-200 px-1 text-sm font-medium text-brand transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 lg:h-9 lg:w-auto lg:justify-center lg:rounded-md lg:border-0 lg:bg-brand lg:px-3 lg:text-sm lg:font-semibold lg:text-white lg:hover:bg-brand-dark"
                />
              </div>
              {deals.map((deal) => {
                const statusStyle = {
                  OPEN: "text-brand",
                  WON: "text-emerald-700 dark:text-emerald-400",
                  LOST: "text-red-700 dark:text-red-400",
                }[deal.status];
                const statusDotStyle = {
                  OPEN: "bg-brand",
                  WON: "bg-emerald-500",
                  LOST: "bg-red-500",
                }[deal.status];

                return (
                  <div
                    key={deal.id}
                    className="contact-deal-card card group relative border border-neutral-200 shadow-sm transition-all duration-200 hover:border-brand/40 hover:bg-neutral-50 dark:border-neutral-800/80 dark:hover:bg-neutral-900/90"
                  >
                    <Link
                      href={`/negocios/${deal.id}`}
                      className="block p-4 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2 pr-11 lg:pr-8">
                        <span className="min-w-0 break-words font-semibold text-neutral-900 transition-colors group-hover:text-brand dark:text-neutral-100 lg:truncate">
                          {deal.name}
                        </span>
                        <span className={`contact-deal-status inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${statusStyle}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDotStyle}`} aria-hidden="true" />
                          {STATUS_LABEL[deal.status].label}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: deal.stageColor ?? "#a1a1aa" }}
                          />
                          <span className="truncate font-medium text-neutral-600 dark:text-neutral-300">{deal.stageName}</span>
                        </span>
                        <span className="shrink-0 font-bold text-emerald-600 dark:text-emerald-400 tabular-nums text-sm">
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
        </section>

        <aside className={`${tab === "info" ? "block" : "hidden"} min-w-0 lg:block lg:border-l lg:border-neutral-200 lg:pl-8 dark:lg:border-neutral-800 xl:pl-10`}>
          <div className="space-y-3 lg:sticky lg:top-4">
            <div className="hidden items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800 lg:flex">
              <UserCheck className="h-4 w-4 text-brand" strokeWidth={2} />
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Dados do contato</h2>
            </div>
          <div className="contact-info-card card space-y-0 p-4 text-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            {infoRows.map((row) => (
              <Row key={row.label} label={row.label} value={row.value} />
            ))}
            {addressLines && (
              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-neutral-200 py-2.5 dark:border-neutral-800">
                <span className="text-neutral-500 dark:text-neutral-400">Endereço</span>
                <p className="text-right leading-snug text-neutral-800 dark:text-neutral-200">{addressLines}</p>
              </div>
            )}
            {tags.length > 0 && (
              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 py-2.5">
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
          </div>

          {whatsapp && (
            <WhatsAppChat
              threadId={whatsapp.threadId}
              contactId={whatsapp.contactId}
              contactName={whatsapp.contactName}
              contactPhone={whatsapp.contactPhone}
              sendAsAlternate={whatsapp.sendAsAlternate}
            />
          )}

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
                      ? "Disponível após excluir os negócios vinculados."
                      : "Remove este contato. A ação pode ser desfeita."}
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
        </aside>
      </div>

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
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 border-b border-neutral-200 py-2.5 last:border-0 dark:border-neutral-800">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="min-w-0 break-words text-right leading-snug text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}
