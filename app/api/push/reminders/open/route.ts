import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/current-membership";
import { isPushReminderScopeKey } from "@/lib/push-reminders/keys";
import { acknowledgePushReminder } from "@/lib/push-reminders/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { scopeKey?: unknown } | null;
  if (!isPushReminderScopeKey(body?.scopeKey)) {
    return NextResponse.json({ error: "Conteúdo inválido" }, { status: 400 });
  }

  const acknowledged = await acknowledgePushReminder({
    organizationId: membership.organizationId,
    userId: membership.userId,
    scopeKey: body.scopeKey,
  });
  return NextResponse.json({ ok: true, acknowledged });
}
