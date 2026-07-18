"use client";

import { useRef, useState } from "react";
import { Loader2, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";

type ImportResult = {
  total: number;
  created: number;
  skipped: number;
  withoutJobTitle?: number;
  stageFallbacks?: number;
  ownerFallbacks?: number;
  valueParseFailures?: number;
};

export function ImportDialog({
  title,
  hint,
  endpoint,
  extraFields,
  onClose,
  onImported,
  renderSummary,
}: {
  title: string;
  hint: string;
  endpoint: string;
  extraFields?: Record<string, string>;
  onClose: () => void;
  onImported: () => void;
  renderSummary?: (result: ImportResult) => string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Selecione um arquivo");
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    for (const [key, value] of Object.entries(extraFields ?? {})) {
      formData.append(key, value);
    }

    const res = await fetch(endpoint, { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao importar arquivo");
      return;
    }

    setResult(data);
    onImported();
  }

  if (result) {
    const summary = renderSummary
      ? renderSummary(result)
      : `${result.created} de ${result.total} importados.${
          result.skipped > 0 ? ` ${result.skipped} ignorados.` : ""
        }`;

    return (
      <Modal onClose={onClose}>
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Importação concluída</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{summary}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-primary">
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center hover:border-neutral-400 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
          <FileSpreadsheet className="h-6 w-6 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            {fileName ?? "Clique para escolher um arquivo"}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !fileName} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Importando
                <LoadingDots />
              </span>
            ) : (
              "Importar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
