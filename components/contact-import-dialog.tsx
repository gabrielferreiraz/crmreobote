"use client";

import { useRef, useState } from "react";
import { Loader2, FileSpreadsheet, CheckCircle2, TriangleAlert, Info, Sparkles, ChevronRight, SlidersHorizontal, Download } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { Select } from "./select";
import { useFileDrop } from "@/lib/use-file-drop";
import { downloadContactImportTemplate } from "@/lib/contact-import-template";

type ImportField = "name" | "jobTitle" | "email" | "phone" | "whatsapp" | "source" | "company" | "tags" | "responsavel";

type ColumnDetection = { field: ImportField; label: string; required: boolean; index: number; headerLabel: string | null };
type RowIssue = { code: string; message: string };
type ResolvedRow = {
  rowNumber: number;
  willImport: boolean;
  name: string | null;
  jobTitle: string | null;
  source: string | null;
  responsavelName: string | null;
  issues: RowIssue[];
};
type ImportPlanSummary = {
  totalRows: number;
  toCreate: number;
  skippedNoName: number;
  skippedNoJobTitle: number;
  duplicateContacts: number;
  ownerFallbacks: number;
};
type PreviewResponse = {
  rawHeaderRow: string[];
  columns: ColumnDetection[];
  missingRequiredColumns: ColumnDetection[];
  summary: ImportPlanSummary;
  rows: ResolvedRow[];
  rowsShown: number;
};
type ImportResult = ImportPlanSummary & { total: number; created: number; skipped: number; importBatchId: string; issueRows: ResolvedRow[] };

type Step = "pick" | "analyzing" | "preview" | "importing" | "done";

/** Quantas linhas a tabela de prévia mostra antes do "Mostrar mais" — ver showAllRows. */
const PREVIEW_ROWS_COLLAPSED = 5;

/** Etiqueta curta pro "Aviso" da tabela de linhas — o motivo mais lido de relance, sem precisar passar o mouse pra entender. */
const ISSUE_LABEL: Record<string, string> = {
  NO_NAME: "Sem nome",
  NO_JOB_TITLE: "Sem cargo",
  DUPLICATE_CONTACT: "Duplicado",
  OWNER_NOT_FOUND: "Resp. não achado",
};

/** Campo que faz sentido ter UM valor só aplicado a toda a planilha quando a coluna correspondente não existe no arquivo — mesma ideia de DEFAULTABLE_FIELDS em deal-import-dialog.tsx, só que com um campo (contato não tem etapa/tipo de crédito pra "aplicar a todos"). */
type DefaultableField = "responsavel";
const DEFAULTABLE_FIELDS: DefaultableField[] = ["responsavel"];

/**
 * Resumo em uma frase do que vai acontecer — a primeira coisa que a pessoa
 * lê, antes de qualquer grade técnica de coluna/estatística. Mesmo
 * raciocínio de importHeadline em deal-import-dialog.tsx.
 */
function importHeadline(s: ImportPlanSummary, hasBlockingIssue: boolean): { icon: typeof Sparkles; tone: "success" | "warning" | "danger"; title: string; subtitle: string } {
  if (hasBlockingIssue) {
    return {
      icon: TriangleAlert,
      tone: "danger",
      title: "Falta indicar uma coluna obrigatória",
      subtitle: "Sem saber qual coluna é o nome (ou o cargo) do contato, não dá pra continuar — aponte ela abaixo.",
    };
  }
  if (s.toCreate === 0) {
    return {
      icon: Info,
      tone: "warning",
      title: "Nenhum contato será criado",
      subtitle: "Confira se as colunas de nome e cargo foram reconhecidas certo, em \"Ver detalhes técnicos\" abaixo.",
    };
  }
  const details = [
    s.duplicateContacts > 0 ? `${s.duplicateContacts} duplicado${s.duplicateContacts === 1 ? "" : "s"} evitado${s.duplicateContacts === 1 ? "" : "s"}` : null,
    s.skippedNoJobTitle > 0 ? `${s.skippedNoJobTitle} sem cargo (ignorado${s.skippedNoJobTitle === 1 ? "" : "s"})` : null,
  ].filter((d): d is string => !!d);
  return {
    icon: Sparkles,
    tone: "success",
    title: `${s.toCreate} contato${s.toCreate === 1 ? "" : "s"} pronto${s.toCreate === 1 ? "" : "s"} pra importar`,
    subtitle: details.length > 0 ? details.join(" · ") : "Tudo certo pra continuar.",
  };
}

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  return (
    <div className="rounded-md border border-neutral-200 px-2.5 py-1.5 dark:border-neutral-800">
      <div
        className={`text-lg font-semibold tabular-nums ${
          tone === "danger"
            ? "text-red-600 dark:text-red-400"
            : tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : "text-neutral-900 dark:text-neutral-100"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
}

/**
 * Importação de contatos com prévia de verdade — mesmo espírito/UX de
 * components/deal-import-dialog.tsx, adaptado pro conjunto mais simples de
 * campos de contato (sem etapa/negócio — Responsável é o único conceito que
 * os dois compartilham). Analisa o arquivo, mostra o que vai acontecer ANTES
 * de gravar qualquer coisa, e deixa apontar manualmente qual coluna do
 * arquivo é qual campo quando o cabeçalho não bate com nenhum sinônimo
 * conhecido — pedido explícito: "formas de localizar os cabeçalhos da
 * planilha pra não haver erros".
 */
export function ContactImportDialog({
  members,
  onClose,
  onImported,
}: {
  members: { id: string; name: string }[];
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<ImportField, number>>>({});
  // Valor único pra todo mundo quando a coluna "responsavel" não existe no
  // arquivo (ver DEFAULTABLE_FIELDS acima) — começa vazio ("Ninguém"),
  // diferente do responsável de NEGÓCIO na importação de negócios (que já
  // começa preenchido com quem está importando): aqui um contato sem
  // responsável é um estado normal/esperado (mesmo padrão do cadastro
  // manual, "Novo contato"), não faria sentido atribuir a planilha inteira
  // a quem importou sem essa pessoa pedir.
  const [fieldDefaults, setFieldDefaults] = useState<Partial<Record<DefaultableField, string>>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showIssueRows, setShowIssueRows] = useState(false);
  // Grade completa de mapeamento (9 campos) escondida por padrão — na
  // maioria das vezes a detecção automática já acerta tudo sozinha. Abre
  // sozinha quando falta algo obrigatório (não dá pra esconder o que
  // bloqueia continuar).
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);

  async function runPreview(
    pickedFile: File,
    currentOverrides: Partial<Record<ImportField, number>>,
    currentFieldDefaults: Partial<Record<DefaultableField, string>>,
  ) {
    setStep("analyzing");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", pickedFile);
      if (Object.keys(currentOverrides).length > 0) formData.append("columnOverrides", JSON.stringify(currentOverrides));
      if (Object.keys(currentFieldDefaults).length > 0) formData.append("fieldDefaults", JSON.stringify(currentFieldDefaults));

      const res = await fetch("/api/contacts/import/preview", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao analisar o arquivo");
        setStep("pick");
        return;
      }
      setPreview(data);
      setShowAllRows(false);
      setStep("preview");
    } catch {
      setError("Falha de conexão. Tente novamente.");
      setStep("pick");
    }
  }

  function pickFile(picked: File) {
    setFile(picked);
    setOverrides({});
    setFieldDefaults({});
    runPreview(picked, {}, {});
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    pickFile(picked);
  }

  // "importar contatos deve ser drag and drop" (pedido explícito) — mesmo
  // hook usado em deal-import-dialog.tsx, ver lib/use-file-drop.ts.
  const { isDraggingOver, dropZoneProps } = useFileDrop(pickFile, step === "analyzing");

  function updateOverride(field: ImportField, index: number) {
    const next = { ...overrides, [field]: index };
    setOverrides(next);
    if (file) runPreview(file, next, fieldDefaults);
  }

  function updateFieldDefault(field: DefaultableField, value: string) {
    const next = { ...fieldDefaults };
    if (value) next[field] = value;
    else delete next[field];
    setFieldDefaults(next);
    if (file) runPreview(file, overrides, next);
  }

  async function confirmImport() {
    if (!file) return;
    setStep("importing");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (Object.keys(overrides).length > 0) formData.append("columnOverrides", JSON.stringify(overrides));
      if (Object.keys(fieldDefaults).length > 0) formData.append("fieldDefaults", JSON.stringify(fieldDefaults));

      const res = await fetch("/api/contacts/import", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao importar arquivo");
        setStep("preview");
        return;
      }
      setResult(data);
      setStep("done");
      onImported();
    } catch {
      setError("Falha de conexão. Tente novamente.");
      setStep("preview");
    }
  }

  // ─── Passo final: resultado ───────────────────────────────────────
  if (step === "done" && result) {
    return (
      <Modal onClose={onClose} maxWidth="max-w-lg">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Importação concluída</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {result.created} de {result.total} contatos criados.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Duplicados evitados" value={result.duplicateContacts} tone={result.duplicateContacts > 0 ? "warn" : undefined} />
          <StatChip label="Sem nome" value={result.skippedNoName} tone={result.skippedNoName > 0 ? "warn" : undefined} />
          <StatChip label="Sem cargo" value={result.skippedNoJobTitle} tone={result.skippedNoJobTitle > 0 ? "warn" : undefined} />
          <StatChip label="Resp. não achado" value={result.ownerFallbacks} tone={result.ownerFallbacks > 0 ? "warn" : undefined} />
        </div>

        {result.issueRows.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowIssueRows((v) => !v)}
              className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              {showIssueRows ? "Esconder" : "Ver"} linhas com aviso ({result.issueRows.length})
            </button>
            {showIssueRows && (
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                {result.issueRows.map((r) => (
                  <div key={r.rowNumber} className="text-neutral-500 dark:text-neutral-400">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">Linha {r.rowNumber}</span>
                    {r.name ? ` (${r.name})` : ""}: {r.issues.map((i) => i.message).join("; ")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-[11px] text-neutral-400 dark:text-neutral-500">
          Fica salvo no botão &quot;Histórico&quot;, ao lado de Importar — dá pra ver os detalhes ou desfazer esse lote lá.
        </p>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-primary">
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  // ─── Passo de prévia ────────────────────────────────────────────────
  if ((step === "preview" || step === "importing") && preview) {
    const s = preview.summary;
    const hasBlockingIssue = preview.missingRequiredColumns.length > 0;

    const headline = importHeadline(s, hasBlockingIssue);
    const HeadlineIcon = headline.icon;
    const hasAnyMissingOptionalColumn = preview.columns.some((col) => !col.required && col.index === -1);
    const mappingExpanded = showColumnMapping || hasBlockingIssue || hasAnyMissingOptionalColumn;
    const hasMissingDefaultableColumn = preview.columns.some(
      (col) => col.index === -1 && DEFAULTABLE_FIELDS.includes(col.field as DefaultableField),
    );
    const visibleRows = showAllRows ? preview.rows : preview.rows.slice(0, PREVIEW_ROWS_COLLAPSED);
    const hiddenRowCount = preview.rows.length - visibleRows.length;

    return (
      <Modal onClose={onClose} maxWidth="max-w-3xl">
        <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Confira antes de importar</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          {file?.name} — {s.totalRows} linha{s.totalRows === 1 ? "" : "s"} de dados. Nada foi gravado ainda.
        </p>

        <div
          className={`mb-4 flex items-start gap-3 rounded-lg border p-3 ${
            headline.tone === "success"
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
              : headline.tone === "danger"
                ? "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10"
                : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
          }`}
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              headline.tone === "success"
                ? "bg-emerald-100 dark:bg-emerald-500/20"
                : headline.tone === "danger"
                  ? "bg-red-100 dark:bg-red-500/20"
                  : "bg-amber-100 dark:bg-amber-500/20"
            }`}
          >
            <HeadlineIcon
              className={`h-4 w-4 ${
                headline.tone === "success"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : headline.tone === "danger"
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400"
              }`}
              strokeWidth={2}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{headline.title}</p>
            <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">{headline.subtitle}</p>
          </div>
        </div>

        {s.duplicateContacts > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/40">
            <Info className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            <p className="text-neutral-600 dark:text-neutral-400">
              <strong className="text-neutral-800 dark:text-neutral-200">
                {s.duplicateContacts} linha{s.duplicateContacts === 1 ? "" : "s"} ignorada{s.duplicateContacts === 1 ? "" : "s"}
              </strong>{" "}
              — já existe contato com esse telefone ou WhatsApp (nesta planilha ou já cadastrado). Nada é atualizado nele: a
              importação só cria contato novo, nunca edita um existente.
            </p>
          </div>
        )}

        {/* Campo sem coluna correspondente na planilha — mesma ideia de
            deal-import-dialog.tsx, sempre visível quando se aplica. */}
        {hasMissingDefaultableColumn && (
          <div className="mb-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
              Não veio na planilha — escolha o responsável pra usar em <strong>todos</strong> os contatos (opcional):
            </p>
            <Select
              value={fieldDefaults.responsavel ?? ""}
              onChange={(v) => updateFieldDefault("responsavel", v)}
              className="w-full py-1.5 text-sm"
              options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
        )}

        {/* Igual ao mapeamento técnico de negócios — pedido explícito: "formas
            de localizar os cabeçalhos da planilha pra não haver erros". Um só
            "avançado" pra tudo que é técnico, escondido por padrão, some
            sozinho quando falta a coluna obrigatória. */}
        <button
          type="button"
          onClick={() => setShowColumnMapping((v) => !v)}
          disabled={hasBlockingIssue}
          className="mb-2 flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          <ChevronRight className={`h-3 w-3 transition-transform duration-200 ease-smooth ${mappingExpanded ? "rotate-90" : ""}`} strokeWidth={2} />
          <SlidersHorizontal className="h-3 w-3" strokeWidth={2} />
          Ver detalhes técnicos
        </button>
        {mappingExpanded && (
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              {preview.columns.map((col) => (
                <div key={col.field} className="flex items-center justify-between gap-2">
                  <span className={`text-xs ${col.required ? "font-medium text-neutral-700 dark:text-neutral-300" : "text-neutral-500 dark:text-neutral-400"}`}>
                    {col.label}
                    {col.required && <span className="text-red-500"> *</span>}
                  </span>
                  <Select
                    value={col.index === -1 ? "" : String(col.index)}
                    onChange={(v) => updateOverride(col.field, Number(v))}
                    className="w-40 py-1 text-xs"
                    placeholder="Não usar"
                    options={preview.rawHeaderRow.map((h, i) => ({ value: String(i), label: h || `Coluna ${i + 1}` }))}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <StatChip label="Vão criar contato" value={s.toCreate} />
              <StatChip label="Sem nome (ignoradas)" value={s.skippedNoName} tone={s.skippedNoName > 0 ? "warn" : undefined} />
              <StatChip label="Sem cargo (ignoradas)" value={s.skippedNoJobTitle} tone={s.skippedNoJobTitle > 0 ? "warn" : undefined} />
              <StatChip label="Duplicados evitados" value={s.duplicateContacts} tone={s.duplicateContacts > 0 ? "warn" : undefined} />
              <StatChip label="Resp. não achado" value={s.ownerFallbacks} tone={s.ownerFallbacks > 0 ? "warn" : undefined} />
            </div>
          </div>
        )}

        {!hasBlockingIssue && (
          <div className="mb-4 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
                  <th className="px-2 py-1.5 font-medium">Linha</th>
                  <th className="px-2 py-1.5 font-medium">Nome</th>
                  <th className="px-2 py-1.5 font-medium">Cargo</th>
                  <th className="px-2 py-1.5 font-medium">Origem</th>
                  <th className="px-2 py-1.5 font-medium">Responsável</th>
                  <th className="px-2 py-1.5 font-medium">Aviso</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr
                    key={r.rowNumber}
                    className={`border-b border-neutral-50 last:border-0 dark:border-neutral-900 ${!r.willImport ? "opacity-50" : ""}`}
                  >
                    <td className="px-2 py-1.5 tabular-nums text-neutral-400 dark:text-neutral-500">{r.rowNumber}</td>
                    <td className="px-2 py-1.5 text-neutral-800 dark:text-neutral-200">{r.name ?? "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">{r.jobTitle ?? "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">{r.source ?? "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">{r.responsavelName ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {r.issues.length > 0 && (
                        <span
                          title={r.issues.map((i) => i.message).join("; ")}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                        >
                          {ISSUE_LABEL[r.issues[0].code] ?? r.issues[0].message}
                          {r.issues.length > 1 && ` +${r.issues.length - 1}`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-2 py-1.5 dark:border-neutral-900">
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {s.totalRows > preview.rowsShown
                  ? `Mostrando as primeiras ${preview.rowsShown} de ${s.totalRows} linhas — o resumo acima já considera todas.`
                  : `${preview.rows.length} linha${preview.rows.length === 1 ? "" : "s"} analisada${preview.rows.length === 1 ? "" : "s"}.`}
              </p>
              {hiddenRowCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAllRows(true)}
                  className="shrink-0 text-xs font-medium text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                >
                  Mostrar mais {hiddenRowCount}
                </button>
              ) : (
                showAllRows &&
                preview.rows.length > PREVIEW_ROWS_COLLAPSED && (
                  <button
                    type="button"
                    onClick={() => setShowAllRows(false)}
                    className="shrink-0 text-xs font-medium text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                  >
                    Mostrar menos
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("pick");
              setFile(null);
              setPreview(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="btn-secondary"
          >
            Trocar arquivo
          </button>
          <button
            type="button"
            disabled={hasBlockingIssue || s.toCreate === 0 || step === "importing"}
            onClick={confirmImport}
            className="btn-primary"
          >
            {step === "importing" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {step === "importing" ? (
              <span className="inline-flex items-center gap-1">
                Importando
                <LoadingDots />
              </span>
            ) : s.toCreate === 0 ? (
              "Nada pra importar"
            ) : (
              `Importar ${s.toCreate} contato${s.toCreate === 1 ? "" : "s"}`
            )}
          </button>
        </div>
      </Modal>
    );
  }

  // ─── Passo inicial: escolher arquivo ────────────────────────────────
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Importar contatos</h2>
      <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
        Arquivo .csv ou .xlsx com colunas: nome (obrigatório), cargo (obrigatório), email, whatsapp, celular, origem,
        empresa, responsável, tags. O nome da coluna pode variar — se não reconhecermos, você aponta manualmente na
        próxima tela.
      </p>
      {/* Pedido explícito: "vamos adicionar para baixar uma planilha
          MODELO" — gera o CSV no próprio navegador (sem round-trip com o
          servidor, é só um arquivo estático) já com os cabeçalhos exatos
          que o detector reconhece de cara, mais uma linha de exemplo. */}
      <button
        type="button"
        onClick={downloadContactImportTemplate}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2} />
        Baixar planilha modelo
      </button>
      <div className="mb-4 flex items-start gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
        <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Só cria contato novo. Se já existir contato com o mesmo telefone ou WhatsApp, a linha é pulada — nenhum campo é
        atualizado no contato existente.
      </div>
      <label
        {...dropZoneProps}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors ${
          isDraggingOver
            ? "border-brand bg-brand-light dark:bg-[var(--brand-subtle)]"
            : "border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/60"
        }`}
      >
        {step === "analyzing" ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
            <span className="inline-flex items-center gap-1 text-sm text-neutral-600 dark:text-neutral-400">
              Analisando
              <LoadingDots />
            </span>
          </>
        ) : (
          <>
            <FileSpreadsheet className={`h-6 w-6 ${isDraggingOver ? "text-brand" : "text-neutral-400 dark:text-neutral-500"}`} strokeWidth={1.5} />
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {isDraggingOver ? "Solte o arquivo aqui" : (file?.name ?? "Clique ou arraste um arquivo aqui")}
            </span>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileChange} disabled={step === "analyzing"} />
      </label>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 flex items-start gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
        <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Até 5000 linhas por arquivo, 5MB.
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
