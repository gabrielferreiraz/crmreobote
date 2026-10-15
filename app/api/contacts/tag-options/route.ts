import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { getCurrentMembership } from "@/lib/current-membership";
import { getDistinctContactTags } from "@/lib/contacts/list-query";

export const dynamic = "force-dynamic";

export async function GET() {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return NextResponse.json({ error: "Sem permissao" }, { status: 403 });
  }
  const responsavelId = membership?.role === "MEMBER" ? userId : undefined;
  const tags = await getDistinctContactTags(organizationId, responsavelId);

  return NextResponse.json(
    { tags },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
