import { prisma } from "@/lib/prisma";
import { getDealScope, type DealScope } from "@/lib/team-scope";

/**
 * Grupos de compartilhamento entre consultores (ver prisma/schema.prisma,
 * model ShareGroup) — dentro de um grupo, todo membro vê o que foi ligado
 * (agenda e/ou negócios) de todo membro. Ortogonal a Team/getDealScope:
 * afeta só Agenda e Pipeline/negócio (nunca Relatórios) — quem usa
 * getSharedScope em vez de getDealScope direto passa a incluir o que os
 * colegas de grupo compartilharam, em cima da visão normal por papel/equipe.
 *
 * `shareContacts` existe no schema mas NÃO está ligado a nada ainda: Clientes
 * já é visível pra organização inteira hoje (não é escopado por dono/equipe,
 * ver lib/contacts/list-query.ts), então não há o que esse interruptor
 * mudar por enquanto — fica reservado pro dia em que Clientes ganhar
 * escopo próprio.
 */

const roles = ["OWNER", "MANAGER", "SUPERVISOR"] as const;
export type ShareGroupManagerRole = (typeof roles)[number];

export function canManageShareGroups(role: string | undefined): role is ShareGroupManagerRole {
  return roles.includes(role as ShareGroupManagerRole);
}

export type ShareResource = "shareAgenda" | "shareDeals" | "shareContacts";

/**
 * Todo userId que compartilha QUALQUER UM dos `resources` com `userId`, via
 * algum grupo em comum (união de todos os grupos que ele participa onde ao
 * menos um daqueles interruptores está ligado) — [] se nenhum grupo dele
 * tem nenhum desses recursos ligado. Usado pra somar à visão normal
 * (getDealScope) na Agenda/Pipeline — endpoints usados a partir de mais de
 * um lugar (ex.: /api/tasks, aberto tanto pela Agenda quanto pelo detalhe
 * do negócio) passam os dois recursos, pra valer o que QUALQUER um dos dois
 * contextos já garantiria sozinho.
 */
export async function getSharedOwnerIds(
  organizationId: string,
  userId: string,
  resources: ShareResource | ShareResource[],
): Promise<string[]> {
  const resourceList = Array.isArray(resources) ? resources : [resources];
  const myMemberships = await prisma.shareGroupMember.findMany({
    where: { userId, group: { organizationId, OR: resourceList.map((r) => ({ [r]: true })) } },
    select: { groupId: true },
  });
  if (myMemberships.length === 0) return [];

  const groupIds = myMemberships.map((m) => m.groupId);
  const allMembers = await prisma.shareGroupMember.findMany({
    where: { groupId: { in: groupIds } },
    select: { userId: true },
  });
  return Array.from(new Set(allMembers.map((m) => m.userId).filter((id) => id !== userId)));
}

/**
 * getDealScope (visão normal de negócios/tarefas) + quem compartilha
 * `resources` com este usuário. Donos (scope "all") não precisam de nada a
 * mais, já veem tudo.
 */
export async function getSharedScope(
  organizationId: string,
  userId: string,
  role: string | undefined,
  resources: ShareResource | ShareResource[],
): Promise<DealScope> {
  const scope = await getDealScope(organizationId, userId, role);
  if (scope.type === "all") return scope;

  const sharedOwnerIds = await getSharedOwnerIds(organizationId, userId, resources);
  if (sharedOwnerIds.length === 0) return scope;

  return { type: "owners", ownerIds: Array.from(new Set([...scope.ownerIds, ...sharedOwnerIds])) };
}

/**
 * Confere que todo id em `memberIds` é um usuário ATIVO desta organização e
 * está dentro do que o ATOR (quem está criando/editando o grupo) já
 * enxerga normalmente (getDealScope) — um Supervisor só pode juntar gente
 * da própria equipe num grupo, um Gerente só de quem ele supervisiona, um
 * Dono qualquer um. Sempre permite o próprio ator, mesmo fora do próprio
 * getDealScope (não faz sentido barrar alguém de se incluir no grupo que
 * está criando/editando).
 */
export async function validateShareGroupMemberIds(
  organizationId: string,
  actorUserId: string,
  actorRole: string | undefined,
  memberIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uniqueIds = Array.from(new Set(memberIds));
  if (uniqueIds.length === 0) return { ok: false, error: "Selecione ao menos um consultor" };

  const activeMembers = await prisma.organizationUser.findMany({
    where: { organizationId, userId: { in: uniqueIds }, active: true },
    select: { userId: true },
  });
  const activeIds = new Set(activeMembers.map((m) => m.userId));
  const missing = uniqueIds.filter((id) => !activeIds.has(id));
  if (missing.length > 0) {
    return { ok: false, error: "Um ou mais consultores selecionados não existem ou estão inativos" };
  }

  const scope = await getDealScope(organizationId, actorUserId, actorRole);
  if (scope.type === "all") return { ok: true };

  const allowed = new Set([...scope.ownerIds, actorUserId]);
  const outOfScope = uniqueIds.filter((id) => !allowed.has(id));
  if (outOfScope.length > 0) {
    return { ok: false, error: "Você só pode compartilhar com consultores que já enxerga (sua equipe)" };
  }
  return { ok: true };
}
