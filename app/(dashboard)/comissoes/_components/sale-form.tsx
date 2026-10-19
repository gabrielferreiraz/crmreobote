"use client";

import { Select } from "@/components/select";
import { CurrencyInput } from "@/components/currency-input";
import { DatePicker } from "@/components/date-picker";
import { brazilDateKey } from "@/lib/timezone";
import { Choices } from "./question";

export type SaleFormState = {
  clientName: string;
  sellerId: string;
  saleDate: string;
  administratorId: string;
  modality: "FULL" | "REDUCED";
  netValue: string;
  grossValue: string;
  clientInstallment: string;
  autoDebit: boolean;
  creditType: string;
  quotaNumber: string;
  groupNumber: string;
  notes: string;
};

export type SaleFormOptions = {
  members: { id: string; name: string }[];
  /** As tabelas (categoria + modo) decidem se pede o valor da parcela do cliente. */
  administrators: {
    id: string;
    name: string;
    tables?: { creditType: string | null; revenueMode: "CREDIT_EQUAL" | "CREDIT_TABLE" | "CLIENT_INSTALLMENT_TABLE" | null }[];
  }[];
  creditTypes: string[];
};

/**
 * Campos da venda de comissão — os que mudam o valor primeiro
 * (administradora, modalidade, valores), o resto depois. Mesmo componente
 * pra corrigir uma venda e pra lançar uma "fora do CRM".
 */
export function SaleFields({
  value,
  onChange,
  options,
  showClient,
}: {
  value: SaleFormState;
  onChange: (next: SaleFormState) => void;
  options: SaleFormOptions;
  showClient: boolean;
}) {
  const set = <K extends keyof SaleFormState>(key: K, v: SaleFormState[K]) => onChange({ ...value, [key]: v });
  // Só a administradora que paga a corretora em "% da parcela do cliente"
  // precisa desse valor — nas outras o campo nem aparece.
  const tables = options.administrators.find((a) => a.id === value.administratorId)?.tables ?? [];
  const norm = (v: string) => v.toLocaleLowerCase("pt-BR");
  const table =
    (value.creditType ? tables.find((t) => t.creditType && norm(t.creditType) === norm(value.creditType)) : undefined) ??
    tables.find((t) => t.creditType === null);
  const needsClientInstallment = table?.revenueMode === "CLIENT_INSTALLMENT_TABLE" || value.clientInstallment !== "";

  return (
    <div className="space-y-3">
      {showClient && (
        <div className="space-y-1">
          <label className="field-label" htmlFor="sale-client">
            Nome do cliente
          </label>
          <input id="sale-client" className="field-input" value={value.clientName} maxLength={120} onChange={(e) => set("clientName", e.target.value)} />
        </div>
      )}

      <div className="space-y-1">
        <label className="field-label">Administradora</label>
        <Select
          value={value.administratorId}
          onChange={(v) => set("administratorId", v)}
          options={options.administrators.map((a) => ({ value: a.id, label: a.name }))}
          placeholder="Escolha a administradora"
          invalid={!value.administratorId}
        />
      </div>

      <div className="space-y-1">
        <label className="field-label">Tipo de parcela</label>
        <Choices
          value={value.modality}
          onChange={(v) => set("modality", v)}
          options={[
            { value: "FULL", label: "Parcela cheia" },
            { value: "REDUCED", label: "Meia parcela" },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="field-label">Valor líquido da venda</label>
          <CurrencyInput value={value.netValue} onChange={(v) => set("netValue", v)} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Valor bruto da venda</label>
          <CurrencyInput value={value.grossValue} onChange={(v) => set("grossValue", v)} />
        </div>
      </div>

      {needsClientInstallment && (
        <div className="space-y-1">
          <label className="field-label">Parcela do cliente</label>
          <CurrencyInput value={value.clientInstallment} onChange={(v) => set("clientInstallment", v)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="field-label">Quem vendeu</label>
          <Select
            value={value.sellerId}
            onChange={(v) => set("sellerId", v)}
            options={options.members.map((m) => ({ value: m.id, label: m.name }))}
            placeholder="Escolha quem vendeu"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Data da venda</label>
          <DatePicker value={value.saleDate} onChange={(v) => set("saleDate", v)} max={brazilDateKey()} />
        </div>
      </div>

      {options.creditTypes.length > 0 && (
        <div className="space-y-1">
          <label className="field-label">Categoria</label>
          <Select
            value={value.creditType}
            onChange={(v) => set("creditType", v)}
            options={[
              { value: "", label: "Sem categoria" },
              ...options.creditTypes.map((c) => ({ value: c, label: c })),
              // Categoria que saiu da lista continua aparecendo na venda que já tem ela.
              ...(value.creditType && !options.creditTypes.includes(value.creditType)
                ? [{ value: value.creditType, label: `${value.creditType} (não está mais na lista)` }]
                : []),
            ]}
            invalid={!value.creditType}
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="field-label">Débito automático?</label>
        <Choices
          value={value.autoDebit ? "yes" : "no"}
          onChange={(v) => set("autoDebit", v === "yes")}
          options={[
            { value: "no", label: "Não" },
            { value: "yes", label: "Sim" },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="field-label" htmlFor="sale-group">
            Grupo
          </label>
          <input id="sale-group" className="field-input" value={value.groupNumber} maxLength={40} onChange={(e) => set("groupNumber", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="field-label" htmlFor="sale-quota">
            Cota
          </label>
          <input id="sale-quota" className="field-input" value={value.quotaNumber} maxLength={40} onChange={(e) => set("quotaNumber", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="field-label" htmlFor="sale-notes">
          Observação interna
        </label>
        <textarea id="sale-notes" className="field-input min-h-16" value={value.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} />
      </div>
    </div>
  );
}

/** Formulário → corpo da API. `only` = mandar só o que mudou (correção). */
export function saleFormToBody(state: SaleFormState, initial?: SaleFormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    clientName: state.clientName.trim(),
    sellerId: state.sellerId,
    saleDate: state.saleDate,
    administratorId: state.administratorId || null,
    modality: state.modality,
    netValue: state.netValue === "" ? null : Number(state.netValue),
    grossValue: state.grossValue === "" ? null : Number(state.grossValue),
    clientInstallment: state.clientInstallment === "" ? null : Number(state.clientInstallment),
    autoDebit: state.autoDebit,
    creditType: state.creditType || null,
    quotaNumber: state.quotaNumber,
    groupNumber: state.groupNumber,
    notes: state.notes,
  };
  if (!initial) return body;
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(state) as (keyof SaleFormState)[]) {
    if (state[key] !== initial[key]) changed[key] = body[key];
  }
  return changed;
}
