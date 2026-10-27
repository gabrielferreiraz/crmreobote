import { ServopaParseError } from "@/lib/servopa-tables/parse";
import {
  beginServopaSnapshotUpload,
  failServopaSync,
  getCompletedServopaSync,
} from "@/lib/servopa-tables/queue";
import {
  buildServopaSnapshot,
  servopaSnapshotPayloadSchema,
  ServopaSnapshotPayloadError,
} from "@/lib/servopa-tables/snapshot-payload";
import { ServopaSnapshotValidationError } from "@/lib/servopa-tables/snapshot-validation";
import { syncServopaSnapshot } from "@/lib/servopa-tables/sync";
import { ServopaSyncInterruptedError } from "@/lib/servopa-tables/sync-engine";
import {
  parseServopaWorkerBody,
  requireServopaWorkerRoute,
  servopaQueueErrorResponse,
  servopaWorkerJson,
} from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireServopaWorkerRoute(req, "snapshot");
  if (!auth.ok) return auth.response;
  const body = await parseServopaWorkerBody(req, servopaSnapshotPayloadSchema, MAX_SNAPSHOT_BYTES);
  if (!body.ok) return body.response;

  const completed = await getCompletedServopaSync(auth.access.organizationId, body.data.runId);
  if (completed) {
    return servopaWorkerJson({
      completed: true,
      alreadyProcessed: true,
      finishedAt: completed.finishedAt?.toISOString() ?? null,
      summary: completed.summary,
    });
  }

  let activeLeaseToken = body.data.leaseToken;
  try {
    const upload = await beginServopaSnapshotUpload({
      organizationId: auth.access.organizationId,
      runId: body.data.runId,
      leaseToken: body.data.leaseToken,
    });
    activeLeaseToken = upload.uploadLeaseToken;
    const { groups, evidence } = buildServopaSnapshot(body.data);
    const result = await syncServopaSnapshot({
      organizationId: auth.access.organizationId,
      groups,
      trigger: "MANUAL",
      complete: true,
      evidence,
      existingRunId: body.data.runId,
    });
    return servopaWorkerJson({ completed: true, alreadyProcessed: false, summary: result.summary });
  } catch (error) {
    if (error instanceof ServopaSyncInterruptedError) {
      return servopaWorkerJson({ error: error.message, code: "JOB_CANCELLED" }, 409);
    }
    if (error instanceof ServopaParseError || error instanceof ServopaSnapshotValidationError || error instanceof ServopaSnapshotPayloadError) {
      await failServopaSync({
        organizationId: auth.access.organizationId,
        runId: body.data.runId,
        leaseToken: activeLeaseToken,
        code: "INVALID_SNAPSHOT",
        message: error.message,
      }).catch(() => {});
      return servopaWorkerJson({ error: `Coleta rejeitada: ${error.message}`, code: "INVALID_SNAPSHOT" }, 422);
    }
    return servopaQueueErrorResponse(error);
  }
}
