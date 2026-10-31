import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { enableLista50Campaign, disableLista50Campaign, getLista50Config, parseLista50StartDate } from "@/lib/lista-50";

export const dynamic = "force-dynamic";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Trava em memória contra dois POSTs concorrentes ligando a campanha pra
// mesma organização (duplo clique, duas abas) — enableLista50Campaign faz um
// find-then-create da etapa "Black November" que não é atômico sozinho; sem
// isso as duas chamadas podiam achar "não existe ainda" ao mesmo tempo e
// criar duas etapas com o mesmo nome. Mesma limitação de processo único de
// lib/rate-limit.ts (aceitável: é uma ação de Dono, rara, nunca em lote).
const emVoo = new Set<string>();

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
  if (startsOn !== undefined && (typeof startsOn !== "string" || !DATE_KEY.test(startsOn))) {
    return NextResponse.json({ error: "Data de início inválida" }, { status: 400 });
  }
  const startDate = enabled ? parseLista50StartDate(startsOn as string | undefined) : null;

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (emVoo.has(access.organizationId)) {
    return NextResponse.json({ error: "Já estamos salvando a configuração — aguarde terminar." }, { status: 409 });
  }
  emVoo.add(access.organizationId);

  try {
    return await runWithTenant(access.organizationId, async () => {
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
  } finally {
    emVoo.delete(access.organizationId);
  }
}
