"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/badge";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StageManager } from "./stage-manager";

type Stage = {
  id: string;
  name: string;
  color: string | null;
  order: number;
  _count: { deals: number };
};

type Pipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
  _count: { deals: number };
};

export function PipelineManager({
  initialPipelines,
  isOwner,
}: {
  initialPipelines: Pipeline[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPipelines.find((p) => p.isDefault)?.id ?? initialPipelines[0]?.id ?? null,
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineToDelete, setPipelineToDelete] = useState<Pipeline | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = initialPipelines.find((p) => p.id === selectedId);

  async function createPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar pipeline");
      return;
    }

    const pipeline = await res.json();
    setOpen(false);
    setName("");
    setSelectedId(pipeline.id);
    router.refresh();
  }

  async function renamePipeline(id: string, newName: string) {
    await fetch(`/api/pipelines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    router.refresh();
  }

  async function setDefault(id: string) {
    setBusyId(id);
    await fetch(`/api/pipelines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    setBusyId(null);
    router.refresh();
  }

  async function deletePipeline(id: string) {
    const res = await fetch(`/api/pipelines/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (selectedId === id) {
        setSelectedId(initialPipelines.find((p) => p.id !== id)?.id ?? null);
      }
      router.refresh();
    }
    return res;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {isOwner && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Nova pipeline
          </button>
        </div>
      )}

      <div className="space-y-2">
        {initialPipelines.map((pipeline) => (
          <div
            key={pipeline.id}
            onClick={() => setSelectedId(pipeline.id)}
            className={`card flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors ${
              selectedId === pipeline.id
                ? "border-neutral-900 dark:border-white"
                : "hover:border-neutral-300 dark:hover:border-neutral-700"
            }`}
          >
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
                {isOwner ? (
                  <input
                    defaultValue={pipeline.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== pipeline.name) renamePipeline(pipeline.id, v);
                    }}
                    className="min-w-0 rounded bg-transparent px-1 py-0.5 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800"
                  />
                ) : (
                  pipeline.name
                )}
                {pipeline.isDefault && <Badge tone="accent">Padrão</Badge>}
              </span>
              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                {pipeline.stages.length} etapa{pipeline.stages.length === 1 ? "" : "s"} · {pipeline._count.deals} negócio
                {pipeline._count.deals === 1 ? "" : "s"}
              </p>
            </div>

            {isOwner && (
              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {!pipeline.isDefault && (
                  <button
                    onClick={() => setDefault(pipeline.id)}
                    disabled={busyId === pipeline.id}
                    className="icon-btn"
                    title="Tornar padrão"
                  >
                    {busyId === pipeline.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Star className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                  </button>
                )}
                <button
                  onClick={() => setPipelineToDelete(pipeline)}
                  disabled={initialPipelines.length <= 1}
                  className="icon-btn hover:text-red-600 dark:hover:text-red-400"
                  title={initialPipelines.length <= 1 ? "Precisa de ao menos uma pipeline" : "Excluir pipeline"}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {selected && (
        <div className="space-y-2 pt-2">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Etapas de &quot;{selected.name}&quot;
          </h2>
          <StageManager key={selected.id} pipelineId={selected.id} initialStages={selected.stages} />
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nova pipeline</h2>
          <form onSubmit={createPipeline} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Nome</label>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Funil de renovação"
                className="field-input"
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={creating || !name.trim()} className="btn-primary">
                {creating && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {creating ? "Criando..." : "Criar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pipelineToDelete && (
        <ConfirmDialog
          title={`Excluir "${pipelineToDelete.name}"?`}
          description={
            pipelineToDelete._count.deals > 0
              ? "Essa pipeline tem negócios vinculados — mova ou exclua-os antes de excluir a pipeline."
              : "Essa ação não pode ser desfeita."
          }
          confirmLabel="Excluir"
          onClose={() => setPipelineToDelete(null)}
          onConfirm={async () => {
            const res = await deletePipeline(pipelineToDelete.id);
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              setError(data.error ?? "Erro ao excluir pipeline");
            }
            setPipelineToDelete(null);
          }}
        />
      )}
    </div>
  );
}
