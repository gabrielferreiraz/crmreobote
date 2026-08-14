import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet } from "@/lib/parse-spreadsheet";
import { brazilianMobileVariants } from "@/lib/phone-normalize";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { linkOrphanThreadsForContact } from "@/lib/whatsapp/threads";
import { resolveImportPlan, type ImportField } from "@/lib/deals/import-resolve";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 1000;

export async function POST(req: Request) {
  const { organizationId, userId: sessionUserId, session } = await requireSession();
  if (!organizationId || !sessionUserId)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const userId: string = sessionUserId;
  const actorName = session?.user.name ?? session?.user.email ?? "?";

  // Cada chamada pode criar até MAX_ROWS negócios/contatos — sem limite de
  // quantas vezes por hora, dava pra inundar a organização de registros.
  // Chave separada da prévia (ver preview/route.ts) — analisar um arquivo
  // várias vezes ajustando o mapeamento de coluna não deveria gastar essa
  // cota, só a gravação de verdade gasta.
  const rateLimited = rateLimitOrResponse(`import:${organizationId}`, 5, 60 * 60_000);
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
      // Antes cortava em silêncio (só as primeiras MAX_ROWS entravam, sem
      // avisar) — quem mandasse 3.000 linhas achava que importou tudo e só
      // ia notar depois. Recusa e deixa claro quanto precisa cortar, em vez
      // de importar uma fração sem dizer.
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
      // Base pro rodízio de responsável (ver pickAutoOwner em lib/deals/import-resolve.ts) — mesma
      // lógica de lib/auto-assign.ts, só que resolvida uma vez em memória
      // pra todo o arquivo em vez de reconsultar o banco a cada linha.
      prisma.deal.groupBy({ by: ["ownerId"], where: { organizationId, status: "OPEN" }, _count: true }),
    ]);

    // Contato que já tem negócio ABERTO nesse MESMO funil — ver
    // ResolveImportInput.contactIdsWithOpenDeal em import-resolve.ts.
    // Sem isso, reimportar a mesma planilha (ou uma planilha com um contato
    // que já está em andamento) criava um segundo negócio duplicado pro
    // mesmo lead, sem aviso nenhum. Sem filtrar por contactId IN (...) de
    // propósito — numa organização com base grande de contatos, esse IN
    // vinha com dezenas de milhares de parâmetros e estourava o limite de
    // parâmetros do Postgres (P2029). Não precisa filtrar: o resultado só é
    // usado como Set de consulta (ref.id in contactIdsWithOpenDeal),
    // trazer contactId de deal aberto "a mais" (de contato que nem aparece
    // nesta importação) é inofensivo, só sobra sem nunca ser consultado.
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
      includeWrites: true,
    });

    if (plan.missingRequiredColumns.length > 0) {
      return NextResponse.json(
        { error: `Não encontrei a coluna obrigatória "${plan.missingRequiredColumns[0].label}" no arquivo` },
        { status: 400 },
      );
    }

    const { pendingIndexToRealId, newContactsForThreadLink, importBatchId, actualCreated } = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, organizationId);

      // Rastro de auditoria (ver ImportBatch no schema) — na MESMA
      // transação que cria os contatos/negócios: se algo falhar adiante e
      // o rollback acontecer, o registro do lote também desfaz junto, nunca
      // sobra um ImportBatch órfão apontando pra nada.
      const batch = await tx.importBatch.create({
        data: {
          organizationId,
          createdById: userId,
          type: "deals",
          fileName: file.name,
          rowsTotal: plan.summary.totalRows,
          rowsCreated: plan.summary.toCreate,
          rowsSkipped: plan.summary.totalRows - plan.summary.toCreate,
          // Cap de 500 — não guarda a lista inteira de 1000 linhas quando
          // quase todas têm o mesmo aviso, só o suficiente pra "baixar
          // planilha de erros" (ver /api/deals/import/[id]/errors) ser útil.
          issueRows: plan.rows.filter((r) => r.issues.length > 0).slice(0, 500),
        },
      });

      const pendingIndexToRealId = new Map<number, string>();
      const newContacts = plan.writes!.newContacts;

      // Contatos sem telefone/whatsapp nunca colidem (a constraint única é
      // só em cima desses dois campos) — createManyAndReturn devolve todo
      // mundo, na mesma ordem da entrada, sem risco de "sumir" nenhuma linha.
      const withoutNumber = newContacts.filter((c) => !c.phoneNormalized && !c.whatsappNormalized);
      if (withoutNumber.length > 0) {
        const created = await tx.contact.createManyAndReturn({
          data: withoutNumber.map((c) => ({
            organizationId,
            name: c.name,
            phone: c.phone,
            whatsapp: c.whatsapp,
            email: c.email,
            source: c.source,
            importBatchId: batch.id,
          })),
        });
        created.forEach((r, i) => pendingIndexToRealId.set(withoutNumber[i].pendingIndex, r.id));
      }

      // Contatos com telefone/whatsapp podem colidir com a constraint única
      // (concorrência com outra importação/cadastro rodando ao mesmo tempo,
      // fora do que já foi deduplicado em memória acima) — usa skipDuplicates
      // e recupera pelo próprio número quem entrou, sem depender de ordem.
      const withNumber = newContacts.filter((c) => c.phoneNormalized || c.whatsappNormalized);
      if (withNumber.length > 0) {
        const created = await tx.contact.createManyAndReturn({
          data: withNumber.map((c) => ({
            organizationId,
            name: c.name,
            phone: c.phone,
            whatsapp: c.whatsapp,
            email: c.email,
            source: c.source,
            phoneNormalized: c.phoneNormalized,
            whatsappNormalized: c.whatsappNormalized,
            importBatchId: batch.id,
          })),
          skipDuplicates: true,
        });
        const idByNumber = new Map<string, string>();
        for (const r of created) {
          if (r.phoneNormalized) for (const v of brazilianMobileVariants(r.phoneNormalized)) idByNumber.set(v, r.id);
          if (r.whatsappNormalized) for (const v of brazilianMobileVariants(r.whatsappNormalized)) idByNumber.set(v, r.id);
        }
        const strays = withNumber.filter((c) => {
          const id =
            (c.phoneNormalized && brazilianMobileVariants(c.phoneNormalized).map((v) => idByNumber.get(v)).find(Boolean)) ??
            (c.whatsappNormalized && brazilianMobileVariants(c.whatsappNormalized).map((v) => idByNumber.get(v)).find(Boolean));
          if (id) pendingIndexToRealId.set(c.pendingIndex, id);
          return !id;
        });
        // Raríssimo (perdeu uma corrida de criação concorrente pro mesmo
        // número) — resolve pegando quem já ficou dono do número agora. Por
        // variante (9º dígito) pelo mesmo motivo de sempre: quem venceu a
        // corrida pode ter gravado o número num formato de dígitos diferente.
        if (strays.length > 0) {
          const strayVariants = (n: string | null) => (n ? brazilianMobileVariants(n) : []);
          const conflicting = await tx.contact.findMany({
            where: {
              organizationId,
              OR: strays.flatMap((c) => [
                ...(strayVariants(c.phoneNormalized).length
                  ? [
                      { phoneNormalized: { in: strayVariants(c.phoneNormalized) } },
                      { whatsappNormalized: { in: strayVariants(c.phoneNormalized) } },
                    ]
                  : []),
                ...(strayVariants(c.whatsappNormalized).length
                  ? [
                      { phoneNormalized: { in: strayVariants(c.whatsappNormalized) } },
                      { whatsappNormalized: { in: strayVariants(c.whatsappNormalized) } },
                    ]
                  : []),
              ]),
            },
          });
          for (const c of strays) {
            const phoneVariants = strayVariants(c.phoneNormalized);
            const whatsappVariants = strayVariants(c.whatsappNormalized);
            const match = conflicting.find(
              (row) =>
                (row.phoneNormalized && (phoneVariants.includes(row.phoneNormalized) || whatsappVariants.includes(row.phoneNormalized))) ||
                (row.whatsappNormalized && (phoneVariants.includes(row.whatsappNormalized) || whatsappVariants.includes(row.whatsappNormalized))),
            );
            if (match) pendingIndexToRealId.set(c.pendingIndex, match.id);
          }
        }
      }

      function resolveContactId(ref: { kind: "existing"; id: string } | { kind: "new"; pendingIndex: number }): string | undefined {
        return ref.kind === "existing" ? ref.id : pendingIndexToRealId.get(ref.pendingIndex);
      }

      const dealsData: {
        organizationId: string;
        pipelineId: string;
        stageId: string;
        contactId: string;
        ownerId: string;
        name: string;
        value?: number;
        creditType?: string;
        importBatchId: string;
      }[] = [];

      for (const dealPlan of plan.writes!.dealPlans) {
        const ref = plan.writes!.rowContactRefs[dealPlan.rowIndex];
        const contactId = ref ? resolveContactId(ref) : undefined;
        if (!contactId) continue; // não deveria acontecer (linha já tinha ref resolvida) — defensivo
        dealsData.push({
          organizationId,
          pipelineId: pipeline.id,
          stageId: dealPlan.stageId,
          contactId,
          ownerId: dealPlan.ownerId,
          name: dealPlan.name,
          value: dealPlan.value,
          creditType: dealPlan.creditType,
          importBatchId: batch.id,
        });
      }

      // Rede de segurança final: como o dedup de contato agora é só por
      // WhatsApp (ver lib/deals/import-resolve.ts), duas linhas com o
      // mesmo Telefone mas WhatsApp diferente/ausente são tratadas como
      // dois contatos "novos" distintos na resolução em memória — mas
      // Contact.phoneNormalized ainda tem constraint única no banco, então
      // uma delas pode ter sido descartada (skipDuplicates acima) e as
      // duas terem resolvido pro MESMO contactId real. Sem isso, viraria 2
      // negócios pro mesmo contato. Mantém a 1ª ocorrência de cada
      // contactId, descarta o resto — mesmo espírito da guarda de
      // duplicidade da resolução, só que na verdade final pós-criação.
      const seenContactIds = new Set<string>();
      const dealsToCreate = dealsData.filter((d) => {
        if (seenContactIds.has(d.contactId)) return false;
        seenContactIds.add(d.contactId);
        return true;
      });

      if (dealsToCreate.length > 0) {
        await tx.deal.createMany({ data: dealsToCreate });
      }
      // Se a rede de segurança acima descartou alguma linha, o rowsCreated
      // gravado no início (calculado antes de saber que ia colidir) ficou
      // otimista demais — corrige pra bater com o que realmente foi criado.
      const actualCreated = dealsToCreate.length;
      if (actualCreated !== plan.summary.toCreate) {
        await tx.importBatch.update({ where: { id: batch.id }, data: { rowsCreated: actualCreated, rowsSkipped: plan.summary.totalRows - actualCreated } });
      }

      // Pra promover conversas de WhatsApp avulsas depois da transação (ver
      // chamada abaixo) — mesmo comportamento que toda outra rota que cria
      // Contact já tem (cadastro manual, importação de contatos, API
      // externa).
      const newContactsForThreadLink = newContacts
        .map((c) => ({ data: c, id: pendingIndexToRealId.get(c.pendingIndex) }))
        .filter((e): e is { data: (typeof newContacts)[number]; id: string } => !!e.id);

      return { pendingIndexToRealId, newContactsForThreadLink, importBatchId: batch.id, actualCreated };
    });

    // Fora da transação de propósito — não precisa ser atômico com a
    // criação, e linkOrphanThreadsForContact usa o cliente prisma normal
    // (com RLS), não o prismaRaw/tx usado acima.
    for (const c of newContactsForThreadLink) {
      if (c.data.phoneNormalized || c.data.whatsappNormalized) {
        await linkOrphanThreadsForContact(organizationId, c.id, [c.data.phoneNormalized, c.data.whatsappNormalized]);
      }
    }

    logAudit({
      organizationId,
      actorUserId: userId,
      actorName,
      action: "DEALS_IMPORTED",
      targetType: "ImportBatch",
      targetId: importBatchId,
      detail: `${file.name} — ${actualCreated} de ${plan.summary.totalRows} negócios criados`,
      ip: getClientIp(req),
    }).catch((err) => console.error("[audit-log] falha ao registrar DEALS_IMPORTED", err));

    return NextResponse.json({
      total: plan.summary.totalRows,
      created: actualCreated,
      skipped: plan.summary.totalRows - actualCreated,
      newContacts: plan.summary.newContacts,
      existingContactsMatched: plan.summary.existingContactsMatched,
      duplicateDeals: plan.summary.duplicateDeals,
      skippedNoContact: plan.summary.skippedNoContact,
      stageFallbacks: plan.summary.stageFallbacks,
      ownerFallbacks: plan.summary.ownerFallbacks,
      valueParseFailures: plan.summary.valueParseFailures,
      importBatchId,
      // Linhas com problema, pra quem quiser conferir o que exatamente não
      // bateu — antes só existia a contagem agregada (ver revisão que
      // motivou essa mudança). Cap de 200 pra não estourar o payload numa
      // importação de 1000 linhas todas com o mesmo aviso.
      issueRows: plan.rows.filter((r) => r.issues.length > 0).slice(0, 200),
    });
  });
}
