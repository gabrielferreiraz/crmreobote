import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { enableLista50Campaign, disableLista50Campaign, getLista50Config } from "@/lib/lista-50";

export const dynamic = "force-dynamic";

/**
 * Ligar/desligar a campanha sazonal — decisão do Dono (não é tarefa
 * operacional do dia a dia, é "abrir/fechar a temporada"). Desligar não
 * apaga nada: a etapa "Black November" e os negócios já criados ficam no
 * pipeline; religar no ano seguinte só grava um novo `startsOn`.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const { enabled, startsOn } = (body ?? {}) as { enabled?: unknown; startsOn?: unknown };
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  let startDate: Date | null = null;
  if (enabled) {
    startDate = typeof startsOn === "string" ? new Date(startsOn) : new Date();
    if (Number.isNaN(startDate.getTime())) {
      return NextResponse.json({ error: "Data de início inválida" }, { status: 400 });
    }
  }

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    if (enabled) {
      await enableLista50Campaign(access.organizationId, access.userId, startDate!);
    } else {
      await disableLista50Campaign(access.organizationId, access.userId);
    }
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session?.user.name ?? "—",
      action: "LISTA_50_CAMPAIGN_CHANGED",
      detail: enabled ? `Campanha ligada a partir de ${startDate!.toISOString().slice(0, 10)}` : "Campanha desligada",
    });
    const config = await getLista50Config(access.organizationId);
    return NextResponse.json(config);
  });
}
