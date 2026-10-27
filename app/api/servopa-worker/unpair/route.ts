import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";
import { revokeServopaWorkerCredential } from "@/lib/servopa-tables/worker-auth";
import { requireServopaWorkerRoute, servopaWorkerJson } from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";

/** Chamado pelo desinstalador: o computador desliga a própria chave. */
export async function POST(req: Request) {
  const auth = await requireServopaWorkerRoute(req, "unpair");
  if (!auth.ok) return auth.response;

  const revoked = await revokeServopaWorkerCredential(auth.access.organizationId, auth.access.workerId);
  if (revoked) {
    await logAudit({
      organizationId: auth.access.organizationId,
      actorName: "Desinstalador do robô Servopa",
      action: "SERVOPA_WORKER_CREDENTIAL_REVOKED",
      targetType: "ServopaWorker",
      targetId: auth.access.workerId,
      detail: "O robô Servopa foi desinstalado deste computador e a chave dele foi desativada.",
      ip: getClientIp(req),
    });
  }
  return servopaWorkerJson({ revoked });
}
