"use client";

import { useRef, useState } from "react";
import { Loader2, FileSpreadsheet, CheckCircle2, TriangleAlert, Info, Sparkles, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";
import { Select } from "./select";
import { Badge } from "./badge";
import { formatCurrency } from "@/lib/format";
import { sortSelfFirst } from "@/lib/sort-self-first";

type ImportField = "contact" | "phone" | "whatsapp" | "email" | "source" | "dealName" | "value" | "grossValue" | "creditType" | "stage" | "owner";

type ColumnDetection = { field: ImportField; label: string; required: boolean; index: number; headerLabel: string | null };
type RowIssue = { code: string; message: string };
type ResolvedRow = {
  rowNumber: number;
  willImport: boolean;
  contactName: string | null;
  contactStatus: "existing" | "new" | null;
  dealName: string | null;
  stageName: string | null;
  ownerName: string | null;
  value: number | null;
  grossValue: number | null;
  issues: RowIssue[];
};
type ImportPlanSummary = {
  totalRows: number;
  toCreate: number;
  newContacts: number;
  existingContactsMatched: number;
  duplicateDeals: number;
  skippedNoContact: number;
  stageFallbacks: number;
  ownerFallbacks: number;
  valueParseFailures: number;
  grossValueParseFailures: number;
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

/** Campos que fazem sentido ter UM valor só aplicado a toda a planilha quando a coluna correspondente não existe no arquivo (ver fieldDefaults). */
type DefaultableField = "owner" | "stage" | "source" | "creditType";
const DEFAULTABLE_FIELDS: DefaultableField[] = ["owner", "stage", "source", "creditType"];

/** Quantas linhas a tabela de prévia mostra antes do "Mostrar mais" — ver showAllRows. */
const PREVIEW_ROWS_COLLAPSED = 5;

/** Etiqueta curta pro "Aviso" da tabela de linhas — o motivo mais lido de relance, sem precisar passar o mouse pra entender (ver title= pra ver todos, se tiver mais de um). */
const ISSUE_LABEL: Record<string, string> = {
  NO_CONTACT_NAME: "Sem contato",
  DUPLICATE_DEAL: "Duplicado",
  STAGE_NOT_FOUND: "Etapa não achada",
  OWNER_NOT_FOUND: "Resp. não achado",
  VALUE_UNREADABLE: "Valor líquido ilegível",
  GROSS_VALUE_UNREADABLE: "Valor bruto ilegível",
};

/**
 * Resumo em uma frase do que vai acontecer — a primeira coisa que a pessoa
 * lê, antes de qualquer grade técnica de coluna/estatística. Quem importa
 * é o consultor no dia a dia, não alguém acostumado a ler uma tabela de
 * contagens pra entender se deu certo.
 */
function importHeadline(s: ImportPlanSummary, hasBlockingIssue: boolean): { icon: typeof Sparkles; tone: "success" | "warning" | "danger"; title: string; subtitle: string } {
  if (hasBlockingIssue) {
    return {
      icon: TriangleAlert,
      tone: "danger",
      title: "Falta indicar uma coluna obrigatória",
      subtitle: "Sem saber qual coluna é o nome do contato, não dá pra continuar — aponte ela abaixo.",
    };
  }
  if (s.toCreate === 0) {
    if (s.totalRows > 0 && s.duplicateDeals === s.totalRows) {
      return {
        icon: Info,
        tone: "warning",
        title: "Nenhum negócio novo pra criar",
        subtitle: `Todos os ${s.totalRows} contatos dessa planilha já têm um negócio em andamento nesse funil.`,
      };
    }
    return {
      icon: Info,
      tone: "warning",
      title: "Nenhum negócio será criado",
      subtitle: "Confira se a coluna de contato foi reconhecida certo, em \"Ajustar colunas\" abaixo.",
    };
  }
  const details = [
    s.newContacts > 0 ? `${s.newContacts} contato${s.newContacts === 1 ? "" : "s"} novo${s.newContacts === 1 ? "" : "s"}` : null,
    s.existingContactsMatched > 0 ? `${s.existingContactsMatched} já cadastrado${s.existingContactsMatched === 1 ? "" : "s"}` : null,
    s.duplicateDeals > 0 ? `${s.duplicateDeals} duplicado${s.duplicateDeals === 1 ? "" : "s"} evitado${s.duplicateDeals === 1 ? "" : "s"}` : null,
  ].filter((d): d is string => !!d);
  return {
    icon: Sparkles,
    tone: "success",
    title: `${s.toCreate} negócio${s.toCreate === 1 ? "" : "s"} pronto${s.toCreate === 1 ? "" : "s"} pra importar`,
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
 * Importação de negócios com prévia de verdade — analisa o arquivo, mostra
 * o que vai acontecer (quantos negócios, quantos contatos novos, o que não
 * bateu) ANTES de gravar qualquer coisa no banco. Se uma coluna obrigatória
 * não foi reconhecida pelos sinônimos automáticos, deixa a pessoa apontar
 * manualmente qual coluna do arquivo é aquele campo, sem precisar editar o
 * arquivo e subir de novo.
 *
 * O arquivo em si nunca sai do navegador entre os passos — a mesma
 * instância de File é reenviada pra prévia E pra confirmação (ver
 * runPreview/runImport), então o servidor sempre resolve tudo do zero
 * contra o estado ATUAL do banco em cada chamada (nunca confia numa
 * decisão "congelada" da prévia — ver comentário em
 * lib/deals/import-resolve.ts).
 */
export function DealImportDialog({
  pipelineId,
  members,
  currentUserId,
  stages,
  creditTypes,
  onClose,
  onImported,
}: {
  pipelineId: string;
  members: { id: string; name: string }[];
  /** Quem está importando — vira o responsável padrão pré-selecionado (ver
   * fieldDefaults abaixo) em vez de "Distribuir automaticamente" vir marcado
   * sozinho. Um consultor testando a importação esperava que os negócios
   * virassem dele; com o rodízio como padrão anterior, eles espalhavam pro
   * time inteiro e ele só via a fatia que calhou de cair nele mesmo (ver
   * conversa que motivou essa mudança). */
  currentUserId: string;
  stages: { id: string; name: string }[];
  creditTypes: { id: string; label: string }[];
  onClose: () => void;
  onImported: () => void;
}) {
  // "Eu" sempre em primeiro na lista — mesma convenção de todo filtro de
  // Responsável no app (ver lib/sort-self-first.ts).
  const orderedMembers = sortSelfFirst(members, currentUserId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<ImportField, number>>>({});
  // Valor único pra todo mundo quando a coluna não existe no arquivo (ver
  // DEFAULTABLE_FIELDS acima) — ex.: planilha sem coluna "responsavel",
  // escolhe um responsável fixo em vez do rodízio automático de sempre.
  // owner começa preenchido com quem está importando (não vazio) — é o
  // padrão esperado ("importei, são meus negócios"), diferente de
  // stage/source/creditType, que continuam sem valor nenhum até a pessoa
  // escolher. Ainda dá pra trocar pra "Distribuir automaticamente" na
  // tela de prévia (ver Select abaixo) quando isso for o que se quer de
  // verdade.
  const [fieldDefaults, setFieldDefaults] = useState<Partial<Record<DefaultableField, string>>>({ owner: currentUserId });
  // Rascunho local do campo "Origem" (texto livre, não Select) — digitar
  // não deve disparar uma reanálise no servidor a cada tecla; só confirma
  // (e reanalisa) ao sair do campo. Os outros 3 campos são Select (uma
  // escolha discreta), reanalisam na hora sem esse problema.
  const [sourceDraft, setSourceDraft] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showIssueRows, setShowIssueRows] = useState(false);
  // Grade completa de mapeamento (10 campos) escondida por padrão — na
  // maioria das vezes a detecção automática já acerta tudo sozinha, e um
  // consultor não precisa ver 10 dropdowns técnicos pra confirmar uma
  // importação. Abre sozinha quando falta algo obrigatório (não dá pra
  // esconder o que bloqueia continuar).
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  // Tabela de linhas começa recolhida (ver PREVIEW_ROWS_COLLAPSED) — uma
  // planilha de 141 linhas não precisa mostrar tudo de cara, só o
  // suficiente pra confirmar que o mapeamento fez sentido.
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
      formData.append("pipelineId", pipelineId);
      if (Object.keys(currentOverrides).length > 0) formData.append("columnOverrides", JSON.stringify(currentOverrides));
      if (Object.keys(currentFieldDefaults).length > 0) formData.append("fieldDefaults", JSON.stringify(currentFieldDefaults));

      const res = await fetch("/api/deals/import/preview", { method: "POST", body: formData });
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setOverrides({});
    const initialFieldDefaults = { owner: currentUserId };
    setFieldDefaults(initialFieldDefaults);
    setSourceDraft("");
    runPreview(picked, {}, initialFieldDefaults);
  }

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
      formData.append("pipelineId", pipelineId);
      if (Object.keys(overrides).length > 0) formData.append("columnOverrides", JSON.stringify(overrides));
      if (Object.keys(fieldDefaults).length > 0) formData.append("fieldDefaults", JSON.stringify(fieldDefaults));

      const res = await fetch("/api/deals/import", { method: "POST", body: formData });
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
              {result.created} de {result.total} negócios criados
              {result.newContacts > 0 ? ` (${result.newContacts} contatos novos)` : ""}.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatChip label="Duplicados evitados" value={result.duplicateDeals} tone={result.duplicateDeals > 0 ? "warn" : undefined} />
          <StatChip label="Etapa não encontrada" value={result.stageFallbacks} tone={result.stageFallbacks > 0 ? "warn" : undefined} />
          <StatChip label="Responsável não encontrado" value={result.ownerFallbacks} tone={result.ownerFallbacks > 0 ? "warn" : undefined} />
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
                    {r.contactName ? ` (${r.contactName})` : ""}: {r.issues.map((i) => i.message).join("; ")}
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
    const hasMissingDefaultableColumn = preview.columns.some(
      (col) => col.index === -1 && DEFAULTABLE_FIELDS.includes(col.field as DefaultableField),
    );
    // WhatsApp é o único campo usado pra reconhecer contato já existente E
    // pra poder mandar mensagem pro lead depois (ver lib/deals/import-resolve.ts)
    // — diferente dos outros opcionais (telefone, e-mail, valor, nome do
    // negócio), que só ficam vazios se não encontrados. Sem essa coluna,
    // toda linha vira contato "novo" (mesmo já existindo) e ninguém no time
    // consegue conversar com esse lead pelo CRM depois — merece um aviso
    // explícito, não só a seção técnica escondida.
    const hasMissingWhatsappColumn = preview.columns.some((col) => col.field === "whatsapp" && col.index === -1);
    // Qualquer outro campo opcional não reconhecido não bloqueia nem merece
    // um aviso do tamanho do de cima, mas também não deveria ficar
    // completamente escondido — abre a grade técnica sozinha (em vez de só
    // quando falta algo obrigatório) pra dar pra notar e corrigir sem
    // precisar saber que o botão "Ver detalhes técnicos" existe.
    const hasAnyMissingOptionalColumn = preview.columns.some((col) => !col.required && col.index === -1);
    const mappingExpanded = showColumnMapping || hasBlockingIssue || hasAnyMissingOptionalColumn;
    const visibleRows = showAllRows ? preview.rows : preview.rows.slice(0, PREVIEW_ROWS_COLLAPSED);
    const hiddenRowCount = preview.rows.length - visibleRows.length;

    return (
      <Modal onClose={onClose} maxWidth="max-w-3xl">
        <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Confira antes de importar</h2>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
          {file?.name} — {s.totalRows} linha{s.totalRows === 1 ? "" : "s"} de dados. Nada foi gravado ainda.
        </p>

        {/* A primeira coisa a ler é essa frase, não uma grade de contagens
            — quem importa é o consultor no dia a dia, "17 duplicados
            evitados" sozinho não diz se deu certo ou não. */}
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

        {/* WhatsApp não é um campo "opcional" comum — sem ele, todo contato
            entra como "novo" (mesmo já existindo) e ninguém consegue
            conversar com esse lead pelo CRM depois. Aviso explícito, igual
            em peso ao de baixo (que pergunta o responsável padrão), não só
            a grade técnica escondida. */}
        {hasMissingWhatsappColumn && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2} />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-300">Não encontramos uma coluna de WhatsApp nessa planilha</p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                Sem isso, não dá pra reconhecer um contato que já existe (todo mundo entra como novo) nem mandar mensagem
                pra esse lead depois pelo CRM. Se a planilha tiver essa coluna com outro nome, aponte ela em
                &quot;Ver detalhes técnicos&quot; logo abaixo.
              </p>
            </div>
          </div>
        )}

        {/* Campo sem coluna correspondente na planilha — pedido direto,
            sempre visível quando se aplica (é uma decisão que precisa de
            resposta, não fica escondido atrás do "Ajustar colunas"). */}
        {hasMissingDefaultableColumn && (
          <div className="mb-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
              Não veio na planilha — escolha o valor pra usar em <strong>todos</strong> os negócios:
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {preview.columns
                .filter((col) => col.index === -1 && DEFAULTABLE_FIELDS.includes(col.field as DefaultableField))
                .map((col) => {
                  const field = col.field as DefaultableField;
                  return (
                    <div key={field} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">{col.label}</span>
                      {field === "owner" ? (
                        <Select
                          value={fieldDefaults.owner ?? currentUserId}
                          onChange={(v) => updateFieldDefault("owner", v)}
                          className="w-40 py-1 text-xs"
                          options={[
                            { value: "", label: "Distribuir automaticamente" },
                            ...orderedMembers.map((m) => ({ value: m.id, label: m.id === currentUserId ? "Eu" : m.name })),
                          ]}
                        />
                      ) : field === "stage" ? (
                        <Select
                          value={fieldDefaults.stage ?? ""}
                          onChange={(v) => updateFieldDefault("stage", v)}
                          className="w-40 py-1 text-xs"
                          options={[{ value: "", label: "Etapa padrão" }, ...stages.map((s) => ({ value: s.id, label: s.name }))]}
                        />
                      ) : field === "creditType" ? (
                        <Select
                          value={fieldDefaults.creditType ?? ""}
                          onChange={(v) => updateFieldDefault("creditType", v)}
                          className="w-40 py-1 text-xs"
                          options={[{ value: "", label: "Nenhum" }, ...creditTypes.map((c) => ({ value: c.label, label: c.label }))]}
                        />
                      ) : (
                        <input
                          value={sourceDraft}
                          onChange={(e) => setSourceDraft(e.target.value)}
                          onBlur={() => {
                            if (sourceDraft !== (fieldDefaults.source ?? "")) updateFieldDefault("source", sourceDraft);
                          }}
                          placeholder="Ex.: Feira XPTO"
                          className="field-input w-40 py-1 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Um só "avançado" pra tudo que é técnico (mapeamento de coluna +
            números detalhados) — escondido por padrão, some sozinho quando
            falta a coluna obrigatória. O essencial já está na frase de cima
            e na tabela embaixo; isso aqui é só pra quem quer conferir o
            porquê nos mínimos detalhes. */}
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
            <div className="grid grid-cols-4 gap-2 md:grid-cols-7">
              <StatChip label="Vão criar negócio" value={s.toCreate} />
              <StatChip label="Contatos novos" value={s.newContacts} />
              <StatChip label="Contatos já existiam" value={s.existingContactsMatched} />
              <StatChip label="Duplicados evitados" value={s.duplicateDeals} tone={s.duplicateDeals > 0 ? "warn" : undefined} />
              <StatChip label="Sem nome (ignoradas)" value={s.skippedNoContact} tone={s.skippedNoContact > 0 ? "warn" : undefined} />
              <StatChip label="Etapa não achada" value={s.stageFallbacks} tone={s.stageFallbacks > 0 ? "warn" : undefined} />
              <StatChip label="Valor líquido ilegível" value={s.valueParseFailures} tone={s.valueParseFailures > 0 ? "warn" : undefined} />
              <StatChip label="Valor bruto ilegível" value={s.grossValueParseFailures} tone={s.grossValueParseFailures > 0 ? "warn" : undefined} />
            </div>
          </div>
        )}

        {!hasBlockingIssue && (
          <div className="mb-4 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
                  <th className="px-2 py-1.5 font-medium">Linha</th>
                  <th className="px-2 py-1.5 font-medium">Contato</th>
                  <th className="px-2 py-1.5 font-medium">Negócio</th>
                  <th className="px-2 py-1.5 font-medium">Etapa</th>
                  <th className="px-2 py-1.5 font-medium">Responsável</th>
                  <th className="px-2 py-1.5 font-medium">Valor líquido</th>
                  <th className="px-2 py-1.5 font-medium">Valor bruto</th>
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
                    <td className="px-2 py-1.5 text-neutral-800 dark:text-neutral-200">
                      {r.contactName ?? "—"}
                      {r.contactStatus === "new" && <Badge tone="brand" size="sm" className="ml-1.5">novo</Badge>}
                    </td>
                    <td className="max-w-40 truncate px-2 py-1.5 text-neutral-600 dark:text-neutral-400">{r.dealName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">{r.stageName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400">{r.ownerName ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums text-neutral-600 dark:text-neutral-400">{r.value != null ? formatCurrency(r.value) : "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums text-neutral-600 dark:text-neutral-400">{r.grossValue != null ? formatCurrency(r.grossValue) : "—"}</td>
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
              `Importar ${s.toCreate} negócio${s.toCreate === 1 ? "" : "s"}`
            )}
          </button>
        </div>
      </Modal>
    );
  }

  // ─── Passo inicial: escolher arquivo ────────────────────────────────
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Importar negócios</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Arquivo .csv ou .xlsx com colunas: contato (obrigatório), whatsapp, telefone/celular, email, origem, negocio, valor,
        etapa, responsavel, tipo de credito. O nome da coluna pode variar — se não reconhecermos, você aponta manualmente na
        próxima tela.
      </p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center hover:border-neutral-400 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
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
            <FileSpreadsheet className="h-6 w-6 text-neutral-400 dark:text-neutral-500" strokeWidth={1.5} />
            <span className="text-sm text-neutral-600 dark:text-neutral-400">{file?.name ?? "Clique para escolher um arquivo"}</span>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileChange} disabled={step === "analyzing"} />
      </label>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 flex items-start gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
        <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        Até 1000 linhas por arquivo, 5MB.
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <button type="button" onClick={onClose} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
