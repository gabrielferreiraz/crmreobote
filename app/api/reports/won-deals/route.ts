import { NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { fetchWonDeals } from "@/lib/reports/won-deals";

export const dynamic = "force-dynamic";

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Negócios GANHOS de uma pessoa — abre pelo "Ver negócios" do card "Negócios
 * fechados" (ranking do relatório). `from`/`to` chegam JÁ resolvidos (ISO,
 * calculados pelo próprio relatório em lib/reports/commercial-data.ts) — esta
 * rota nunca reinterpreta "Este mês"/"Tudo" por conta própria, pra a lista
 * bater com o número do ranking. Escopo por papel (getDealScope): fora dele
 * responde 404, nunca uma lista vazia que pareça "não fechou nada".
 */
export async function GET(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get("ownerId");
  if (!ownerId) return NextResponse.json({ error: "ownerId é obrigatório" }, { status: 400 });

  const skipParam = Number(searchParams.get("skip"));
  const takeParam = Number(searchParams.get("take"));
  const skip = Number.isFinite(skipParam) && skipParam > 0 ? Math.floor(skipParam) : 0;
  const take = Number.isFinite(takeParam) && takeParam > 0 ? Math.min(Math.floor(takeParam), MAX_TAKE) : DEFAULT_TAKE;

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const result = await fetchWonDeals({
      organizationId: access.organizationId,
      scope,
      ownerId,
      from: parseDate(searchParams.get("from")),
      to: parseDate(searchParams.get("to")),
      pipelineId: searchParams.get("pipelineId"),
      skip,
      take,
    });
    if (!result) return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 });
    return NextResponse.json(result);
  });
}
