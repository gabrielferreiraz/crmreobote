"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/modal";

export type DeleteTarget = { rowIds: string[]; columnIds: string[]; headerOnly: boolean };

/**
 * Ctrl+- com células comuns selecionadas: como a caixa "Excluir" do Excel, pergunta se sai a
 * linha inteira ou a coluna inteira. (Deslocar só as células para cima/esquerda não existe
 * aqui: cada linha é um registro — mover metade dela misturaria dados de registros diferentes.)
 */
export function DeleteDialog({
  target,
  onRows,
  onColumns,
  onClose,
}: {
  target: DeleteTarget;
  onRows: () => void;
  onColumns: () => void;
  onClose: () => void;
}) {
  const rowsOk = target.rowIds.length > 0;
  const colsOk = target.columnIds.length > 0;
  const [mode, setMode] = useState<"rows" | "columns">(rowsOk ? "rows" : "columns");
  const options = [
    {
      id: "rows" as const,
      label: rowsOk ? `Linha inteira (${target.rowIds.length})` : "Linha inteira",
      description: rowsOk
        ? "As linhas abaixo sobem. Ctrl+Z desfaz."
        : target.headerOnly
          ? "A linha 1 guarda os títulos das colunas e não é excluída — use Delete para limpar."
          : "Não há linhas com dados na seleção.",
      disabled: !rowsOk,
    },
    {
      id: "columns" as const,
      label: colsOk ? `Coluna inteira (${target.columnIds.length})` : "Coluna inteira",
      description: colsOk ? "As colunas da direita andam para a esquerda. Dá para restaurar em Dados → Colunas Arquivadas." : "Não há colunas com dados na seleção.",
      disabled: !colsOk,
    },
  ];
  const confirm = () => {
    if (mode === "rows" && rowsOk) onRows();
    else if (mode === "columns" && colsOk) onColumns();
    onClose();
  };
  return (
    <Modal onClose={onClose} maxWidth="max-w-sm" panelClassName="!rounded-[6px] !p-0 font-sans text-neutral-900 dark:text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
        <h2 className="text-[15px] font-semibold">Excluir</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </div>
      <fieldset className="space-y-1 p-4 text-[13px]">
        <legend className="mb-2 font-semibold">Excluir</legend>
        {options.map((option) => (
          <label
            key={option.id}
            className={`flex items-start gap-2 rounded-[3px] border px-3 py-2 ${option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${mode === option.id ? "border-[var(--xl)] bg-[var(--xl-soft)]" : "border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
          >
            <input type="radio" name="delete-mode" value={option.id} checked={mode === option.id} disabled={option.disabled} onChange={() => setMode(option.id)} className="mt-0.5 accent-[var(--xl)]" />
            <span><span className="block font-medium">{option.label}</span><span className="text-[12px] text-neutral-500 dark:text-neutral-400">{option.description}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <button type="button" onClick={onClose} className="rounded-[3px] border border-neutral-300 bg-white px-4 py-1.5 text-[13px] text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">Cancelar</button>
        <button type="button" autoFocus disabled={!rowsOk && !colsOk} onClick={confirm} className="rounded-[3px] bg-[var(--xl-btn)] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--xl-btn-hover)] disabled:opacity-50">OK</button>
      </div>
    </Modal>
  );
}
