"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Select } from "./select";
import { CurrencyInput } from "./currency-input";
import { DatePicker } from "./date-picker";
import { labelForRequiredField, type RequirableDealField } from "@/lib/deal-required-fields";
import { Avatar } from "./avatar";

export type RequirableFieldValues = Partial<Record<RequirableDealField, any>>;

export interface CompleteRequiredFieldsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: RequirableFieldValues) => void;
  missingFields: RequirableDealField[];
  deals: { id: string; name: string; contactName: string; contactInitials: string }[];
  stageName: string;
  leadSources: { label: string }[];
  jobTitles: { label: string }[];
  creditTypes: { id: string; label: string }[];
  submitting?: boolean;
}

export function CompleteRequiredFieldsDialog({
  isOpen,
  onClose,
  onSubmit,
  missingFields,
  deals,
  stageName,
  leadSources,
  jobTitles,
  creditTypes,
  submitting,
}: CompleteRequiredFieldsDialogProps) {
  const [values, setValues] = useState<RequirableFieldValues>({});
  const isBulk = deals.length > 1;

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  const isFormValid = missingFields.every((field) => {
    const val = values[field];
    return val !== undefined && val !== null && val !== "";
  });

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 dark:bg-orange-500/10">
          <AlertCircle className="h-6 w-6 text-orange-600 dark:text-orange-400" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Campos Obrigatórios</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
            A etapa <span className="font-medium text-neutral-900 dark:text-neutral-200">{stageName}</span> exige
            algumas informações que ainda não foram preenchidas.
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
        {isBulk ? (
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {deals.length} contatos selecionados
            <span className="block mt-1 text-xs text-neutral-500 dark:text-neutral-400 font-normal">
              O que você preencher abaixo será aplicado a todos eles.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar name={deals[0].contactName} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                {deals[0].contactName}
              </div>
              <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {deals[0].name}
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {missingFields.includes("contactSource") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Origem do Contato
            </label>
            <Select
              value={values.contactSource ?? ""}
              onChange={(val: string) => setValues({ ...values, contactSource: val })}
              options={leadSources.map((s) => ({ value: s.label, label: s.label }))}
              placeholder="Selecione..."
            />
          </div>
        )}

        {missingFields.includes("contactJobTitle") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Cargo do Contato
            </label>
            <Select
              value={values.contactJobTitle ?? ""}
              onChange={(val: string) => setValues({ ...values, contactJobTitle: val })}
              options={jobTitles.map((j) => ({ value: j.label, label: j.label }))}
              placeholder="Selecione..."
            />
          </div>
        )}

        {missingFields.includes("creditType") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Tipo de Crédito
            </label>
            <Select
              value={values.creditType ?? ""}
              onChange={(val: string) => setValues({ ...values, creditType: val })}
              options={creditTypes.map((c) => ({ value: c.label, label: c.label }))}
              placeholder="Selecione..."
            />
          </div>
        )}

        {missingFields.includes("value") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Valor Líquido
            </label>
            <CurrencyInput
              value={values.value ?? ""}
              onChange={(val: string) => setValues({ ...values, value: val })}
            />
          </div>
        )}

        {missingFields.includes("grossValue") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Valor Bruto
            </label>
            <CurrencyInput
              value={values.grossValue ?? ""}
              onChange={(val: string) => setValues({ ...values, grossValue: val })}
            />
          </div>
        )}

        {missingFields.includes("expectedCloseAt") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Data de Fechamento
            </label>
            <DatePicker
              value={values.expectedCloseAt ?? ""}
              onChange={(val: string) => setValues({ ...values, expectedCloseAt: val })}
            />
          </div>
        )}

        <div className="mt-8 flex items-center justify-end gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!isFormValid || submitting}
            className="btn-primary flex items-center gap-2 px-5 py-2.5 font-medium disabled:opacity-50"
          >
            {submitting ? "Movendo..." : isBulk ? "Aplicar a todos e Mover" : "Salvar e Mover"}
            {!submitting && <ArrowRight className="h-4 w-4" strokeWidth={2} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}
