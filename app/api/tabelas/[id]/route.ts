import { NextResponse } from "next/server";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaTable } from "@/lib/servopa-tables/queries";

export const dynamic = "force-dynamic";

/** Uma tabela com todas as linhas — o mesmo que /tabelas/[id] mostra. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getServopaTablesAccess();
  if (!access.ok) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const table = await getServopaTable(access.organizationId, id);
  if (!table) {
    return NextResponse.json({ error: "Tabela não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ table }, { headers: { "Cache-Control": "private, max-age=30" } });
}
