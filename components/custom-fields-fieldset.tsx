"use client";

import { useId, useState } from "react";
import { Select } from "@/components/select";
import { DatePicker } from "@/components/date-picker";
import { isValidCpf, maskCpf, normalizeCpf } from "@/lib/cpf";
import type { CustomFieldType } from "@/lib/custom-fields";

export type CustomFieldDefinitionInput = {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
};

export type CustomFieldFormValues = Record<string, string | number | boolean | null>;

/**
 * Desenha um input por definição de campo personalizado — reaproveitado nos
 * formulários de criar/editar Cliente e Negócio, e na seção de campos
 * personalizados do detalhe do negócio.
 */
export function CustomFieldsFieldset({
  definitions,
  values,
  onChange,
}: {
  definitions: CustomFieldDefinitionInput[];
  values: CustomFieldFormValues;
  onChange: (values: CustomFieldFormValues) => void;
}) {
  if (definitions.length === 0) return null;

  function setValue(id: string, value: string | number | boolean | null) {
    onChange({ ...values, [id]: value });
  }

  return (
    <>
      {definitions.map((def) => {
        if (def.type === "BOOLEAN") {
          return (
            <label key={def.id} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={!!values[def.id]}
                onChange={(e) => setValue(def.id, e.target.checked)}
                className="accent-neutral-900 dark:accent-white"
              />
              {def.label}
              {def.required && " *"}
            </label>
          );
        }

        return (
          <div key={def.id} className="space-y-1">
            <label className="field-label">
              {def.label}
              {def.required && " *"}
            </label>
            {def.type === "TEXT" && (
              <input
                value={(values[def.id] as string) ?? ""}
                onChange={(e) => setValue(def.id, e.target.value)}
                required={def.required}
                className="field-input"
              />
            )}
            {def.type === "NUMBER" && (
              <input
                type="number"
                value={values[def.id] === null || values[def.id] === undefined ? "" : String(values[def.id])}
                onChange={(e) => setValue(def.id, e.target.value === "" ? null : Number(e.target.value))}
                required={def.required}
                className="field-input"
              />
            )}
            {def.type === "DATE" && (
              <DatePicker value={(values[def.id] as string) ?? ""} onChange={(v) => setValue(def.id, v || null)} />
            )}
            {def.type === "SELECT" && (
              <Select
                value={(values[def.id] as string) ?? ""}
                onChange={(v) => setValue(def.id, v || null)}
                options={def.options.map((o) => ({ value: o, label: o }))}
              />
            )}
            {def.type === "CPF" && (
              <CpfInput value={(values[def.id] as string) ?? ""} onChange={(v) => setValue(def.id, v || null)} required={def.required} />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Campo de CPF: máscara enquanto digita (000.000.000-00), guarda só os dígitos
 * no valor do formulário e avisa NA HORA quando o número não fecha — sem
 * esperar o servidor recusar (que continua sendo a fonte de verdade, ver
 * coerceCustomFieldValue em lib/custom-fields.ts). Só acusa "incompleto" depois
 * que a pessoa sai do campo, pra não gritar erro no meio da digitação.
 */
function CpfInput({ value, onChange, required }: { value: string; onChange: (digits: string) => void; required: boolean }) {
  const [touched, setTouched] = useState(false);
  const errorId = useId();
  const digits = normalizeCpf(value);

  let error: string | null = null;
  if (digits.length === 11 && !isValidCpf(digits)) error = "CPF inválido — confira os números digitados";
  else if (digits.length > 0 && digits.length < 11 && touched) error = "CPF incompleto — são 11 números";

  return (
    <>
      <input
        inputMode="numeric"
        autoComplete="off"
        placeholder="000.000.000-00"
        value={maskCpf(value)}
        onChange={(e) => onChange(normalizeCpf(e.target.value).slice(0, 11))}
        onBlur={() => setTouched(true)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="field-input"
      />
      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}
    </>
  );
}
