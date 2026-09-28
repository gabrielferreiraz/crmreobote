import { prisma } from "@/lib/prisma";
import { runWithTenantUser } from "@/lib/tenant-context";

/**
 * Trava contra TOMADA DE CONTA entre organizações (auditoria de 09/2026, P0).
 *
 * `User` é global (login, senha, nome, e-mail, foto, nascimento) e
 * `OrganizationUser` liga a pessoa a N organizações. Antes desta trava a cadeia
 * era: qualquer um cria uma organização pública (/api/register) → como Dono,
 * adiciona o e-mail de um usuário que já existe noutra organização (o POST de
 * membros reaproveitava o User sem aceite) → "Trocar senha" (reset-password)
 * reescrevia a senha GLOBAL dele → o login com a senha nova caía na filiação
 * ativa MAIS ANTIGA (lib/auth.ts), ou seja, na organização original da vítima.
 *
 * Regra: um Dono só mexe em dado GLOBAL de quem pertence EXCLUSIVAMENTE à
 * organização dele (senha, e-mail, nome, nascimento), e não pode anexar à
 * própria organização alguém que já é membro de outra.
 *
 * Consulta com `runWithTenantUser` de propósito: dentro de `runWithTenant(org)`
 * a RLS só deixa ver as filiações DAQUELA organização, então "quantas
 * organizações essa pessoa tem" sempre daria 1. A policy de OrganizationUser
 * deixa ver todas as filiações de um userId quando `app.current_user_id` é ele.
 */
export async function getUserOrganizationIds(userId: string): Promise<string[]> {
  const rows = await runWithTenantUser(userId, () =>
    prisma.organizationUser.findMany({ where: { userId }, select: { organizationId: true } }),
  );
  return Array.from(new Set(rows.map((r) => r.organizationId)));
}

/** true = a pessoa só tem filiação nesta organização (ou em nenhuma). */
export async function isUserExclusiveToOrg(userId: string, organizationId: string): Promise<boolean> {
  const orgIds = await getUserOrganizationIds(userId);
  return orgIds.every((id) => id === organizationId);
}

/** Quantas filiações ATIVAS a pessoa tem em qualquer organização (push/avatar são globais por User). */
export async function countActiveMemberships(userId: string): Promise<number> {
  return runWithTenantUser(userId, () => prisma.organizationUser.count({ where: { userId, active: true } }));
}

/** Quantas filiações (ativas ou não) a pessoa tem em qualquer organização. */
export async function countMemberships(userId: string): Promise<number> {
  return runWithTenantUser(userId, () => prisma.organizationUser.count({ where: { userId } }));
}

export const SHARED_ACCOUNT_MESSAGE =
  "Esta pessoa também faz parte de outra organização — senha, e-mail, nome e data de nascimento só podem ser alterados por ela mesma.";

export const EMAIL_BELONGS_TO_OTHER_ORG_MESSAGE =
  "Este e-mail já é usado por uma conta de outra organização. Use outro e-mail para criar o usuário.";
