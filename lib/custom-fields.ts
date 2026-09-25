/**
 * Coerção/validação/formatação de valores de campo personalizado —
 * compartilhado entre as rotas de API (contatos/negócios) e o motor de
 * automações, pra nunca duplicar a lógica de "isso bate com o tipo do
 * campo?" em mais de um lugar.
 */

import { formatCpf, isValidCpf, normalizeCpf } from "@/lib/cpf";

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "CPF";
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
    case "CPF": {
      // Aceita com ou sem pontuação, guarda só os dígitos (ver lib/cpf.ts). Roda no
      // servidor pra contatos, negócios e API v1 — validação só no navegador se burla.
      const digits = normalizeCpf(String(raw));
      if (!isValidCpf(digits)) throw new Error(`"${def.label}" não é um CPF válido — confira os números digitados`);
      return digits;
    }
  }
}

/**
 * Valida um conjunto de valores contra as definições de campo de uma
 * entidade — obrigatórios presentes, cada valor batendo com o tipo/opções.
 * Retorna os valores já coeridos (prontos pra gravar) ou lança no primeiro erro.
 *
 * `previousValues` (só na EDIÇÃO): o que já estava gravado. Serve pra um caso
 * específico — CPF legado inválido (ex.: "3395004171", que perdeu o zero à
 * esquerda numa planilha; ~800 clientes vindos da importação do Agendor). A
 * tela reenvia TODOS os campos a cada salvamento, então recusar o valor antigo
 * impediria editar QUALQUER coisa desse cliente. Regra: valor inválido IGUAL
 * ao que já estava gravado passa como veio; valor inválido NOVO (a pessoa
 * digitou) continua recusado.
 */
export function validateCustomFieldValues(
  definitions: CustomFieldDefinitionLike[],
  rawValues: Record<string, unknown> | null | undefined,
  previousValues?: Record<string, unknown> | null,
): CustomFieldValues {
  const input = rawValues ?? {};
  const result: CustomFieldValues = {};

  for (const def of definitions) {
    let coerced: CustomFieldValue;
    try {
      coerced = coerceCustomFieldValue(def, input[def.id]);
    } catch (err) {
      const before = previousValues?.[def.id];
      if (def.type === "CPF" && typeof before === "string" && normalizeCpf(before) === normalizeCpf(String(input[def.id] ?? ""))) {
        coerced = before;
      } else {
        throw err;
      }
    }
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
  if (def.type === "CPF") return formatCpf(String(raw));
  return String(raw);
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  BOOLEAN: "Sim ou não",
  SELECT: "Lista de opções",
  CPF: "CPF",
};

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  CONTACT: "Cliente",
  DEAL: "Negócio",
};
