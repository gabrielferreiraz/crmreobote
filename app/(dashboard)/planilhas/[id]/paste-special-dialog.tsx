"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/modal";
import type { PasteSpecialMode } from "./sheet-grid";

const OPTIONS: { id: PasteSpecialMode; label: string; description: string }[] = [
  { id: "all", label: "Tudo", description: "Valores, fórmulas e formatos" },
  { id: "values", label: "Valores", description: "Resultados e constantes, sem fórmulas nem formatos" },
  { id: "formulas", label: "Fórmulas", description: "Fórmulas e constantes, sem formatos" },
  { id: "formats", label: "Formatos", description: "Somente a formatação das células" },
  { id: "transpose", label: "Transpor", description: "Troca linhas por colunas e cola tudo" },
];

export function PasteSpecialDialog({ onPaste, onClose }: { onPaste: (mode: PasteSpecialMode) => void; onClose: () => void }) {
  const [mode, setMode] = useState<PasteSpecialMode>("all");
  return (
    <Modal onClose={onClose} maxWidth="max-w-md" panelClassName="!rounded-[6px] !p-0 font-sans text-neutral-900 dark:text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
        <h2 className="text-[15px] font-semibold">Colar Especial</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </div>
      <fieldset className="space-y-1 p-4 text-[13px]">
        <legend className="mb-2 font-semibold">Colar</legend>
        {OPTIONS.map((option) => (
          <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-[3px] border px-3 py-2 ${mode === option.id ? "border-[var(--xl)] bg-[var(--xl-soft)]" : "border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}>
            <input type="radio" name="paste-special" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} className="mt-0.5 accent-[var(--xl)]" />
            <span><span className="block font-medium">{option.label}</span><span className="text-[12px] text-neutral-500 dark:text-neutral-400">{option.description}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <button type="button" onClick={onClose} className="rounded-[3px] border border-neutral-300 bg-white px-4 py-1.5 text-[13px] text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">Cancelar</button>
        <button type="button" autoFocus onClick={() => onPaste(mode)} className="rounded-[3px] bg-[var(--xl-btn)] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--xl-btn-hover)]">OK</button>
      </div>
    </Modal>
  );
}
