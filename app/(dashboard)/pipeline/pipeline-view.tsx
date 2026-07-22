"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Kanban, List, Upload, Download, Plus } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { Select } from "@/components/select";
import { NewDealDialog } from "./new-deal-dialog";
import { KanbanBoard, type Deal } from "./kanban-board";
import { DealsList } from "./deals-list";
import { popBulkSendDraft, type BulkSendDraft } from "@/lib/pipeline-bulk-send-draft";
import type { CustomFieldDefinitionInput } from "@/components/custom-fields-fieldset";

type MemberOption = { id: string; name: string };
type MemberFilterOption = { id: string; name: string; active: boolean };
type LossReasonOption = { id: string; label: string };
type CreditTypeOption = { id: string; label: string };
type Stage = { id: string; name: string; color: string | null; order: number };
type PipelineOption = { id: string; name: string; stages: { id: string; name: string }[] };

export function PipelineView({
  pipelineId,
  pipelines,
  stages,
  initialDeals,
  dealsCapped,
  members,
  allMembers,
  lossReasons,
  customFields,
  creditTypes,
  isOwner,
  canBulkDelete,
  canBulkMessage,
  openNewDeal,
}: {
  pipelineId: string;
  pipelines: PipelineOption[];
  stages: Stage[];
  initialDeals: Deal[];
  /** true = a busca no servidor bateu no teto (ver page.tsx) — a Lista pode não estar mostrando o histórico completo de Ganhos/Perdidos. */
  dealsCapped?: boolean;
  members: MemberOption[];
  allMembers: MemberFilterOption[];
  lossReasons: LossReasonOption[];
  customFields: CustomFieldDefinitionInput[];
  creditTypes: CreditTypeOption[];
  isOwner: boolean;
  canBulkDelete: boolean;
  canBulkMessage: boolean;
  openNewDeal?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [deals, setDeals] = useState(initialDeals);
  const [importOpen, setImportOpen] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<BulkSendDraft | null>(null);

  useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  useEffect(() => {
    if (openNewDeal) {
      setDealDialogOpen(true);
      router.replace("/pipeline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewDeal]);

  // Volta de "+ Criar script" (ver components/bulk-send-message-dialog.tsx) —
  // restaura a view Lista e repassa filtro/seleção pra deals-list.tsx
  // restaurar e reabrir o diálogo de envio sozinho. Não dá pra virar um
  // useState(() => ...) lazy: sessionStorage não existe durante a
  // renderização no servidor, só depois de montado no cliente.
  useEffect(() => {
    const draft = popBulkSendDraft();
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView("lista");
      setRestoredDraft(draft);
    }
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 && (
            <Select
              value={pipelineId}
              onChange={(v) => router.push(`/pipeline?pipelineId=${v}`)}
              className="w-auto py-1.5 text-sm"
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
          <div className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "kanban"
                  ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              <Kanban className="h-3.5 w-3.5" strokeWidth={2} />
              Kanban
            </button>
            <button
              onClick={() => setView("lista")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                view === "lista"
                  ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                  : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              <List className="h-3.5 w-3.5" strokeWidth={2} />
              Lista
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDealDialogOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Novo negócio
          </button>
          <button onClick={() => setImportOpen(true)} className="btn-secondary">
            <Upload className="h-4 w-4" strokeWidth={2} />
            Importar
          </button>
          {isOwner && (
            <a href="/api/deals/export" className="btn-secondary">
              <Download className="h-4 w-4" strokeWidth={2} />
              Exportar
            </a>
          )}
        </div>
      </div>

      {view === "lista" && dealsCapped && (
        <p className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
          Este pipeline tem muitos negócios — a lista pode não mostrar os ganhos/perdidos mais antigos. Os negócios em
          andamento (Kanban) continuam completos.
        </p>
      )}

      {view === "kanban" ? (
        <KanbanBoard stages={stages} deals={deals} onDealsChange={setDeals} members={members} />
      ) : (
        <DealsList
          deals={deals}
          members={allMembers}
          stages={stages}
          pipelineId={pipelineId}
          pipelines={pipelines}
          lossReasons={lossReasons}
          canBulkDelete={canBulkDelete}
          canBulkMessage={canBulkMessage}
          restoredDraft={restoredDraft}
        />
      )}

      <NewDealDialog
        pipelineId={pipelineId}
        firstStageId={stages[0]?.id}
        members={members}
        customFields={customFields}
        creditTypes={creditTypes}
        onCreated={(deal) => setDeals((prev) => [deal, ...prev])}
        open={dealDialogOpen}
        onOpenChange={setDealDialogOpen}
        hideTrigger
      />

      {importOpen && (
        <ImportDialog
          title="Importar negócios"
          hint="Arquivo .csv ou .xlsx com colunas: contato (obrigatório), whatsapp, telefone/celular (número 2, usado se o WhatsApp não funcionar), email, origem, negocio, valor, etapa, responsavel, tipo de credito."
          endpoint="/api/deals/import"
          extraFields={{ pipelineId }}
          onClose={() => setImportOpen(false)}
          onImported={() => router.refresh()}
          renderSummary={(r) => {
            const parts: string[] = [];
            if (r.skipped > 0) parts.push(`${r.skipped} linhas ignoradas por falta de contato`);
            if (r.stageFallbacks) parts.push(`${r.stageFallbacks} caíram na etapa padrão (texto da coluna 'etapa' não encontrado)`);
            if (r.ownerFallbacks) parts.push(`${r.ownerFallbacks} caíram em responsável automático (texto da coluna 'responsavel' não encontrado)`);
            if (r.valueParseFailures) parts.push(`${r.valueParseFailures} ficaram sem valor (não consegui ler o número)`);
            return `${r.created} de ${r.total} negócios importados.${parts.length > 0 ? ` ${parts.join("; ")}.` : ""}`;
          }}
        />
      )}
    </div>
  );
}
