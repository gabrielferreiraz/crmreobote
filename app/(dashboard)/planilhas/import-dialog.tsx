"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { SHEET_COLUMN_TYPE_LABELS, type SheetColumnType } from "@/lib/sheets/column-types";
import { columnLabel, type ClientColumn } from "@/lib/sheets/format";

type Preview = { header: string[]; totalRows: number; sample: string[][]; suggested: { type: SheetColumnType; options?: string[] }[] };
type Result = { sheetId: string; created: number; skipped: { line: number; error: string }[]; unmatched: number };

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Importar .xlsx/.csv. `new` cria uma planilha com as colunas e tipos
 * detectados; `append` adiciona linhas numa planilha existente, casando
 * cada coluna dela com uma coluna do arquivo (pré-preenchido pelo nome).
 */
export function ImportDialog(
  props:
    | { mode: "new"; onClose: () => void; onDone: (sheetId: string) => void }
    | { mode: "append"; sheetId: string; columns: ClientColumn[]; onClose: () => void; onDone: (sheetId: string) => void },
) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState<Record<string, number | -1>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(f: File) {
    setFile(f);
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.set("file", f);
    form.set("mode", "preview");
    const res = await fetch("/api/sheets/import", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setFile(null);
      return setError(data?.error ?? "Não foi possível ler o arquivo");
    }
    setPreview(data);
    setName(f.name.replace(/\.(xlsx|csv)$/i, ""));
    if (props.mode === "append") {
      const headers = (data as Preview).header.map(normalize);
      setMapping(Object.fromEntries(props.columns.map((c) => [c.id, headers.indexOf(normalize(c.name))])));
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    if (props.mode === "new") {
      form.set("mode", "new");
      form.set("name", name);
    } else {
      form.set("mode", "append");
      form.set("sheetId", props.sheetId);
      form.set("mapping", JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v >= 0))));
    }
    const res = await fetch("/api/sheets/import", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(data?.error ?? "A importação falhou");
    setResult(data);
  }

  const mappedCount = Object.values(mapping).filter((v) => v >= 0).length;

  return (
    <Modal onClose={props.onClose} maxWidth="max-w-2xl" mobileSheet>
      <div className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {props.mode === "new" ? "Importar planilha" : "Importar linhas"}
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Arquivo .xlsx ou .csv, até 25 MB. A primeira linha precisa ter os nomes das colunas.
          </p>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-sm text-emerald-900 dark:text-emerald-200">
                <p className="font-medium">{result.created.toLocaleString("pt-BR")} linha(s) importada(s).</p>
                {result.unmatched > 0 && (
                  <p className="text-emerald-800/80 dark:text-emerald-200/80">
                    {result.unmatched} cliente(s)/membro(s) não foram encontrados no CRM e ficaram em branco.
                  </p>
                )}
              </div>
            </div>
            {result.skipped.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4" /> {result.skipped.length} linha(s) recusada(s)
                </p>
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs text-amber-900/90 dark:text-amber-200/90">
                  {result.skipped.slice(0, 100).map((s) => (
                    <li key={s.line}>
                      <span className="font-mono">Linha {s.line}</span> — {s.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" className="btn-primary btn-sm" onClick={() => props.onDone(result.sheetId)}>
                {props.mode === "new" ? "Abrir planilha" : "Concluir"}
              </button>
            </div>
          </div>
        ) : !preview ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) pick(f);
            }}
            className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-sm transition-colors ${
              dragOver ? "border-brand bg-brand/5" : "border-neutral-200 hover:border-brand/50 dark:border-neutral-700"
            }`}
          >
            {busy ? (
              <LoadingDots />
            ) : (
              <>
                <FileUp className="h-6 w-6 text-neutral-400" />
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Arraste o arquivo aqui ou clique para escolher</span>
                <span className="text-xs text-neutral-400">.xlsx ou .csv</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pick(f);
                e.target.value = "";
              }}
            />
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{file?.name}</span> · {preview.totalRows.toLocaleString("pt-BR")} linha(s) ·{" "}
              {preview.header.length} coluna(s)
              <button type="button" className="ml-2 text-brand hover:underline" onClick={() => { setPreview(null); setFile(null); }}>
                trocar arquivo
              </button>
            </p>

            {props.mode === "new" ? (
              <>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nome da planilha</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="field-input w-full" />
                </label>
                <div className="overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-50 dark:bg-neutral-800/50">
                      <tr>
                        {preview.header.map((h, i) => (
                          <th key={i} className="border-b border-neutral-200 px-2 py-1.5 text-left font-medium whitespace-nowrap dark:border-neutral-800">
                            <div className="text-neutral-900 dark:text-neutral-100">{h}</div>
                            <div className="font-normal text-brand">{SHEET_COLUMN_TYPE_LABELS[preview.suggested[i].type]}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.slice(0, 6).map((r, ri) => (
                        <tr key={ri} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                          {preview.header.map((_, ci) => (
                            <td key={ci} className="max-w-[180px] truncate px-2 py-1 text-neutral-600 dark:text-neutral-400">{r[ci]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Os tipos foram detectados pelos valores. Dá para trocar depois, no menu de cada coluna.</p>
              </>
            ) : (
              <div className="max-h-80 space-y-1.5 overflow-auto rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">De qual coluna do arquivo vem cada coluna da planilha:</p>
                {props.columns.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="w-1/2 truncate font-medium text-neutral-800 dark:text-neutral-200">{columnLabel(c, props.columns.indexOf(c))}</span>
                    <select
                      value={mapping[c.id] ?? -1}
                      onChange={(e) => setMapping((m) => ({ ...m, [c.id]: Number(e.target.value) }))}
                      className="field-input w-1/2 py-1 text-sm"
                    >
                      <option value={-1}>— não importar —</option>
                      {preview.header.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost btn-sm" onClick={props.onClose}>Cancelar</button>
              <button type="button" className="btn-primary btn-sm" disabled={busy || (props.mode === "append" && mappedCount === 0)} onClick={run}>
                {busy ? <LoadingDots /> : `Importar ${preview.totalRows.toLocaleString("pt-BR")} linha(s)`}
              </button>
            </div>
          </div>
        )}
        {!preview && error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
