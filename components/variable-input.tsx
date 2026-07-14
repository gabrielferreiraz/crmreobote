"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { AUTOMATION_VARIABLE_GROUPS } from "@/lib/automations/variables";

const TOKEN_LABEL = new Map(AUTOMATION_VARIABLE_GROUPS.flatMap((g) => g.variables.map((v) => [v.token, v.label] as const)));

function buildChipHtml(token: string): string {
  const label = TOKEN_LABEL.get(token) ?? token;
  return `<span contenteditable="false" data-token="${token}" class="variable-pill">${label}</span> `;
}

/** DOM → string com `{{token}}` — é isso que vai pro banco e pro motor de automação (lib/automations/variables.ts). */
function serializeEditor(root: HTMLElement): string {
  let out = "";
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/ /g, " ");
    } else if (node instanceof HTMLElement) {
      if (node.dataset.token) out += `{{${node.dataset.token}}}`;
      else if (node.tagName === "BR") out += "\n";
    }
  }
  return out;
}

/** string com `{{token}}` → DOM (pílulas + texto) — só roda uma vez, no mount (ver comentário no useEffect abaixo). */
function deserializeIntoEditor(root: HTMLElement, value: string) {
  root.innerHTML = "";
  const parts = value.split(/(\{\{[\w.]+\}\})/g);
  for (const part of parts) {
    const match = part.match(/^\{\{([\w.]+)\}\}$/);
    if (match) {
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

/**
 * Campo de texto com variáveis como "pílula" inline, no espírito do n8n:
 * clica em "Adicionar variável do negócio", ela se encaixa onde o cursor
 * estava. Por baixo dos panos é sempre uma string com `{{token}}` (o que o
 * backend recebe e substitui de verdade) — a pílula é só a representação
 * visual, nunca o dado guardado.
 *
 * Deliberadamente não-controlado após o mount: sincronizar o DOM a partir de
 * `value` a cada tecla quebraria a posição do cursor (problema clássico de
 * contentEditable controlado). Como este componente só é usado dentro de um
 * Modal que desmonta ao fechar, um reset externo já vem de graça via
 * remount, sem precisar resync via prop.
 */
export function VariableInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(!value);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) deserializeIntoEditor(editorRef.current, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pickerOpen]);

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    onChange(serializeEditor(el));
    setIsEmpty(el.childNodes.length === 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!multiline) return;
    document.execCommand("insertLineBreak");
    handleInput();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Sempre como texto puro — colar de um site/Word traria formatação/HTML
    // estranho pro corpo da mensagem.
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    handleInput();
  }

  /** mousedown com preventDefault (não onClick) nos botões abaixo evita que o navegador tire o foco/seleção do editor antes do clique — é assim que o cursor "lembrado" continua válido na hora de inserir. */
  function ensureFocusInsideEditor() {
    const el = editorRef.current;
    if (!el) return;
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

  function insertVariable(token: string) {
    ensureFocusInsideEditor();
    document.execCommand("insertHTML", false, buildChipHtml(token));
    setPickerOpen(false);
    handleInput();
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="field-input scrollbar-thin cursor-text overflow-y-auto whitespace-pre-wrap"
          style={{ minHeight: multiline ? `${rows * 1.5}rem` : "2.25rem" }}
        />
        {isEmpty && (
          <span className="pointer-events-none absolute top-2 left-3 text-sm text-neutral-400 dark:text-neutral-500">
            {placeholder}
          </span>
        )}
      </div>

      <div ref={pickerRef} className="relative inline-block">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setPickerOpen((v) => !v)} className="btn-ghost btn-sm">
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Adicionar variável do negócio
        </button>
        {pickerOpen && (
          <div className="surface-glass scrollbar-thin absolute z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-md p-1 shadow-lg">
            {AUTOMATION_VARIABLE_GROUPS.map((group) => (
              <div key={group.label} className="mb-1 last:mb-0">
                <p className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                  {group.label}
                </p>
                {group.variables.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertVariable(v.token)}
                    className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-neutral-600 transition-colors hover:bg-neutral-100 active:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:active:bg-neutral-800"
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
