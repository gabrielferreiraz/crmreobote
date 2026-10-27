import { z } from "zod";
import { failServopaSync, SERVOPA_RETRY_DELAY_MS } from "@/lib/servopa-tables/queue";
import { parseServopaWorkerBody, requireServopaWorkerRoute, servopaQueueErrorResponse, servopaWorkerJson } from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  runId: z.string().min(1).max(64),
  leaseToken: z.string().min(32).max(128),
  code: z.string().min(1).max(80).regex(/^[A-Z0-9_]+$/),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
}).strict();

export async function POST(req: Request) {
  const auth = await requireServopaWorkerRoute(req, "fail");
  if (!auth.ok) return auth.response;
  const body = await parseServopaWorkerBody(req, bodySchema);
  if (!body.ok) return body.response;
  const retryAt = body.data.retryable ? new Date(Date.now() + SERVOPA_RETRY_DELAY_MS) : undefined;
  try {
    const result = await failServopaSync({ organizationId: auth.access.organizationId, ...body.data, retryAt });
    return servopaWorkerJson({
      retryAt: result.retryAt?.toISOString() ?? null,
      exhausted: result.exhausted,
      maxAttempts: result.maxAttempts,
    });
  } catch (error) {
    return servopaQueueErrorResponse(error);
  }
}
