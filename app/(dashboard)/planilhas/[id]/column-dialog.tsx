"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, GripVertical, Plus, Sparkles, Wand2, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import {
  SHEET_COLUMN_TYPE_LABELS,
  parseLooseBoolean,
  parseLooseDate,
  parseLooseNumber,
  type CellValue,
  type SheetColumnType,
} from "@/lib/sheets/column-types";
import { columnDecimals, columnOptions, isNumericType, type ClientColumn } from "@/lib/sheets/format";
import { ColumnTypeIcon } from "./column-type-icon";

const TYPE_GROUPS: { label: string; types: SheetColumnType[] }[] = [
  { label: "Mais usados", types: ["TEXT", "CURRENCY", "NUMBER", "PERCENT", "DATE", "SELECT", "CHECKBOX", "LONG_TEXT"] },
  { label: "Listas e Documentos", types: ["MULTI_SELECT", "PHONE", "CPF", "CNPJ", "EMAIL", "URL"] },
  { label: "Vínculo com o CRM", types: ["CONTACT", "DEAL", "USER"] },
];

const TYPE_HINTS: Record<SheetColumnType, string> = {
  TEXT: "Texto livre",
  LONG_TEXT: "Várias linhas / notas",
  CURRENCY: "R$ 1.250,00",
  NUMBER: "1.250,5",
  PERCENT: "12,5%",
  DATE: "29/10/2026",
  CHECKBOX: "Sim / Não",
  SELECT: "1 opção por célula",
  MULTI_SELECT: "Várias etiquetas",
  EMAIL: "nome@empresa.com",
  PHONE: "(67) 99999-9999",
  CPF: "000.000.000-00",
  CNPJ: "00.000.000/0001-00",
  URL: "https://…",
  CONTACT: "Ficha do cliente",
  DEAL: "Negócio no funil",
  USER: "Responsável",
};

type ConflictState = {
  count: number;
  samples: { rowNumber: number; value: string }[];
};

function suggestFromSamples(values: CellValue[]): { type: SheetColumnType; options?: string[] } | null {
  const filled = values
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== "")
    .slice(0, 200);
  if (!filled.length) return null;
  const strs = filled.map((v) => (Array.isArray(v) ? v.join(", ") : String(v).trim()));

  if (strs.every((s) => /R\$/i.test(s) && parseLooseNumber(s) !== null)) return { type: "CURRENCY" };
  if (strs.every((s) => s.endsWith("%") && parseLooseNumber(s) !== null)) return { type: "PERCENT" };
  if (strs.every((s) => parseLooseDate(s) !== null)) return { type: "DATE" };
  if (strs.every((s) => /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(s))) return { type: "CPF" };
  if (strs.every((s) => /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(s))) return { type: "CNPJ" };
  if (strs.every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) return { type: "EMAIL" };
  if (strs.every((s) => parseLooseNumber(s) !== null)) return { type: "NUMBER" };
  if (strs.every((s) => parseLooseBoolean(s) !== null && !/^\d+$/.test(s))) return { type: "CHECKBOX" };

  const distinct = [...new Set(strs.filter((s) => s.length <= 80))];
  if (filled.length >= 4 && distinct.length >= 2 && distinct.length <= Math.min(25, Math.ceil(filled.length * 0.6))) {
    return { type: "SELECT", options: distinct };
  }
  return null;
}

/**
 * Criar/editar coluna com escolha visual de tipo, sugestão automática pelos
 * dados da planilha, coleta automática de opções para listas e resolução
 * amigável quando algum valor não cabe no novo tipo (converter para 0,
 * adicionar às opções ou limpar apenas os incompatíveis).
 */
export function ColumnDialog({
  sheetId,
  column,
  insertAt,
  initialType,
  initialConflict,
  sampleValues = [],
  onClose,
  onSaved,
}: {
  sheetId: string;
  /** Ausente = coluna nova. */
  column?: ClientColumn;
  insertAt?: number;
  /** Tipo pré-selecionado (galeria da guia Inserir ou troca rápida de tipo). */
  initialType?: SheetColumnType;
  /** Conflito já detectado numa tentativa rápida de troca de tipo. */
  initialConflict?: ConflictState | null;
  /** Valores já carregados dessa coluna na tela (para sugerir tipo e puxar opções). */
  sampleValues?: CellValue[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(
    column?.name ?? (initialType ? SHEET_COLUMN_TYPE_LABELS[initialType].replace(/ \(.*\)$/, "").replace(/ do CRM$/, "") : ""),
  );
  const [type, setType] = useState<SheetColumnType>(initialType ?? column?.type ?? "TEXT");
  const [options, setOptions] = useState<string[]>(column ? columnOptions(column) : []);
  const [newOption, setNewOption] = useState("");
  const [decimals, setDecimals] = useState<number | "">(column ? (columnDecimals(column) ?? "") : initialType === "CURRENCY" ? 2 : "");
  const [required, setRequired] = useState(column?.required ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(initialConflict ?? null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const hasOptions = type === "SELECT" || type === "MULTI_SELECT";

  const discoveredOptions = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of sampleValues) {
      if (raw === undefined || raw === null) continue;
      const parts = Array.isArray(raw) ? raw.map(String) : type === "MULTI_SELECT" ? String(raw).split(/[;,]/) : [String(raw)];
      for (const p of parts) {
        const clean = p.trim().slice(0, 100);
        if (clean && !seen.has(clean) && out.length < 200) {
          seen.add(clean);
          out.push(clean);
        }
      }
    }
    return out;
  }, [sampleValues, type]);

  const missingDiscovered = useMemo(() => {
    const cur = new Set(options);
    return discoveredOptions.filter((o) => !cur.has(o));
  }, [discoveredOptions, options]);

  const suggestion = useMemo(() => suggestFromSamples(sampleValues), [sampleValues]);

  function selectType(nextType: SheetColumnType) {
    setType(nextType);
    setConflict(null);
    setError(null);
    if ((nextType === "SELECT" || nextType === "MULTI_SELECT") && options.length === 0 && discoveredOptions.length > 0) {
      setOptions(discoveredOptions);
    }
    if (nextType === "CURRENCY" && decimals === "") {
      setDecimals(2);
    }
  }

  function addOption() {
    const parts = newOption
      .split(/[;,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return setNewOption("");
    setOptions((list) => {
      const seen = new Set(list);
      const next = [...list];
      for (const p of parts) {
        if (!seen.has(p)) {
          seen.add(p);
          next.push(p);
        }
      }
      return next;
    });
    setNewOption("");
  }

  async function save(onInvalid?: "clear" | "zero" | "addOptions") {
    if (!name.trim()) return setError("Dê um nome para a coluna");
    setSaving(true);
    setError(null);
    const config = hasOptions ? { options } : isNumericType(type) && decimals !== "" ? { decimals } : {};
    const body = column
      ? {
          name,
          type,
          config,
          required,
          ...(onInvalid === "clear" ? { force: true, onInvalid: "clear" } : onInvalid ? { onInvalid } : {}),
        }
      : { name, type, config, required, ...(insertAt !== undefined ? { position: insertAt } : {}) };
    const res = await fetch(column ? `/api/sheets/${sheetId}/columns/${column.id}` : `/api/sheets/${sheetId}/columns`, {
      method: column ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (res.status === 409 && typeof data?.invalidCount === "number") {
      return setConflict({
        count: data.invalidCount,
        samples: Array.isArray(data.invalidSamples) ? data.invalidSamples : [],
      });
    }
    if (!res.ok) return setError(data?.error ?? "Não foi possível salvar a coluna");
    onSaved();
  }

  const decimalPreview = useMemo(() => {
    const n = 1250.5;
    const d = decimals === "" ? (type === "CURRENCY" ? 2 : undefined) : decimals;
    const formatted = n.toLocaleString("pt-BR", d === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: d, maximumFractionDigits: d });
    if (type === "CURRENCY") return `R$ ${formatted}`;
    if (type === "PERCENT") return `${formatted}%`;
    return formatted;
  }, [type, decimals]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-xl" mobileSheet>
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{column ? "Configurar coluna" : "Nova coluna"}</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Escolha o nome e o formato dos dados desta coluna.
            </p>
          </div>
          {column && suggestion && suggestion.type !== type && (
            <button
              type="button"
              onClick={() => {
                selectType(suggestion.type);
                if (suggestion.options) setOptions(suggestion.options);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              title="Analisa os valores já preenchidos na coluna e seleciona o melhor formato"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Sugerido: {SHEET_COLUMN_TYPE_LABELS[suggestion.type]}
            </button>
          )}
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nome da coluna</span>
          <input
            autoFocus
            value={name}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="field-input w-full"
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Tipo de dado</span>
            {column && column.type !== type && (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Mudando de {SHEET_COLUMN_TYPE_LABELS[column.type]} → {SHEET_COLUMN_TYPE_LABELS[type]}
              </span>
            )}
          </div>
          <div className="space-y-2.5 rounded-xl border border-neutral-200 bg-neutral-50/60 p-2.5 dark:border-neutral-800 dark:bg-neutral-900/50">
            {TYPE_GROUPS.map((g) => (
              <div key={g.label} className="space-y-1">
                <p className="px-1 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">{g.label}</p>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {g.types.map((t) => {
                    const active = type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => selectType(t)}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all ${
                          active
                            ? "bg-white font-semibold text-brand shadow-xs ring-1 ring-brand/40 dark:bg-neutral-800 dark:text-brand"
                            : "text-neutral-700 hover:bg-white/80 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
                        }`}
                      >
                        <ColumnTypeIcon type={t} className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-neutral-400"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs leading-tight">{SHEET_COLUMN_TYPE_LABELS[t]}</div>
                          <div className="truncate text-[10px] font-normal text-neutral-400">{TYPE_HINTS[t]}</div>
                        </div>
                        {active && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {hasOptions && (
          <div className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Opções da lista ({options.length})
              </span>
              {missingDiscovered.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOptions((list) => [...list, ...missingDiscovered])}
                  className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/15"
                >
                  <Wand2 className="h-3 w-3" />
                  Puxar {missingDiscovered.length} valor(es) já existentes na coluna
                </button>
              )}
            </div>
            {options.length > 0 && (
              <ul className="max-h-36 space-y-1 overflow-auto pr-1">
                {options.map((o, i) => (
                  <li
                    key={o}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragIndex === null || dragIndex === i) return;
                      setOptions((list) => {
                        const next = [...list];
                        const [m] = next.splice(dragIndex, 1);
                        next.splice(i, 0, m);
                        return next;
                      });
                      setDragIndex(i);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <GripVertical className="h-3.5 w-3.5 cursor-grab text-neutral-300" />
                    <span className="flex-1 truncate">{o}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${o}`}
                      onClick={() => setOptions((list) => list.filter((x) => x !== o))}
                      className="text-neutral-400 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-1.5">
              <input
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOption();
                  }
                }}
                maxLength={200}
                placeholder="Digite uma ou várias opções separadas por vírgula…"
                className="field-input flex-1 py-1 text-sm"
              />
              <button type="button" className="btn-secondary btn-sm inline-flex items-center gap-1" onClick={addOption}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </button>
            </div>
          </div>
        )}

        {isNumericType(type) && (
          <div className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Casas decimais</span>
              <span className="text-neutral-500">
                Exemplo: <strong className="text-neutral-800 dark:text-neutral-200">{decimalPreview}</strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Automático", value: "" as const },
                { label: "Inteiro (0)", value: 0 },
                { label: "1 casa", value: 1 },
                { label: "2 casas (,00)", value: 2 },
                { label: "3 casas", value: 3 },
                { label: "4 casas", value: 4 },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setDecimals(opt.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    decimals === opt.value
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
          <div>
            <div className="font-medium">Preenchimento obrigatório</div>
            <div className="text-xs text-neutral-400">Exige que toda linha preenchida tenha um valor nesta coluna</div>
          </div>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand)]"
          />
        </label>

        {conflict !== null && (
          <div className="space-y-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <p className="font-medium">
                  <strong>{conflict.count}</strong> célula(s) têm valores que não são {SHEET_COLUMN_TYPE_LABELS[type].toLowerCase()}.
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200/80">
                  Escolha abaixo o que fazer com essas {conflict.count} célula(s) — todas as outras serão convertidas normalmente:
                </p>
              </div>
            </div>

            {conflict.samples.length > 0 && (
              <div className="max-h-28 overflow-auto rounded-lg border border-amber-200/80 bg-white/80 px-2.5 py-1.5 text-xs dark:border-amber-500/20 dark:bg-neutral-900/60">
                <p className="mb-1 font-semibold text-amber-900 dark:text-amber-300">Exemplos encontrados na coluna:</p>
                <ul className="space-y-0.5">
                  {conflict.samples.map((s) => (
                    <li key={`${s.rowNumber}-${s.value}`} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-neutral-500">Linha {s.rowNumber}</span>
                      <span className="truncate font-medium text-neutral-800 dark:text-neutral-200">&ldquo;{s.value}&rdquo;</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {isNumericType(type) && (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={saving}
                  onClick={() => save("zero")}
                >
                  Converter esses {conflict.count} para 0 e salvar
                </button>
              )}
              {hasOptions && (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={saving}
                  onClick={() => save("addOptions")}
                >
                  Adicionar às opções e salvar
                </button>
              )}
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={saving}
                onClick={() => save("clear")}
              >
                Limpar só esses {conflict.count} e salvar
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setConflict(null)}>
                Voltar
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {conflict === null && (
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={() => save()}>
              {saving ? <LoadingDots /> : column ? "Salvar alterações" : "Criar coluna"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
