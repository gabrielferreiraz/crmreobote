"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

const MAX_LENGTH = 4000;

export function ProposalTemplateForm({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = text.trim() !== saved.trim();

  async function save() {
    setSaving(true);
    setError(null);
    setJustSaved(false);

    const res = await fetch("/api/organization/proposal-template", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: text }),
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar");
      return;
    }
    setSaved(text.trim());
    setText(text.trim());
    setJustSaved(true);
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="space-y-1">
        <label className="field-label">Texto padrão da descrição</label>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setJustSaved(false);
          }}
          rows={9}
          maxLength={MAX_LENGTH}
          placeholder="Ex.: Esta proposta foi elaborada considerando as condições apresentadas acima. As condições poderão sofrer alterações conforme disponibilidade dos grupos, administradora e data de contratação."
          className="field-input"
        />
        <p className="text-right text-xs text-neutral-400 tabular-nums dark:text-neutral-500">
          {text.length}/{MAX_LENGTH}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        {justSaved && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            Salvo
          </span>
        )}
        <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          Salvar
        </button>
      </div>
    </div>
  );
}
