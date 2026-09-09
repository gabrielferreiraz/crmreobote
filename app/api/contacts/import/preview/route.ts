import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet } from "@/lib/parse-spreadsheet";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { resolveImportPlan, type ContactImportField } from "@/lib/contacts/import-resolve";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 5000;
// Nunca grava nada — só lê e resolve em memória — então pode ser bem mais
// generoso que a cota de commit de verdade (5/hora, ver /api/contacts/import):
// quem está ajustando o mapeamento de coluna até acertar pode analisar várias
// vezes seguidas sem gastar a cota de importar de fato.
const PREVIEW_LIMIT = 30;
// Não devolve as 5000 linhas resolvidas pro navegador — só uma amostra (mais
// o resumo agregado, que já é sobre TODAS as linhas) é suficiente pra pessoa
// confirmar que o mapeamento está certo.
const PREVIEW_ROWS_SHOWN = 50;

export async function POST(req: Request) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const rateLimited = rateLimitOrResponse(`contact-import-preview:${organizationId}`, PREVIEW_LIMIT, 60 * 60_000);
  if (rateLimited) return rateLimited;

  const formData = await req.formData();
  const file = formData.get("file");
  const columnOverridesRaw = formData.get("columnOverrides");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Arquivo maior que 5MB" }, { status: 400 });
  }
  let columnOverrides: Partial<Record<ContactImportField, number>> | undefined;
  if (typeof columnOverridesRaw === "string" && columnOverridesRaw) {
    try {
      columnOverrides = JSON.parse(columnOverridesRaw);
    } catch {
      return NextResponse.json({ error: "columnOverrides inválido" }, { status: 400 });
    }
  }

  return runWithTenant(organizationId, async () => {
    const buffer = Buffer.from(await file.arrayBuffer());
    let rows: string[][];
    try {
      rows = await parseSpreadsheet(buffer, file.name);
    } catch (err) {
      if (err instanceof Error && err.message === "XLS_NOT_SUPPORTED") {
        return NextResponse.json(
          { error: "Arquivo .xls (Excel 97-2003) não é suportado — salve como .xlsx e tente de novo" },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: "Não foi possível ler o arquivo" }, { status: 400 });
    }

    if (rows.length < 2) {
      return NextResponse.json({ error: "Arquivo vazio ou sem linhas de dados" }, { status: 400 });
    }

    const totalDataRows = rows.length - 1;
    if (totalDataRows > MAX_ROWS) {
      return NextResponse.json(
        { error: `Arquivo tem ${totalDataRows} linhas — o máximo por importação é ${MAX_ROWS}. Divida em arquivos menores e importe em partes.` },
        { status: 400 },
      );
    }

    const dataRows = rows.slice(1, 1 + MAX_ROWS);
    const rawHeaderRow = rows[0];

    // Só quem tem telefone OU whatsapp preenchido — os únicos dois campos
    // com constraint única (ver lib/contacts/import-resolve.ts), o resto
    // nunca colide.
    const existingContacts = await prisma.contact.findMany({
      where: { organizationId, OR: [{ phoneNormalized: { not: null } }, { whatsappNormalized: { not: null } }] },
      select: { phoneNormalized: true, whatsappNormalized: true },
    });

    const plan = resolveImportPlan({
      dataRows,
      rawHeaderRow,
      columnOverrides,
      existingContacts,
      includeWrites: false,
    });

    return NextResponse.json({
      rawHeaderRow,
      columns: plan.columns,
      missingRequiredColumns: plan.missingRequiredColumns,
      summary: plan.summary,
      rows: plan.rows.slice(0, PREVIEW_ROWS_SHOWN),
      rowsShown: Math.min(PREVIEW_ROWS_SHOWN, plan.rows.length),
    });
  });
}
