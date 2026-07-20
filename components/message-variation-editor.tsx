"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { VariablePills } from "@/components/variable-pills";

/**
 * Editor visual da variação de mensagem, embutido direto na tela (sem
 * modal/popup) — por trás vira a sintaxe "{[opção 1|opção 2]}" (ver
 * lib/campaigns/spintax.ts), mas quem usa nunca precisa escrever chave,
 * colchete ou barra: escreve as frases alternativas em campos separados e
 * clica nas pílulas pra inserir uma variável dentro de qualquer uma delas.
 */
export function MessageVariationEditor({
  initialOptions,
  onSave,
  onCancel,
}: {
  initialOptions: string[];
  onSave: (options: string[]) => void;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<string[]>(
    initialOptions.length >= 2 ? initialOptions : [...initialOptions, "", ""].slice(0, 2),
  );
  const [focusedOptionIndex, setFocusedOptionIndex] = useState(0);
  const inputRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  function updateOption(i: number, value: string) {
    // "|" quebraria a separação das opções por trás — nunca deixa digitar.
    // Chaves continuam liberadas: é assim que uma variável ({cargo}) entra
    // dentro de uma opção.
    const clean = value.replace(/\|/g, "");
    setOptions((prev) => prev.map((o, idx) => (idx === i ? clean : o)));
  }

  function addOption() {
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
    if (focusedOptionIndex >= i) setFocusedOptionIndex((prev) => Math.max(0, prev - 1));
  }

  /** Insere a variável na posição do cursor da opção que estava com foco por último. */
  function insertVariableIntoOption(token: string) {
    const idx = focusedOptionIndex;
    const el = inputRefs.current[idx];
    const current = options[idx] ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setOptions((prev) => prev.map((o, i) => (i === idx ? next : o)));

    const cursor = start + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSave = validOptions.length >= 2;

  return (
    <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <p className="text-xs text-neutral-600 dark:text-neutral-300">
        Escreva formas diferentes de dizer a mesma coisa — o sistema escolhe uma ao acaso em cada envio.
      </p>

      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-medium text-violet-600 dark:bg-neutral-900 dark:text-violet-300">
              {i + 1}
            </span>
            <textarea
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              autoFocus={i === 0}
              value={opt}
              rows={1}
              onFocus={() => setFocusedOptionIndex(i)}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={i === 0 ? "Ex.: Tudo bem?" : "Ex.: Como vai?"}
              // resize-y (não resize-none nem resize-both): dá pra puxar só a
              // borda de baixo com o mouse pra aumentar a altura quando o
              // texto da opção for maior — largura fica fixa de propósito.
              className="field-input scrollbar-thin min-h-[38px] resize-y py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => removeOption(i)}
              disabled={options.length <= 2}
              className="icon-btn mt-0.5 h-7 w-7 shrink-0 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Remover opção ${i + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={addOption} className="btn-ghost btn-sm w-full justify-center">
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        Adicionar outra opção
      </button>

      <div className="space-y-1 border-t border-violet-200/60 pt-2 dark:border-violet-500/20">
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Inserir na opção <span className="font-medium text-violet-700 dark:text-violet-300">{focusedOptionIndex + 1}</span>:
        </p>
        <VariablePills onInsert={insertVariableIntoOption} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-ghost btn-sm">
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          Cancelar
        </button>
        <button type="button" disabled={!canSave} onClick={() => onSave(validOptions)} className="btn-primary btn-sm">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          Salvar
        </button>
      </div>
    </div>
  );
}
