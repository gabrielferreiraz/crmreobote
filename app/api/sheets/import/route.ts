import { NextResponse } from "next/server";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { BODY_LIMITS, readFormData } from "@/lib/read-body";
import { spreadsheetParseFailure } from "@/lib/parse-spreadsheet";
import { logAudit } from "@/lib/audit-log";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { importAsNewSheet, importIntoSheet, previewImport } from "@/lib/sheets/io";
import { sheetRouteError } from "@/lib/sheets/http";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { recalcAfterWrite } from "@/lib/sheets/recalc";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = SHEET_LIMITS.importFileBytes;

/**
 * Importa .xlsx/.csv (multipart):
 * - `file` (obrigatório)
 * - `mode`: "preview" (só analisa, nada é gravado) | "new" (planilha nova, padrão) | "append"
 * - `sheetId` (append) e `mapping` (append, JSON { <columnId>: índice da coluna no arquivo })
 * - `name` (new): nome da planilha criada
 */
export async function POST(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;

  let form: FormData;
  try {
    form = await readFormData(req, BODY_LIMITS.spreadsheet);
  } catch (err) {
    return sheetRouteError(err);
  }
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "new");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo .xlsx ou .csv" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Arquivo maior que 25 MB" }, { status: 400 });
  if (!["preview", "new", "append"].includes(mode)) return NextResponse.json({ error: "Modo inválido" }, { status: 400 });

  // Prévia é barata e repetida (a pessoa ajusta e reenvia); gravação tem cota própria.
  const limited =
    mode === "preview"
      ? rateLimitOrResponse(`sheets:import-preview:${access.organizationId}:${access.userId}`, 30, 60_000)
      : rateLimitOrResponse(`sheets:import:${access.organizationId}`, 20, 60 * 60_000);
  if (limited) return limited;

  const buffer = Buffer.from(await file.arrayBuffer());
  const actor = { ...access, source: "app" };
  try {
    if (mode === "preview") return NextResponse.json(await previewImport({ buffer, filename: file.name }));

    let result;
    if (mode === "append") {
      const sheetId = String(form.get("sheetId") ?? "");
      if (!sheetId) return NextResponse.json({ error: "Informe a planilha de destino" }, { status: 400 });
      let mapping: Record<string, number> | undefined;
      const rawMapping = form.get("mapping");
      if (typeof rawMapping === "string" && rawMapping) {
        try {
          const parsed: unknown = JSON.parse(rawMapping);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          mapping = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "number")) as Record<string, number>;
        } catch {
          return NextResponse.json({ error: "Mapeamento de colunas inválido" }, { status: 400 });
        }
      }
      result = await importIntoSheet(actor, sheetId, { buffer, filename: file.name }, mapping);
      await recalcAfterWrite(access.organizationId, sheetId);
    } else {
      const name = form.get("name");
      result = await importAsNewSheet(actor, { buffer, filename: file.name, name: typeof name === "string" ? name : undefined });
    }

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.actorName,
      action: "SHEET_IMPORTED",
      targetType: "Sheet",
      targetId: result.sheetId,
      detail: `Importou ${result.created} linha(s) de "${file.name}"${result.skipped.length ? ` (${result.skipped.length} recusada(s))` : ""}.`,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const parseFailure = spreadsheetParseFailure(err);
    if (parseFailure) return NextResponse.json({ error: parseFailure.message }, { status: parseFailure.status });
    if (err instanceof Error && err.message === "XLS_NOT_SUPPORTED") {
      return NextResponse.json({ error: "Arquivo .xls antigo não é suportado — salve como .xlsx no Excel" }, { status: 400 });
    }
    return sheetRouteError(err);
  }
}
