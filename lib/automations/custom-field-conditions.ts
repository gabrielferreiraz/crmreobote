import { coerceCustomFieldValue, type CustomFieldDefinitionLike } from "@/lib/custom-fields";

export type CustomFieldConditionOperator = "equals" | "not_equals" | "is_set" | "is_not_set";

export type CustomFieldCondition = {
  fieldId: string;
  operator: CustomFieldConditionOperator;
  /** Ignorado quando operator é is_set/is_not_set. */
  value?: string;
};

/**
 * Filtro extra usado por findMatches (lib/automations/engine.ts) — checa se
 * os campos personalizados de uma entidade batem com as condições
 * configuradas na regra, além do próprio trigger. Compara sempre o valor
 * "cru" já coerido pro tipo do campo (nunca a versão formatada pra exibição),
 * pra não depender de formato de data/texto bater exatamente.
 */
export function matchesCustomFieldConditions(
  values: Record<string, unknown> | null | undefined,
  conditions: CustomFieldCondition[] | undefined,
  definitionsById: Map<string, CustomFieldDefinitionLike>,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  const bag = values ?? {};

  return conditions.every((condition) => {
    // Campo apagado depois que a regra foi salva — não trava a automação, só ignora essa condição.
    const def = definitionsById.get(condition.fieldId);
    if (!def) return true;

    const raw = bag[condition.fieldId];
    const isEmpty = raw === undefined || raw === null || raw === "";

    if (condition.operator === "is_set") return !isEmpty;
    if (condition.operator === "is_not_set") return isEmpty;

    let expected: string | number | boolean | null = null;
    try {
      expected = coerceCustomFieldValue(def, condition.value ?? "");
    } catch {
      return false;
    }

    if (condition.operator === "equals") return !isEmpty && raw === expected;
    if (condition.operator === "not_equals") return isEmpty || raw !== expected;
    return true;
  });
}
