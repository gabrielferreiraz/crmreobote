/**
 * Campos que um admin pode marcar como obrigatórios por etapa do funil (ver
 * PipelineStage.requiredFields). Compartilhado entre a API (validação de
 * verdade) e a UI de configuração (lista de checkboxes) — a lista de campos
 * elegíveis vive só aqui, então adicionar um novo campo obrigável é uma
 * linha só, num lugar só.
 *
 * A maioria é campo do próprio Deal, mas "contactSource"/"contactJobTitle"
 * são do Contact vinculado (Origem/Cargo) — prefixo "contact" no key só pra
 * deixar isso óbvio lendo o código; quem chama findMissingRequiredFields
 * precisa buscar esses dois no Contact e passar junto (ver
 * app/api/deals/[id]/move/route.ts).
 */

export const REQUIRABLE_DEAL_FIELDS = [
  { key: "value", label: "Valor do negócio" },
  { key: "creditType", label: "Tipo de crédito" },
  { key: "expectedCloseAt", label: "Data prevista de fechamento" },
  { key: "contactSource", label: "Origem" },
  { key: "contactJobTitle", label: "Cargo" },
] as const;

export type RequirableDealField = (typeof REQUIRABLE_DEAL_FIELDS)[number]["key"];

const REQUIRABLE_DEAL_FIELD_KEYS = new Set<string>(REQUIRABLE_DEAL_FIELDS.map((f) => f.key));

export function isRequirableDealField(key: string): key is RequirableDealField {
  return REQUIRABLE_DEAL_FIELD_KEYS.has(key);
}

/** Filtra qualquer entrada que não seja um campo elegível reconhecido. */
export function sanitizeRequiredFields(fields: unknown): RequirableDealField[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter((f): f is RequirableDealField => typeof f === "string" && isRequirableDealField(f));
}

export function labelForRequiredField(key: string): string {
  return REQUIRABLE_DEAL_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** Um valor por chave elegível — mistura campo do Deal e do Contact vinculado (ver comentário acima). */
type RequirableFieldValues = Partial<Record<RequirableDealField, unknown>>;

/** Dos campos exigidos pela etapa, quais estão vazios/nulos no negócio (+ contato) informado. */
export function findMissingRequiredFields(requiredFields: string[], values: RequirableFieldValues): RequirableDealField[] {
  return requiredFields.filter((field): field is RequirableDealField => {
    if (!isRequirableDealField(field)) return false;
    const value = values[field];
    return value === null || value === undefined || value === "";
  });
}
