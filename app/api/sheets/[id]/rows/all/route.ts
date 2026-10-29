import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { allRowsForCalc } from "@/lib/sheets/rows";
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
    const { rows } = await allRowsForCalc(access.organizationId, id);
    return NextResponse.json({ rows });
  } catch (err) {
    return sheetRouteError(err);
  }
}
