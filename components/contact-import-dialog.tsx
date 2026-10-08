"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { Select } from "./select";
import { useFileDrop } from "@/lib/use-file-drop";
import { downloadContactImportTemplate } from "@/lib/contact-import-template";
import { trackUse } from "@/lib/feature-usage/track";
import { requestJson } from "@/lib/client-request";
import { MAX_CONTACT_IMPORT_ROWS } from "@/lib/contacts/import-limits";
import { MAPPING_NONE, MAPPING_SKIP } from "@/lib/contacts/import-mapping";
// Só tipos — o módulo em si puxa o leitor de planilha (servidor), mas
// `import type` some na compilação e nada dele vai pro navegador.
import type {
  ColumnDetection,
  ContactImportField,
  DecisionField,
  DivergentField,
  ExistingContactMatch,
  ImportPlanSummary,
  PendingValue,
  ResolvedRow,
  ValueMappings,
} from "@/lib/contacts/import-resolve";

type DuplicateRow = ResolvedRow & { existingContact: ExistingContactMatch };
type PreviewResponse = {
  rawHeaderRow: string[];
  columnSamples: string[][];
  columns: ColumnDetection[];
  missingRequiredColumns: ColumnDetection[];
  summary: ImportPlanSummary;
  pendingValues: PendingValue[];
  rows: ResolvedRow[];
  rowsShown: number;
  duplicateRows: DuplicateRow[];
  duplicateRowsTruncated: boolean;
};
type ImportResult = ImportPlanSummary & {
  total: number;
  created: number;
  /** Contatos que já existiam e foram atualizados com o que a planilha trazia
   * de diferente (ver POST /api/contacts/import) — pode ser menor que
   * `contactsToUpdate` se alguém apagou/mexeu no contato no meio do caminho. */
  updatedExisting: number;
  /** Divergência detectada mas NÃO aplicada por estar fora do escopo de quem
   * importou (lead de outro consultor) — não é erro, é a regra de permissão. */
  updateBlocked: number;
  /** Preenchido só quando a etapa de atualização quebrou de verdade — os
   * contatos novos entraram do mesmo jeito. */
  updateFailed: string | null;
  skipped: number;
  importBatchId: string;
  issueRows: ResolvedRow[];
};

type Step = "pick" | "columns" | "review" | "done";
type Overrides = Partial<Record<ContactImportField, number>>;
type LeadActionResult = { kind: "claimed" | "requested" | "already-target" } | { kind: "error"; message: string };

/** Quantos pedidos de "Atribuir/Pedir" em massa rodam ao mesmo tempo — 300
 * de uma vez só derrubava a cota/conexões do servidor e metade voltava erro. */
const BULK_CONCURRENCY = 5;

/** Texto curto da coluna "Situação" — o motivo principal de cada linha. */
const ISSUE_LABEL: Record<string, string> = {
  NO_NAME: "Sem nome",
  NO_JOB_TITLE: "Sem cargo",
  UNKNOWN_SOURCE: "Origem ignorada",
  DUPLICATE_CONTACT: "Já existe",
  INVALID_WHATSAPP: "WhatsApp inválido",
  INVALID_PHONE: "Celular inválido",
  OWNER_NOT_FOUND: "Responsável não achado",
  INVALID_STATE: "UF ignorada",
  INVALID_ZIP: "CEP ignorado",
};

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

const decisionId = (field: DecisionField, key: string) => `${field}:${key}`;

/**
 * Importação de contatos em 3 telas: Colunas (o que é cada coluna da
 * planilha) → Revisar (o que vai acontecer, sem gravar nada ainda: só
 * pergunta o que não bateu com o CRM, e mostra os contatos que já existem,
 * com Atribuir/Pedir) → Resultado. A prévia e a importação usam o MESMO cálculo no servidor
 * (lib/contacts/import-resolve.ts), então o que a revisão mostra é o que grava.
 */
export function ContactImportDialog({
  members,
  jobTitles,
  sources,
  currentUserId,
  onClose,
  onImported,
}: {
  members: { id: string; name: string }[];
  /** Configurações → Cargos — as opções pra um cargo da planilha que não existe no CRM. */
  jobTitles: { id: string; label: string }[];
  /** Idem, Configurações → Origens. */
  sources: { id: string; label: string }[];
  /** Quem está importando — destino de "Atribuir" numa linha que não diz pra quem vai. */
  currentUserId?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"analyzing" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  // Resposta pra cada valor que não bateu com o CRM (ver PendingValue) —
  // chave "campo:valor". Fica de pé entre análises: voltar pras colunas e
  // revisar de novo não apaga o que já foi respondido.
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reviewTab, setReviewTab] = useState<"rows" | "duplicates">("rows");
  const [showIssueRows, setShowIssueRows] = useState(false);
  // Por id do CONTATO existente (não da linha) — a mesma pessoa pode colidir
  // em mais de uma linha e todas refletem a mesma ação.
  const [leadBusy, setLeadBusy] = useState<Record<string, true>>({});
  const [leadResult, setLeadResult] = useState<Record<string, LeadActionResult>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState<Record<string, true>>({});
  const [updateResult, setUpdateResult] = useState<Record<string, { ok: true } | { ok: false; message: string }>>({});

  const memberName = (id: string | null | undefined) => (id ? (members.find((m) => m.id === id)?.name ?? null) : null);

  async function analyze(picked: File, nextOverrides: Overrides, opts: { nextStep: Step; allRows?: boolean }) {
    setBusy("analyzing");
    setError(null);
    const formData = new FormData();
    formData.append("file", picked);
    if (Object.keys(nextOverrides).length > 0) formData.append("columnOverrides", JSON.stringify(nextOverrides));
    if (opts.allRows) formData.append("includeAllRows", "true");

    const res = await requestJson<PreviewResponse>("/api/contacts/import/preview", { method: "POST", body: formData }, { silent: true, errorMessage: "Não foi possível ler o arquivo" });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview(res.data);
    setStep(opts.nextStep);
  }

  function pickFile(picked: File) {
    setFile(picked);
    setPreview(null);
    setOverrides({});
    setDecisions({});
    setLeadResult({});
    setUpdateResult({});
    setReviewTab("rows");
    analyze(picked, {}, { nextStep: "columns" });
  }

  function resetFile() {
    setStep("pick");
    setFile(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const { isDraggingOver, dropZoneProps } = useFileDrop(pickFile, busy !== null);

  // ─── Mapeamento coluna da planilha ↔ campo do CRM ─────────────────────
  // A detecção do servidor diz campo → coluna; a tela mostra coluna → campo
  // (é a planilha que a pessoa tem aberta na frente). Override presente
  // (mesmo -1) sempre vence a detecção — ver detectColumns.
  function fieldIndex(col: ColumnDetection) {
    const o = overrides[col.field];
    return o !== undefined ? o : col.index;
  }
  function fieldForColumn(columnIndex: number): ContactImportField | "" {
    return preview?.columns.find((c) => fieldIndex(c) === columnIndex)?.field ?? "";
  }
  function setColumnField(columnIndex: number, field: ContactImportField | "") {
    if (!preview) return;
    const next: Overrides = { ...overrides };
    // Quem estava nesta coluna sai dela.
    for (const c of preview.columns) {
      if (fieldIndex(c) === columnIndex && c.field !== field) next[c.field] = -1;
    }
    if (field) next[field] = columnIndex;
    setOverrides(next);
  }

  // ─── Valores que não bateram com o CRM ────────────────────────────────
  // Resposta efetiva = a escolhida, senão o palpite do sistema (visível, já
  // selecionado), senão "Ninguém" pra responsável vazio. undefined = ainda
  // sem resposta (bloqueia a importação se a pergunta for bloqueante).
  function answerFor(p: PendingValue): string | undefined {
    return decisions[decisionId(p.field, p.key)] ?? p.suggestion ?? (p.field === "responsavel" && !p.key ? MAPPING_NONE : undefined);
  }
  function answerByKey(field: DecisionField, key: string | undefined): string | undefined {
    if (key === undefined || !preview) return undefined;
    const p = preview.pendingValues.find((v) => v.field === field && v.key === key);
    return p ? answerFor(p) : undefined;
  }
  /** Responsável da linha já com a resposta aplicada (null = ninguém). */
  function rowResponsavelId(row: ResolvedRow): string | null {
    if (row.responsavelId) return row.responsavelId;
    const answer = answerByKey("responsavel", row.pending?.responsavel);
    return answer && answer !== MAPPING_NONE ? answer : null;
  }
  function valueMappings(): ValueMappings {
    const out: ValueMappings = {};
    for (const p of preview?.pendingValues ?? []) {
      const answer = answerFor(p);
      if (answer === undefined) continue;
      (out[p.field] ??= {})[p.key] = answer;
    }
    return out;
  }

  // ─── Atribuir / Pedir contato que já existe ───────────────────────────
  // O servidor decide entre assumir na hora (sem dono, dono inativo, lead
  // perdido há tempo) e criar pedido pro dono atual — pelo estado do banco
  // AGORA, nunca pelo que a prévia achava. O destino é o da LINHA: a coluna
  // Responsável da planilha (ou a resposta dada pra ela), senão quem clicou.
  // (Bug relatado: era sempre um padrão-ou-quem-clicou, então o dono
  // importando a planilha do Vinicius, com Vinicius na coluna, recebia ele
  // mesmo os leads ao clicar "Atribuir".)
  function targetFor(row: DuplicateRow) {
    return rowResponsavelId(row) ?? currentUserId ?? null;
  }

  async function leadAction(contactId: string, targetUserId: string | null) {
    setLeadBusy((prev) => ({ ...prev, [contactId]: true }));
    const res = await requestJson("/api/lead-requests", { method: "POST", json: { contactId, targetUserId: targetUserId ?? undefined } }, { silent: true });
    setLeadBusy((prev) => {
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
    const outcome: LeadActionResult = !res.ok
      ? { kind: "error", message: res.error }
      : res.data?.alreadyYours
        ? { kind: "already-target" }
        : res.data?.claimed
          ? { kind: "claimed" }
          : { kind: "requested" };
    setLeadResult((prev) => ({ ...prev, [contactId]: outcome }));
  }

  async function bulkLeadAction(rows: DuplicateRow[]) {
    if (rows.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    await runPool(rows, BULK_CONCURRENCY, (r) => leadAction(r.existingContact.id, targetFor(r)));
    setBulkBusy(false);
  }

  // Reaproveita o PUT de edição de sempre (mesma validação e permissão),
  // mandando só os campos que divergem — o que não vai no corpo não é tocado.
  async function updateDivergent(contactId: string, fields: { field: DivergentField; newValue: string }[]) {
    setUpdateBusy((prev) => ({ ...prev, [contactId]: true }));
    const body = Object.fromEntries(fields.map((f) => [f.field, f.newValue]));
    const res = await requestJson(`/api/contacts/${contactId}`, { method: "PUT", json: body }, { silent: true });
    setUpdateBusy((prev) => {
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
    setUpdateResult((prev) => ({ ...prev, [contactId]: res.ok ? { ok: true } : { ok: false, message: res.error } }));
  }

  async function confirmImport() {
    if (!file) return;
    setBusy("importing");
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    if (Object.keys(overrides).length > 0) formData.append("columnOverrides", JSON.stringify(overrides));
    const mappings = valueMappings();
    if (Object.keys(mappings).length > 0) formData.append("valueMappings", JSON.stringify(mappings));

    const res = await requestJson<ImportResult>("/api/contacts/import", { method: "POST", body: formData }, { silent: true, errorMessage: "Erro ao importar arquivo" });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    setStep("done");
    trackUse("clientes.importar");
    onImported();
  }

  // ─── Resultado ────────────────────────────────────────────────────────
  if (step === "done" && result) {
    return (
      <Modal onClose={onClose} maxWidth="max-w-lg">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Importação concluída</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{file?.name}</p>

        <p className="mt-5 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {plural(result.created, "contato criado", "contatos criados")}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">de {plural(result.total, "linha", "linhas")} na planilha</p>

        <SummaryList
          items={summaryItems(result, result.skippedNoJobTitle, true, result.updatedExisting, result.updateBlocked)}
          className="mt-4"
        />

        {result.updateFailed && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            {result.updateFailed}
          </p>
        )}

        {result.issueRows.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowIssueRows((v) => !v)}
              className="text-sm text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 dark:text-neutral-400 dark:decoration-neutral-600 dark:hover:text-neutral-100"
            >
              {showIssueRows ? "Esconder" : "Ver"} linhas com aviso ({result.issueRows.length})
            </button>
            {showIssueRows && (
              <ul className="mt-2 max-h-56 divide-y divide-neutral-100 overflow-y-auto border-y border-neutral-200 text-xs dark:divide-neutral-800 dark:border-neutral-800">
                {result.issueRows.map((r) => (
                  <li key={r.rowNumber} className="py-1.5 text-neutral-600 dark:text-neutral-400">
                    <span className="tabular-nums text-neutral-400 dark:text-neutral-500">Linha {r.rowNumber}</span>
                    {r.name ? <span className="text-neutral-800 dark:text-neutral-200"> · {r.name}</span> : null}
                    <span> — {r.issues.map((i) => i.message).join("; ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
          Dá pra ver os detalhes ou desfazer este lote em Clientes → Histórico.
        </p>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-primary">
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  // ─── Colunas ──────────────────────────────────────────────────────────
  if (step === "columns" && preview) {
    const nameMapped = preview.columns.some((c) => c.field === "name" && fieldIndex(c) >= 0);
    const fieldOptions = [
      { value: "", label: "Ignorar" },
      ...preview.columns.map((c) => ({ value: c.field, label: c.required ? `${c.label} *` : c.label })),
    ];

    return (
      <Modal onClose={onClose} maxWidth="max-w-3xl">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Colunas da planilha</h2>
        <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
          {file?.name} · {plural(preview.summary.totalRows, "linha", "linhas")}
        </p>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_10.5rem] items-end gap-x-4 border-b border-neutral-200 pb-1.5 text-xs font-medium text-neutral-500 sm:grid-cols-[minmax(0,1fr)_12rem] dark:border-neutral-800 dark:text-neutral-400">
          <span>Na planilha</span>
          <span>No CRM</span>
        </div>
        <div className="max-h-[50dvh] divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800/70">
          {preview.rawHeaderRow.map((header, index) => {
            const field = fieldForColumn(index);
            const samples = preview.columnSamples[index] ?? [];
            return (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_10.5rem] items-center gap-x-4 py-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <div className="min-w-0">
                  <p className={`truncate text-sm ${field ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}`}>
                    {header || `Coluna ${index + 1}`}
                  </p>
                  <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{samples.length > 0 ? samples.join(", ") : "vazia"}</p>
                </div>
                <Select
                  value={field}
                  onChange={(v) => setColumnField(index, v as ContactImportField | "")}
                  options={fieldOptions}
                  className="w-full py-1.5 text-sm"
                />
              </div>
            );
          })}
        </div>

        {!nameMapped && <p className="mt-3 text-sm text-red-600 dark:text-red-400">Diga qual coluna é o Nome.</p>}

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button type="button" onClick={resetFile} className="btn-ghost">
            Trocar arquivo
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!nameMapped || busy !== null}
              onClick={() => file && analyze(file, overrides, { nextStep: "review" })}
              className="btn-primary"
            >
              {busy === "analyzing" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
              {busy === "analyzing" ? "Conferindo…" : "Revisar"}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ─── Revisar ──────────────────────────────────────────────────────────
  if (step === "review" && preview) {
    const s = preview.summary;
    const duplicates = preview.duplicateRows;
    const pending = (r: DuplicateRow) => {
      const res = leadResult[r.existingContact.id];
      return (!res || res.kind === "error") && r.existingContact.responsavelId !== targetFor(r);
    };
    const claimable = duplicates.filter((r) => pending(r) && (!r.existingContact.responsavelId || !r.existingContact.responsavelActive));
    const requestable = duplicates.filter((r) => pending(r) && !!r.existingContact.responsavelId && r.existingContact.responsavelActive);
    const showLocation = preview.rows.some((r) => r.location);
    // Contagem final já com as respostas: linhas que esperavam cargo e
    // ganharam um entram; "não importar" continua de fora. Calculado aqui
    // (sem nova análise) — o servidor refaz a mesma conta ao importar.
    const jobTitleGroups = preview.pendingValues.filter((p) => p.field === "jobTitle");
    const rescuedByJobTitle = jobTitleGroups.reduce((sum, p) => {
      const answer = answerFor(p);
      return answer && answer !== MAPPING_SKIP ? sum + p.rows : sum;
    }, 0);
    const toCreate = s.toCreate + rescuedByJobTitle;
    const unanswered = preview.pendingValues.filter((p) => p.blocking && answerFor(p) === undefined);
    const responsavelColumnMapped = preview.columns.some((c) => c.field === "responsavel" && fieldIndex(c) >= 0);

    return (
      <Modal onClose={onClose} maxWidth="max-w-4xl">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Revisar importação</h2>
        <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
          {file?.name} · {plural(s.totalRows, "linha", "linhas")}
        </p>

        <p className="mt-5 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {toCreate === 0 ? "Nenhum contato novo" : plural(toCreate, "contato novo", "contatos novos")}
        </p>
        <SummaryList items={summaryItems(s, s.skippedNoJobTitle - rescuedByJobTitle, false)} className="mt-3" />

        {preview.pendingValues.length > 0 && (
          <section className="mt-6">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Não encontrado no CRM</h3>
            <div className="mt-1 max-h-[32dvh] divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800/70">
              {preview.pendingValues.map((p) => (
                <PendingValueRow
                  key={decisionId(p.field, p.key)}
                  pending={p}
                  answer={answerFor(p)}
                  suggested={decisions[decisionId(p.field, p.key)] === undefined && !!p.suggestion}
                  columnMissing={p.field === "responsavel" && !p.key && !responsavelColumnMapped}
                  onAnswer={(v) => setDecisions((prev) => ({ ...prev, [decisionId(p.field, p.key)]: v }))}
                  members={members}
                  currentUserId={currentUserId}
                  jobTitles={jobTitles}
                  sources={sources}
                />
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 flex gap-5 border-b border-neutral-200 text-sm dark:border-neutral-800">
          <TabButton active={reviewTab === "rows"} onClick={() => setReviewTab("rows")}>
            Linhas
          </TabButton>
          {duplicates.length > 0 && (
            <TabButton active={reviewTab === "duplicates"} onClick={() => setReviewTab("duplicates")}>
              Já existem no CRM <span className="tabular-nums text-neutral-400 dark:text-neutral-500">{duplicates.length}</span>
            </TabButton>
          )}
        </div>

        {reviewTab === "rows" ? (
          <>
            <div className="max-h-[40dvh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Linha</th>
                    <th className="py-2 pr-3 font-medium">Nome</th>
                    <th className="py-2 pr-3 font-medium">Cargo</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Responsável</th>
                    {showLocation && <th className="hidden py-2 pr-3 font-medium md:table-cell">Cidade</th>}
                    <th className="py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
                  {preview.rows.map((r) => {
                    // Linha que só esperava o cargo: mostra já com a resposta.
                    const jobTitleAnswer = answerByKey("jobTitle", r.pending?.jobTitle);
                    const rescued = !r.willImport && r.issues[0]?.code === "NO_JOB_TITLE" && !!jobTitleAnswer && jobTitleAnswer !== MAPPING_SKIP;
                    const willImport = r.willImport || rescued;
                    const mainIssue = rescued ? undefined : r.issues[0];
                    const jobTitle = r.jobTitle ?? (jobTitleAnswer && jobTitleAnswer !== MAPPING_SKIP ? jobTitleAnswer : null);
                    const responsavelName = r.responsavelName ?? memberName(rowResponsavelId(r));
                    const status = mainIssue
                      ? mainIssue.code === "NO_JOB_TITLE" && jobTitleAnswer === MAPPING_SKIP
                        ? "Não importar"
                        : (ISSUE_LABEL[mainIssue.code] ?? mainIssue.message)
                      : "Novo";
                    return (
                      <tr key={r.rowNumber} className={willImport ? "" : "text-neutral-400 dark:text-neutral-500"}>
                        <td className="py-1.5 pr-3 tabular-nums text-neutral-400 dark:text-neutral-500">{r.rowNumber}</td>
                        <td className={`max-w-[12rem] truncate py-1.5 pr-3 ${willImport ? "text-neutral-900 dark:text-neutral-100" : ""}`}>{r.name ?? "—"}</td>
                        <td className="max-w-[10rem] truncate py-1.5 pr-3">{jobTitle ?? "—"}</td>
                        <td className="hidden max-w-[10rem] truncate py-1.5 pr-3 sm:table-cell">{responsavelName ?? "—"}</td>
                        {showLocation && <td className="hidden max-w-[10rem] truncate py-1.5 pr-3 md:table-cell">{r.location ?? "—"}</td>}
                        <td
                          className={`py-1.5 whitespace-nowrap ${willImport && mainIssue ? "text-amber-700 dark:text-amber-400" : ""}`}
                          title={rescued ? undefined : r.issues.map((i) => i.message).join("\n") || undefined}
                        >
                          {status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {preview.rowsShown < s.totalRows && (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Mostrando as primeiras {preview.rowsShown} de {s.totalRows.toLocaleString("pt-BR")}.{" "}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => file && analyze(file, overrides, { nextStep: "review", allRows: true })}
                  className="text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 dark:text-neutral-300 dark:decoration-neutral-600"
                >
                  {busy === "analyzing" ? "Carregando…" : "Mostrar todas"}
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 py-3">
              <p className="mr-auto text-xs text-neutral-500 dark:text-neutral-400">
                Não serão criados de novo — o que a planilha traz de diferente é atualizado no contato que já existe ao
                importar. Dá pra trazer para quem a linha iria.
              </p>
              {claimable.length > 0 && (
                <button type="button" disabled={bulkBusy} onClick={() => bulkLeadAction(claimable)} className="btn-secondary btn-sm">
                  {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Atribuir {claimable.length} sem dono ativo
                </button>
              )}
              {requestable.length > 0 && (
                <button type="button" disabled={bulkBusy} onClick={() => bulkLeadAction(requestable)} className="btn-secondary btn-sm">
                  {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Pedir {requestable.length} aos donos atuais
                </button>
              )}
            </div>
            <div className="max-h-[40dvh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Contato</th>
                    <th className="py-2 pr-3 font-medium">Dono atual</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">Iria para</th>
                    <th className="py-2 text-right font-medium" />
                  </tr>
                </thead>
                {duplicates.map((r) => (
                    <DuplicateTableRow
                      key={r.existingContact.id}
                      row={r}
                      targetId={targetFor(r)}
                      targetName={targetFor(r) === currentUserId ? "Você" : (memberName(targetFor(r)) ?? "—")}
                      busy={!!leadBusy[r.existingContact.id]}
                      result={leadResult[r.existingContact.id]}
                      onAction={() => leadAction(r.existingContact.id, targetFor(r))}
                      updateBusy={!!updateBusy[r.existingContact.id]}
                      updateResult={updateResult[r.existingContact.id]}
                      onUpdate={() => updateDivergent(r.existingContact.id, r.existingContact.divergentFields)}
                    />
                ))}
              </table>
            </div>
            {preview.duplicateRowsTruncated && (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Lista cortada nos primeiros {duplicates.length.toLocaleString("pt-BR")}. Importe o resto em outra planilha para ver os demais.
              </p>
            )}
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button type="button" onClick={resetFile} className="btn-ghost">
            Trocar arquivo
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("columns")} disabled={busy !== null} className="btn-secondary">
              Voltar
            </button>
            <button type="button" disabled={toCreate === 0 || unanswered.length > 0 || busy !== null} onClick={confirmImport} className="btn-primary">
              {busy === "importing" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
              {busy === "importing"
                ? "Importando…"
                : unanswered.length > 0
                  ? `Falta responder ${unanswered.length}`
                  : toCreate === 0
                    ? "Nada para importar"
                    : `Importar ${plural(toCreate, "contato", "contatos")}`}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ─── Escolher arquivo ─────────────────────────────────────────────────
  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Importar contatos</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Planilha .csv ou .xlsx. Nome e cargo são obrigatórios; telefone, e-mail, empresa, responsável e endereço (CEP, rua,
        número, bairro, cidade, UF) entram se estiverem lá. Na próxima tela você confere qual coluna é o quê.
      </p>

      <label
        {...dropZoneProps}
        className={`mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
          isDraggingOver
            ? "border-brand bg-brand-light dark:bg-[var(--brand-subtle)]"
            : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-600"
        }`}
      >
        {busy === "analyzing" ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Lendo {file?.name}…</span>
          </>
        ) : (
          <>
            <FileSpreadsheet className="h-5 w-5 text-neutral-400 dark:text-neutral-500" strokeWidth={1.75} />
            <span className="text-sm text-neutral-700 dark:text-neutral-300">{isDraggingOver ? "Pode soltar" : "Escolher arquivo ou arrastar aqui"}</span>
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              Até {MAX_CONTACT_IMPORT_ROWS.toLocaleString("pt-BR")} linhas, 5 MB
            </span>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} disabled={busy !== null} />
      </label>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Quem já está no CRM (mesmo telefone ou WhatsApp) não é criado de novo — você vê essas pessoas antes de confirmar.
      </p>

      <div className="mt-5 flex items-center justify-between gap-2">
        <button type="button" onClick={downloadContactImportTemplate} className="btn-ghost">
          <Download className="h-4 w-4" strokeWidth={2} />
          Planilha modelo
        </button>
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

function PendingValueRow({
  pending: p,
  answer,
  suggested,
  columnMissing,
  onAnswer,
  members,
  currentUserId,
  jobTitles,
  sources,
}: {
  pending: PendingValue;
  answer: string | undefined;
  suggested: boolean;
  columnMissing: boolean;
  onAnswer: (value: string) => void;
  members: { id: string; name: string }[];
  currentUserId?: string;
  jobTitles: { id: string; label: string }[];
  sources: { id: string; label: string }[];
}) {
  const count = p.field === "responsavel" ? p.rows + p.duplicateRows : p.rows;
  const raw = <span className="font-medium text-neutral-900 dark:text-neutral-100">“{p.raw}”</span>;
  const text =
    p.field === "responsavel" ? (
      !p.key ? (
        columnMissing ? "A planilha não diz o responsável" : "Sem responsável na planilha"
      ) : p.inactiveMember ? (
        <>Responsável {raw} está inativo</>
      ) : (
        <>Responsável {raw} não está na equipe</>
      )
    ) : p.field === "jobTitle" ? (
      !p.key ? "Sem cargo" : <>Cargo {raw} não existe</>
    ) : (
      <>Origem {raw} não existe</>
    );

  const options =
    p.field === "responsavel"
      ? [{ value: MAPPING_NONE, label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.id === currentUserId ? `${m.name} (você)` : m.name }))]
      : p.field === "jobTitle"
        ? [...jobTitles.map((j) => ({ value: j.label, label: j.label })), { value: MAPPING_SKIP, label: "Não importar essas linhas" }]
        : [...sources.map((o) => ({ value: o.label, label: o.label })), { value: MAPPING_NONE, label: "Deixar sem origem" }];

  return (
    <div className="grid items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
      <p className="min-w-0 text-sm text-neutral-600 dark:text-neutral-400">
        {text}
        <span className="text-neutral-400 dark:text-neutral-500"> · {plural(count, "linha", "linhas")}</span>
        {suggested && <span className="text-neutral-400 dark:text-neutral-500"> · sugerido</span>}
      </p>
      <Select
        value={answer ?? ""}
        onChange={onAnswer}
        options={options}
        placeholder="Escolher…"
        invalid={p.blocking && answer === undefined}
        className="w-full py-1.5 text-sm"
      />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 pb-2 transition-colors ${
        active
          ? "border-neutral-900 font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
          : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

type SummaryItem = { count: number; text: string; warn?: boolean };

/**
 * Contagens do que NÃO entra (ou entra com ressalva) — só as que não são
 * zero. Na revisão, "sem cargo" já vem descontado das linhas que ganharam
 * cargo nas respostas, e responsável não encontrado fica de fora (é uma
 * pergunta logo abaixo, não um aviso).
 */
function summaryItems(
  s: ImportPlanSummary,
  skippedNoJobTitle: number,
  final: boolean,
  updatedExisting?: number,
  blocked?: number,
): SummaryItem[] {
  return [
    { count: s.duplicateContacts, text: "já existem no CRM (mesmo telefone ou WhatsApp)" },
    // Contato existente que ganha dado novo da planilha (cargo, origem,
    // endereço…) — acontece sozinho na importação, não é mais um clique
    // "Atualizar contato" por linha. No fim mostra o que o servidor DE FATO
    // aplicou (updatedExisting), não o que estava planejado.
    {
      count: final ? (updatedExisting ?? 0) : s.contactsToUpdate,
      text: final
        ? "desses, foram atualizados com os dados da planilha"
        : "desses, serão atualizados com os dados da planilha",
    },
    // Só no fim: divergência que existia mas não pôde ser aplicada porque o
    // contato é de outro consultor (ver updateBlocked em POST
    // /api/contacts/import). Em âmbar — não é falha, mas a pessoa precisa
    // saber que aqueles ficaram como estavam.
    ...(final && (blocked ?? 0) > 0
      ? [{ count: blocked!, text: "não foram atualizados — contato de outro consultor", warn: true }]
      : []),
    { count: skippedNoJobTitle, text: final ? "sem cargo — ignoradas" : "esperando cargo ou fora da importação" },
    { count: s.skippedInvalidPhone, text: "com telefone inválido — ignoradas" },
    { count: s.skippedNoName, text: "sem nome — ignoradas" },
    ...(final ? [{ count: s.ownerFallbacks, text: "ficaram sem responsável (nome não encontrado)", warn: true }] : []),
    { count: s.addressWarnings, text: "com UF ou CEP não reconhecido — entram sem esse dado", warn: true },
  ].filter((i) => i.count > 0);
}

function SummaryList({ items, className = "" }: { items: SummaryItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={`space-y-0.5 text-sm ${className}`}>
      {items.map((i) => (
        <li key={i.text} className="flex gap-2 text-neutral-600 dark:text-neutral-400">
          <span className={`w-12 shrink-0 text-right tabular-nums ${i.warn ? "text-amber-700 dark:text-amber-400" : "text-neutral-900 dark:text-neutral-100"}`}>
            {i.count.toLocaleString("pt-BR")}
          </span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

function DuplicateTableRow({
  row,
  targetId,
  targetName,
  busy,
  result,
  onAction,
  updateBusy,
  updateResult,
  onUpdate,
}: {
  row: DuplicateRow;
  targetId: string | null;
  targetName: string;
  busy: boolean;
  result: LeadActionResult | undefined;
  onAction: () => void;
  updateBusy: boolean;
  updateResult: { ok: true } | { ok: false; message: string } | undefined;
  onUpdate: () => void;
}) {
  const c = row.existingContact;
  // Sem dono ou dono que saiu da empresa = assume na hora; dono ativo = vira
  // pedido pra ele aprovar. É só o rótulo — quem decide é o servidor.
  const canClaim = !c.responsavelId || !c.responsavelActive;
  const alreadyTarget = !!targetId && c.responsavelId === targetId;

  let action: React.ReactNode;
  if (result?.kind === "claimed") action = <span className="text-emerald-700 dark:text-emerald-400">Atribuído</span>;
  else if (result?.kind === "requested") action = <span className="text-neutral-500 dark:text-neutral-400">Pedido enviado</span>;
  else if (result?.kind === "already-target" || alreadyTarget)
    action = <span className="text-neutral-400 dark:text-neutral-500">{targetName === "Você" ? "Já é seu" : `Já é de ${targetName}`}</span>;
  else
    action = (
      <span className="inline-flex items-center gap-2">
        {result?.kind === "error" && (
          <span className="max-w-[12rem] truncate text-xs text-red-600 dark:text-red-400" title={result.message}>
            {result.message}
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onAction}
          className="font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : canClaim ? "Atribuir" : "Pedir"}
        </button>
      </span>
    );

  return (
    <tbody className="border-t border-neutral-100 dark:border-neutral-800/70">
      <tr className={c.divergentFields.length > 0 ? "[&>td]:pb-0.5" : ""}>
        <td className="max-w-[14rem] py-1.5 pr-3">
          <p className="truncate text-neutral-900 dark:text-neutral-100">{c.name}</p>
          <p className="text-xs tabular-nums text-neutral-400 dark:text-neutral-500">linha {row.rowNumber}</p>
        </td>
        <td className="max-w-[12rem] truncate py-1.5 pr-3 text-neutral-600 dark:text-neutral-400">
          {c.responsavelName ?? "—"}
          {c.responsavelName && !c.responsavelActive && <span className="text-neutral-400 dark:text-neutral-500"> (inativo)</span>}
        </td>
        <td className="hidden max-w-[10rem] truncate py-1.5 pr-3 text-neutral-600 sm:table-cell dark:text-neutral-400">{targetName}</td>
        <td className="py-1.5 text-right whitespace-nowrap">{action}</td>
      </tr>
      {c.divergentFields.length > 0 && (
        <tr>
          <td colSpan={4} className="pb-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Na planilha está diferente: </span>
            {c.divergentFields.map((f, i) => (
              <span key={f.field}>
                {i > 0 && " · "}
                {f.label} <span className="text-neutral-400 line-through dark:text-neutral-500">{f.oldValue || "vazio"}</span>{" "}
                <span className="text-neutral-800 dark:text-neutral-200">{f.newValue}</span>
              </span>
            ))}{" "}
            {updateResult?.ok ? (
              <span className="text-emerald-700 dark:text-emerald-400">· atualizado</span>
            ) : (
              <>
                {updateResult && !updateResult.ok && <span className="text-red-600 dark:text-red-400">· {updateResult.message} </span>}
                <button
                  type="button"
                  disabled={updateBusy}
                  onClick={onUpdate}
                  className="font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateBusy ? "Atualizando…" : "Atualizar contato"}
                </button>
              </>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}
