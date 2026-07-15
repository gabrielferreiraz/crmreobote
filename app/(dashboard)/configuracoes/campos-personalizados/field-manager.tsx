"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_ENTITY_LABELS,
  type CustomFieldType,
  type CustomFieldEntity,
} from "@/lib/custom-fields";

type Field = {
  id: string;
  entityType: CustomFieldEntity;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
};

const TYPE_OPTIONS = (Object.keys(CUSTOM_FIELD_TYPE_LABELS) as CustomFieldType[]).map((value) => ({
  value,
  label: CUSTOM_FIELD_TYPE_LABELS[value],
}));

const ENTITY_OPTIONS = (Object.keys(CUSTOM_FIELD_ENTITY_LABELS) as CustomFieldEntity[]).map((value) => ({
  value,
  label: CUSTOM_FIELD_ENTITY_LABELS[value],
}));

export function FieldManager({ initialFields }: { initialFields: Field[] }) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [fieldToDelete, setFieldToDelete] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteField(id: string) {
    setError(null);
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao excluir campo");
      return;
    }
    setFields((prev) => prev.filter((f) => f.id !== id));
    router.refresh();
  }

  function renderGroup(entityType: CustomFieldEntity) {
    const group = fields.filter((f) => f.entityType === entityType);
    return (
      <div className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
          {CUSTOM_FIELD_ENTITY_LABELS[entityType]}
        </h2>
        {group.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Nenhum campo criado ainda.</p>
        ) : (
          <div className="space-y-2">
            {group.map((field) => (
              <div key={field.id} className="card flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingField(field);
                    setDialogOpen(true);
                  }}
                  className="flex-1 text-left"
                >
                  <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{field.label}</span>
                  {field.required && <span className="ml-1.5 text-xs text-neutral-400 dark:text-neutral-500">obrigatório</span>}
                </button>
                <span className="shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  {CUSTOM_FIELD_TYPE_LABELS[field.type]}
                </span>
                <button
                  onClick={() => setFieldToDelete(field)}
                  className="icon-btn hover:text-red-600 dark:hover:text-red-400"
                  title="Excluir campo"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {renderGroup("CONTACT")}
      {renderGroup("DEAL")}

      <button
        onClick={() => {
          setEditingField(null);
          setDialogOpen(true);
        }}
        className="btn-primary"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Novo campo
      </button>

      {dialogOpen && (
        <FieldFormModal
          editingField={editingField}
          onClose={() => setDialogOpen(false)}
          onSaved={(field) => {
            setFields((prev) =>
              editingField ? prev.map((f) => (f.id === field.id ? field : f)) : [...prev, field],
            );
            setDialogOpen(false);
            router.refresh();
          }}
        />
      )}

      {fieldToDelete && (
        <ConfirmDialog
          title={`Excluir o campo "${fieldToDelete.label}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onClose={() => setFieldToDelete(null)}
          onConfirm={async () => {
            await deleteField(fieldToDelete.id);
            setFieldToDelete(null);
          }}
        />
      )}
    </div>
  );
}

function FieldFormModal({
  editingField,
  onClose,
  onSaved,
}: {
  editingField: Field | null;
  onClose: () => void;
  onSaved: (field: Field) => void;
}) {
  const isEdit = !!editingField;
  const [label, setLabel] = useState(editingField?.label ?? "");
  const [entityType, setEntityType] = useState<CustomFieldEntity>(editingField?.entityType ?? "CONTACT");
  const [type, setType] = useState<CustomFieldType>(editingField?.type ?? "TEXT");
  const [options, setOptions] = useState<string[]>(editingField?.options ?? []);
  const [required, setRequired] = useState(editingField?.required ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!label.trim() && (type !== "SELECT" || options.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(isEdit ? `/api/custom-fields/${editingField!.id}` : "/api/custom-fields", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, entityType, type, options, required }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar campo");
      return;
    }

    const field = await res.json();
    onSaved(field);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {isEdit ? "Editar campo" : "Novo campo"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Nome</label>
          <input
            autoFocus
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex.: Tamanho do imóvel"
            className="field-input"
          />
        </div>

        <div className="space-y-1">
          <label className="field-label">Aplica-se a</label>
          <Select
            value={entityType}
            onChange={(v) => setEntityType(v as CustomFieldEntity)}
            options={ENTITY_OPTIONS}
            disabled={isEdit}
          />
          {isEdit && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">Não dá pra mudar depois de criado.</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="field-label">Tipo</label>
          <Select value={type} onChange={(v) => setType(v as CustomFieldType)} options={TYPE_OPTIONS} disabled={isEdit} />
          {isEdit && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">Não dá pra mudar depois de criado.</p>
          )}
        </div>

        {type === "SELECT" && <OptionListInput values={options} onChange={setOptions} />}

        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="accent-neutral-900 dark:accent-white"
          />
          Obrigatório
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {isEdit ? "Salvar" : "Criar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Campo de lista (opções da seleção) — digita e aperta Enter/vírgula pra adicionar um chip. */
function OptionListInput({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [input, setInput] = useState("");

  function add(raw: string) {
    const clean = raw.trim();
    if (clean && !values.includes(clean)) onChange([...values, clean]);
    setInput("");
  }

  return (
    <div className="space-y-1">
      <label className="field-label">Opções</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 p-1.5 dark:border-neutral-700">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label={`Remover ${v}`}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            }
          }}
          onBlur={() => input && add(input)}
          placeholder={values.length === 0 ? "Ex.: Pequeno — Enter pra adicionar" : ""}
          className="min-w-[100px] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
        />
      </div>
    </div>
  );
}
