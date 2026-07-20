"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Loader2, ArrowLeft, X, Shuffle } from "lucide-react";
import { VariablePills } from "@/components/variable-pills";
import { LoadingDots } from "@/components/loading-dots";
import { WhatsAppPhonePreview } from "@/components/whatsapp-phone-preview";
import { MessageVariationEditor } from "@/components/message-variation-editor";
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
// Casa tokens de variável conhecidos (ex.: "{cargo}") E blocos de variação
// "{[opção 1|opção 2]}" (sintaxe spintax, ver lib/campaigns/spintax.ts) —
// ambos viram pílula no editor, nunca ficam como chave/colchete cru na tela.
// O corpo da variação aceita "{token}" dentro (só "[" e "]" ficam de fora —
// mesma regra de lib/campaigns/spintax.ts), pra permitir variável dentro de
// uma opção (ex.: "Oi {primeiro_nome}!" como uma das frases alternativas).
const VARIATION_GROUP_RE = "\\{\\[[^\\[\\]]+\\]\\}";
const TOKEN_RE = new RegExp(`(\\{(?:${Array.from(TOKEN_LABEL.keys()).join("|")})\\}|${VARIATION_GROUP_RE})`, "g");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildChipHtml(token: string): string {
  const label = TOKEN_LABEL.get(token) ?? token;
  return `<span contenteditable="false" data-token="${token}" class="variable-pill variable-pill--clickable" title="Clique para remover">${label}</span> `;
}

/** Pílula de variação — guarda as opções em data-variation-options (JSON) pra reabrir o editor visual depois. */
function buildVariationChipHtml(options: string[]): string {
  const encoded = encodeURIComponent(JSON.stringify(options));
  const label = escapeHtml(options.join(" / "));
  return `<span contenteditable="false" data-variation-options="${encoded}" class="variation-pill" title="Clique para editar as opções">🔀 ${label}<span data-variation-remove="true" class="variation-pill__remove" title="Remover variação">×</span></span> `;
}

/** DOM do editor → string com `{token}`/`{[a|b]}` (mesmo formato que sempre foi salvo/renderizado). */
function serializeEditor(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      if (node.dataset.variationOptions) {
        const options: string[] = JSON.parse(decodeURIComponent(node.dataset.variationOptions));
        out += `{[${options.join("|")}]}`;
      } else if (node.dataset.token) {
        out += `{${node.dataset.token}}`;
      } else if (node.tagName === "BR") {
        out += "\n";
      } else {
        out += node.textContent ?? "";
      }
    }
  }
  return out;
}

/** string com `{token}`/`{[a|b]}` → DOM (pílulas + texto) — só roda uma vez, no mount de cada editor. */
function deserializeIntoEditor(root: HTMLElement, value: string) {
  root.innerHTML = "";
  const parts = value.split(TOKEN_RE);
  for (const part of parts) {
    const tokenMatch = part.match(/^\{(\w+)\}$/);
    const variationMatch = part.match(/^\{\[([^[\]]+)\]\}$/);
    if (tokenMatch && TOKEN_LABEL.has(tokenMatch[1])) {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildChipHtml(tokenMatch[1]);
      while (wrapper.firstChild) root.appendChild(wrapper.firstChild);
    } else if (variationMatch) {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = buildVariationChipHtml(variationMatch[1].split("|"));
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
  // Editor inline de variação de mensagem (não é modal — aparece embutido
  // no card "Inserir em") — editingChip aponta pra pílula real no DOM quando
  // é edição (reabrindo com as opções atuais); null quando é uma variação
  // nova, ainda sem pílula nenhuma.
  const [variationDialog, setVariationDialog] = useState<{
    stepIdx: number;
    options: string[];
    editingChip: HTMLElement | null;
  } | null>(null);

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

  /** Clique numa pílula: variável remove direto; variação abre o editor visual (ou remove, se foi no "×"). */
  function handleEditorClick(e: React.MouseEvent<HTMLDivElement>, idx: number) {
    const target = e.target as HTMLElement;

    const removeBtn = target.closest<HTMLElement>("[data-variation-remove]");
    if (removeBtn) {
      removeBtn.closest<HTMLElement>("[data-variation-options]")?.remove();
      handleEditorInput(idx);
      return;
    }

    const variationChip = target.closest<HTMLElement>("[data-variation-options]");
    if (variationChip) {
      const options: string[] = JSON.parse(decodeURIComponent(variationChip.dataset.variationOptions!));
      setVariationDialog({ stepIdx: idx, options, editingChip: variationChip });
      return;
    }

    const tokenChip = target.closest<HTMLElement>("[data-token]");
    if (tokenChip) {
      tokenChip.remove();
      handleEditorInput(idx);
    }
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

  /** Abre o editor visual de variação vazio, pra inserir uma pílula nova na mensagem com foco. */
  function openNewVariationDialog() {
    setVariationDialog({ stepIdx: focusedStepIndex, options: ["", ""], editingChip: null });
  }

  /** Confirma o editor inline: atualiza a pílula existente no DOM, ou insere uma nova no cursor. */
  function saveVariationDialog(options: string[]) {
    if (!variationDialog) return;
    const { stepIdx, editingChip } = variationDialog;
    const el = editorRefs.current[stepIdx];
    if (!el) {
      setVariationDialog(null);
      return;
    }

    if (editingChip && el.contains(editingChip)) {
      const encoded = encodeURIComponent(JSON.stringify(options));
      editingChip.setAttribute("data-variation-options", encoded);
      editingChip.innerHTML = `🔀 ${escapeHtml(options.join(" / "))}<span data-variation-remove="true" class="variation-pill__remove" title="Remover variação">×</span>`;
    } else {
      ensureFocusInsideEditor(el);
      document.execCommand("insertHTML", false, buildVariationChipHtml(options));
    }
    handleEditorInput(stepIdx);
    setVariationDialog(null);
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

  // Memoizado pela chave dos textos crus, não recalculado a cada render: como
  // a variação sorteia uma opção ao acaso (expandSpintax), recalcular à toa
  // (ex.: digitando em outro campo qualquer) reiniciaria a animação do
  // celular sem a mensagem ter mudado de verdade.
  const rawStepsKey = steps.map((s) => s.text).join("");
  const [variationSeed, setVariationSeed] = useState(0);
  const hasVariation = steps.some((s) => /\{\[[^[\]]+\]\}/.test(s.text));
  const previewSteps = useMemo(
    () =>
      steps.map((s) => ({
        text: s.text.trim() ? renderTemplate(s.text, SAMPLE_VARS, "Boa tarde") : "",
        delayAfterSec: s.delayAfterSec,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawStepsKey, variationSeed],
  );
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
                      Ex.: {"{saudacao} {primeiro_nome}"}! Vi que você atua como {"{cargo}"}...
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
                Inserir em: <span className="font-medium text-neutral-600 dark:text-neutral-300">Mensagem {focusedStepIndex + 1}</span>
              </p>
              <VariablePills onInsert={insertVariable} />

              {variationDialog ? (
                <MessageVariationEditor
                  initialOptions={variationDialog.options}
                  onCancel={() => setVariationDialog(null)}
                  onSave={saveVariationDialog}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={openNewVariationDialog}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
                  >
                    <Shuffle className="h-3 w-3" strokeWidth={2.5} />
                    Adicionar variação
                  </button>
                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    Variação = frases alternativas que o sistema escolhe ao acaso, pra não mandar sempre o mesmo texto.
                  </p>
                </>
              )}
            </div>

            <button type="button" onClick={addStep} className="btn-ghost w-full justify-center">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Adicionar outra mensagem
            </button>
          </div>

          <div className="card space-y-3 p-4 lg:sticky lg:top-4 lg:col-span-5">
            <p className="field-label text-center">Prévia (com dados de exemplo)</p>
            <WhatsAppPhonePreview steps={previewSteps} contactName={SAMPLE_VARS.nome} />
            {hasVariation && (
              <button
                type="button"
                onClick={() => setVariationSeed((s) => s + 1)}
                className="mx-auto flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
              >
                <Shuffle className="h-3 w-3" strokeWidth={2.5} />
                Ver outra variação
              </button>
            )}
            <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">{totalChars} caracteres no total</p>
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
