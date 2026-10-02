export type AcademyOnboardingRole = "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
export type AcademyOnboardingArea = "VENDAS" | "ADMINISTRATIVO";
export type AcademyOnboardingState = "NOT_REQUIRED" | "REQUIRED" | "STARTED" | "CRM_UNLOCKED";
export type ManualAcademyOnboardingAction = "REQUIRE" | "EXEMPT";

export function requiresAcademyOnboarding(role: AcademyOnboardingRole, area: AcademyOnboardingArea): boolean {
  return role === "MEMBER" && area === "VENDAS";
}

export function initialAcademyOnboardingState(
  role: AcademyOnboardingRole,
  area: AcademyOnboardingArea,
  required = true,
): AcademyOnboardingState {
  return required && requiresAcademyOnboarding(role, area) ? "REQUIRED" : "NOT_REQUIRED";
}

export function isCrmRestrictedByAcademy(
  role: AcademyOnboardingRole,
  area: AcademyOnboardingArea,
  state: AcademyOnboardingState,
): boolean {
  return requiresAcademyOnboarding(role, area) && (state === "REQUIRED" || state === "STARTED");
}

/**
 * Promover ou mover a pessoa para outra area libera o CRM. O caminho inverso
 * nao cria uma obrigacao retroativa: a regra vale apenas na criacao de um novo
 * consultor, nunca por uma edicao administrativa posterior.
 */
export function stateAfterMembershipChange(
  current: AcademyOnboardingState,
  nextRole: AcademyOnboardingRole,
  nextArea: AcademyOnboardingArea,
): AcademyOnboardingState {
  if (!requiresAcademyOnboarding(nextRole, nextArea) && (current === "REQUIRED" || current === "STARTED")) {
    return "NOT_REQUIRED";
  }
  return current;
}

/**
 * Controle manual reservado ao Dono. Retorna null quando o usuario nao pode
 * receber a exigencia: ela so se aplica a consultores ativos de Vendas.
 * Manter STARTED evita apagar o progresso visual de quem ja abriu a Academy.
 */
export function stateAfterManualAcademyAction(
  current: AcademyOnboardingState,
  role: AcademyOnboardingRole,
  area: AcademyOnboardingArea,
  active: boolean,
  action: ManualAcademyOnboardingAction,
): AcademyOnboardingState | null {
  if (!active || !requiresAcademyOnboarding(role, area)) return null;
  if (action === "EXEMPT") return "NOT_REQUIRED";
  return current === "STARTED" ? "STARTED" : "REQUIRED";
}
