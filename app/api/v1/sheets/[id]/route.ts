import { apiSuccess } from "@/lib/api/v1-response";
import { getSheet } from "@/lib/sheets/sheets";
import { requireSheetsApi, v1SheetError } from "@/lib/sheets/v1";

export const dynamic = "force-dynamic";

/** Planilha + colunas (id, nome, tipo, opções) — o id da coluna é a chave dos valores nas linhas. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsApi(req, "read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  try {
    return apiSuccess(await getSheet(auth.actor.organizationId, id));
  } catch (err) {
    return v1SheetError(err);
  }
}
