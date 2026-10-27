import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit-log";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { createServopaWorkerPairing } from "@/lib/servopa-tables/worker-auth";
import { buildServopaInstallerScript } from "@/lib/servopa-tables/worker-bundle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Entrega o único arquivo que a pessoa abre no computador do robô. Cada
 * download gera um código novo, de uso único e válido por 1 hora — nenhuma
 * chave permanente sai daqui.
 */
export async function GET(request: Request) {
  const access = await getServopaTablesAccess();
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE });
  if (!access.canOperate) return NextResponse.json({ error: "Sem permissão para instalar o robô." }, { status: 403, headers: NO_STORE });
  const limited = rateLimitOrResponse(`servopa-installer:${access.organizationId}:${access.userId}`, 5, 60_000);
  if (limited) return limited;

  try {
    const crmBaseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
    const pairing = await createServopaWorkerPairing({ organizationId: access.organizationId, createdById: access.userId });
    const script = buildServopaInstallerScript({ crmBaseUrl, pairingCode: pairing.code });
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "SERVOPA_WORKER_INSTALLER_DOWNLOADED",
      targetType: "ServopaWorker",
      detail: "Baixou o instalador do robô Servopa (vale 1 hora, para um computador).",
      ip: getClientIp(request),
    });
    return new Response(script, {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="Instalar Robo Servopa.cmd"',
        "Content-Length": String(Buffer.byteLength(script, "utf8")),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[servopa-installer] falha ao montar instalador", error);
    return NextResponse.json({ error: "Não foi possível preparar o instalador." }, { status: 500, headers: NO_STORE });
  }
}
