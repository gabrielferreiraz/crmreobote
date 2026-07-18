"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Kanban, List, Upload, Download, Plus } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { Select } from "@/components/select";
import { NewDealDialog } from "./new-deal-dialog";
import { KanbanBoard, type Deal } from "./kanban-board";
import { DealsList } from "./deals-list";
import { PipelineMobile } from "./pipeline-mobile";
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
  members,
  allMembers,
  lossReasons,
  customFields,
  creditTypes,
  isOwner,
  canBulkDelete,
  openNewDeal,
}: {
  pipelineId: string;
  pipelines: PipelineOption[];
  stages: Stage[];
  initialDeals: Deal[];
  members: MemberOption[];
  allMembers: MemberFilterOption[];
  lossReasons: LossReasonOption[];
  customFields: CustomFieldDefinitionInput[];
  creditTypes: CreditTypeOption[];
  isOwner: boolean;
  canBulkDelete: boolean;
  openNewDeal?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [deals, setDeals] = useState(initialDeals);
  const [importOpen, setImportOpen] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

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

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Versão desktop — inalterada, só passou a ficar atrás de lg: */}
      <div className="hidden h-full flex-col gap-3 lg:flex">
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
          />
        )}
      </div>

      {/* Versão mobile — telas separadas, feitas pro toque (ver pipeline-mobile.tsx) */}
      <div className="flex-1 lg:hidden">
        <PipelineMobile stages={stages} deals={deals} />
      </div>

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
          renderSummary={(r) =>
            `${r.created} de ${r.total} negócios importados.${
              r.skipped > 0 ? ` ${r.skipped} linhas ignoradas por falta de contato.` : ""
            }`
          }
        />
      )}
    </div>
  );
}
