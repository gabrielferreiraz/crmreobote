import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getSharedScope } from "@/lib/share-groups";
import { buildDealsWhere } from "@/lib/deals/list-query";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Só os IDS dos negócios de UMA etapa, sob os mesmos filtros de
 * GET /api/deals — alimenta o "selecionar todos da etapa" do Kanban.
 *
 * Existe separado de /api/deals de propósito: o Kanban carrega só uma
 * página por coluna (ver kanban-board.tsx), então "selecionar todos" numa
 * etapa com milhares de negócios não pode baixar os negócios INTEIROS
 * (nome, contato, dono, tarefas, valores — é o que /api/deals devolve, com
 * várias consultas de enriquecimento por lote). Aqui é uma consulta só,
 * uma coluna só (`select: { id: true }`): o peso de trazer 5.000 ids é
 * ~100KB, contra vários MB e um punhado de consultas extras se fosse a
 * lista completa que ninguém vai desenhar na tela.
 *
 * Respeita os filtros ativos porque "todos da etapa" precisa significar
 * "todos os que a coluna ESTÁ mostrando" — com um filtro de responsável
 * ligado, selecionar negócio de outra pessoa (invisível na tela) seria
 * exatamente o tipo de ação em massa surpresa que não pode acontecer.
 */
function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Mesmo teto de POST /api/deals/bulk — não adianta selecionar mais do que a ação consegue aplicar depois. */
const MAX_IDS = 10000;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stageId = searchParams.get("stageId") ?? undefined;
  if (!stageId) return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });

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
    const where = buildDealsWhere({
      organizationId: access.organizationId,
      pipelineId,
      stageId,
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
    });

    // take = MAX+1 pra saber se passou do teto sem precisar de um count
    // separado — a UI avisa "selecionados os primeiros N" em vez de mentir
    // que selecionou tudo.
    const rows = await prisma.deal.findMany({ where, select: { id: true }, take: MAX_IDS + 1 });
    const truncated = rows.length > MAX_IDS;
    return NextResponse.json({ ids: rows.slice(0, MAX_IDS).map((r) => r.id), truncated, max: MAX_IDS });
  });
}
