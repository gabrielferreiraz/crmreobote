import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/** Registra a dica do atalho como vista pelo proprio usuario autenticado. */
export async function POST() {
  const access = await requireSession();
  if (!access.session || !access.organizationId || !access.userId) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  await runWithTenant(access.organizationId, () =>
    prisma.organizationUser.updateMany({
      where: {
        organizationId: access.organizationId!,
        userId: access.userId!,
        academyOnboardingStatus: "CRM_UNLOCKED",
        academyShortcutHintSeenAt: null,
      },
      data: { academyShortcutHintSeenAt: new Date() },
    }),
  );

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
