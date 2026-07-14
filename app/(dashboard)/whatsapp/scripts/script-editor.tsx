"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Loader2, ArrowLeft, X } from "lucide-react";
import { VariablePills } from "@/components/variable-pills";
import { LoadingDots } from "@/components/loading-dots";
import { renderTemplate } from "@/lib/campaigns/spintax";

type Step = { text: string; delayAfterSec: number };

const SAMPLE_VARS = { nome: "Maria Silva", cargo: "Advogada", empresa: "Empresa Exemplo", cidade: "Sua Cidade" };
const MAX_DELAY_SEC = 120;

export function ScriptEditor({
  scriptId,
  initialName = "",
  initialSteps,
  initialTags = [],
  existingTags,
}: {
  scriptId?: string;
  initialName?: string;
  initialSteps?: Step[];
  initialTags?: string[];
  existingTags: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [steps, setSteps] = useState<Step[]>(
    initialSteps?.length ? initialSteps : [{ text: "", delayAfterSec: 0 }],
  );
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [focusedStepIndex, setFocusedStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  function updateStepText(idx: number, text: string) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, text } : s)));
  }

  function updateStepDelay(idx: number, delayAfterSec: number) {
    const clamped = Math.min(MAX_DELAY_SEC, Math.max(0, Math.round(delayAfterSec) || 0));
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, delayAfterSec: clamped } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { text: "", delayAfterSec: 2 }]);
    setFocusedStepIndex(steps.length);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Insere no campo de texto que estava com foco por último, na posição do cursor. */
  function insertVariable(token: string) {
    const idx = focusedStepIndex;
    const el = textareaRefs.current[idx];
    const current = steps[idx]?.text ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const nextText = current.slice(0, start) + token + current.slice(end);
    updateStepText(idx, nextText);

    requestAnimationFrame(() => {
      const target = textareaRefs.current[idx];
      if (target) {
        const pos = start + token.length;
        target.focus();
        target.setSelectionRange(pos, pos);
      }
    });
  }

  function addTag(raw: string) {
    const clean = raw.trim();
    if (!clean || tags.includes(clean)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, clean]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  const previewSteps = steps.map((s) => ({
    text: s.text.trim() ? renderTemplate(s.text, SAMPLE_VARS, "Boa tarde") : "",
    delayAfterSec: s.delayAfterSec,
  }));
  const totalChars = steps.reduce((sum, s) => sum + s.text.length, 0);
  const canSubmit = !!name.trim() && steps.length > 0 && steps.every((s) => s.text.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(scriptId ? `/api/message-scripts/${scriptId}` : "/api/message-scripts", {
      method: scriptId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, steps, tags }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar script");
      return;
    }

    router.push("/whatsapp/scripts");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/whatsapp/scripts"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Scripts
      </Link>

      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {scriptId ? "Editar script" : "Novo script"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="card space-y-3 p-4">
          <div className="space-y-1">
            <label className="field-label">Nome</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Abertura — cargo jurídico"
              className="field-input"
            />
          </div>

          <div className="space-y-1">
            <label className="field-label">Tags</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                    aria-label={`Remover tag ${t}`}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                onBlur={() => tagInput && addTag(tagInput)}
                list="existing-script-tags"
                placeholder="Adicionar tag..."
                className="field-input w-36 py-1 text-xs"
              />
              <datalist id="existing-script-tags">
                {existingTags
                  .filter((t) => !tags.includes(t))
                  .map((t) => (
                    <option key={t} value={t} />
                  ))}
              </datalist>
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Organiza a biblioteca — ex.: &quot;abertura&quot;, &quot;follow-up&quot;, &quot;objeção&quot;.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {steps.map((step, idx) => (
            <div key={idx} className="card space-y-2 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">Mensagem {idx + 1}</span>
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    className="icon-btn"
                    aria-label={`Remover mensagem ${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
              <textarea
                ref={(el) => {
                  textareaRefs.current[idx] = el;
                }}
                required
                value={step.text}
                onFocus={() => setFocusedStepIndex(idx)}
                onChange={(e) => updateStepText(idx, e.target.value)}
                rows={3}
                placeholder="Ex.: {saudacao} {primeiro_nome}! {[Tudo bem|Como vai]}? Vi que você atua como {cargo}..."
                className="field-input"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400 dark:text-neutral-500">
                <span>{step.text.length} caracteres</span>
                {idx < steps.length - 1 && (
                  <label className="flex items-center gap-1.5">
                    Esperar
                    <input
                      type="number"
                      min={0}
                      max={MAX_DELAY_SEC}
                      value={step.delayAfterSec}
                      onChange={(e) => updateStepDelay(idx, Number(e.target.value))}
                      className="field-input w-16 px-2 py-0.5"
                    />
                    segundos antes da próxima mensagem
                  </label>
                )}
              </div>
            </div>
          ))}

          <div className="card space-y-2 p-3">
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Inserir variável em: <span className="font-medium text-neutral-600 dark:text-neutral-300">Mensagem {focusedStepIndex + 1}</span>
            </p>
            <VariablePills onInsert={insertVariable} />
          </div>

          <button type="button" onClick={addStep} className="btn-ghost w-full justify-center">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Adicionar outra mensagem
          </button>
        </div>

        <div className="card space-y-2 p-4">
          <p className="field-label">Prévia (com dados de exemplo)</p>
          <div className="space-y-1.5">
            {previewSteps.map((s, i) => (
              <div
                key={i}
                className="max-w-[85%] rounded-lg bg-emerald-50 px-3 py-1.5 text-sm whitespace-pre-wrap text-neutral-800 dark:bg-emerald-500/10 dark:text-neutral-200"
              >
                {s.text || <span className="text-neutral-400 dark:text-neutral-500">(vazio)</span>}
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {totalChars} caracteres no total · <code>{"{[opção 1|opção 2]}"}</code> varia trechos
          </p>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pb-4">
          <Link href="/whatsapp/scripts" className="btn-ghost">
            Cancelar
          </Link>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Salvar"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
