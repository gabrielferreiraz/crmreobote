import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { buildDealsWhere } from "@/lib/deals/list-query";

export const dynamic = "force-dynamic";

/** Teto da lista de arquivados — é uma gaveta de arrumação, não uma segunda
 * Lista: ninguém rola mil negócios arquivados procurando um. Se um dia
 * encostar nesse número, o certo é busca/paginação aqui, não subir o teto. */
const MAX_ARCHIVED = 200;

/**
 * Negócios arquivados (ver Deal.archivedAt e POST /api/deals/[id]/archive) —
 * alimenta a janela "Arquivados" do Pipeline.
 *
 * Mesmo escopo do endpoint que arquiva/desarquiva (getDealScope puro, NÃO
 * getSharedScope): listar algo que a pessoa não poderia trazer de volta só
 * geraria um botão que responde 404.
 */
export async function GET(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId") || undefined;

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);

    const deals = await prisma.deal.findMany({
      where: buildDealsWhere({
        organizationId: access.organizationId,
        pipelineId,
        scope,
        archived: true,
      }),
      select: {
        id: true,
        name: true,
        value: true,
        status: true,
        archivedAt: true,
        archivedById: true,
        contact: { select: { name: true } },
        owner: { select: { name: true } },
        stage: { select: { name: true } },
      },
      orderBy: [{ archivedAt: "desc" }, { id: "desc" }],
      take: MAX_ARCHIVED,
    });

    // Nome de quem arquivou: `archivedById` é uma coluna solta de propósito
    // (ver schema.prisma), então a tradução id → nome é uma consulta à parte,
    // uma só para a lista inteira. Negócio arquivado antes desta coluna
    // existir, ou por alguém que saiu do sistema, simplesmente não mostra
    // nome — nunca quebra a lista.
    const archiverIds = [...new Set(deals.map((d) => d.archivedById).filter((v): v is string => !!v))];
    const archivers =
      archiverIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: archiverIds } }, select: { id: true, name: true } })
        : [];
    const nameById = new Map(archivers.map((u) => [u.id, u.name]));

    return NextResponse.json({
      deals: deals.map((d) => ({
        id: d.id,
        name: d.name,
        value: d.value != null ? Number(d.value) : null,
        status: d.status,
        archivedAt: d.archivedAt,
        archivedByName: d.archivedById ? (nameById.get(d.archivedById) ?? null) : null,
        contactName: d.contact.name,
        ownerName: d.owner.name,
        stageName: d.stage.name,
      })),
      truncated: deals.length >= MAX_ARCHIVED,
    });
  });
}
