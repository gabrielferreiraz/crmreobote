"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Stage = {
  id: string;
  name: string;
  color: string | null;
  order: number;
  _count: { deals: number };
};

const COLOR_PRESETS = [
  "#6366f1",
  "#8b5cf6",
  "#f59e0b",
  "#f97316",
  "#06b6d4",
  "#3b82f6",
  "#10b981",
  "#64748b",
  "#e34948",
];

export function StageManager({
  pipelineId,
  initialStages,
}: {
  pipelineId: string;
  initialStages: Stage[];
}) {
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(stages, oldIndex, newIndex);
    setStages(reordered);

    await fetch(`/api/pipelines/${pipelineId}/stages/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageIds: reordered.map((s) => s.id) }),
    });
    router.refresh();
  }

  async function renameStage(stageId: string, name: string) {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, name } : s)));
    await fetch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    router.refresh();
  }

  async function recolorStage(stageId: string, color: string) {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, color } : s)));
    await fetch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    router.refresh();
  }

  async function deleteStage(stageId: string) {
    setError(null);
    const res = await fetch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir etapa");
      return;
    }
    setStages((prev) => prev.filter((s) => s.id !== stageId));
    router.refresh();
  }

  async function createStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch(`/api/pipelines/${pipelineId}/stages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, color: COLOR_PRESETS[stages.length % COLOR_PRESETS.length] }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar etapa");
      return;
    }

    const stage = await res.json();
    setStages((prev) => [...prev, { ...stage, _count: { deals: 0 } }]);
    setNewName("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <DndContext id="pipeline-stages" sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {stages.map((stage) => (
              <StageRow
                key={stage.id}
                stage={stage}
                onRename={renameStage}
                onRecolor={recolorStage}
                onDelete={() => setStageToDelete(stage)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <form onSubmit={createStage} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nova etapa"
          className="field-input flex-1"
        />
        <button type="submit" disabled={creating || !newName.trim()} className="btn-primary">
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          )}
          Adicionar
        </button>
      </form>

      {stageToDelete && (
        <ConfirmDialog
          title={`Excluir a etapa "${stageToDelete.name}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setStageToDelete(null)}
          onConfirm={async () => {
            await deleteStage(stageToDelete.id);
            setStageToDelete(null);
          }}
        />
      )}
    </div>
  );
}

function StageRow({
  stage,
  onRename,
  onRecolor,
  onDelete,
}: {
  stage: Stage;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const [name, setName] = useState(stage.name);
  const [showColors, setShowColors] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showColors) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowColors(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showColors]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="card flex items-center gap-2 px-3 py-2">
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400"
        aria-label="Arrastar para reordenar"
      >
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </button>

      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setShowColors((v) => !v)}
          className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10 transition-transform hover:scale-110"
          style={{ backgroundColor: stage.color ?? "#999" }}
          aria-label="Escolher cor"
        />
        {showColors && (
          <div
            className="surface-glass absolute top-6 left-0 z-10 flex flex-wrap gap-1 rounded-md p-2 shadow-lg"
            style={{ width: 120 }}
          >
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onRecolor(stage.id, c);
                  setShowColors(false);
                }}
                className="h-5 w-5 rounded-full ring-1 ring-black/10 dark:ring-white/10 transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== stage.name) onRename(stage.id, name.trim());
        }}
        className="flex-1 rounded bg-transparent px-1 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800"
      />

      <span className="text-xs text-neutral-400 dark:text-neutral-500">{stage._count.deals} negócios</span>

      <button
        onClick={onDelete}
        disabled={stage._count.deals > 0}
        className="icon-btn hover:text-red-600 dark:hover:text-red-400"
        title={stage._count.deals > 0 ? "Mova os negócios antes de excluir" : "Excluir etapa"}
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}
