import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet } from "@/lib/parse-spreadsheet";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { resolveImportPlan, type ImportField } from "@/lib/deals/import-resolve";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 1000;
// Nunca grava nada — só lê e resolve em memória — então pode ser bem mais
// generoso que a cota de commit de verdade (5/hora, ver /api/deals/import):
// quem está ajustando o mapeamento de coluna até acertar pode analisar
// várias vezes seguidas sem gastar a cota de importar de fato.
const PREVIEW_LIMIT = 30;
// Não devolve as 1000 linhas resolvidas pro navegador — só uma amostra
// (mais o resumo agregado, que já é sobre TODAS as linhas) é suficiente
// pra pessoa confirmar que o mapeamento está certo.
const PREVIEW_ROWS_SHOWN = 50;

export async function POST(req: Request) {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const rateLimited = rateLimitOrResponse(`import-preview:${organizationId}`, PREVIEW_LIMIT, 60 * 60_000);
  if (rateLimited) return rateLimited;

  const formData = await req.formData();
  const file = formData.get("file");
  const pipelineId = formData.get("pipelineId");
  const columnOverridesRaw = formData.get("columnOverrides");
  const fieldDefaultsRaw = formData.get("fieldDefaults");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx" }, { status: 400 });
  }
  if (typeof pipelineId !== "string" || !pipelineId) {
    return NextResponse.json({ error: "Pipeline inválido" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Arquivo maior que 5MB" }, { status: 400 });
  }
  let columnOverrides: Partial<Record<ImportField, number>> | undefined;
  if (typeof columnOverridesRaw === "string" && columnOverridesRaw) {
    try {
      columnOverrides = JSON.parse(columnOverridesRaw);
    } catch {
      return NextResponse.json({ error: "columnOverrides inválido" }, { status: 400 });
    }
  }
  let fieldDefaults: Partial<Record<"owner" | "stage" | "source" | "creditType", string>> | undefined;
  if (typeof fieldDefaultsRaw === "string" && fieldDefaultsRaw) {
    try {
      fieldDefaults = JSON.parse(fieldDefaultsRaw);
    } catch {
      return NextResponse.json({ error: "fieldDefaults inválido" }, { status: 400 });
    }
  }

  return runWithTenant(organizationId, async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    if (!pipeline || pipeline.stages.length === 0) {
      return NextResponse.json({ error: "Pipeline inválido" }, { status: 400 });
    }

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

    const [members, existingContacts, openLoads] = await Promise.all([
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      // Só quem tem WhatsApp preenchido — é o único campo usado pra
      // reconhecer contato já existente na importação (ver decisão em
      // lib/deals/import-resolve.ts), Telefone/E-mail não entram nisso.
      prisma.contact.findMany({
        where: { organizationId, whatsappNormalized: { not: null } },
        select: { id: true, name: true, source: true, whatsappNormalized: true },
      }),
      prisma.deal.groupBy({ by: ["ownerId"], where: { organizationId, status: "OPEN" }, _count: true }),
    ]);

    // Sem filtrar por contactId IN (...) de propósito — ver mesmo
    // comentário em app/api/deals/import/route.ts (estourava o limite de
    // parâmetros do Postgres numa organização com base grande de contatos).
    const openDealContacts = await prisma.deal.findMany({
      where: { organizationId, pipelineId, status: "OPEN" },
      select: { contactId: true },
      distinct: ["contactId"],
    });

    const plan = resolveImportPlan({
      dataRows,
      rawHeaderRow,
      columnOverrides,
      fieldDefaults,
      stages: pipeline.stages,
      members: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email })),
      existingContacts,
      contactIdsWithOpenDeal: new Set(openDealContacts.map((d) => d.contactId)),
      openLoadByOwnerId: new Map(openLoads.map((l) => [l.ownerId, l._count])),
      fallbackOwnerId: userId,
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
