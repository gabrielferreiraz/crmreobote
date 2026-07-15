/**
 * Coerção/validação/formatação de valores de campo personalizado —
 * compartilhado entre as rotas de API (contatos/negócios) e o motor de
 * automações, pra nunca duplicar a lógica de "isso bate com o tipo do
 * campo?" em mais de um lugar.
 */

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
export type CustomFieldEntity = "CONTACT" | "DEAL";

export type CustomFieldDefinitionLike = {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
};

export type CustomFieldValue = string | number | boolean | null;
export type CustomFieldValues = Record<string, CustomFieldValue>;

/** Converte o valor cru (vindo de JSON.parse do body da request) pro tipo certo, ou lança um erro descritivo. */
export function coerceCustomFieldValue(def: CustomFieldDefinitionLike, raw: unknown): CustomFieldValue {
  if (raw === null || raw === undefined || raw === "") return null;

  switch (def.type) {
    case "TEXT":
      return String(raw);
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isNaN(n)) throw new Error(`"${def.label}" precisa ser um número`);
      return n;
    }
    case "DATE": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw new Error(`"${def.label}" precisa ser uma data válida`);
      return String(raw);
    }
    case "BOOLEAN":
      return typeof raw === "boolean" ? raw : raw === "true";
    case "SELECT": {
      const value = String(raw);
      if (!def.options.includes(value)) throw new Error(`"${def.label}" tem um valor fora das opções permitidas`);
      return value;
    }
  }
}

/**
 * Valida um conjunto de valores contra as definições de campo de uma
 * entidade — obrigatórios presentes, cada valor batendo com o tipo/opções.
 * Retorna os valores já coeridos (prontos pra gravar) ou lança no primeiro erro.
 */
export function validateCustomFieldValues(
  definitions: CustomFieldDefinitionLike[],
  rawValues: Record<string, unknown> | null | undefined,
): CustomFieldValues {
  const input = rawValues ?? {};
  const result: CustomFieldValues = {};

  for (const def of definitions) {
    const coerced = coerceCustomFieldValue(def, input[def.id]);
    if (def.required && (coerced === null || coerced === "")) {
      throw new Error(`"${def.label}" é obrigatório`);
    }
    if (coerced !== null) result[def.id] = coerced;
  }

  return result;
}

/** Formata um valor já salvo pra exibição/comparação (usado em automações e nas telas de detalhe). */
export function stringifyCustomFieldValue(def: CustomFieldDefinitionLike, raw: CustomFieldValue): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (def.type === "BOOLEAN") return raw ? "Sim" : "Não";
  if (def.type === "DATE") return new Date(String(raw)).toLocaleDateString("pt-BR");
  return String(raw);
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  BOOLEAN: "Sim ou não",
  SELECT: "Lista de opções",
};

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  CONTACT: "Cliente",
  DEAL: "Negócio",
};
