import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { acknowledgePushReminder } from "@/lib/push-reminders/service";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  if (!id || id.length > 80) {
    return NextResponse.json({ error: "Lembrete inválido" }, { status: 400 });
  }
  const acknowledged = await acknowledgePushReminder({
    organizationId: membership.organizationId,
    userId: membership.userId,
    reminderId: id,
  });
  return NextResponse.json({ ok: true, acknowledged });
}
