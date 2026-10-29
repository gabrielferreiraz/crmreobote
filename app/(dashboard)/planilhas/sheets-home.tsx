"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, FileSpreadsheet, Plus, Search, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { ImportDialog } from "./import-dialog";

export type SheetCard = { id: string; name: string; description: string; rowCount: number; updatedAt: string };

function relativeDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  return d.toLocaleDateString("pt-BR");
}

export function SheetsHome({ initialSheets, initialArchived }: { initialSheets: SheetCard[]; initialArchived: SheetCard[] }) {
  const router = useRouter();
  const [sheets, setSheets] = useState(initialSheets);
  const [archived, setArchived] = useState(initialArchived);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<SheetCard | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const list = showArchived ? archived : sheets;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) : list;
  }, [list, query]);

  async function restore(sheet: SheetCard) {
    const res = await fetch(`/api/sheets/${sheet.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: false }) });
    if (!res.ok) return alert((await res.json().catch(() => null))?.error ?? "Não foi possível restaurar");
    setArchived((a) => a.filter((s) => s.id !== sheet.id));
    setSheets((s) => [{ ...sheet, updatedAt: new Date().toISOString() }, ...s]);
  }

  async function archive(sheet: SheetCard) {
    setArchiveError(null);
    const res = await fetch(`/api/sheets/${sheet.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setArchiveError(data?.error ?? "Não foi possível arquivar a planilha");
      return;
    }
    setSheets((current) => current.filter((item) => item.id !== sheet.id));
    setArchived((current) => [{ ...sheet, updatedAt: new Date().toISOString() }, ...current]);
    setArchiveTarget(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-brand">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Planilhas</h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Listas e controles do administrativo, ligados aos clientes do CRM.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary btn-sm inline-flex items-center gap-1.5" onClick={() => setImporting(true)}>
            <Upload className="h-3.5 w-3.5" /> Importar Excel/CSV
          </button>
          <button type="button" className="btn-primary btn-sm inline-flex items-center gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Nova planilha
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar planilha" className="field-input w-full pl-8 text-sm" />
        </div>
        <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 text-sm dark:border-neutral-800">
          {[
            { v: false, label: `Ativas (${sheets.length})` },
            { v: true, label: `Arquivadas (${archived.length})` },
          ].map((t) => (
            <button
              key={String(t.v)}
              type="button"
              onClick={() => setShowArchived(t.v)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                showArchived === t.v ? "bg-brand text-white" : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800">
          {showArchived ? (
            <EmptyState icon={Archive} title="Nenhuma planilha arquivada" description="Planilhas arquivadas aparecem aqui e podem ser restauradas." />
          ) : query ? (
            <EmptyState icon={Search} title="Nada encontrado" description={`Nenhuma planilha com "${query}".`} />
          ) : (
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma planilha ainda"
              description="Crie do zero ou traga a planilha que vocês já usam no Excel ou no Google Sheets."
              action={
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setImporting(true)}>Importar</button>
                  <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>Nova planilha</button>
                </div>
              }
            />
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) =>
            showArchived ? (
              <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 opacity-80 dark:border-neutral-800 dark:bg-neutral-900">
                <SheetCardBody sheet={s} />
                <button type="button" className="btn-secondary btn-sm mt-1 inline-flex items-center justify-center gap-1.5 self-start" onClick={() => restore(s)}>
                  <ArchiveRestore className="h-3.5 w-3.5" /> Restaurar
                </button>
              </div>
            ) : (
              <div key={s.id} className="group relative rounded-xl border border-neutral-200 bg-white transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-brand/50">
                <Link href={`/planilhas/${s.id}`} target="_blank" rel="noopener noreferrer" className="block p-4 pr-12">
                  <SheetCardBody sheet={s} />
                </Link>
                <button
                  type="button"
                  onClick={() => { setArchiveError(null); setArchiveTarget(s); }}
                  className="icon-btn absolute top-3 right-3 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  aria-label={`Arquivar ${s.name}`}
                  title="Arquivar planilha"
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {creating && (
        <CreateSheetDialog
          onClose={() => setCreating(false)}
          onCreated={(sheet) => {
            setSheets((s) => [sheet, ...s]);
            setCreating(false);
            window.open(`/planilhas/${sheet.id}`, "_blank", "noopener,noreferrer");
          }}
        />
      )}
      {importing && (
        <ImportDialog
          mode="new"
          onClose={() => setImporting(false)}
          onDone={(sheetId) => {
            setImporting(false);
            window.open(`/planilhas/${sheetId}`, "_blank", "noopener,noreferrer");
            router.refresh();
          }}
        />
      )}
      {archiveTarget && (
        <ConfirmDialog
          title={`Arquivar ${archiveTarget.name}?`}
          description="Ela sai da lista ativa, mas os dados e o histórico ficam guardados. Você pode restaurar depois."
          error={archiveError}
          confirmLabel="Arquivar"
          onConfirm={() => archive(archiveTarget)}
          onClose={() => { setArchiveTarget(null); setArchiveError(null); }}
        />
      )}
    </div>
  );
}

function SheetCardBody({ sheet }: { sheet: SheetCard }) {
  return (
    <>
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
          <FileSpreadsheet className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 group-hover:text-brand dark:text-neutral-100">{sheet.name}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {sheet.rowCount.toLocaleString("pt-BR")} {sheet.rowCount === 1 ? "linha" : "linhas"} · {relativeDate(sheet.updatedAt)}
          </p>
        </div>
      </div>
      {sheet.description && <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{sheet.description}</p>}
    </>
  );
}

function CreateSheetDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (sheet: SheetCard) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Dê um nome para a planilha");
    setSaving(true);
    setError(null);
    const res = await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setSaving(false);
      return setError(data?.error ?? "Não foi possível criar");
    }
    onCreated({ id: data.id, name: name.trim(), description: description.trim(), rowCount: 0, updatedAt: new Date().toISOString() });
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" mobileSheet>
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Nova planilha</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Começa em branco, como no Excel: digite os títulos na linha 1 e os dados a partir da linha 2.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nome</span>
          <input ref={inputRef} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Documentos pendentes" className="field-input w-full" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Descrição <span className="font-normal text-neutral-400">(opcional)</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} className="field-input w-full resize-none" />
        </label>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary btn-sm" disabled={saving}>{saving ? <LoadingDots /> : "Criar planilha"}</button>
        </div>
      </form>
    </Modal>
  );
}
