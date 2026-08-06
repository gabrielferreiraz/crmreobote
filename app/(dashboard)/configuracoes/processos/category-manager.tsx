"use client";

import { useEffect, useState } from "react";
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
import { GripVertical, Plus, Trash2, Loader2, ChevronRight, Layers3 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProcessStageManager } from "@/components/process-stage-manager";

type Stage = { id: string; name: string; color: string | null; order: number; isFinal: boolean; _count: { processes: number } };
type Pipeline = { id: string; name: string; order: number; isDefault: boolean; stages: Stage[]; _count: { processes: number } };
type Category = { id: string; name: string; order: number; pipelines: Pipeline[] };

export function CategoryManager({ initialCategories }: { initialCategories: Category[] }) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [error, setError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(initialCategories[0]?.id ?? null);
  const [expandedPipelineId, setExpandedPipelineId] = useState<string | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [pipelineToDelete, setPipelineToDelete] = useState<{ categoryId: string; pipeline: Pipeline } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleCategoryDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(categories, oldIndex, newIndex);
    setCategories(reordered);

    await fetch("/api/process-categories/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIds: reordered.map((c) => c.id) }),
    });
    router.refresh();
  }

  async function renameCategory(id: string, name: string) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    await fetch(`/api/process-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    router.refresh();
  }

  async function deleteCategory(id: string) {
    setError(null);
    const res = await fetch(`/api/process-categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir categoria");
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== id));
    router.refresh();
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    setError(null);

    const res = await fetch("/api/process-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName }),
    });

    setCreatingCategory(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar categoria");
      return;
    }

    const category = await res.json();
    setCategories((prev) => [...prev, category]);
    setExpandedCategoryId(category.id);
    setNewCategoryName("");
    router.refresh();
  }

  async function handlePipelineDragEnd(categoryId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;
    const oldIndex = category.pipelines.findIndex((p) => p.id === active.id);
    const newIndex = category.pipelines.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(category.pipelines, oldIndex, newIndex);
    setCategories((prev) => prev.map((c) => (c.id === categoryId ? { ...c, pipelines: reordered } : c)));

    await fetch(`/api/process-categories/${categoryId}/pipelines/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineIds: reordered.map((p) => p.id) }),
    });
    router.refresh();
  }

  async function renamePipeline(categoryId: string, pipelineId: string, name: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === categoryId
          ? { ...c, pipelines: c.pipelines.map((p) => (p.id === pipelineId ? { ...p, name } : p)) }
          : c,
      ),
    );
    await fetch(`/api/process-pipelines/${pipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    router.refresh();
  }

  async function deletePipeline(categoryId: string, pipelineId: string) {
    setError(null);
    const res = await fetch(`/api/process-pipelines/${pipelineId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir subcategoria");
      return;
    }
    setCategories((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, pipelines: c.pipelines.filter((p) => p.id !== pipelineId) } : c)),
    );
    if (expandedPipelineId === pipelineId) setExpandedPipelineId(null);
    router.refresh();
  }

  async function createPipeline(categoryId: string, name: string) {
    if (!name.trim()) return;
    setError(null);

    const res = await fetch("/api/process-pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, categoryId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar subcategoria");
      return;
    }

    const pipeline = await res.json();
    setCategories((prev) => prev.map((c) => (c.id === categoryId ? { ...c, pipelines: [...c.pipelines, pipeline] } : c)));
    setExpandedPipelineId(pipeline.id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <DndContext id="process-categories" sensors={sensors} onDragEnd={handleCategoryDragEnd}>
        <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {categories.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                expanded={expandedCategoryId === category.id}
                onToggle={() => setExpandedCategoryId((prev) => (prev === category.id ? null : category.id))}
                onRename={(name) => renameCategory(category.id, name)}
                onDelete={() => setCategoryToDelete(category)}
                expandedPipelineId={expandedPipelineId}
                onTogglePipeline={(id) => setExpandedPipelineId((prev) => (prev === id ? null : id))}
                onPipelineDragEnd={(event) => handlePipelineDragEnd(category.id, event)}
                onRenamePipeline={(pipelineId, name) => renamePipeline(category.id, pipelineId, name)}
                onDeletePipeline={(pipeline) => setPipelineToDelete({ categoryId: category.id, pipeline })}
                onCreatePipeline={(name) => createPipeline(category.id, name)}
                sensors={sensors}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <form onSubmit={createCategory} className="flex gap-2">
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="Nova categoria (ex.: Imóvel, Automóvel)"
          className="field-input flex-1"
        />
        <button type="submit" disabled={creatingCategory || !newCategoryName.trim()} className="btn-primary">
          {creatingCategory ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
          Adicionar
        </button>
      </form>

      {categoryToDelete && (
        <ConfirmDialog
          title={`Excluir a categoria "${categoryToDelete.name}"?`}
          description="Todas as subcategorias e etapas dela (sem processo nenhum dentro) são excluídas junto. Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setCategoryToDelete(null)}
          onConfirm={async () => {
            await deleteCategory(categoryToDelete.id);
            setCategoryToDelete(null);
          }}
        />
      )}

      {pipelineToDelete && (
        <ConfirmDialog
          title={`Excluir a subcategoria "${pipelineToDelete.pipeline.name}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setPipelineToDelete(null)}
          onConfirm={async () => {
            await deletePipeline(pipelineToDelete.categoryId, pipelineToDelete.pipeline.id);
            setPipelineToDelete(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryRow({
  category,
  expanded,
  onToggle,
  onRename,
  onDelete,
  expandedPipelineId,
  onTogglePipeline,
  onPipelineDragEnd,
  onRenamePipeline,
  onDeletePipeline,
  onCreatePipeline,
  sensors,
}: {
  category: Category;
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  expandedPipelineId: string | null;
  onTogglePipeline: (id: string) => void;
  onPipelineDragEnd: (event: DragEndEvent) => void;
  onRenamePipeline: (pipelineId: string, name: string) => void;
  onDeletePipeline: (pipeline: Pipeline) => void;
  onCreatePipeline: (name: string) => void;
  sensors: ReturnType<typeof useSensors>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  const [name, setName] = useState(category.name);
  const [newPipelineName, setNewPipelineName] = useState("");
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const totalProcesses = category.pipelines.reduce((sum, p) => sum + p._count.processes, 0);

  useEffect(() => setName(category.name), [category.name]);

  return (
    <div ref={setNodeRef} style={style} className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-400"
          aria-label="Arrastar para reordenar"
        >
          <GripVertical className="h-4 w-4" strokeWidth={2} />
        </button>

        <button type="button" onClick={onToggle} className="shrink-0 text-neutral-400 dark:text-neutral-500">
          <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} strokeWidth={2} />
        </button>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== category.name) onRename(name.trim());
          }}
          className="flex-1 rounded bg-transparent px-1 text-sm font-medium text-neutral-900 outline-none focus:bg-neutral-50 dark:text-neutral-100 dark:focus:bg-neutral-800"
        />

        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {category.pipelines.length} subcategoria{category.pipelines.length === 1 ? "" : "s"}
        </span>

        <button
          onClick={onDelete}
          disabled={totalProcesses > 0}
          className="icon-btn hover:text-red-600 dark:hover:text-red-400"
          title={totalProcesses > 0 ? "Mova os processos antes de excluir" : "Excluir categoria"}
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-neutral-100 bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
          <DndContext sensors={sensors} onDragEnd={onPipelineDragEnd}>
            <SortableContext items={category.pipelines.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {category.pipelines.map((pipeline) => (
                  <PipelineRow
                    key={pipeline.id}
                    pipeline={pipeline}
                    expanded={expandedPipelineId === pipeline.id}
                    onToggle={() => onTogglePipeline(pipeline.id)}
                    onRename={(v) => onRenamePipeline(pipeline.id, v)}
                    onDelete={() => onDeletePipeline(pipeline)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCreatePipeline(newPipelineName);
              setNewPipelineName("");
            }}
            className="flex gap-2"
          >
            <input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="Nova subcategoria (ex.: Aquisição, Construção)"
              className="field-input flex-1 text-sm"
            />
            <button type="submit" disabled={!newPipelineName.trim()} className="btn-secondary btn-sm">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Adicionar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function PipelineRow({
  pipeline,
  expanded,
  onToggle,
  onRename,
  onDelete,
}: {
  pipeline: Pipeline;
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pipeline.id });
  const [name, setName] = useState(pipeline.name);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  useEffect(() => setName(pipeline.name), [pipeline.name]);

  return (
    <div ref={setNodeRef} style={style} className="card overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-400"
          aria-label="Arrastar para reordenar"
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={2} />
        </button>

        <button type="button" onClick={onToggle} className="flex shrink-0 items-center gap-1 text-neutral-400 dark:text-neutral-500">
          <Layers3 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== pipeline.name) onRename(name.trim());
          }}
          className="flex-1 rounded bg-transparent px-1 text-sm text-neutral-900 outline-none focus:bg-neutral-50 dark:text-neutral-100 dark:focus:bg-neutral-800"
        />

        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {pipeline.stages.length} etapa{pipeline.stages.length === 1 ? "" : "s"} · {pipeline._count.processes} processos
        </span>

        <button
          type="button"
          onClick={onToggle}
          className="btn-ghost btn-sm"
        >
          {expanded ? "Fechar etapas" : "Editar etapas"}
        </button>

        <button
          onClick={onDelete}
          disabled={pipeline._count.processes > 0}
          className="icon-btn hover:text-red-600 dark:hover:text-red-400"
          title={pipeline._count.processes > 0 ? "Mova os processos antes de excluir" : "Excluir subcategoria"}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
          <ProcessStageManager pipelineId={pipeline.id} initialStages={pipeline.stages} />
        </div>
      )}
    </div>
  );
}
