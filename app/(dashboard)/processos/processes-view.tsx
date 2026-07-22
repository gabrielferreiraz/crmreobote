"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import Link from "next/link";
import { Select } from "@/components/select";
import { ProcessKanbanBoard, type ProcessItem } from "./process-kanban-board";

type Stage = { id: string; name: string; color: string | null; order: number };
type PipelineOption = { id: string; name: string };

export function ProcessesView({
  pipelineId,
  pipelines,
  stages,
  initialProcesses,
  isAdmin,
}: {
  pipelineId: string;
  pipelines: PipelineOption[];
  stages: Stage[];
  initialProcesses: ProcessItem[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [processes, setProcesses] = useState(initialProcesses);

  // Sem isso, o estado local nunca vê os dados que o servidor manda de volta
  // depois de um router.refresh() (ex.: após mover um card) — o array em
  // memória fica congelado no valor do 1º render pra sempre, e qualquer
  // divergência entre o otimista e o real nunca se corrige sozinha. Mesmo
  // padrão já usado em app/(dashboard)/pipeline/pipeline-view.tsx.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProcesses(initialProcesses);
  }, [initialProcesses]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 && (
            <Select
              value={pipelineId}
              onChange={(v) => router.push(`/processos?pipelineId=${v}`)}
              className="w-auto py-1.5 text-sm"
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
        </div>
        {isAdmin && (
          <Link href="/configuracoes/processos" className="btn-secondary">
            <Settings2 className="h-4 w-4" strokeWidth={2} />
            Configurar etapas
          </Link>
        )}
      </div>

      <ProcessKanbanBoard
        pipelineId={pipelineId}
        stages={stages}
        processes={processes}
        onProcessesChange={setProcesses}
        isAdmin={isAdmin}
      />
    </div>
  );
}
