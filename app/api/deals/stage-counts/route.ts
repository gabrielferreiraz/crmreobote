import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { getDealScope } from "@/lib/team-scope";
import { countDealsByStage } from "@/lib/deals/list-query";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Total de negócios por etapa, sob os mesmos filtros de GET /api/deals — usado
 * pelo Kanban (kanban-board.tsx) pra saber quantos negócios cada coluna tem
 * de verdade no banco (badge + "tem mais pra carregar"), sem precisar de uma
 * consulta por coluna: uma única query aqui, mais uma única busca combinada
 * em /api/deals, no lugar de N consultas em paralelo (uma por etapa) — isso
 * chegou a estourar o timeout de transação por operação (15s) com o pool de
 * conexões sobrecarregado quando o pipeline tem várias etapas.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId") ?? undefined;
  const status = searchParams.get("status") as "OPEN" | "WON" | "LOST" | null;
  const q = searchParams.get("q") ?? undefined;
  const ownerIdParam = searchParams.get("ownerId");
  const ownerIds = ownerIdParam ? ownerIdParam.split(",").filter(Boolean) : undefined;
  const lossReasonId = searchParams.get("lossReasonId") ?? undefined;
  const jobTitle = searchParams.get("jobTitle") ?? undefined;
  const source = searchParams.get("source") ?? undefined;
  const state = searchParams.get("state") ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const stageEnteredBefore = parseDate(searchParams.get("stageEnteredBefore"));

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const counts = await countDealsByStage({
      organizationId: access.organizationId,
      pipelineId,
      scope,
      status: status ?? undefined,
      q,
      ownerIds,
      lossReasonId,
      jobTitle,
      source,
      state,
      city,
      stageEnteredBefore,
    });
    return NextResponse.json(counts);
  });
}
