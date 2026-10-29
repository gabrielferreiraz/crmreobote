import { NextResponse } from "next/server";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { linkedRows } from "@/lib/sheets/rows";

export const dynamic = "force-dynamic";

/** Em quais planilhas este cliente/negócio aparece (?contactId= ou ?dealId=). */
export async function GET(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const sp = new URL(req.url).searchParams;
  const contactId = sp.get("contactId");
  const dealId = sp.get("dealId");
  if (!contactId === !dealId) return NextResponse.json({ error: "Informe contactId ou dealId" }, { status: 400 });
  const sheets = await linkedRows(auth.access.organizationId, contactId ? { contactId } : { dealId: dealId! });
  return NextResponse.json({ sheets });
}
