import { NextResponse } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/audit-log";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";
import { readJsonObjectOrError } from "@/lib/read-body";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaOperationState } from "@/lib/servopa-tables/queries";
import { revokeServopaWorkerCredential } from "@/lib/servopa-tables/worker-auth";

// Computadores novos entram pelo instalador de uso único
// (`/api/servopa-tables/installer` → `/api/servopa-worker/pair`); aqui só se remove.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const revokeSchema = z.object({ workerId: z.string().min(1).max(100) }).strict();

async function requireOperator() {
  const access = await getServopaTablesAccess();
  if (!access.ok) return { ok: false as const, response: NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE }) };
  if (!access.canOperate) return { ok: false as const, response: NextResponse.json({ error: "Sem permissão para configurar o robô." }, { status: 403, headers: NO_STORE }) };
  return { ok: true as const, access };
}

export async function DELETE(request: Request) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const limited = rateLimitOrResponse(`servopa-worker-key:${auth.access.organizationId}:${auth.access.userId}`, 4, 60_000);
  if (limited) return limited;
  const rawBody = await readJsonObjectOrError(request, 4_096);
  if (rawBody instanceof NextResponse) {
    rawBody.headers.set("Cache-Control", "no-store");
    return rawBody;
  }
  const body = revokeSchema.safeParse(rawBody);
  if (!body.success) return NextResponse.json({ error: "Computador inválido." }, { status: 400, headers: NO_STORE });

  const revoked = await revokeServopaWorkerCredential(auth.access.organizationId, body.data.workerId);
  if (!revoked) return NextResponse.json({ error: "Este computador já foi removido." }, { status: 404, headers: NO_STORE });
  await logAudit({
    organizationId: auth.access.organizationId,
    actorUserId: auth.access.userId,
    actorName: auth.access.actorName,
    action: "SERVOPA_WORKER_CREDENTIAL_REVOKED",
    targetType: "ServopaWorker",
    targetId: body.data.workerId,
    detail: "Removeu o acesso de um computador ao robô Servopa.",
    ip: getClientIp(request),
  });
  const state = await getServopaOperationState(auth.access.organizationId);
  return NextResponse.json({ revoked: true, state }, { headers: NO_STORE });
}
