import { NextResponse } from "next/server";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getLastServopaSync, listServopaTables } from "@/lib/servopa-tables/queries";

export const dynamic = "force-dynamic";

/**
 * Mesma lista que a página /tabelas monta no servidor, só que buscável de
 * dentro de um modal (consultar a tabela sem sair da proposta em edição).
 * Somente leitura: ajuste de taxa continua exclusivo da página.
 */
export async function GET() {
  const access = await getServopaTablesAccess();
  if (!access.ok) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const [tables, lastSync] = await Promise.all([
    listServopaTables(access.organizationId),
    getLastServopaSync(access.organizationId),
  ]);

  return NextResponse.json(
    { tables, lastSyncAt: lastSync?.finishedAt ?? null },
    // São ~400 tabelas que só mudam quando o robô roda; meio minuto de cache
    // evita refazer a consulta a cada abertura do modal.
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
