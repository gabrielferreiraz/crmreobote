import { apiError, apiSuccess } from "@/lib/api/v1-response";
import { linkedRows } from "@/lib/sheets/rows";
import { requireSheetsApi } from "@/lib/sheets/v1";

export const dynamic = "force-dynamic";

/** Em quais planilhas um cliente/negócio aparece (?contactId= ou ?dealId=). */
export async function GET(req: Request) {
  const auth = await requireSheetsApi(req, "read");
  if ("response" in auth) return auth.response;
  const sp = new URL(req.url).searchParams;
  const contactId = sp.get("contactId");
  const dealId = sp.get("dealId");
  if (!contactId === !dealId) return apiError("Informe contactId ou dealId", 400);
  return apiSuccess(await linkedRows(auth.actor.organizationId, contactId ? { contactId } : { dealId: dealId! }));
}
