import { z } from "zod";
import { logAudit } from "@/lib/audit-log";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";
import { redeemServopaWorkerPairing, ServopaPairingError } from "@/lib/servopa-tables/worker-auth";
import { parseServopaWorkerBody, servopaWorkerJson } from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().min(1).max(160),
  computerName: z.string().max(120).optional(),
  windowsUser: z.string().max(120).optional(),
}).strict();

/**
 * O instalador troca o código de uso único (embutido no arquivo baixado) pela
 * chave própria deste computador. Única rota do robô sem chave: protegida pelo
 * código de 256 bits, de uso único e com validade de 1 hora, e por limite por IP.
 */
export async function POST(req: Request) {
  const limited = rateLimitOrResponse(`servopa-worker-pair:${getClientIp(req)}`, 10, 60_000);
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  const body = await parseServopaWorkerBody(req, bodySchema, 2_048);
  if (!body.ok) return body.response;

  try {
    const result = await redeemServopaWorkerPairing(body.data);
    await logAudit({
      organizationId: result.organizationId,
      actorUserId: result.createdById,
      actorName: "Instalador do robô Servopa",
      action: "SERVOPA_WORKER_CREDENTIAL_CREATED",
      targetType: "ServopaWorker",
      targetId: result.worker.id,
      detail: result.replacedPrevious
        ? `Reinstalou o robô Servopa em "${result.worker.name}" (${result.worker.keyPrefix}…); a chave anterior deste computador foi desativada.`
        : `Conectou o computador "${result.worker.name}" ao robô Servopa (${result.worker.keyPrefix}…).`,
      ip: getClientIp(req),
    });
    return servopaWorkerJson({ workerKey: result.fullKey, workerId: result.worker.id, name: result.worker.name }, 201);
  } catch (error) {
    if (error instanceof ServopaPairingError) {
      return servopaWorkerJson({ error: error.message, code: error.code }, error.code === "WORKER_LIMIT" ? 409 : 410);
    }
    console.error("[servopa-worker-pair] falha ao conectar computador", error);
    return servopaWorkerJson({ error: "Não foi possível conectar este computador agora. Tente de novo." }, 500);
  }
}
