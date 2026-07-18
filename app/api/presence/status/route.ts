import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Quem está online agora — só Dono/Gerente (mesmo padrão de acesso já usado
 * em Configurações → Usuários). Usado tanto no carregamento inicial da
 * página quanto no polling que mantém os pontinhos atualizados sem recarregar.
 */
export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const members = await prisma.organizationUser.findMany({
      where: { organizationId: access.organizationId, active: true },
      select: { userId: true, lastActiveAt: true },
    });

    return NextResponse.json({ members });
  });
}
