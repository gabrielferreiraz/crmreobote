import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/current-membership";
import { isCrmRestrictedByAcademy } from "@/lib/academy-onboarding";
import { canBypassRegistration } from "./rules";

export type RegistrationAccess = {
  organizationId: string;
  userId: string;
  actorName: string;
  canBypass: boolean;
  deal: { id: string; ownerId: string; contactId: string; status: "OPEN" | "WON" | "LOST" };
};

/**
 * Quem vê e edita o cadastro do cliente: Dono, Administrativo, o responsável
 * pelo negócio e os co-responsáveis. Dados bancários e documentos pessoais são
 * sensíveis (LGPD) — gerente/supervisor só entram se forem um desses papéis.
 * Sempre confere no banco, nunca só no token.
 */
export async function requireRegistrationAccess(dealId: string): Promise<{ access: RegistrationAccess } | { response: NextResponse }> {
  const m = await getCurrentMembership();
  if (!m?.active || isCrmRestrictedByAcademy(m.role, m.area, m.academyOnboardingStatus)) {
    return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  }
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId: m.organizationId },
    select: { id: true, ownerId: true, contactId: true, status: true, participants: { select: { userId: true } } },
  });
  if (!deal) return { response: NextResponse.json({ error: "Não encontrado" }, { status: 404 }) };

  const privileged = canBypassRegistration(m);
  const involved = deal.ownerId === m.userId || deal.participants.some((p) => p.userId === m.userId);
  if (!privileged && !involved) {
    return { response: NextResponse.json({ error: "Sem permissão para o cadastro deste cliente" }, { status: 403 }) };
  }
  return {
    access: {
      organizationId: m.organizationId,
      userId: m.userId,
      actorName: m.name ?? m.email ?? "Usuário",
      canBypass: privileged,
      deal: { id: deal.id, ownerId: deal.ownerId, contactId: deal.contactId, status: deal.status },
    },
  };
}
