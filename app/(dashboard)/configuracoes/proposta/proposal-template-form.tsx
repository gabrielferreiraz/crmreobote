"use client";

import { useState } from "react";
import { Check, FileText, Info, Loader2 } from "lucide-react";

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
    <div className="card grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Texto padrão da descrição</label>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setJustSaved(false);
            }}
            rows={10}
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

      <aside className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" strokeWidth={2} />
          <p className="font-medium text-neutral-900 dark:text-neutral-100">Onde aparece</p>
        </div>
        <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          O texto preenche a descrição do modal de proposta. No PDF ele aparece como Observações.
        </p>
        <div className="flex gap-2 rounded-md bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-500/10 dark:text-blue-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <p>Use um texto geral. Condições específicas devem ser ajustadas pelo consultor na proposta.</p>
        </div>
      </aside>
    </div>
  );
}
