import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";

/**
 * Quem pode ALTERAR um contato — a regra única do PUT /api/contacts/[id],
 * agora compartilhada com as rotas parciais (tags, qualificação de lead), que
 * só conferiam "mesma organização" (auditoria de 09/2026, P1 — BOLA):
 *  - Consultor (MEMBER): só contato dele ou sem responsável;
 *  - Supervisor/Gerente/Dono: qualquer contato da organização (Clientes já é
 *    visível inteiro pra esses papéis — ver app/(dashboard)/clientes/page.tsx).
 *
 * O papel vem de getCurrentMembership() (banco), não do JWT — um papel
 * rebaixado vale na hora, sem esperar novo login.
 *
 * Devolve null tanto pra "não existe" quanto pra "não é seu": a rota responde
 * 404 nos dois casos, pra não confirmar a existência de contato alheio.
 */
export async function findWritableContactId(organizationId: string, contactId: string): Promise<string | null> {
  const membership = await getCurrentMembership();
  if (!membership?.active) return null;
  const onlyOwn =
    membership.role === "MEMBER" ? { OR: [{ responsavelId: membership.userId }, { responsavelId: null }] } : {};
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId, ...onlyOwn },
    select: { id: true },
  });
  return contact?.id ?? null;
}
