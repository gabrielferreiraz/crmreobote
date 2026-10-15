"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Settings2, Kanban, List, Plus } from "lucide-react";
import Link from "next/link";
import { CategoryTreeNav, type CategoryTreeItem } from "./category-tree-nav";
import type { ProcessItem } from "./process-kanban-board";
import { ProcessList } from "./process-list";
import { AddToProcessDialog } from "./add-to-process-dialog";
import { useDesktopViewport } from "@/lib/use-desktop-viewport";

const ProcessKanbanBoard = dynamic(() =>
  import("./process-kanban-board").then((mod) => mod.ProcessKanbanBoard),
);
const ProcessesListMobile = dynamic(() =>
  import("./processes-list-mobile").then((mod) => mod.ProcessesListMobile),
);

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
  const desktop = useDesktopViewport();
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // A lista mobile (sem drag, sem paginação própria) só usa a 1ª leva já
  // carregada — quem precisa de tudo de verdade usa a Lista (ver ProcessList,
  // paginação de verdade) ou o Kanban desktop (carrega mais rolando).
  const mobileProcesses = useMemo(() => Object.values(initialProcessesByStage).flat(), [initialProcessesByStage]);

  return (
    // min-h-0: deixa o filho (Kanban ou Lista) encolher de verdade até a
    // altura disponível em vez de crescer pro tamanho do próprio conteúdo e
    // vazar o scroll pra página inteira — mesmo ajuste de pipeline-view.tsx.
    // Sem isso, só o Kanban ficava preso à altura da tela (mede a própria
    // altura via JS); a Lista virava um documento normal que empurrava a
    // paginação lá embaixo e fazia a página inteira rolar — alternar entre
    // as duas parecia mudar a "proporção" da tela inteira.
    <div className="flex h-full min-h-0 flex-col gap-3">
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

          {desktop === null ? (
            <div className="card min-h-64 min-w-0 flex-1 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
          ) : desktop ? (
          <div className="h-full min-w-0 flex-1">
            <ProcessKanbanBoard
              pipelineId={pipelineId}
              stages={stages}
              initialProcessesByStage={initialProcessesByStage}
              initialCountByStage={initialCountByStage}
              isAdmin={isAdmin}
            />
          </div>
          ) : (
          <div className="min-w-0 flex-1">
            <ProcessesListMobile stages={stages} processes={mobileProcesses} />
          </div>
          )}
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
