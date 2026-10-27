import { z } from "zod";
import { heartbeatServopaSync } from "@/lib/servopa-tables/queue";
import { parseServopaWorkerBody, requireServopaWorkerRoute, servopaQueueErrorResponse, servopaWorkerJson } from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";

const progressSchema = z.object({
  phase: z.enum(["STARTING", "AUTHENTICATING", "LISTING_GROUPS", "FETCHING_GROUPS", "VALIDATING", "UPLOADING"]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  message: z.string().max(240).optional(),
}).refine((value) => value.completed <= value.total);

const activeHeartbeatSchema = z.object({
  runId: z.string().min(1).max(64),
  leaseToken: z.string().min(32).max(128),
  progress: progressSchema,
}).strict();
const bodySchema = z.union([activeHeartbeatSchema, z.object({}).strict()]);

function isActiveHeartbeat(value: z.infer<typeof bodySchema>): value is z.infer<typeof activeHeartbeatSchema> {
  return "runId" in value;
}

export async function POST(req: Request) {
  const auth = await requireServopaWorkerRoute(req, "heartbeat");
  if (!auth.ok) return auth.response;
  const body = await parseServopaWorkerBody(req, bodySchema);
  if (!body.ok) return body.response;
  if (!isActiveHeartbeat(body.data)) return servopaWorkerJson({ online: true });

  try {
    const result = await heartbeatServopaSync({ organizationId: auth.access.organizationId, ...body.data });
    return servopaWorkerJson({ online: true, leaseExpiresAt: result.leaseExpiresAt.toISOString() });
  } catch (error) {
    return servopaQueueErrorResponse(error);
  }
}
