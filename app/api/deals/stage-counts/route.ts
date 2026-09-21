import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { getSharedScope } from "@/lib/share-groups";
import { countDealsByStage, countDealsWithTaskByStage } from "@/lib/deals/list-query";
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
  const hasNoOpenTask = searchParams.get("hasNoOpenTask") === "1";
  const taskDueBefore = parseDate(searchParams.get("taskDueBefore"));
  const noValue = searchParams.get("noValue") === "1";

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getSharedScope(access.organizationId, access.userId, access.role, "shareDeals");
    const filterParams = {
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
      hasNoOpenTask: hasNoOpenTask || undefined,
      taskDueBefore,
      noValue: noValue || undefined,
    };
    // Em PARALELO (era sequencial: esperava `counts` só pra saber quais
    // etapas consultar). countDealsWithTaskByStage virou uma agregada só e
    // não precisa mais dessa lista — quem consome usa `?? 0` pra etapa sem
    // chave (ver kanban-board.tsx). Esta rota roda a cada mudança de filtro
    // no Kanban, então um degrau de cascata a menos aparece direto na
    // sensação de resposta ao clique.
    const [counts, withTaskCounts] = await Promise.all([
      countDealsByStage(filterParams),
      countDealsWithTaskByStage(filterParams),
    ]);
    return NextResponse.json({ counts, withTaskCounts });
  });
}
