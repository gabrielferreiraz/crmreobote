import { NextResponse } from "next/server";
import { requireProcessAccess } from "@/lib/processes/access";
import { countProcessesByStage } from "@/lib/processes/list-query";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Total de processos por etapa, sob os mesmos filtros de GET /api/processes —
 * usado pelo Kanban (process-kanban-board.tsx) pra saber o total de verdade
 * de cada coluna sem precisar de uma consulta por coluna (mesma ideia de
 * app/api/deals/stage-counts/route.ts).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const pipelineId = searchParams.get("pipelineId") ?? undefined;
  const documentStatus = searchParams.get("documentStatus") as
    | "NOT_REQUESTED"
    | "PENDING_DELIVERY"
    | "DELIVERED"
    | null;
  const q = searchParams.get("q") ?? undefined;

  const access = await requireProcessAccess();
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const counts = await countProcessesByStage({
      organizationId: access.organizationId,
      ownerId: access.isAdmin ? undefined : access.userId,
      categoryId,
      pipelineId,
      documentStatus: documentStatus ?? undefined,
      q,
    });
    return NextResponse.json(counts);
  });
}
