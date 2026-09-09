import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet } from "@/lib/parse-spreadsheet";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { linkOrphanThreadsForOrganization } from "@/lib/whatsapp/threads";
import { rateLimitOrResponse, getClientIp } from "@/lib/rate-limit";
import { resolveImportPlan, type ContactImportField } from "@/lib/contacts/import-resolve";
import { logAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 5000;

export async function POST(req: Request) {
  const { organizationId, userId: sessionUserId, session } = await requireSession();
  if (!organizationId || !sessionUserId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const userId: string = sessionUserId;
  const actorName = session?.user.name ?? session?.user.email ?? "?";

  // Cada chamada pode criar até MAX_ROWS contatos — sem limite de quantas
  // vezes por hora, dava pra inundar a organização de registros. Chave
  // separada da prévia (ver preview/route.ts) — analisar um arquivo várias
  // vezes ajustando o mapeamento de coluna não deveria gastar essa cota, só
  // a gravação de verdade gasta.
  const rateLimited = rateLimitOrResponse(`import:${organizationId}`, 5, 60 * 60_000);
  if (rateLimited) return rateLimited;

  const formData = await req.formData();
  const file = formData.get("file");
  const columnOverridesRaw = formData.get("columnOverrides");
  const fieldDefaultsRaw = formData.get("fieldDefaults");

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
  let fieldDefaults: { responsavel?: string } | undefined;
  if (typeof fieldDefaultsRaw === "string" && fieldDefaultsRaw) {
    try {
      fieldDefaults = JSON.parse(fieldDefaultsRaw);
    } catch {
      return NextResponse.json({ error: "fieldDefaults inválido" }, { status: 400 });
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
      // Antes cortava em silêncio (só as primeiras MAX_ROWS entravam, sem
      // avisar) — quem mandasse 8.000 linhas achava que importou tudo e só ia
      // notar depois, contando os contatos um por um. Recusa e deixa claro
      // quanto precisa cortar, em vez de importar uma fração sem dizer.
      return NextResponse.json(
        { error: `Arquivo tem ${totalDataRows} linhas — o máximo por importação é ${MAX_ROWS}. Divida em arquivos menores e importe em partes.` },
        { status: 400 },
      );
    }

    const dataRows = rows.slice(1, 1 + MAX_ROWS);
    const rawHeaderRow = rows[0];

    const [existingContacts, members] = await Promise.all([
      prisma.contact.findMany({
        where: { organizationId, OR: [{ phoneNormalized: { not: null } }, { whatsappNormalized: { not: null } }] },
        select: { phoneNormalized: true, whatsappNormalized: true },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const plan = resolveImportPlan({
      dataRows,
      rawHeaderRow,
      columnOverrides,
      existingContacts,
      members: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email })),
      fieldDefaults,
      includeWrites: true,
    });

    if (plan.missingRequiredColumns.length > 0) {
      return NextResponse.json(
        { error: `Não encontrei a coluna obrigatória "${plan.missingRequiredColumns[0].label}" no arquivo` },
        { status: 400 },
      );
    }

    const { importBatchId, actualCreated } = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, organizationId);

      // Rastro de auditoria (ver ImportBatch no schema) — na MESMA transação
      // que cria os contatos: se algo falhar adiante e o rollback acontecer,
      // o registro do lote também desfaz junto, nunca sobra um ImportBatch
      // órfão apontando pra nada.
      const batch = await tx.importBatch.create({
        data: {
          organizationId,
          createdById: userId,
          type: "contacts",
          fileName: file.name,
          rowsTotal: plan.summary.totalRows,
          rowsCreated: plan.summary.toCreate,
          rowsSkipped: plan.summary.totalRows - plan.summary.toCreate,
          // Cap de 500 — não guarda a lista inteira quando quase todas têm o
          // mesmo aviso, só o suficiente pra "baixar planilha de erros" ser útil.
          issueRows: plan.rows.filter((r) => r.issues.length > 0).slice(0, 500),
        },
      });

      // skipDuplicates aqui é só rede de segurança contra uma corrida rara
      // (outro cadastro/importação gravando o mesmo telefone entre a
      // resolução acima e este INSERT) — a dedup de verdade (dentro do
      // arquivo E contra o banco) já aconteceu em resolveImportPlan.
      const created = await tx.contact.createManyAndReturn({
        data: plan.writes!.newContacts.map((c) => ({
          organizationId,
          name: c.name,
          email: c.email,
          phone: c.phone,
          whatsapp: c.whatsapp,
          source: c.source,
          company: c.company,
          jobTitle: c.jobTitle,
          tags: c.tags,
          responsavelId: c.responsavelId,
          phoneNormalized: c.phoneNormalized,
          whatsappNormalized: c.whatsappNormalized,
          importBatchId: batch.id,
        })),
        skipDuplicates: true,
      });

      // Se a corrida rara acima descartou alguma linha, o rowsCreated
      // gravado no início (calculado antes de saber que ia colidir) ficou
      // otimista demais — corrige pra bater com o que realmente foi criado.
      const actualCreated = created.length;
      if (actualCreated !== plan.summary.toCreate) {
        await tx.importBatch.update({ where: { id: batch.id }, data: { rowsCreated: actualCreated, rowsSkipped: plan.summary.totalRows - actualCreated } });
      }

      return { importBatchId: batch.id, actualCreated };
    });

    // Fora da transação de propósito — não precisa ser atômico com a
    // criação (mesma decisão de app/api/deals/import/route.ts), e escaneia a
    // organização inteira em vez de contato por contato porque um lote pode
    // trazer milhares de linhas de uma vez.
    if (actualCreated > 0) {
      await linkOrphanThreadsForOrganization(organizationId);
    }

    logAudit({
      organizationId,
      actorUserId: userId,
      actorName,
      action: "CONTACTS_IMPORTED",
      targetType: "ImportBatch",
      targetId: importBatchId,
      detail: `${file.name} — ${actualCreated} de ${plan.summary.totalRows} contatos criados`,
      ip: getClientIp(req),
    }).catch((err) => console.error("[audit-log] falha ao registrar CONTACTS_IMPORTED", err));

    return NextResponse.json({
      total: plan.summary.totalRows,
      created: actualCreated,
      skipped: plan.summary.totalRows - actualCreated,
      skippedNoName: plan.summary.skippedNoName,
      skippedNoJobTitle: plan.summary.skippedNoJobTitle,
      duplicateContacts: plan.summary.duplicateContacts,
      ownerFallbacks: plan.summary.ownerFallbacks,
      importBatchId,
      // Linhas com problema, pra quem quiser conferir o que exatamente não
      // bateu — cap de 200 pra não estourar o payload numa importação de
      // milhares de linhas todas com o mesmo aviso.
      issueRows: plan.rows.filter((r) => r.issues.length > 0).slice(0, 200),
    });
  });
}
