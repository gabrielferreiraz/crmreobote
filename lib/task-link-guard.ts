import { prisma } from "@/lib/prisma";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";

/**
 * Autorização dos VÍNCULOS de uma tarefa (negócio, contato, responsável,
 * atividade) — auditoria de 09/2026, P1 (BOLA). Antes, POST/PUT /api/tasks só
 * conferia que cada id era "da mesma organização": um Consultor ligava tarefa
 * ao negócio/contato de qualquer colega (e via o nome deles na resposta) e
 * atribuía tarefa a qualquer membro. Regras, alinhadas com o resto do CRM:
 *
 *  - Negócio: precisa estar no escopo de negócios de quem pede (getSharedScope
 *    "shareDeals" — o mesmo de /negocios/[id]).
 *  - Contato: o contato DO PRÓPRIO negócio vinculado sempre vale (é o que o
 *    detalhe do negócio manda, mesmo quando o contato é de outro consultor);
 *    fora isso, Consultor só usa contato dele ou sem responsável — mesma regra
 *    do PUT /api/contacts/[id]. Supervisor/Gerente/Dono: qualquer contato.
 *  - Responsável: quem pede, o dono do negócio vinculado (o detalhe do negócio
 *    cria a tarefa em nome do responsável — pedido explícito), ou alguém da
 *    equipe de quem pede (getDealScope). Sempre membro ativo.
 *  - Atividade (Videochamada/Visita criada antes pelo detalhe do negócio): do
 *    mesmo negócio, ou criada por quem pede.
 */
export type TaskLinkInput = {
  organizationId: string;
  userId: string;
  role: string | undefined;
  dealId?: string | null;
  contactId?: string | null;
  ownerId?: string | null;
  activityId?: string | null;
};

export type TaskLinkResult =
  | { ok: true; deal: { id: string; ownerId: string; contactId: string } | null }
  | { ok: false; error: string };

export async function validateTaskLinks(input: TaskLinkInput): Promise<TaskLinkResult> {
  const { organizationId, userId, role } = input;

  let deal: { id: string; ownerId: string; contactId: string } | null = null;
  if (input.dealId) {
    const scope = await getSharedScope(organizationId, userId, role, "shareDeals");
    deal = await prisma.deal.findFirst({
      where: { id: input.dealId, organizationId, ...scopeWhere(scope) },
      select: { id: true, ownerId: true, contactId: true },
    });
    if (!deal) return { ok: false, error: "Negócio inválido" };
  }

  if (input.contactId && input.contactId !== deal?.contactId) {
    const onlyOwn = role === "MEMBER" ? { OR: [{ responsavelId: userId }, { responsavelId: null }] } : {};
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId, ...onlyOwn },
      select: { id: true },
    });
    if (!contact) return { ok: false, error: "Contato inválido" };
  }

  if (input.ownerId && input.ownerId !== userId) {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: input.ownerId } },
      select: { active: true },
    });
    if (!membership?.active) return { ok: false, error: "Responsável inválido" };
    if (input.ownerId !== deal?.ownerId) {
      const scope = await getDealScope(organizationId, userId, role);
      if (scope.type === "owners" && !scope.ownerIds.includes(input.ownerId)) {
        return { ok: false, error: "Você só pode atribuir tarefas a você mesmo ou à sua equipe" };
      }
    }
  }

  if (input.activityId) {
    const activity = await prisma.activity.findFirst({
      where: { id: input.activityId, organizationId },
      select: { dealId: true, userId: true },
    });
    const allowed = !!activity && ((!!deal && activity.dealId === deal.id) || activity.userId === userId);
    if (!allowed) return { ok: false, error: "Atividade inválida" };
  }

  return { ok: true, deal };
}
