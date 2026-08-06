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
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, ChevronDown, Tag, Plus, Trash2, Settings2, GripVertical, Loader2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProcessStageManager, type ProcessStage } from "@/components/process-stage-manager";

export type PipelineTreeItem = { id: string; name: string; stages: ProcessStage[]; _count: { processes: number } };
export type CategoryTreeItem = { id: string; name: string; pipelines: PipelineTreeItem[] };

/**
 * Categoria (grupo colapsável) → Subcategoria (item indentado), com
 * criação/renomeação/reordenação/exclusão inline pra quem é admin — direto
 * na própria página de Processos, sem precisar ir em Configurações (que
 * continua existindo, só não é mais o único jeito de gerenciar isso).
 */
export function CategoryTreeNav({
  categories: initialCategories,
  activePipelineId,
  isAdmin,
  onSelect,
}: {
  categories: CategoryTreeItem[];
  activePipelineId: string;
  isAdmin: boolean;
  onSelect: (pipelineId: string) => void;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  useEffect(() => setCategories(initialCategories), [initialCategories]);

  const activeCategoryId = categories.find((c) => c.pipelines.some((p) => p.id === activePipelineId))?.id;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(activeCategoryId ? [activeCategoryId] : []));
  useEffect(() => {
    if (activeCategoryId) setOpenIds((prev) => (prev.has(activeCategoryId) ? prev : new Set(prev).add(activeCategoryId)));
  }, [activeCategoryId]);

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryTreeItem | null>(null);
  const [pipelineToDelete, setPipelineToDelete] = useState<{ categoryId: string; pipeline: PipelineTreeItem } | null>(null);
  const [stageEditorPipeline, setStageEditorPipeline] = useState<PipelineTreeItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // A árvore inteira (com toda a edição de admin) só cabe de verdade como
  // barra lateral fixa — no celular vira uma folha: um botão resumindo a
  // seleção atual, que abre a mesma árvore num Modal por cima da tela.
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeCategory = categories.find((c) => c.pipelines.some((p) => p.id === activePipelineId));
  const activePipeline = activeCategory?.pipelines.find((p) => p.id === activePipelineId);

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createCategory() {
    if (!newCategoryName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/process-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategoryName }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar categoria");
      return;
    }
    const category = await res.json();
    const item: CategoryTreeItem = {
      id: category.id,
      name: category.name,
      pipelines: category.pipelines.map((p: { id: string; name: string; stages: ProcessStage[] }) => ({
        id: p.id,
        name: p.name,
        stages: p.stages,
        _count: { processes: 0 },
      })),
    };
    setCategories((prev) => [...prev, item]);
    setOpenIds((prev) => new Set(prev).add(item.id));
    setNewCategoryName("");
    setAddingCategory(false);
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

  async function deleteCategory(category: CategoryTreeItem) {
    setError(null);
    const res = await fetch(`/api/process-categories/${category.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir categoria");
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== category.id));
    if (category.pipelines.some((p) => p.id === activePipelineId)) router.push("/processos");
    router.refresh();
  }

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

  async function createSubcategory(categoryId: string) {
    if (!newSubName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/process-pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSubName, categoryId }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar subcategoria");
      return;
    }
    const pipeline = await res.json();
    setCategories((prev) =>
      prev.map((c) =>
        c.id === categoryId
          ? { ...c, pipelines: [...c.pipelines, { id: pipeline.id, name: pipeline.name, stages: pipeline.stages, _count: { processes: 0 } }] }
          : c,
      ),
    );
    setNewSubName("");
    setAddingSubFor(null);
    router.refresh();
    onSelect(pipeline.id);
  }

  async function renameSubcategory(categoryId: string, pipelineId: string, name: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === categoryId ? { ...c, pipelines: c.pipelines.map((p) => (p.id === pipelineId ? { ...p, name } : p)) } : c,
      ),
    );
    await fetch(`/api/process-pipelines/${pipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    router.refresh();
  }

  async function deleteSubcategory(categoryId: string, pipeline: PipelineTreeItem) {
    setError(null);
    const res = await fetch(`/api/process-pipelines/${pipeline.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir subcategoria");
      return;
    }
    setCategories((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, pipelines: c.pipelines.filter((p) => p.id !== pipeline.id) } : c)),
    );
    if (pipeline.id === activePipelineId) router.push("/processos");
    router.refresh();
  }

  async function handleSubDragEnd(categoryId: string, event: DragEndEvent) {
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

  // Corpo da árvore em si — igual pra barra lateral (desktop) e pra dentro
  // do Modal (celular), só a moldura em volta muda.
  const treeBody = (
    <>
      {error && <p className="px-1 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <DndContext sensors={sensors} onDragEnd={handleCategoryDragEnd}>
        <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {categories.map((category) => (
              <CategoryGroup
                key={category.id}
                category={category}
                isOpen={openIds.has(category.id)}
                onToggle={() => toggle(category.id)}
                isAdmin={isAdmin}
                activePipelineId={activePipelineId}
                onSelect={(id) => {
                  onSelect(id);
                  setMobileOpen(false);
                }}
                onRename={(name) => renameCategory(category.id, name)}
                onDelete={() => setCategoryToDelete(category)}
                onSubDragEnd={(e) => handleSubDragEnd(category.id, e)}
                sensors={sensors}
                addingSub={addingSubFor === category.id}
                onStartAddSub={() => {
                  setAddingSubFor(category.id);
                  setOpenIds((prev) => new Set(prev).add(category.id));
                }}
                onCancelAddSub={() => setAddingSubFor(null)}
                newSubName={newSubName}
                onNewSubNameChange={setNewSubName}
                onSubmitAddSub={() => createSubcategory(category.id)}
                busy={busy}
                onRenameSub={(pipelineId, name) => renameSubcategory(category.id, pipelineId, name)}
                onDeleteSub={(pipeline) => setPipelineToDelete({ categoryId: category.id, pipeline })}
                onEditStages={(pipeline) => setStageEditorPipeline(pipeline)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {isAdmin && (
        <div>
          {addingCategory ? (
            <div className="flex min-w-0 items-center gap-1 px-1">
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createCategory();
                  if (e.key === "Escape") setAddingCategory(false);
                }}
                onBlur={() => {
                  if (newCategoryName.trim()) createCategory();
                  else setAddingCategory(false);
                }}
                placeholder="Nome da categoria"
                className="field-input w-0 min-w-0 flex-1 py-1 text-sm"
              />
              {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" strokeWidth={2} />}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCategory(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Nova categoria
            </button>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop — barra lateral fixa, sempre visível. */}
      <nav className="hidden w-64 shrink-0 space-y-2 overflow-x-hidden overflow-y-auto scrollbar-thin lg:block">
        {treeBody}
      </nav>

      {/* Celular — a árvore inteira (com drag-and-drop e edição de admin) não
          cabe como coluna lateral numa tela estreita; vira um botão resumindo
          a seleção atual, que abre a mesma árvore num Modal por cima da tela. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="card flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
        >
          <Tag className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-neutral-500 dark:text-neutral-400">{activeCategory?.name ?? "Categoria"}</span>
            <span className="mx-1 text-neutral-300 dark:text-neutral-600">›</span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{activePipeline?.name ?? "Subcategoria"}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
        </button>
      </div>

      {mobileOpen && (
        <Modal onClose={() => setMobileOpen(false)} maxWidth="max-w-sm">
          <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Categorias</h2>
          {treeBody}
        </Modal>
      )}

      {categoryToDelete && (
        <ConfirmDialog
          title={`Excluir a categoria "${categoryToDelete.name}"?`}
          description="Todas as subcategorias e etapas dela (sem processo nenhum dentro) são excluídas junto. Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setCategoryToDelete(null)}
          onConfirm={async () => {
            await deleteCategory(categoryToDelete);
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
            await deleteSubcategory(pipelineToDelete.categoryId, pipelineToDelete.pipeline);
            setPipelineToDelete(null);
          }}
        />
      )}

      {stageEditorPipeline && (
        <Modal onClose={() => setStageEditorPipeline(null)} maxWidth="max-w-lg">
          <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Etapas de {stageEditorPipeline.name}
          </h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Marcar uma etapa como &quot;conclusão&quot; avisa o consultor responsável (push) sempre que um processo
            chegar nela.
          </p>
          <ProcessStageManager pipelineId={stageEditorPipeline.id} initialStages={stageEditorPipeline.stages} />
        </Modal>
      )}
    </>
  );
}

function CategoryGroup({
  category,
  isOpen,
  onToggle,
  isAdmin,
  activePipelineId,
  onSelect,
  onRename,
  onDelete,
  onSubDragEnd,
  sensors,
  addingSub,
  onStartAddSub,
  onCancelAddSub,
  newSubName,
  onNewSubNameChange,
  onSubmitAddSub,
  busy,
  onRenameSub,
  onDeleteSub,
  onEditStages,
}: {
  category: CategoryTreeItem;
  isOpen: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  activePipelineId: string;
  onSelect: (pipelineId: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSubDragEnd: (event: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  addingSub: boolean;
  onStartAddSub: () => void;
  onCancelAddSub: () => void;
  newSubName: string;
  onNewSubNameChange: (v: string) => void;
  onSubmitAddSub: () => void;
  busy: boolean;
  onRenameSub: (pipelineId: string, name: string) => void;
  onDeleteSub: (pipeline: PipelineTreeItem) => void;
  onEditStages: (pipeline: PipelineTreeItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id });
  const [name, setName] = useState(category.name);
  useEffect(() => setName(category.name), [category.name]);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="group/cat">
      <div className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-900/60">
        {isAdmin && (
          <button
            {...attributes}
            {...listeners}
            className="shrink-0 cursor-grab touch-none text-neutral-300 opacity-0 group-hover/cat:opacity-100 coarse:opacity-100 dark:text-neutral-600"
            aria-label="Arrastar para reordenar"
          >
            <GripVertical className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
        <button type="button" onClick={onToggle} className="shrink-0 text-neutral-400 dark:text-neutral-500">
          <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} strokeWidth={2} />
        </button>

        {isAdmin ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== category.name) onRename(name.trim());
              else setName(category.name);
            }}
            className="w-0 min-w-0 flex-1 truncate rounded bg-transparent px-1 py-1 text-sm font-medium text-neutral-700 outline-none focus:bg-white dark:text-neutral-300 dark:focus:bg-neutral-800"
          />
        ) : (
          <button onClick={onToggle} className="min-w-0 flex-1 truncate px-1 py-1 text-left text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {category.name}
          </button>
        )}

        {isAdmin && (
          <button
            onClick={onDelete}
            className="shrink-0 text-neutral-300 opacity-0 group-hover/cat:opacity-100 coarse:opacity-100 hover:text-red-600 dark:text-neutral-600 dark:hover:text-red-400"
            aria-label="Excluir categoria"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="ml-3.5 space-y-0.5 border-l border-neutral-200 pl-2.5 dark:border-neutral-800">
          <DndContext sensors={sensors} onDragEnd={onSubDragEnd}>
            <SortableContext items={category.pipelines.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {category.pipelines.length === 0 && !addingSub ? (
                <p className="px-2 py-1 text-xs text-neutral-400 dark:text-neutral-500">Sem subcategorias</p>
              ) : (
                category.pipelines.map((pipeline) => (
                  <SubcategoryRow
                    key={pipeline.id}
                    pipeline={pipeline}
                    active={pipeline.id === activePipelineId}
                    isAdmin={isAdmin}
                    onSelect={() => onSelect(pipeline.id)}
                    onRename={(v) => onRenameSub(pipeline.id, v)}
                    onDelete={() => onDeleteSub(pipeline)}
                    onEditStages={() => onEditStages(pipeline)}
                  />
                ))
              )}
            </SortableContext>
          </DndContext>

          {isAdmin &&
            (addingSub ? (
              <div className="flex min-w-0 items-center gap-1 px-1">
                <input
                  autoFocus
                  value={newSubName}
                  onChange={(e) => onNewSubNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSubmitAddSub();
                    if (e.key === "Escape") onCancelAddSub();
                  }}
                  placeholder="Nome da subcategoria"
                  className="field-input w-0 min-w-0 flex-1 py-1 text-sm"
                />
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" strokeWidth={2} />
                ) : (
                  <button onClick={onCancelAddSub} className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onStartAddSub}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                Nova subcategoria
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function SubcategoryRow({
  pipeline,
  active,
  isAdmin,
  onSelect,
  onRename,
  onDelete,
  onEditStages,
}: {
  pipeline: PipelineTreeItem;
  active: boolean;
  isAdmin: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onEditStages: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pipeline.id });
  const [name, setName] = useState(pipeline.name);
  const [editing, setEditing] = useState(false);
  useEffect(() => setName(pipeline.name), [pipeline.name]);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/sub flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 ${
        active ? "bg-neutral-900 dark:bg-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {isAdmin && (
        <button
          {...attributes}
          {...listeners}
          className={`shrink-0 cursor-grab touch-none opacity-0 group-hover/sub:opacity-100 coarse:opacity-100 ${active ? "text-white/50 dark:text-neutral-900/50" : "text-neutral-300 dark:text-neutral-600"}`}
          aria-label="Arrastar para reordenar"
        >
          <GripVertical className="h-3 w-3" strokeWidth={2} />
        </button>
      )}

      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name !== pipeline.name) onRename(name.trim());
            else setName(pipeline.name);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="field-input w-0 min-w-0 flex-1 py-1 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => isAdmin && setEditing(true)}
          className={`flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 text-left text-sm ${
            active ? "text-white dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-400"
          }`}
        >
          <Tag className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span className="truncate">{pipeline.name}</span>
        </button>
      )}

      {isAdmin && !editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/sub:opacity-100 coarse:opacity-100">
          <button
            onClick={onEditStages}
            className={active ? "text-white/70 hover:text-white dark:text-neutral-900/70 dark:hover:text-neutral-900" : "text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"}
            aria-label="Editar etapas"
            title="Editar etapas"
          >
            <Settings2 className="h-3 w-3" strokeWidth={2} />
          </button>
          <button
            onClick={onDelete}
            className={active ? "text-white/70 hover:text-red-200 dark:text-neutral-900/70 dark:hover:text-red-600" : "text-neutral-400 hover:text-red-600 dark:hover:text-red-400"}
            aria-label="Excluir subcategoria"
            title="Excluir subcategoria"
          >
            <Trash2 className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
