import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { readJson, bodyErrorResponse } from "@/lib/read-body";

export const dynamic = "force-dynamic";

const MAX_IDS = 1000;

/**
 * Antes de apagar contatos em massa: quais deles ainda têm negócio, e de
 * quem é cada negócio. O DELETE de contato recusa (409) enquanto existir
 * negócio apontando pra ele — sem esta checagem prévia a tela só sabia
 * dizer "alguns não puderam ser apagados", sem dizer quais nem por quê.
 * Mesma permissão do próprio DELETE (Dono/Gerente). Só lê.
 */
export async function POST(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { ids?: unknown };
  try {
    body = await readJson<{ ids?: unknown }>(req);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Informe de 1 a ${MAX_IDS} contatos` }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const contacts = await prisma.contact.findMany({
      where: { organizationId: access.organizationId, id: { in: ids }, deals: { some: {} } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        deals: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            status: true,
            stage: { select: { name: true } },
            pipeline: { select: { name: true } },
            owner: { select: { name: true } },
            proposals: { where: { status: { not: "DRAFT" } }, select: { id: true }, take: 1 },
          },
        },
      },
    });

    return NextResponse.json({
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        deals: c.deals.map((d) => ({
          id: d.id,
          name: d.name,
          status: d.status,
          stageName: d.stage.name,
          pipelineName: d.pipeline.name,
          ownerName: d.owner.name,
          // Só o Dono apaga negócio com proposta gerada/enviada (ver
          // DELETE /api/deals/[id]) — a tela usa isto pra não oferecer o
          // "apagar mesmo assim" que o servidor vai recusar.
          hasKeptProposals: d.proposals.length > 0,
        })),
      })),
    });
  });
}
