"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2, Kanban, List, Plus } from "lucide-react";
import Link from "next/link";
import { CategoryTreeNav, type CategoryTreeItem } from "./category-tree-nav";
import { ProcessKanbanBoard, type ProcessItem } from "./process-kanban-board";
import { ProcessesListMobile } from "./processes-list-mobile";
import { ProcessList } from "./process-list";
import { AddToProcessDialog } from "./add-to-process-dialog";

type Stage = { id: string; name: string; color: string | null; order: number; slaBusinessDays: number | null };

export function ProcessesView({
  pipelineId,
  categories,
  stages,
  initialProcessesByStage,
  initialCountByStage,
  isAdmin,
}: {
  pipelineId: string;
  categories: CategoryTreeItem[];
  stages: Stage[];
  /** 1ª página de cada coluna (por etapa) — ver ProcessKanbanBoard, que pagina cada uma independente. */
  initialProcessesByStage: Record<string, ProcessItem[]>;
  /** Total real (banco) de processos por etapa — pode ser bem maior que initialProcessesByStage[id].length. */
  initialCountByStage: Record<string, number>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // A lista mobile (sem drag, sem paginação própria) só usa a 1ª leva já
  // carregada — quem precisa de tudo de verdade usa a Lista (ver ProcessList,
  // paginação de verdade) ou o Kanban desktop (carrega mais rolando).
  const mobileProcesses = useMemo(() => Object.values(initialProcessesByStage).flat(), [initialProcessesByStage]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
          <button
            onClick={() => setView("kanban")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "kanban"
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            <Kanban className="h-3.5 w-3.5" strokeWidth={2} />
            Kanban
          </button>
          <button
            onClick={() => setView("lista")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "lista"
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            <List className="h-3.5 w-3.5" strokeWidth={2} />
            Lista
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button onClick={() => setAddDialogOpen(true)} className="btn-primary">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Adicionar ao processo
            </button>
          )}
          {isAdmin && (
            <Link href="/configuracoes/processos" className="btn-secondary">
              <Settings2 className="h-4 w-4" strokeWidth={2} />
              Configurar categorias
            </Link>
          )}
        </div>
      </div>

      {view === "kanban" ? (
        <div className="flex h-full min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
          <CategoryTreeNav
            categories={categories}
            activePipelineId={pipelineId}
            isAdmin={isAdmin}
            onSelect={(id) => router.push(`/processos?pipelineId=${id}`)}
          />

          <div className="hidden h-full min-w-0 flex-1 lg:block">
            <ProcessKanbanBoard
              pipelineId={pipelineId}
              stages={stages}
              initialProcessesByStage={initialProcessesByStage}
              initialCountByStage={initialCountByStage}
              isAdmin={isAdmin}
            />
          </div>

          <div className="min-w-0 flex-1 lg:hidden">
            <ProcessesListMobile stages={stages} processes={mobileProcesses} />
          </div>
        </div>
      ) : (
        <ProcessList categories={categories} />
      )}

      {addDialogOpen && (
        <AddToProcessDialog
          categories={categories}
          defaultPipelineId={pipelineId}
          onClose={() => setAddDialogOpen(false)}
          onCreated={() => {
            setAddDialogOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
