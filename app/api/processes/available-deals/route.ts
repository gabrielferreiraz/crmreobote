import { NextResponse } from "next/server";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { fetchDealsLite } from "@/lib/deals/list-query";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 20;

/**
 * Busca de negócio Ganho pra "Adicionar ao processo" — sempre org inteira,
 * nunca escopada pela hierarquia de vendas (getDealScope): quem tem acesso
 * admin de Processos pode não ter papel de vendas nenhum (ex.: time
 * ADMINISTRATIVO puro), e mesmo quem tem só enxergaria os PRÓPRIOS negócios
 * — mas o setor de contemplações precisa achar o negócio de QUALQUER
 * consultor. Consulta enxuta de propósito (fetchDealsLite, não
 * fetchDealsList) — só os campos que o autocomplete mostra, sem foto de
 * responsável/próxima atividade/WhatsApp não lido, que exigiam idas-e-voltas
 * extras (R2 inclusive) só pra dados que essa tela nunca exibe.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? undefined;

  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const deals = await fetchDealsLite({
      organizationId: access.organizationId,
      scope: { type: "all" },
      status: "WON",
      withoutProcess: true,
      q,
      take: MAX_LIMIT,
    });

    return NextResponse.json(deals);
  });
}
