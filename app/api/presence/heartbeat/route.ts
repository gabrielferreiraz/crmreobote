import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { recordHeartbeat } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

/**
 * Chamado a cada 30s pelo navegador enquanto a aba está em primeiro plano
 * (ver components/presence-heartbeat.tsx) — alimenta tanto "está online
 * agora" quanto o tempo diário no CRM (lib/user-activity.ts).
 */
export async function POST() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    await recordHeartbeat(organizationId, userId);
    return NextResponse.json({ ok: true });
  });
}
