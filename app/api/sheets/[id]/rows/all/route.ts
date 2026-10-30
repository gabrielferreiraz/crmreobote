import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { allRowsForCalc } from "@/lib/sheets/rows";
import { referenceNamesFast } from "@/lib/sheets/open";
import { sheetRouteError } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/**
 * A planilha inteira para o motor de fórmulas da tela, num pedido só (antes
 * eram páginas de 500 em sequência): id, valores, fórmulas e posição real.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:read:${access.organizationId}:${access.userId}`, 600, 60_000);
  if (limited) return limited;
  try {
    const { columns, rows } = await allRowsForCalc(access.organizationId, id);
    // Nomes de cliente/negócio/membro: fórmula que lê essas colunas mostra o nome, não o id.
    const refs = await referenceNamesFast(access.organizationId, columns, rows);
    return NextResponse.json({ rows, refs });
  } catch (err) {
    return sheetRouteError(err);
  }
}
