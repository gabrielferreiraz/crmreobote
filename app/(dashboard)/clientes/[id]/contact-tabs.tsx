"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Inbox, Trash2 } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatCurrency } from "@/lib/format";
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

type Deal = { id: string; name: string; status: "OPEN" | "WON" | "LOST"; value: number | null; stageName: string };
type InfoRow = { label: string; value: string };
type WhatsAppInfo = {
  threadId: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  sendAsAlternate?: { threadId: string; label: string } | null;
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
  deals: initialDeals,
  infoRows,
  addressLines,
  tags,
  whatsapp,
  pipelines,
  members,
  creditTypes,
  canDeleteDeals,
}: {
  contactId: string;
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
}) {
  const [tab, setTab] = useState<"deals" | "info">("deals");
  // Estado local (semeado do server, ver `deals: initialDeals` acima) — cria/
  // apaga aqui reflete na hora, sem esperar um refresh de página inteiro.
  const [deals, setDeals] = useState(initialDeals);
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      setDeals((prev) => prev.filter((d) => d.id !== deleteTarget.id));
    } else {
      setDeleteError("Não foi possível apagar esse negócio.");
    }
    setDeleteTarget(null);
  }

  return (
    <div>
      <div className="relative mb-4 flex w-full max-w-[320px] rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
        <div
          className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded bg-white shadow-sm transition-transform duration-200 ease-spring dark:bg-neutral-900"
          style={{ transform: tab === "info" ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
        />
        <button
          type="button"
          onClick={() => setTab("deals")}
          className={`relative z-10 flex-1 rounded px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97] ${
            tab === "deals" ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          Negócios{deals.length > 0 && <span className="ml-1 tabular-nums opacity-60">({deals.length})</span>}
        </button>
        <button
          type="button"
          onClick={() => setTab("info")}
          className={`relative z-10 flex-1 rounded px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97] ${
            tab === "info" ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          Dados de contato
        </button>
      </div>

      {tab === "deals" ? (
        <div className="animate-bubble-in space-y-2">
          {deleteError && <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>}

          {deals.length === 0 ? (
            <div className="card">
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
              {/* Com negócio(s) já vinculado(s), a ação disponível aqui é
                  apagar (ver canDeleteDeals abaixo) — não criar mais um; o
                  pedido foi especificamente "se não tiver, um botão pra
                  criar", não "sempre". */}
              {deals.map((deal) => (
                <div key={deal.id} className="card group relative">
                  <Link
                    href={`/negocios/${deal.id}`}
                    className="block p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
                  >
                    <div className="flex items-center justify-between gap-2 pr-7">
                      <span className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</span>
                      <Badge tone={STATUS_LABEL[deal.status].tone} className="shrink-0">
                        {STATUS_LABEL[deal.status].label}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="min-w-0 truncate">{deal.stageName}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCurrency(deal.value)}</span>
                    </div>
                  </Link>
                  {/* Apagar direto daqui, sem precisar abrir o negócio — só
                      Dono/Gerente (ver canDeleteDeals), só ícone, só no
                      hover (mesmo padrão de ação secundária usado em
                      agenda/task-row.tsx). preventDefault+stopPropagation
                      pra não disparar a navegação do <Link> em volta. */}
                  {canDeleteDeals && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget(deal);
                      }}
                      className="icon-btn absolute top-2 right-2 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100 coarse:opacity-100 dark:text-neutral-500 dark:hover:text-red-400"
                      title="Apagar negócio"
                      aria-label="Apagar negócio"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="card animate-bubble-in max-w-xl space-y-2 p-4 text-sm">
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
              currentUserName={whatsapp.currentUserName}
              currentUserPhotoUrl={whatsapp.currentUserPhotoUrl}
              sendAsAlternate={whatsapp.sendAsAlternate}
            />
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Apagar "${deleteTarget.name}"?`}
          description="Essa ação não pode ser desfeita — o negócio, suas tarefas e o histórico de atividades somem de vez."
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
