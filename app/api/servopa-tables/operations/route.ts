import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit-log";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { cancelActiveServopaSync, enqueueServopaSync } from "@/lib/servopa-tables/queue";
import { getServopaOperationState } from "@/lib/servopa-tables/queries";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

async function requireOperator() {
  const access = await getServopaTablesAccess();
  if (!access.ok) return { ok: false as const, response: NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE }) };
  if (!access.canOperate) return { ok: false as const, response: NextResponse.json({ error: "Sem permissão para operar o robô." }, { status: 403, headers: NO_STORE }) };
  return { ok: true as const, access };
}

export async function GET() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const state = await getServopaOperationState(auth.access.organizationId);
  return NextResponse.json(state, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const limited = rateLimitOrResponse(`servopa-run:${auth.access.organizationId}:${auth.access.userId}`, 6, 60_000);
  if (limited) return limited;

  const result = await enqueueServopaSync({
    organizationId: auth.access.organizationId,
    trigger: "MANUAL",
    requestedById: auth.access.userId,
  });
  if (result.created) {
    await logAudit({
      organizationId: auth.access.organizationId,
      actorUserId: auth.access.userId,
      actorName: auth.access.actorName,
      action: "SERVOPA_SYNC_REQUESTED",
      targetType: "ServopaSyncRun",
      targetId: result.run.id,
      detail: "Solicitou a atualização manual das tabelas Servopa.",
      ip: getClientIp(request),
    });
  }
  const state = await getServopaOperationState(auth.access.organizationId);
  return NextResponse.json({ created: result.created, state }, { status: result.created ? 201 : 200, headers: NO_STORE });
}

export async function DELETE(request: Request) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const limited = rateLimitOrResponse(`servopa-cancel:${auth.access.organizationId}:${auth.access.userId}`, 6, 60_000);
  if (limited) return limited;

  const cancelled = await cancelActiveServopaSync(auth.access.organizationId);
  if (cancelled) {
    await logAudit({
      organizationId: auth.access.organizationId,
      actorUserId: auth.access.userId,
      actorName: auth.access.actorName,
      action: "SERVOPA_SYNC_CANCELLED",
      targetType: "ServopaSyncRun",
      targetId: cancelled.id,
      detail: "Cancelou a atualização das tabelas Servopa.",
      ip: getClientIp(request),
    });
  }
  const state = await getServopaOperationState(auth.access.organizationId);
  return NextResponse.json({ cancelled: Boolean(cancelled), state }, { headers: NO_STORE });
}
