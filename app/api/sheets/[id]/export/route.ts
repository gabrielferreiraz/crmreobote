import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { exportSheetXlsx } from "@/lib/sheets/io";
import { sheetRouteError } from "@/lib/sheets/http";

export const dynamic = "force-dynamic";

/** Baixa a planilha em .xlsx — fica registrado na auditoria (dados saindo do CRM). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const { id } = await params;
  const limited = rateLimitOrResponse(`sheets:export:${access.organizationId}:${access.userId}`, 20, 60 * 60_000);
  if (limited) return limited;

  try {
    const { buffer, sheetName, rowCount } = await exportSheetXlsx(access.organizationId, id);
    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "SHEET_EXPORTED",
      targetType: "Sheet",
      targetId: id,
      detail: `Exportou "${sheetName}" (${rowCount} linha(s)).`,
    });
    const filename = sheetName.normalize("NFD").replace(/[^\w -]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "planilha";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return sheetRouteError(err);
  }
}
