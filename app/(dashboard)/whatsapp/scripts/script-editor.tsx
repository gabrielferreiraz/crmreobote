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

const TOKEN_LABEL = new Map<string, string>([
  ["nome", "Nome"],
  ["primeiro_nome", "1º nome"],
  ["cargo", "Cargo"],
  ["empresa", "Empresa"],
  ["cidade", "Cidade"],
  ["consultor", "Consultor"],
  ["saudacao", "Saudação"],
]);
// Casa só os tokens de variável conhecidos (ex.: "{cargo}") — de propósito não
// casa "{[opção 1|opção 2]}" (sintaxe de spintax, ver lib/campaigns/spintax.ts),
// que deve continuar como texto puro editável, não virar pílula.
const TOKEN_RE = new RegExp(`(\\{(?:${Array.from(TOKEN_LABEL.keys()).join("|")})\\})`, "g");

function buildChipHtml(token: string): string {
  const label = TOKEN_LABEL.get(token) ?? token;
  return `<span contenteditable="false" data-token="${token}" class="variable-pill variable-pill--clickable" title="Clique para remover">${label}</span> `;
}

/** DOM do editor → string com `{token}` (mesmo formato que sempre foi salvo/renderizado). */
function serializeEditor(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      if (node.dataset.token) out += `{${node.dataset.token}}`;
      else if (node.tagName === "BR") out += "\n";
      else out += node.textContent ?? "";
    }
  }
  return out;
}

/** string com `{token}` → DOM (pílulas + texto) — só roda uma vez, no mount de cada editor. */
function deserializeIntoEditor(root: HTMLElement, value: string) {
  root.innerHTML = "";
  const parts = value.split(TOKEN_RE);
  for (const part of parts) {
    const match = part.match(/^\{(\w+)\}$/);
    if (match && TOKEN_LABEL.has(match[1])) {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildChipHtml(match[1]);
      while (wrapper.firstChild) root.appendChild(wrapper.firstChild);
    } else if (part) {
      part.split("\n").forEach((line, i) => {
        if (i > 0) root.appendChild(document.createElement("br"));
        if (line) root.appendChild(document.createTextNode(line));
      });
    }
  }
}

function ensureFocusInsideEditor(el: HTMLElement) {
  const sel = window.getSelection();
  const hasSelectionInside = !!sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer);
  if (!hasSelectionInside) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

/** Sorteia um valor dentro de [min, max] — usado só quando defaultStepDelayRange é passado. */
function randomInRange([min, max]: [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

export function ScriptEditor({
  scriptId,
  initialName = "",
  initialSteps,
  initialTags = [],
  existingTags,
  redirectTo = "/whatsapp/scripts",
  backLabel = "Scripts",
  defaultStepDelayRange,
}: {
  scriptId?: string;
  initialName?: string;
  initialSteps?: Step[];
  initialTags?: string[];
  existingTags: string[];
  /** Pra onde ir depois de salvar, e o destino do link "Voltar"/"Cancelar". */
  redirectTo?: string;
  /** Texto do link "Voltar" no topo. */
  backLabel?: string;
  /**
   * Quando setado (ex.: [10, 25]), a 1ª mensagem e cada "Adicionar outra
   * mensagem" preenchem o delay com um valor aleatório nessa faixa em vez do
   * fixo 0/2 de hoje — só o valor inicial muda, continua editável depois
   * como qualquer campo (ver app/api/deals/bulk-send-message).
   */
  defaultStepDelayRange?: [number, number];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [steps, setSteps] = useState<Step[]>(
    initialSteps?.length
      ? initialSteps
      : [{ text: "", delayAfterSec: defaultStepDelayRange ? randomInRange(defaultStepDelayRange) : 0 }],
  );
  // Chave estável por mensagem, independente da posição no array — sem isso,
  // remover a mensagem 1 faria a mensagem 2 "herdar" o DOM (e o innerHTML já
  // deserializado) da mensagem 1 no React, já que os editores não são mais
  // controlados por `value` a cada tecla (ver deserializeIntoEditor).
  const nextKeyRef = useRef(0);
  const newStepKey = () => `s${nextKeyRef.current++}`;
  const [stepKeys, setStepKeys] = useState<string[]>(() => steps.map(() => newStepKey()));
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [focusedStepIndex, setFocusedStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const initializedSteps = useRef<Set<number>>(new Set());

  function setEditorRef(idx: number, el: HTMLDivElement | null) {
    editorRefs.current[idx] = el;
    if (el && !initializedSteps.current.has(idx)) {
      deserializeIntoEditor(el, steps[idx]?.text ?? "");
      initializedSteps.current.add(idx);
    }
  }

  function updateStepText(idx: number, text: string) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, text } : s)));
  }

  function updateStepDelay(idx: number, delayAfterSec: number) {
    const clamped = Math.min(MAX_DELAY_SEC, Math.max(0, Math.round(delayAfterSec) || 0));
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, delayAfterSec: clamped } : s)));
  }

  function addStep() {
    const delayAfterSec = defaultStepDelayRange ? randomInRange(defaultStepDelayRange) : 2;
    setSteps((prev) => [...prev, { text: "", delayAfterSec }]);
    setStepKeys((prev) => [...prev, newStepKey()]);
    setFocusedStepIndex(steps.length);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    setStepKeys((prev) => prev.filter((_, i) => i !== idx));
    initializedSteps.current.delete(idx);
  }

  function handleEditorInput(idx: number) {
    const el = editorRefs.current[idx];
    if (!el) return;
    updateStepText(idx, serializeEditor(el));
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.execCommand("insertLineBreak");
  }

  function handleEditorPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Sempre como texto puro — colar de um site/Word traria formatação/HTML
    // estranho pro corpo da mensagem.
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  }

  /** Clique numa pílula inserida no texto a remove — sem precisar posicionar o cursor e apagar. */
  function handleEditorClick(e: React.MouseEvent<HTMLDivElement>, idx: number) {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-token]");
    if (!chip) return;
    chip.remove();
    handleEditorInput(idx);
  }

  /** Insere a pílula da variável no editor que estava com foco por último, na posição do cursor. */
  function insertVariable(bracedToken: string) {
    const idx = focusedStepIndex;
    const el = editorRefs.current[idx];
    if (!el) return;
    const token = bracedToken.replace(/[{}]/g, "");
    ensureFocusInsideEditor(el);
    document.execCommand("insertHTML", false, buildChipHtml(token));
    handleEditorInput(idx);
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

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href={redirectTo}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {backLabel}
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

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <div className="space-y-2 lg:col-span-7">
            {steps.map((step, idx) => (
              <div key={stepKeys[idx]} className="card space-y-2 p-4">
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
                <div className="relative">
                  <div
                    ref={(el) => setEditorRef(idx, el)}
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={() => setFocusedStepIndex(idx)}
                    onInput={() => handleEditorInput(idx)}
                    onKeyDown={handleEditorKeyDown}
                    onPaste={handleEditorPaste}
                    onClick={(e) => handleEditorClick(e, idx)}
                    className="field-input scrollbar-thin min-h-[4.5rem] cursor-text overflow-y-auto whitespace-pre-wrap"
                  />
                  {!step.text && (
                    <span className="pointer-events-none absolute top-2 left-3 text-sm text-neutral-400 dark:text-neutral-500">
                      Ex.: {"{saudacao} {primeiro_nome}"}! {"{[Tudo bem|Como vai]}"}? Vi que você atua como {"{cargo}"}...
                    </span>
                  )}
                </div>
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

          <div className="card space-y-2 p-4 lg:sticky lg:top-4 lg:col-span-5">
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
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pb-4">
          <Link href={redirectTo} className="btn-ghost">
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
