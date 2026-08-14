"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2, UploadCloud, ChevronRight, Download, Trash2 } from "lucide-react";
import { Modal } from "./modal";
import { Avatar } from "./avatar";
import { EmptyState } from "./empty-state";
import { ConfirmDialog } from "./confirm-dialog";
import { Badge } from "./badge";

type ImportBatch = {
  id: string;
  type: string;
  fileName: string;
  rowsTotal: number;
  rowsCreated: number;
  rowsSkipped: number;
  createdAt: string;
  deletedAt: string | null;
  createdBy: { name: string; photoUrl: string | null };
};

type IssueRow = { rowNumber: number; contactName: string | null; dealName: string | null; issues: { code: string; message: string }[] };

const TYPE_LABEL: Record<string, string> = { deals: "Negócios" };

/** Linhas com problema de um lote — buscado sob demanda ao expandir (ver toggleExpand), não vem junto na lista pra não pesar o carregamento inicial. */
function IssueRowsPanel({ batchId }: { batchId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<IssueRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/import/${batchId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Erro ao carregar detalhe");
          setLoading(false);
          return;
        }
        setRows(data.issueRows ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Falha de conexão.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-neutral-400 dark:text-neutral-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
        Carregando…
      </div>
    );
  }
  if (error) return <p className="py-3 text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!rows || rows.length === 0) {
    return <p className="py-3 text-xs text-neutral-400 dark:text-neutral-500">Nenhuma linha com problema — tudo virou negócio.</p>;
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto py-2 text-xs">
      {rows.map((r) => (
        <div key={r.rowNumber} className="text-neutral-500 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Linha {r.rowNumber}</span>
          {r.contactName ? ` (${r.contactName})` : ""}: {r.issues.map((i) => i.message).join("; ")}
        </div>
      ))}
    </div>
  );
}

/**
 * Histórico de importações — direto na página de Pipeline (ver botão ao
 * lado de "Importar" em pipeline-view.tsx), sem sair pra Configurações.
 * Busca ao abrir, não recebe nada pronto do servidor (é um modal, não uma
 * página) — mesmo espírito do DealImportDialog, que também resolve tudo
 * client-side depois de aberto.
 */
export function ImportHistoryDialog({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<ImportBatch | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function loadBatches() {
    setLoading(true);
    setError(null);
    fetch("/api/deals/import/history")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Erro ao carregar histórico");
          setLoading(false);
          return;
        }
        setBatches(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Falha de conexão. Tente novamente.");
        setLoading(false);
      });
  }

  useEffect(loadBatches, []);

  async function confirmDelete() {
    if (!batchToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/deals/import/${batchToDelete.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error ?? "Erro ao desfazer importação");
        setDeleting(false);
        return;
      }
      setBatchToDelete(null);
      setDeleting(false);
      loadBatches();
    } catch {
      setDeleteError("Falha de conexão. Tente novamente.");
      setDeleting(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-4xl">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histórico de importações</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Todo arquivo importado fica registrado aqui — quem importou, quando e quantas linhas entraram.
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400 dark:text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          Carregando…
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !batches || batches.length === 0 ? (
        <div className="py-4">
          <EmptyState icon={UploadCloud} title="Nenhuma importação ainda" description="Quando alguém importar uma planilha, o lote aparece aqui." />
        </div>
      ) : (
        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-neutral-100 bg-white text-left text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
                <th className="px-3 py-2.5 font-medium">Arquivo</th>
                <th className="px-3 py-2.5 font-medium">Quem</th>
                <th className="px-3 py-2.5 font-medium">Quando</th>
                <th className="px-3 py-2.5 font-medium">Linhas</th>
                <th className="px-3 py-2.5 font-medium">Criados</th>
                <th className="px-3 py-2.5 font-medium">Não importados</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const isExpanded = expandedId === b.id;
                const isUndone = !!b.deletedAt;
                return (
                  <Fragment key={b.id}>
                    <tr className={`border-b border-neutral-50 last:border-0 dark:border-neutral-900 ${isUndone ? "opacity-50" : ""}`}>
                      <td className="max-w-48 truncate px-3 py-2.5 font-medium text-neutral-900 dark:text-neutral-100" title={b.fileName}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : b.id)}
                          className="flex w-full items-center gap-1 text-left hover:text-brand"
                        >
                          <ChevronRight className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${isExpanded ? "rotate-90" : ""}`} strokeWidth={2} />
                          <span className="truncate">{b.fileName}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300">
                          <Avatar name={b.createdBy.name} src={b.createdBy.photoUrl} size="xs" />
                          {b.createdBy.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-500 dark:text-neutral-400">
                        {new Date(b.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-neutral-700 dark:text-neutral-300">{b.rowsTotal}</td>
                      <td className="px-3 py-2.5 tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{b.rowsCreated}</td>
                      <td className="px-3 py-2.5 tabular-nums text-neutral-500 dark:text-neutral-400">{b.rowsSkipped}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {isUndone ? (
                            <Badge tone="neutral" size="sm">desfeita</Badge>
                          ) : (
                            <>
                              {b.rowsSkipped > 0 && (
                                <a
                                  href={`/api/deals/import/${b.id}/errors`}
                                  download
                                  className="icon-btn"
                                  title="Baixar planilha de erros"
                                >
                                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteError(null);
                                  setBatchToDelete(b);
                                }}
                                className="icon-btn hover:text-red-600 dark:hover:text-red-400"
                                title="Desfazer importação (apaga os negócios criados por ela)"
                              >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-neutral-50 bg-neutral-50/50 dark:border-neutral-900 dark:bg-neutral-900/30">
                        <td colSpan={7} className="px-3">
                          <IssueRowsPanel batchId={b.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="btn-primary">
          Fechar
        </button>
      </div>

      {batchToDelete && (
        <ConfirmDialog
          title={`Desfazer a importação de "${batchToDelete.fileName}"?`}
          description={
            deleteError ??
            `Apaga os ${batchToDelete.rowsCreated} negócio${batchToDelete.rowsCreated === 1 ? "" : "s"} criados por esse arquivo — só funciona se nenhum deles tiver sido alterado desde então (movido, ganho/perdido, ou já ter atividade registrada). O contato criado junto só é apagado se não tiver ganhado mais nada desde a importação. Essa ação não pode ser desfeita.`
          }
          confirmLabel={deleting ? "Desfazendo…" : "Desfazer importação"}
          onClose={() => {
            setBatchToDelete(null);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </Modal>
  );
}
