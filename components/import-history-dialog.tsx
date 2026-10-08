"use client";

import { useEffect, useState } from "react";
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

type IssueRow = { rowNumber: number; issues: { code: string; message: string }[] } & Record<string, unknown>;

// "name"/"jobTitle" (contato) vs. "contactName"/"dealName" (negócio) — os
// dois formatos de ResolvedRow (ver lib/contacts/import-resolve.ts e
// lib/deals/import-resolve.ts) num painel só, sem precisar de dois
// componentes quase idênticos.
function describeIssueRow(r: IssueRow): string {
  const label = (r.contactName as string | undefined) ?? (r.name as string | undefined);
  return label ? ` (${label})` : "";
}

/** Rótulo do que "não virou X" — plural do tipo, usado no vazio/undo abaixo. */
const ENTITY_LABEL: Record<ImportKind, { singular: string; plural: string }> = {
  deals: { singular: "negócio", plural: "negócios" },
  contacts: { singular: "contato", plural: "contatos" },
};

export type ImportKind = "deals" | "contacts";

/** Linhas com problema de um lote — buscado sob demanda ao expandir (ver toggleExpand), não vem junto na lista pra não pesar o carregamento inicial. */
function IssueRowsPanel({ kind, batchId }: { kind: ImportKind; batchId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<IssueRow[] | null>(null);

  useEffect(() => {
    // Fechar o histórico (ou recolher a linha) cancela a busca do detalhe.
    const controller = new AbortController();
    fetch(`/api/${kind}/import/${batchId}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Erro ao carregar detalhe");
          setLoading(false);
          return;
        }
        setRows(data.issueRows ?? []);
        setLoading(false);
      })
      .catch(() => {
        // Abort não é falha de conexão — não mostra erro nem desliga o
        // "carregando" (o componente já está saindo da tela).
        if (controller.signal.aborted) return;
        setError("Falha de conexão.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [kind, batchId]);

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
    return <p className="py-3 text-xs text-neutral-400 dark:text-neutral-500">Nenhuma linha com problema — tudo virou {ENTITY_LABEL[kind].singular}.</p>;
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto py-2 text-xs">
      {rows.map((r) => (
        <div key={r.rowNumber} className="text-neutral-500 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Linha {r.rowNumber as number}</span>
          {describeIssueRow(r)}: {r.issues.map((i) => i.message).join("; ")}
        </div>
      ))}
    </div>
  );
}

/**
 * Histórico de importações — direto na página de origem (Pipeline pra
 * negócio, Clientes pra contato — ver botão ao lado de "Importar"), sem sair
 * pra Configurações. Busca ao abrir, não recebe nada pronto do servidor (é
 * um modal, não uma página) — mesmo espírito do DealImportDialog/
 * ContactImportDialog, que também resolvem tudo client-side depois de
 * abertos.
 *
 * `kind` decide o namespace da API (/api/deals/import/* ou
 * /api/contacts/import/*) — os dois tipos de ImportBatch (ver schema)
 * nunca se misturam aqui: cada rota de histórico já filtra pelo próprio
 * `type` (ver comentário em app/api/deals/import/history/route.ts).
 */
export function ImportHistoryDialog({ kind, onClose }: { kind: ImportKind; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batchToDelete, setBatchToDelete] = useState<ImportBatch | null>(null);
  // `retryable: false` = o servidor recusou por um motivo que NÃO muda
  // tentando de novo (contato do lote já usado em negócio/tarefa/conversa,
  // lote já desfeito, lote de outra pessoa) — nesse caso o botão de
  // confirmar some em vez de ficar ali repetindo o mesmo erro. Era o bug
  // relatado: a recusa caía no lugar da DESCRIÇÃO do diálogo, em cinza, com
  // o botão intacto — clicar de novo repetia a mesma mensagem, então parecia
  // que o botão não fazia nada.
  const [deleteError, setDeleteError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function loadBatches() {
    setLoading(true);
    setError(null);
    fetch(`/api/${kind}/import/history`)
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

  // Busca ao montar e sempre que `kind` trocar — setState síncrono de
  // propósito (é a própria carga inicial da lista, não uma reação a um
  // valor externo mudando).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(loadBatches, [kind]);

  async function confirmDelete() {
    if (!batchToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/${kind}/import/${batchToDelete.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = recusa de regra (algum registro do lote já foi usado, ou o
        // lote já tinha sido desfeito); 403/404 = não é seu pra desfazer.
        // Nenhum desses muda clicando de novo. Qualquer outro (500, etc.) é
        // falha momentânea e vale deixar tentar.
        const retryable = ![403, 404, 409].includes(res.status);
        setDeleteError({ message: data.error ?? "Erro ao desfazer importação", retryable });
        setDeleting(false);
        return;
      }
      setBatchToDelete(null);
      setDeleting(false);
      loadBatches();
    } catch {
      setDeleteError({ message: "Falha de conexão. Tente novamente.", retryable: true });
      setDeleting(false);
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-4xl">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histórico de importações</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        {kind === "contacts"
          ? // Única exceção de visibilidade por papel nesta tela: Dono vê a importação de
            // qualquer usuário da organização (ver app/api/contacts/import/history/route.ts);
            // os demais papéis continuam só com a própria, igual sempre foi.
            "Os arquivos que você mesmo importou, com quando e quantas linhas entraram — o Dono também vê as importações de todos os outros usuários da organização."
          : "Os arquivos que você mesmo importou, com quando e quantas linhas entraram — importação de outra pessoa não aparece aqui, mesmo pra Dono/Gerente."}
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
          <EmptyState icon={UploadCloud} title="Nenhuma importação ainda" description="Quando você importar uma planilha, o lote aparece aqui." />
        </div>
      ) : (
        // Lista, não tabela — pedido explícito: "cheio de informações que o
        // consultor nem vai olhar". Uma tabela de 7 colunas dava o MESMO peso
        // visual pra arquivo/quem/quando/total/criados/erros, quando só uma
        // coisa importa de cara: "quanto entrou" — e só quando algo ficou de
        // fora é que vale abrir pra ver/agir. O resto (arquivo, quem, hora)
        // vira contexto pequeno numa linha só, pra achar o lote certo sem
        // disputar atenção com o resultado dele.
        <div className="card max-h-[65vh] divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800">
          {batches.map((b) => {
            const isExpanded = expandedId === b.id;
            const isUndone = !!b.deletedAt;
            const hasIssues = b.rowsSkipped > 0;
            const date = new Date(b.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
            return (
              <div key={b.id} className={isUndone ? "opacity-60" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3">
                  <div className="min-w-0">
                    {/* Resultado primeiro e maior — a pergunta real de quem abre esta tela
                        é "entrou tudo?", não "qual arquivo foi". Só vira botão (com seta)
                        quando há algo pra ver; sem erro nenhum, é só texto, sem convite
                        a clicar em nada que não leva a lugar nenhum. */}
                    {hasIssues ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : b.id)}
                        className="flex flex-wrap items-center gap-2 text-left"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${isExpanded ? "rotate-90" : ""}`} strokeWidth={2.5} />
                        <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                          {b.rowsCreated} de {b.rowsTotal} {ENTITY_LABEL[kind].plural}
                        </span>
                        <Badge tone="warning" size="sm">
                          {b.rowsSkipped} não {b.rowsSkipped === 1 ? "entrou" : "entraram"}
                        </Badge>
                        {isUndone && <Badge tone="neutral" size="sm">Desfeita</Badge>}
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 pl-[1.375rem]">
                        <span className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                          {b.rowsCreated} {ENTITY_LABEL[kind].plural}
                        </span>
                        {isUndone && <Badge tone="neutral" size="sm">Desfeita</Badge>}
                      </div>
                    )}
                    {/* Contexto — quem, quando, qual arquivo — pequeno e junto numa linha só,
                        só pra achar o lote certo no meio de vários, nunca o foco da tela. */}
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 pl-[1.375rem] text-xs text-neutral-500 dark:text-neutral-400">
                      <Avatar name={b.createdBy.name} src={b.createdBy.photoUrl} size="xs" className="shrink-0" />
                      {b.createdBy.name} <span aria-hidden="true">·</span> {date}
                      <span aria-hidden="true">·</span>
                      <span className="max-w-[16rem] truncate" title={b.fileName}>{b.fileName}</span>
                    </p>
                  </div>
                  {!isUndone && (
                    <div className="flex shrink-0 items-center gap-1">
                      {hasIssues && (
                        <a href={`/api/${kind}/import/${b.id}/errors`} download className="icon-btn-labeled">
                          <Download className="h-3.5 w-3.5" strokeWidth={2} />
                          Baixar erros
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setBatchToDelete(b);
                        }}
                        className="icon-btn-labeled hover:text-red-600 dark:hover:text-red-400"
                        title={`Apaga os ${ENTITY_LABEL[kind].plural} criados por essa importação`}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        Desfazer
                      </button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  // pl-[2.125rem] = o mesmo recuo da linha de contexto acima (p-3 do
                  // bloco + pl-[1.375rem] dela) — o painel de erros fica visualmente
                  // "dentro" do resultado que ele detalha, não solto na margem do card.
                  <div className="border-t border-neutral-100 bg-neutral-50/60 py-1 pr-3 pl-[2.125rem] dark:border-neutral-800 dark:bg-neutral-900/30">
                    <IssueRowsPanel kind={kind} batchId={b.id} />
                  </div>
                )}
              </div>
            );
          })}
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
          // A explicação da regra fica SEMPRE aqui; a recusa do servidor vai
          // pro `error` abaixo (vermelho, destacado) — ver comentário em
          // deleteError acima.
          description={
            kind === "deals"
              ? `Apaga os ${batchToDelete.rowsCreated} negócio${batchToDelete.rowsCreated === 1 ? "" : "s"} criados por esse arquivo — só funciona se nenhum deles tiver sido alterado desde então (movido, ganho/perdido, ou já ter atividade registrada). O contato criado junto só é apagado se não tiver ganhado mais nada desde a importação. Essa ação não pode ser desfeita.`
              : `Apaga os ${batchToDelete.rowsCreated} contato${batchToDelete.rowsCreated === 1 ? "" : "s"} criados por esse arquivo — só funciona se nenhum deles tiver ganho negócio, tarefa, conversa de WhatsApp, campanha ou processo desde então. Essa ação não pode ser desfeita.`
          }
          error={deleteError?.message}
          hideConfirm={deleteError?.retryable === false}
          closeLabel={deleteError?.retryable === false ? "Fechar" : "Cancelar"}
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
