"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, Database, Loader2, Search, X } from "lucide-react";
import { Modal } from "@/components/modal";
import type { CellValue } from "@/lib/sheets/column-types";
import { columnLabel, type ClientColumn, type ClientRow } from "@/lib/sheets/format";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { isMultiUserColumn } from "@/lib/sheets/column-types";
import {
  CRM_CONNECTORS,
  buildCrmUpdatePayload,
  connectorWithCustomFields,
  crmBoundConfig,
  crmColumnBinding,
  crmPreviewText,
  isCompatibleCrmColumn,
  type CrmEntity,
  type CrmCustomFieldDefinition,
  type CrmField,
  type CrmWriteCheck,
  type CrmWriteMapping,
} from "@/lib/sheets/crm-integration";

type Mode = "pull" | "push";
type Step = "configure" | "confirm" | "result";
type CrmRecord = {
  id: string;
  label: string;
  values: Record<string, CellValue | undefined>;
  display?: Record<string, string>;
  writeCheck?: CrmWriteCheck;
};
type CrmResult = { entity: CrmEntity; total: number; items: CrmRecord[] };
type SheetQuery = { rows: ClientRow[]; refs: Record<string, string> };

const NEW_COLUMN = "__new__";
const PUSH_LIMIT = 500;
/** "Máximo: Todos" — busca tudo que o filtro encontrar, de PAGE_SIZE em PAGE_SIZE. */
const ALL = 0;
/** Registros por busca no CRM (teto da rota crm-data). */
const PAGE_SIZE = 1_000;
/** Linhas por gravação: junta o que já chegou enquanto a gravação anterior rodava (teto do servidor: 5.000). */
const INSERT_MAX = 5_000;

async function request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Não foi possível concluir a operação");
  return data as T;
}

function initialFields(entity: CrmEntity): Set<string> {
  return new Set(CRM_CONNECTORS[entity].fields.filter((field) => field.defaultPull).map((field) => field.key));
}

function findDefaultColumn(entity: CrmEntity, field: CrmField, columns: ClientColumn[]): string {
  return (
    columns.find((column) => {
      const binding = crmColumnBinding(column.config);
      return binding?.entity === entity && binding.field === field.key && isCompatibleCrmColumn(field, column.type);
    })?.id ??
    columns.find(
      (column) => column.name.localeCompare(field.label, "pt-BR", { sensitivity: "base" }) === 0 && isCompatibleCrmColumn(field, column.type),
    )?.id ?? NEW_COLUMN
  );
}

function valueForPreview(record: CrmRecord, field: CrmField): string {
  return record.display?.[field.key] ?? crmPreviewText(record.values[field.key]);
}

export function CrmIntegrationDialog({
  sheetId,
  columns,
  initialMode,
  onClose,
  onDone,
}: {
  sheetId: string;
  columns: ClientColumn[];
  initialMode: Mode;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [entity, setEntity] = useState<CrmEntity>("contacts");
  const [step, setStep] = useState<Step>("configure");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState(() => initialFields("contacts"));
  const [pullTargets, setPullTargets] = useState<Record<string, string>>({});
  const [pushTargets, setPushTargets] = useState<Record<string, string>>({});
  const [linkColumnId, setLinkColumnId] = useState("");
  const [records, setRecords] = useState<CrmRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [preparedPush, setPreparedPush] = useState<{ id: string; label: string; payload: Record<string, unknown>; check: CrmWriteCheck }[]>([]);
  // Clientes sem responsável: o CRM os atribui a quem edita (role MEMBER). Fora do envio, salvo escolha explícita.
  const [includeClaims, setIncludeClaims] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ok: number; failed: { label: string; error: string }[] } | null>(null);
  const [customFields, setCustomFields] = useState<CrmCustomFieldDefinition[]>([]);
  const [progress, setProgress] = useState<{ done: number; target: number } | null>(null);
  const cancelRef = useRef(false);
  const pullCount = limit === ALL ? total : Math.min(limit, total);

  const connector = useMemo(() => connectorWithCustomFields(entity, customFields), [entity, customFields]);
  const identityField = connector.identity;
  const standardFields = connector.fields.filter((field) => !field.customFieldId);
  const customConnectorFields = connector.fields.filter((field) => !!field.customFieldId);
  const selectedFields = useMemo(
    () => [identityField, ...connector.fields.filter((field) => selected.has(field.key))],
    [connector, identityField, selected],
  );
  const linkColumns = useMemo(
    () => columns.filter((column) => column.type === connector.identity.type),
    [columns, connector.identity.type],
  );

  useEffect(() => {
    request<CrmCustomFieldDefinition[]>("/api/custom-fields").then(setCustomFields).catch(() => {});
  }, []);

  function reset(nextMode = mode, nextEntity = entity) {
    setMode(nextMode);
    setEntity(nextEntity);
    setStep("configure");
    setSelected(initialFields(nextEntity));
    setPullTargets({});
    setPushTargets({});
    setLinkColumnId("");
    setRecords([]);
    setPreparedPush([]);
    setIncludeClaims(false);
    setResult(null);
    setError("");
  }

  function pullTarget(field: CrmField): string {
    return pullTargets[field.key] ?? findDefaultColumn(entity, field, columns);
  }

  function pushTarget(field: CrmField): string {
    if (pushTargets[field.key] !== undefined) return pushTargets[field.key];
    const match = findDefaultColumn(entity, field, columns);
    return match === NEW_COLUMN ? "" : match;
  }

  async function preparePull() {
    setLoading(true);
    setError("");
    try {
      // "Todos": a prévia traz a 1ª página; o resto vem durante a importação.
      const params = new URLSearchParams({ entity, limit: String(limit === ALL ? PAGE_SIZE : limit) });
      if (query.trim()) params.set("q", query.trim());
      const data = await request<CrmResult>(`/api/sheets/crm-data?${params}`);
      setRecords(data.items);
      setTotal(data.total);
      setStep("confirm");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Adiciona os registros como linhas. Com "Todos" (ou mais que uma página), dois passos em
   * paralelo: um busca no CRM de 1.000 em 1.000 (cursor — não pula nem repete) e o outro grava
   * o que já chegou, juntando até 5.000 linhas por envio. Assim buscar e gravar se sobrepõem.
   */
  async function importRecords() {
    setLoading(true);
    setError("");
    cancelRef.current = false;
    const target = pullCount;
    let inserted = 0;
    let fetching = false;
    setProgress({ done: 0, target });
    try {
      const targetIds = new Map<string, string>();
      for (const field of selectedFields) {
        const target = pullTarget(field);
        if (target !== NEW_COLUMN) {
          targetIds.set(field.key, target);
          continue;
        }
        const created = await request<{ column: ClientColumn }>(`/api/sheets/${sheetId}/columns`, {
          method: "POST",
          body: JSON.stringify({ name: field.label, type: field.type, config: crmBoundConfig(entity, field) }),
        });
        targetIds.set(field.key, created.column.id);
      }

      const toRow = (record: CrmRecord) => {
        const values: Record<string, unknown> = {};
        for (const field of selectedFields) {
          const columnId = targetIds.get(field.key);
          const value = record.values[field.key];
          if (columnId && value !== undefined && value !== null && value !== "") values[columnId] = value;
        }
        return values;
      };
      const buffer: CrmRecord[] = records.slice(0, target);
      let fetched = buffer.length;
      fetching = fetched < target && records.length > 0;
      let fetchError: Error | null = null;
      let wake: (() => void) | null = null;
      const signal = () => {
        wake?.();
        wake = null;
      };
      const producer = (async () => {
        let cursor = records[records.length - 1]?.id;
        try {
          while (fetching && fetched < target && cursor) {
            const params = new URLSearchParams({ entity, limit: String(Math.min(PAGE_SIZE, target - fetched)), cursor, count: "0" });
            if (query.trim()) params.set("q", query.trim());
            const data = await request<CrmResult>(`/api/sheets/crm-data?${params}`);
            if (!data.items.length) break;
            buffer.push(...data.items);
            fetched += data.items.length;
            cursor = data.items[data.items.length - 1].id;
            signal();
          }
        } catch (err) {
          fetchError = err as Error;
        } finally {
          fetching = false;
          signal();
        }
      })();
      try {
        while (!cancelRef.current) {
          if (!buffer.length) {
            if (!fetching) break;
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          const chunk = buffer.splice(0, INSERT_MAX);
          await request(`/api/sheets/${sheetId}/rows`, { method: "POST", body: JSON.stringify({ rows: chunk.map(toRow) }) });
          inserted += chunk.length;
          setProgress({ done: inserted, target });
        }
      } finally {
        fetching = false;
        await producer;
      }
      if (fetchError) throw fetchError;
      // Parou antes do total sem ninguém pedir: registros saíram do CRM durante a importação.
      const short = !cancelRef.current && inserted < target;
      setResult({
        ok: inserted,
        failed: short
          ? [{ label: "Incompleto", error: `${(target - inserted).toLocaleString("pt-BR")} registro(s) não vieram — provavelmente foram excluídos do CRM durante a importação.` }]
          : [],
      });
      setStep("result");
    } catch (err) {
      const message = (err as Error).message;
      setError(inserted ? `${inserted.toLocaleString("pt-BR")} linhas foram adicionadas antes do erro. ${message}` : message);
    } finally {
      fetching = false;
      setLoading(false);
      setProgress(null);
      if (inserted) await onDone();
    }
  }

  async function preparePush() {
    const effectiveLink = linkColumnId || linkColumns[0]?.id;
    const mappings: CrmWriteMapping[] = connector.fields
      .filter((field) => field.writable)
      .map((field) => ({ fieldKey: field.key, columnId: pushTarget(field) }))
      .filter((mapping) => mapping.columnId);
    if (!effectiveLink) return setError(`Inclua uma coluna do tipo ${connector.singular} para identificar os registros`);
    if (mappings.length === 0) return setError("Mapeie pelo menos um campo que será enviado ao CRM");

    setLoading(true);
    setError("");
    try {
      const found: { id: string; label: string; payload: Record<string, unknown>; check: CrmWriteCheck }[] = [];
      for (let offset = 0; offset < 50_000 && found.length < PUSH_LIMIT; offset += 500) {
        const data = await request<SheetQuery>(`/api/sheets/${sheetId}/rows/query`, {
          method: "POST",
          body: JSON.stringify({ offset, limit: 500 }),
        });
        for (const row of data.rows) {
          const id = row.values[effectiveLink];
          if (typeof id !== "string") continue;
          const payload = buildCrmUpdatePayload(entity, mappings, row.values);
          if (Object.keys(payload).length === 0) continue;
          found.push({ id, label: data.refs[id] ?? id, payload, check: "ok" });
          if (found.length >= PUSH_LIMIT) break;
        }
        if (data.rows.length < 500) break;
      }
      // Confere no CRM, antes de enviar, quem pode ser alterado (dono do registro, carteira).
      const checks = new Map<string, CrmWriteCheck>();
      for (let i = 0; i < found.length; i += 200) {
        const ids = found.slice(i, i + 200).map((f) => f.id);
        const data = await request<CrmResult>(`/api/sheets/crm-data?${new URLSearchParams({ entity, ids: ids.join(",") })}`);
        for (const item of data.items) checks.set(item.id, item.writeCheck ?? "ok");
      }
      // Registro que sumiu do CRM (excluído) também não é enviado.
      for (const f of found) f.check = checks.get(f.id) ?? "blocked";
      setLinkColumnId(effectiveLink);
      setPreparedPush(found);
      setStep("confirm");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const sendable = preparedPush.filter((item) => item.check === "ok" || (includeClaims && item.check === "claim"));
  const claimCount = preparedPush.filter((item) => item.check === "claim").length;
  const blocked = preparedPush.filter((item) => item.check === "blocked");

  async function sendRecords() {
    setLoading(true);
    setError("");
    const failed: { label: string; error: string }[] = blocked.map((item) => ({ label: item.label, error: "não existe mais no CRM" }));
    let ok = 0;
    let cursor = 0;
    const queue = sendable;
    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        try {
          await request(connector.updatePath(item.id), { method: "PUT", body: JSON.stringify(item.payload) });
          ok++;
        } catch (err) {
          failed.push({ label: item.label, error: (err as Error).message });
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
      setResult({ ok, failed });
      setStep("result");
    } finally {
      setLoading(false);
    }
  }

  const previewFields = mode === "pull" ? selectedFields : connector.fields.filter((field) => field.writable && pushTarget(field));

  return (
    <Modal onClose={loading ? () => {} : onClose} maxWidth="max-w-5xl" mobileSheet panelClassName="!p-0 !pb-0 overflow-hidden">
      <div className="flex max-h-[85vh] flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <span className="flex h-9 w-9 items-center justify-center rounded bg-[var(--xl-soft)] text-[var(--xl)]"><Database className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-semibold">Integrar Planilha com o CRM</h2>
            <p className="text-xs text-neutral-500">Operação manual, com prévia e confirmação</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="ml-auto rounded p-1.5 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex border-b border-neutral-200 px-5 pt-2 dark:border-neutral-800">
          <ModeButton active={mode === "pull"} icon={ArrowDownToLine} onClick={() => reset("pull", entity)}>Obter Dados do CRM</ModeButton>
          <ModeButton active={mode === "push"} icon={ArrowUpFromLine} onClick={() => reset("push", entity)}>Enviar ao CRM</ModeButton>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {step === "result" && result ? (
            <ResultPanel result={result} mode={mode} onAgain={() => reset(mode, entity)} />
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Origem</span>
                  <select
                    value={entity}
                    disabled={step !== "configure" || loading}
                    onChange={(event) => reset(mode, event.target.value as CrmEntity)}
                    className="h-9 w-full rounded border border-neutral-300 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <option value="contacts">Clientes</option>
                    <option value="deals">Negócios</option>
                  </select>
                </label>
                {mode === "pull" ? (
                  <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Pesquisar no CRM</span>
                      <span className="relative block"><Search className="absolute top-2.5 left-2.5 h-4 w-4 text-neutral-400" /><input value={query} disabled={step !== "configure" || loading} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !loading && selected.size > 0) { event.preventDefault(); void preparePull(); } }} placeholder={`Nome, telefone ou ${entity === "contacts" ? "empresa" : "cliente"}`} className="h-9 w-full rounded border border-neutral-300 bg-white pr-2 pl-8 dark:border-neutral-700 dark:bg-neutral-900" /></span>
                    </label>
                    <label className="space-y-1 text-sm"><span className="font-medium">Máximo</span><select value={limit} disabled={step !== "configure" || loading} onChange={(event) => setLimit(Number(event.target.value))} className="h-9 w-full rounded border border-neutral-300 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-900"><option value={100}>100</option><option value={500}>500</option><option value={1000}>1.000</option><option value={ALL}>Todos</option></select></label>
                  </div>
                ) : (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Coluna de vínculo</span>
                    <select value={linkColumnId || linkColumns[0]?.id || ""} disabled={step !== "configure" || loading} onChange={(event) => setLinkColumnId(event.target.value)} className="h-9 w-full rounded border border-neutral-300 bg-white px-2 dark:border-neutral-700 dark:bg-neutral-900">
                      {linkColumns.length === 0 && <option value="">Nenhuma coluna do tipo {connector.singular}</option>}
                      {linkColumns.map((column) => <option key={column.id} value={column.id}>{columnLabel(column, columns.indexOf(column))}</option>)}
                    </select>
                  </label>
                )}
              </div>

              {step === "configure" && mode === "pull" && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Campos e destino na planilha</h3>
                  <div className="max-h-72 overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
                    <MappingRow field={identityField} checked target={pullTarget(identityField)} columns={columns} fixed onTarget={(target) => setPullTargets((current) => ({ ...current, [identityField.key]: target }))} />
                    <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">Dados de {connector.singular.toLowerCase()}</div>
                    {standardFields.map((field) => (
                      <MappingRow key={field.key} field={field} checked={selected.has(field.key)} target={pullTarget(field)} columns={columns} onChecked={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(field.key); else next.delete(field.key); return next; })} onTarget={(target) => setPullTargets((current) => ({ ...current, [field.key]: target }))} />
                    ))}
                    {customConnectorFields.length > 0 && <div className="border-y border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">Campos personalizados</div>}
                    {customConnectorFields.map((field) => (
                      <MappingRow key={field.key} field={field} checked={selected.has(field.key)} target={pullTarget(field)} columns={columns} onChecked={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(field.key); else next.delete(field.key); return next; })} onTarget={(target) => setPullTargets((current) => ({ ...current, [field.key]: target }))} />
                    ))}
                  </div>
                </section>
              )}

              {step === "configure" && mode === "push" && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Mapeie as colunas que serão enviadas</h3>
                  <div className="max-h-80 overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
                    {connector.fields.filter((field) => field.writable).map((field) => (
                      <div key={field.key} className="grid grid-cols-[minmax(130px,1fr)_minmax(180px,1fr)] items-center gap-3 border-b border-neutral-100 px-3 py-2 last:border-0 dark:border-neutral-800">
                        <span className="text-sm">{field.label}</span>
                        <select value={pushTarget(field)} onChange={(event) => setPushTargets((current) => ({ ...current, [field.key]: event.target.value }))} className="h-8 rounded border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                          <option value="">Não enviar</option>
                          {columns.filter((column) => isCompatibleCrmColumn(field, column.type) && !(field.type === "USER" && isMultiUserColumn(column))).map((column) => <option key={column.id} value={column.id}>{columnLabel(column, columns.indexOf(column))}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">Células vazias são ignoradas. Até {PUSH_LIMIT.toLocaleString("pt-BR")} registros vinculados por envio.</p>
                </section>
              )}

              {step === "confirm" && (
                <section className="space-y-3">
                  <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    {mode === "pull"
                      ? limit === ALL || pullCount > records.length
                        ? `${pullCount === total ? "Todos os" : `${pullCount.toLocaleString("pt-BR")} de`} ${total.toLocaleString("pt-BR")} registros encontrados serão adicionados como novas linhas (buscados de 1.000 em 1.000).`
                        : `${records.length.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} registros encontrados serão adicionados como novas linhas.`
                      : `${sendable.length.toLocaleString("pt-BR")} registros vinculados receberão os valores abaixo. As regras normais do CRM continuam valendo.`}
                  </div>
                  {mode === "pull" && pullCount > SHEET_LIMITS.rowsPerSheet && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      A planilha comporta até {SHEET_LIMITS.rowsPerSheet.toLocaleString("pt-BR")} linhas: refine a pesquisa ou importe em outra planilha.
                    </p>
                  )}
                  {mode === "pull" && progress && (
                    <div className="space-y-1">
                      <div className="h-2 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                        <div className="h-full bg-[var(--xl)] transition-[width]" style={{ width: `${progress.target ? Math.round((progress.done / progress.target) * 100) : 0}%` }} />
                      </div>
                      <p className="text-xs text-neutral-500">
                        {progress.done.toLocaleString("pt-BR")} de {progress.target.toLocaleString("pt-BR")} linhas adicionadas…
                      </p>
                    </div>
                  )}
                  {mode === "push" && claimCount > 0 && (
                    <label className="flex items-start gap-2 rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                      <input type="checkbox" checked={includeClaims} onChange={(event) => setIncludeClaims(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--xl)]" />
                      <span>
                        Incluir <b>{claimCount.toLocaleString("pt-BR")}</b> cliente(s) <b>sem responsável</b>. Pela regra do CRM, ao alterar um cliente sem
                        responsável, <b>você passa a ser o responsável</b> por ele.
                      </span>
                    </label>
                  )}
                  {mode === "push" && blocked.length > 0 && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {blocked.length.toLocaleString("pt-BR")} registro(s) não serão enviados: não existem mais no CRM.
                    </p>
                  )}
                  <PreviewTable records={mode === "pull" ? records : sendable.map((item) => ({ id: item.id, label: item.label, values: item.payload as Record<string, CellValue> }))} fields={previewFields} />
                  {mode === "push" && sendable.length === 0 && <p className="text-sm text-red-600 dark:text-red-400">Nenhuma linha vinculada pode ser enviada com os mapeamentos atuais.</p>}
                </section>
              )}

              {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {step === "confirm" && mode === "pull" && progress && (
            <button type="button" onClick={() => (cancelRef.current = true)} className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900">Parar</button>
          )}
          {step === "confirm" && <button type="button" disabled={loading} onClick={() => setStep("configure")} className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900">Voltar</button>}
          {step === "result" ? (
            <button type="button" onClick={onClose} className="rounded bg-[var(--xl-btn)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--xl-btn-hover)]">Concluir</button>
          ) : step === "configure" ? (
            <button type="button" disabled={loading || (mode === "pull" && selected.size === 0)} onClick={mode === "pull" ? preparePull : preparePush} className="flex items-center gap-2 rounded bg-[var(--xl-btn)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--xl-btn-hover)] disabled:opacity-40">{loading && <Loader2 className="h-4 w-4 animate-spin" />}Ver prévia</button>
          ) : (
            <button type="button" disabled={loading || (mode === "pull" ? records.length === 0 || pullCount > SHEET_LIMITS.rowsPerSheet : sendable.length === 0)} onClick={mode === "pull" ? importRecords : sendRecords} className="flex items-center gap-2 rounded bg-[var(--xl-btn)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--xl-btn-hover)] disabled:opacity-40">{loading && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "pull" ? "Confirmar e adicionar" : "Confirmar envio"}</button>
          )}
        </footer>
      </div>
    </Modal>
  );
}

function ModeButton({ active, icon: Icon, onClick, children }: { active: boolean; icon: typeof ArrowDownToLine; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm ${active ? "border-[var(--xl)] font-semibold text-[var(--xl)]" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}><Icon className="h-4 w-4" />{children}</button>;
}

function MappingRow({ field, checked, target, columns, fixed, onChecked, onTarget }: { field: CrmField; checked: boolean; target: string; columns: ClientColumn[]; fixed?: boolean; onChecked?: (checked: boolean) => void; onTarget: (target: string) => void }) {
  return (
    <div className="grid grid-cols-[24px_minmax(120px,1fr)_minmax(180px,1fr)] items-center gap-2 border-b border-neutral-100 px-3 py-2 last:border-0 dark:border-neutral-800">
      <input type="checkbox" checked={checked} disabled={fixed} onChange={(event) => onChecked?.(event.target.checked)} className="h-4 w-4 accent-[var(--xl)]" />
      <span className="text-sm">{field.label}{fixed && <span className="ml-1 text-xs text-neutral-400">(vínculo)</span>}</span>
      <select value={target} disabled={!checked} onChange={(event) => onTarget(event.target.value)} className="h-8 rounded border border-neutral-300 bg-white px-2 text-sm disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900">
        <option value={NEW_COLUMN}>Criar nova coluna “{field.label}”</option>
        {columns.filter((column) => isCompatibleCrmColumn(field, column.type)).map((column) => <option key={column.id} value={column.id}>Usar “{columnLabel(column, columns.indexOf(column))}”</option>)}
      </select>
    </div>
  );
}

function PreviewTable({ records, fields }: { records: CrmRecord[]; fields: readonly CrmField[] }) {
  if (records.length === 0) return <div className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">Nenhum registro para mostrar.</div>;
  return (
    <div className="overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-900"><tr>{fields.map((field) => <th key={field.key} className="whitespace-nowrap px-3 py-2 font-semibold">{field.label}</th>)}</tr></thead>
        <tbody>{records.slice(0, 8).map((record) => <tr key={record.id} className="border-t border-neutral-100 dark:border-neutral-800">{fields.map((field) => <td key={field.key} className="max-w-60 truncate whitespace-nowrap px-3 py-2" title={valueForPreview(record, field)}>{field.key === "__record" ? record.label : valueForPreview(record, field)}</td>)}</tr>)}</tbody>
      </table>
      {records.length > 8 && <p className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">Prévia das primeiras 8 de {records.length.toLocaleString("pt-BR")} linhas.</p>}
    </div>
  );
}

function ResultPanel({ result, mode, onAgain }: { result: { ok: number; failed: { label: string; error: string }[] }; mode: Mode; onAgain: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Check className="h-7 w-7" /></span>
      <div><h3 className="text-lg font-semibold">{result.ok.toLocaleString("pt-BR")} {mode === "pull" ? "linhas adicionadas" : "registros atualizados"}</h3>{result.failed.length > 0 && mode === "push" && <p className="mt-1 text-sm text-red-600">{result.failed.length} registros não puderam ser atualizados.</p>}</div>
      {result.failed.length > 0 && <div className="max-h-64 overflow-auto rounded border border-red-200 text-left text-sm dark:border-red-900">{result.failed.map((failure, index) => <div key={`${failure.label}-${index}`} className="border-b border-red-100 px-3 py-2 last:border-0 dark:border-red-900"><b>{failure.label}:</b> {failure.error}</div>)}</div>}
      <button type="button" onClick={onAgain} className="text-sm font-medium text-[var(--xl)] hover:underline">Fazer outra operação</button>
    </div>
  );
}
