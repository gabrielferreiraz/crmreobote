/**
 * "Que experiência essa pessoa vê" — Vendas (CRM de sempre) ou
 * Administrativo (pós-venda: início só com tarefas/anotações, sem Pipeline/
 * Negócios, Relatórios próprio). Sempre confere no banco (não confia só no
 * JWT), mesmo padrão de requireSession/requireProcessAccess.
 */

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import type { $Enums } from "@/app/generated/prisma/client";

export async function getCurrentUserArea(): Promise<$Enums.UserArea | null> {
  const session = await auth();
  if (!session?.user?.organizationId) return null;

  const organizationId = session.user.organizationId;
  const userId = session.user.id;

  const membership = await runWithTenant(organizationId, () =>
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { area: true, active: true },
    }),
  );
  if (!membership?.active) return null;

  return membership.area;
}
