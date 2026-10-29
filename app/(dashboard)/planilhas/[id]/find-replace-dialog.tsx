"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/modal";
import { columnLetter, editText, isReferenceType, type ClientColumn, type ClientRow } from "@/lib/sheets/format";

export type FindOptions = { caseSensitive: boolean; wholeCell: boolean };
export type FindMatch = { rowId: string; colId: string; rowNumber: number; colIndex: number; text: string };

export function replaceFoundText(text: string, find: string, replacement: string, options: FindOptions) {
  if (options.wholeCell) return replacement;
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, options.caseSensitive ? "g" : "gi"), replacement);
}

export function FindReplaceDialog({
  initialTab,
  rows,
  columns,
  refs,
  loading,
  formulaText,
  onNavigate,
  onReplace,
  onClose,
}: {
  initialTab: "find" | "replace";
  rows: ClientRow[];
  columns: ClientColumn[];
  refs: Record<string, string>;
  loading: boolean;
  formulaText: (row: ClientRow, col: ClientColumn) => string | undefined;
  onNavigate: (match: FindMatch) => void;
  onReplace: (replacements: { match: FindMatch; text: string }[]) => Promise<number>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => ({ caseSensitive, wholeCell }), [caseSensitive, wholeCell]);

  const matches = useMemo(() => {
    if (!find) return [];
    const needle = caseSensitive ? find : find.toLocaleLowerCase("pt-BR");
    const out: FindMatch[] = [];
    rows.forEach((row, rowIndex) => {
      columns.forEach((col, colIndex) => {
        const formula = formulaText(row, col);
        const text = formula ?? (isReferenceType(col.type) ? refs[String(row.values[col.id] ?? "")] ?? "" : editText(col, row.values[col.id]));
        const candidate = caseSensitive ? text : text.toLocaleLowerCase("pt-BR");
        const hit = wholeCell ? candidate === needle : candidate.includes(needle);
        if (hit) out.push({ rowId: row.id, colId: col.id, rowNumber: (row.rank ?? rowIndex + 1) + 1, colIndex, text });
      });
    });
    return out;
  }, [find, caseSensitive, wholeCell, rows, columns, formulaText, refs]);

  function next() {
    if (!find || !matches.length) {
      setResult(find ? "Não foi possível localizar o que você está procurando." : "Digite o conteúdo a localizar.");
      return;
    }
    const index = (current + 1) % matches.length;
    setCurrent(index);
    setResult(`${index + 1} de ${matches.length}`);
    onNavigate(matches[index]);
  }

  async function replace(items: FindMatch[]) {
    if (!items.length || !find) return next();
    setBusy(true);
    setResult("");
    try {
      const count = await onReplace(items.map((match) => ({ match, text: replaceFoundText(match.text, find, replacement, options) })));
      setResult(`${count} ${count === 1 ? "substituição realizada" : "substituições realizadas"}.`);
      setCurrent(-1);
      setShowAll(false);
    } catch (error) {
      setResult((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl" panelClassName="!rounded-[6px] !p-0 font-sans text-neutral-900 dark:text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
        <h2 className="text-[15px] font-semibold">Localizar e Substituir</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex border-b border-neutral-200 px-4 dark:border-neutral-700">
        {(["find", "replace"] as const).map((id) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 px-3 py-2 text-[13px] ${tab === id ? "border-[var(--xl)] font-semibold text-[var(--xl)]" : "border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"}`}>
            {id === "find" ? "Localizar" : "Substituir"}
          </button>
        ))}
      </div>
      <div className="space-y-3 p-4 text-[13px]">
        <label className="grid grid-cols-[110px_1fr] items-center gap-2">
          <span>Localizar:</span>
          <input autoFocus value={find} onChange={(e) => (setFind(e.target.value), setCurrent(-1), setShowAll(false), setResult(""))} onKeyDown={(e) => e.key === "Enter" && next()} className="h-8 rounded-[3px] border border-neutral-300 bg-white px-2 text-neutral-900 outline-none focus:border-[var(--xl)] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100" />
        </label>
        {tab === "replace" && (
          <label className="grid grid-cols-[110px_1fr] items-center gap-2">
            <span>Substituir por:</span>
            <input value={replacement} onChange={(e) => setReplacement(e.target.value)} className="h-8 rounded-[3px] border border-neutral-300 bg-white px-2 text-neutral-900 outline-none focus:border-[var(--xl)] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100" />
          </label>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <label className="flex items-center gap-2"><input type="checkbox" checked={caseSensitive} onChange={(e) => (setCaseSensitive(e.target.checked), setCurrent(-1))} className="accent-[var(--xl)]" /> Diferenciar maiúsculas</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={wholeCell} onChange={(e) => (setWholeCell(e.target.checked), setCurrent(-1))} className="accent-[var(--xl)]" /> Coincidir conteúdo da célula inteira</label>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {tab === "replace" && <button type="button" disabled={busy || loading || !find} onClick={() => replace(current >= 0 ? [matches[current]] : matches.slice(0, 1))} className="rounded-[3px] border border-neutral-300 bg-white px-3 py-1.5 text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">Substituir</button>}
          {tab === "replace" && <button type="button" disabled={busy || loading || !find} onClick={() => replace(matches)} className="rounded-[3px] border border-neutral-300 bg-white px-3 py-1.5 text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">Substituir Tudo</button>}
          <button type="button" disabled={loading || !find} onClick={next} className="rounded-[3px] border border-neutral-300 bg-white px-3 py-1.5 text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">Localizar Próxima</button>
          <button type="button" disabled={loading || !find} onClick={() => (setShowAll(true), setResult(`${matches.length} célula(s) localizada(s)`))} className="rounded-[3px] bg-[var(--xl-btn)] px-3 py-1.5 font-medium text-white hover:bg-[var(--xl-btn-hover)] disabled:opacity-40">Localizar Tudo</button>
        </div>
        <p className="min-h-5 text-neutral-600 dark:text-neutral-400" aria-live="polite">{loading ? "Carregando a planilha inteira…" : result}</p>
        {showAll && (
          <div className="max-h-52 overflow-auto rounded border border-neutral-200 dark:border-neutral-700">
            <div className="sticky top-0 grid grid-cols-[90px_1fr] bg-neutral-100 px-2 py-1 font-semibold dark:bg-neutral-800"><span>Célula</span><span>Conteúdo</span></div>
            {matches.map((match, index) => (
              <button key={`${match.rowId}:${match.colId}`} type="button" onClick={() => (setCurrent(index), onNavigate(match))} className="grid w-full grid-cols-[90px_1fr] border-t border-neutral-100 px-2 py-1 text-left hover:bg-[var(--xl-soft)] dark:border-neutral-800">
                <span className="font-medium text-[var(--xl)]">{columnLetter(match.colIndex)}{match.rowNumber}</span><span className="truncate text-neutral-700 dark:text-neutral-300">{match.text}</span>
              </button>
            ))}
            {!matches.length && <p className="px-2 py-3 text-center text-neutral-500">Nenhuma célula localizada.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
