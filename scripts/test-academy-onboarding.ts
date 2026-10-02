import assert from "node:assert/strict";
import test from "node:test";
import {
  initialAcademyOnboardingState,
  isCrmRestrictedByAcademy,
  stateAfterManualAcademyAction,
  stateAfterMembershipChange,
} from "../lib/academy-onboarding.ts";

test("somente novo MEMBER de VENDAS recebe onboarding obrigatorio", () => {
  assert.equal(initialAcademyOnboardingState("MEMBER", "VENDAS"), "REQUIRED");
  assert.equal(initialAcademyOnboardingState("MEMBER", "ADMINISTRATIVO"), "NOT_REQUIRED");
  assert.equal(initialAcademyOnboardingState("SUPERVISOR", "VENDAS"), "NOT_REQUIRED");
  assert.equal(initialAcademyOnboardingState("MANAGER", "VENDAS"), "NOT_REQUIRED");
  assert.equal(initialAcademyOnboardingState("OWNER", "VENDAS"), "NOT_REQUIRED");
  assert.equal(initialAcademyOnboardingState("MEMBER", "VENDAS", false), "NOT_REQUIRED");
});

test("CRM fica bloqueado apenas antes de chegar ao modulo de CRM", () => {
  assert.equal(isCrmRestrictedByAcademy("MEMBER", "VENDAS", "REQUIRED"), true);
  assert.equal(isCrmRestrictedByAcademy("MEMBER", "VENDAS", "STARTED"), true);
  assert.equal(isCrmRestrictedByAcademy("MEMBER", "VENDAS", "CRM_UNLOCKED"), false);
  assert.equal(isCrmRestrictedByAcademy("MEMBER", "VENDAS", "NOT_REQUIRED"), false);
});

test("mudanca para perfil isento libera sem criar bloqueio retroativo", () => {
  assert.equal(stateAfterMembershipChange("STARTED", "SUPERVISOR", "VENDAS"), "NOT_REQUIRED");
  assert.equal(stateAfterMembershipChange("REQUIRED", "MEMBER", "ADMINISTRATIVO"), "NOT_REQUIRED");
  assert.equal(stateAfterMembershipChange("NOT_REQUIRED", "MEMBER", "VENDAS"), "NOT_REQUIRED");
  assert.equal(stateAfterMembershipChange("CRM_UNLOCKED", "MEMBER", "VENDAS"), "CRM_UNLOCKED");
});

test("Dono pode exigir ou retirar onboarding de consultor de Vendas existente", () => {
  assert.equal(stateAfterManualAcademyAction("NOT_REQUIRED", "MEMBER", "VENDAS", true, "REQUIRE"), "REQUIRED");
  assert.equal(stateAfterManualAcademyAction("CRM_UNLOCKED", "MEMBER", "VENDAS", true, "REQUIRE"), "REQUIRED");
  assert.equal(stateAfterManualAcademyAction("STARTED", "MEMBER", "VENDAS", true, "REQUIRE"), "STARTED");
  assert.equal(stateAfterManualAcademyAction("REQUIRED", "MEMBER", "VENDAS", true, "EXEMPT"), "NOT_REQUIRED");
});

test("controle manual nao se aplica a perfil isento ou inativo", () => {
  assert.equal(stateAfterManualAcademyAction("NOT_REQUIRED", "SUPERVISOR", "VENDAS", true, "REQUIRE"), null);
  assert.equal(stateAfterManualAcademyAction("NOT_REQUIRED", "MEMBER", "ADMINISTRATIVO", true, "REQUIRE"), null);
  assert.equal(stateAfterManualAcademyAction("NOT_REQUIRED", "MEMBER", "VENDAS", false, "REQUIRE"), null);
});
