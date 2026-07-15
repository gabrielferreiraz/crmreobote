"use client";

import { Select } from "@/components/select";
import { DatePicker } from "@/components/date-picker";

export type CustomFieldDefinitionInput = {
  id: string;
  label: string;
  type: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
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
          </div>
        );
      })}
    </>
  );
}
