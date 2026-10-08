import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const MAX_AUTOMATION_ACTIONS = 8;

export type AutomationActionEntry = {
  type: $Enums.AutomationAction;
  config: Record<string, unknown>;
};

type LegacyAction = {
  action: $Enums.AutomationAction;
  actionConfig: Prisma.JsonValue | Record<string, unknown> | null | undefined;
};

function asConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Regras antigas não têm `actions`; nesse caso a ação original vira a única entrada. */
export function resolveAutomationActions(actions: unknown, legacy: LegacyAction): AutomationActionEntry[] {
  if (Array.isArray(actions) && actions.length > 0) {
    return actions
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        type: entry.type as $Enums.AutomationAction,
        config: asConfig(entry.config),
      }));
  }

  return [{ type: legacy.action, config: asConfig(legacy.actionConfig) }];
}

export function actionEntriesToJson(actions: AutomationActionEntry[]): Prisma.InputJsonValue {
  return actions as unknown as Prisma.InputJsonValue;
}

export function parseAutomationActionsInput(
  input: { actions?: unknown; action?: unknown; actionConfig?: unknown },
  validActions: readonly $Enums.AutomationAction[],
): { ok: true; value: AutomationActionEntry[] } | { ok: false; error: string } {
  const raw = Array.isArray(input.actions)
    ? input.actions
    : input.action
      ? [{ type: input.action, config: input.actionConfig }]
      : [];

  if (raw.length === 0) return { ok: false, error: "Adicione ao menos uma ação" };
  if (raw.length > MAX_AUTOMATION_ACTIONS) {
    return { ok: false, error: `Use no máximo ${MAX_AUTOMATION_ACTIONS} ações por automação` };
  }

  const parsed: AutomationActionEntry[] = [];
  const used = new Set<string>();
  for (const rawEntry of raw) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return { ok: false, error: "Ação inválida" };
    }
    const entry = rawEntry as Record<string, unknown>;
    const type = entry.type as $Enums.AutomationAction;
    if (!validActions.includes(type)) return { ok: false, error: "Ação inválida" };
    if (used.has(type)) return { ok: false, error: "Não repita a mesma ação na automação" };
    used.add(type);
    parsed.push({ type, config: asConfig(entry.config) });
  }

  return { ok: true, value: parsed };
}
