import { apiSuccess } from "@/lib/api/v1-response";
import { listSheets } from "@/lib/sheets/sheets";
import { requireSheetsApi } from "@/lib/sheets/v1";

export const dynamic = "force-dynamic";

/** Lista as planilhas ativas da organização. Documentação: docs/integracoes-api.md. */
export async function GET(req: Request) {
  const auth = await requireSheetsApi(req, "read");
  if ("response" in auth) return auth.response;
  return apiSuccess(await listSheets(auth.actor.organizationId));
}
