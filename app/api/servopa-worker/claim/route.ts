import { claimNextServopaSync } from "@/lib/servopa-tables/queue";
import { readServopaPanelCredentials } from "@/lib/servopa-tables/panel-credentials";
import { requireServopaWorkerRoute, servopaQueueErrorResponse, servopaWorkerJson } from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireServopaWorkerRoute(req, "claim");
  if (!auth.ok) return auth.response;

  // O acesso da Servopa mora no ambiente do servidor. Sem ele, nenhuma coleta é
  // reivindicada (fica na fila, e a tela avisa) — e o computador continua online.
  const credentials = readServopaPanelCredentials();
  if (!credentials) {
    return servopaWorkerJson(
      { error: "O acesso da Servopa não está configurado no servidor do CRM.", code: "PANEL_CREDENTIALS_MISSING" },
      503,
    );
  }

  try {
    const job = await claimNextServopaSync(auth.access.organizationId, auth.access.workerId);
    // As credenciais só saem junto com uma coleta efetivamente reivindicada.
    return servopaWorkerJson(job ? { job, credentials } : { job: null });
  } catch (error) {
    return servopaQueueErrorResponse(error);
  }
}
