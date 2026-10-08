import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet, spreadsheetParseFailure } from "@/lib/parse-spreadsheet";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { linkOrphanThreadsForOrganization } from "@/lib/whatsapp/threads";
import { rateLimitOrResponse, getClientIp } from "@/lib/rate-limit";
import { parseValueMappings, resolveImportPlan, type ContactImportField, type ValueMappings } from "@/lib/contacts/import-resolve";
import { loadContactImportContext } from "@/lib/contacts/import-context";
import { getDealScope, contactScopeWhere } from "@/lib/team-scope";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { logAudit } from "@/lib/audit-log";
import { readFormData, bodyErrorResponse, BODY_LIMITS } from "@/lib/read-body";
import {
  CONTACT_IMPORT_TRANSACTION_OPTIONS,
  CONTACT_IMPORT_WRITE_CHUNK_SIZE,
  MAX_CONTACT_IMPORT_FILE_SIZE_BYTES,
  MAX_CONTACT_IMPORT_ROWS,
} from "@/lib/contacts/import-limits";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { organizationId, userId: sessionUserId, session } = await requireSession();
  if (!organizationId || !sessionUserId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const userId: string = sessionUserId;
  const actorName = session?.user.name ?? session?.user.email ?? "?";

  // Cada chamada pode criar até MAX_CONTACT_IMPORT_ROWS contatos — sem limite de quantas
  // vezes por hora, dava pra inundar a organização de registros. Chave
  // separada da prévia (ver preview/route.ts) — analisar um arquivo várias
  // vezes ajustando o mapeamento de coluna não deveria gastar essa cota, só
  // a gravação de verdade gasta.
  const rateLimited = rateLimitOrResponse(`import:${organizationId}`, 5, 60 * 60_000);
  if (rateLimited) return rateLimited;

  // Lido só depois da autenticação e com teto (lib/read-body.ts) — antes
  // req.formData() carregava o corpo INTEIRO pra memória antes de checar tamanho.
  let formData: FormData;
  try {
    formData = await readFormData(req, BODY_LIMITS.spreadsheet);
  } catch (err) {
    const res = bodyErrorResponse(err);
    if (res) return res;
    throw err;
  }
  const file = formData.get("file");
  const columnOverridesRaw = formData.get("columnOverrides");
  const valueMappingsRaw = formData.get("valueMappings");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx" }, { status: 400 });
  }
  if (file.size > MAX_CONTACT_IMPORT_FILE_SIZE_BYTES) {
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
  let valueMappings: ValueMappings | undefined;
  if (typeof valueMappingsRaw === "string" && valueMappingsRaw) {
    valueMappings = parseValueMappings(valueMappingsRaw) ?? undefined;
    if (!valueMappings) return NextResponse.json({ error: "valueMappings inválido" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const buffer = Buffer.from(await file.arrayBuffer());
    let rows: string[][];
    try {
      rows = await parseSpreadsheet(buffer, file.name, { maxRows: MAX_CONTACT_IMPORT_ROWS + 1 });
    } catch (err) {
      if (err instanceof Error && err.message === "XLS_NOT_SUPPORTED") {
        return NextResponse.json(
          { error: "Arquivo .xls (Excel 97-2003) não é suportado — salve como .xlsx e tente de novo" },
          { status: 400 },
        );
      }
      const parseFailure = spreadsheetParseFailure(err);
      if (parseFailure) return NextResponse.json({ error: parseFailure.message }, { status: parseFailure.status });
      return NextResponse.json({ error: "Não foi possível ler o arquivo" }, { status: 400 });
    }

    if (rows.length < 2) {
      return NextResponse.json({ error: "Arquivo vazio ou sem linhas de dados" }, { status: 400 });
    }

    const totalDataRows = rows.length - 1;
    if (totalDataRows > MAX_CONTACT_IMPORT_ROWS) {
      // Antes cortava em silêncio (só as primeiras linhas entravam, sem
      // avisar) — quem mandasse 8.000 linhas achava que importou tudo e só ia
      // notar depois, contando os contatos um por um. Recusa e deixa claro
      // quanto precisa cortar, em vez de importar uma fração sem dizer.
      return NextResponse.json(
        { error: `Arquivo tem ${totalDataRows} linhas — o máximo por importação é ${MAX_CONTACT_IMPORT_ROWS}. Divida em arquivos menores e importe em partes.` },
        { status: 400 },
      );
    }

    const dataRows = rows.slice(1, 1 + MAX_CONTACT_IMPORT_ROWS);
    const rawHeaderRow = rows[0];

    // Mesma consulta da prévia (lib/contacts/import-context.ts) — o commit
    // usa a MESMA função resolveImportPlan, então precisa da mesma entrada.
    const context = await loadContactImportContext(organizationId);

    const plan = resolveImportPlan({
      dataRows,
      rawHeaderRow,
      columnOverrides,
      ...context,
      valueMappings,
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
      let actualCreated = 0;
      const newContacts = plan.writes!.newContacts;
      for (let start = 0; start < newContacts.length; start += CONTACT_IMPORT_WRITE_CHUNK_SIZE) {
        const created = await tx.contact.createMany({
          // sanitizeCell nos campos de texto livre — mesma proteção do
          // cadastro manual (POST /api/contacts): uma célula "=HYPERLINK(...)"
          // vinda da planilha não pode virar fórmula viva quando alguém
          // exportar esses contatos e abrir no Excel.
          data: newContacts.slice(start, start + CONTACT_IMPORT_WRITE_CHUNK_SIZE).map((c) => ({
            organizationId,
            name: sanitizeCell(c.name),
            email: sanitizeCell(c.email),
            phone: c.phone,
            whatsapp: c.whatsapp,
            source: sanitizeCell(c.source),
            company: sanitizeCell(c.company),
            jobTitle: sanitizeCell(c.jobTitle),
            tags: c.tags.map(sanitizeCell),
            zipCode: c.zipCode,
            address: sanitizeCell(c.address),
            addressNumber: sanitizeCell(c.addressNumber),
            addressComplement: sanitizeCell(c.addressComplement),
            neighborhood: sanitizeCell(c.neighborhood),
            city: sanitizeCell(c.city),
            state: c.state,
            responsavelId: c.responsavelId,
            phoneNormalized: c.phoneNormalized,
            whatsappNormalized: c.whatsappNormalized,
            importBatchId: batch.id,
          })),
          skipDuplicates: true,
        });
        actualCreated += created.count;
      }

      // Se a corrida rara acima descartou alguma linha, o rowsCreated
      // gravado no início (calculado antes de saber que ia colidir) ficou
      // otimista demais — corrige pra bater com o que realmente foi criado.
      if (actualCreated !== plan.summary.toCreate) {
        await tx.importBatch.update({ where: { id: batch.id }, data: { rowsCreated: actualCreated, rowsSkipped: plan.summary.totalRows - actualCreated } });
      }

      return { importBatchId: batch.id, actualCreated };
    }, CONTACT_IMPORT_TRANSACTION_OPTIONS);

    // Contatos que JÁ existiam e vêm com dado novo na planilha (ex.: cargo
    // "MEDICO" no CRM, "MEDICO MS" na lista) — pedido explícito: atualizar
    // automaticamente, em vez de depender de clicar "Atualizar contato"
    // linha por linha na prévia. Só os campos que de fato divergem entram
    // (ver buildDivergentFields em lib/contacts/import-resolve.ts): célula
    // vazia nunca apaga o que já está salvo.
    //
    // FORA da transação de propósito, mesma decisão de
    // linkOrphanThreadsForOrganization logo abaixo: não é parte do ato
    // atômico de "criar este lote" (são contatos de outros lotes, que já
    // existiam), e um arquivo de 20 mil linhas quase todo duplicado geraria
    // milhares de UPDATEs — dentro da transação isso disputaria o mesmo
    // orçamento de 60s do INSERT e poderia derrubar a importação inteira por
    // timeout. Aqui, no pior caso, os contatos novos já estão salvos e só a
    // atualização fica incompleta (repetir a importação reaplica).
    //
    // Agrupado por payload IDÊNTICO (um updateMany por conjunto de valores,
    // não um update por contato): é exatamente o caso real desse pedido —
    // uma lista inteira em que todo mundo vira o mesmo cargo colapsa em UMA
    // consulta. Lista com endereço próprio por pessoa cai de volta em uma
    // consulta por grupo, que é o mínimo possível sem SQL cru.
    let updatedExisting = 0;
    // Planejado x aplicado nunca é a mesma coisa, e a tela precisa saber
    // explicar a diferença em vez de só mostrar um número menor sem motivo:
    //  - updateBlocked: o contato existe mas está FORA do escopo de quem
    //    importou (lead de outro consultor) — não é erro, é a regra.
    //  - updateFailed: a atualização em si quebrou (banco fora, timeout).
    //    Os contatos NOVOS já estão salvos nesse ponto, então derrubar a
    //    resposta inteira com 500 seria pior: a pessoa veria "erro" numa
    //    importação que de fato criou tudo, e provavelmente importaria de
    //    novo (duplicando trabalho de conferência). Reporta e segue.
    let updateFailed: string | null = null;
    const contactUpdates = plan.writes!.contactUpdates.filter((u) => Object.keys(u.data).length > 0);
    if (contactUpdates.length > 0) {
      // Mesmo escopo por papel que PUT /api/contacts/[id] já aplica no botão
      // "Atualizar contato" da prévia (consultor não edita lead de outro
      // consultor) — sem isto, importar uma lista grande viraria um jeito de
      // sobrescrever cargo/origem/endereço da carteira inteira da empresa
      // passando por cima do dono de cada lead. Dono/gerente têm escopo
      // "all" e seguem atualizando tudo, como já fazem no resto do sistema.
      // Contato SEM responsável fica de fora pra quem tem escopo limitado:
      // o PUT individual "assume" o lead nesse caso, e uma importação não
      // pode reivindicar lead de ninguém em silêncio (isso é o fluxo
      // Atribuir/Pedir, decisão à parte, ver DuplicateTableRow).
      const scope = await getDealScope(organizationId, userId, session?.user.role);
      const scopeWhere = contactScopeWhere(scope);
      const byPayload = new Map<string, { data: Record<string, string>; ids: string[] }>();
      for (const u of contactUpdates) {
        // sanitizeCell nos campos de texto livre — mesma proteção do INSERT
        // acima: célula "=HYPERLINK(...)" da planilha não pode virar fórmula
        // viva quando alguém exportar esses contatos depois.
        const data = Object.fromEntries(Object.entries(u.data).map(([field, value]) => [field, sanitizeCell(value)]));
        // Ordem das chaves é estável (divergentFields sempre segue a ordem de
        // DIVERGENT_FIELD_LABELS), então o JSON serve de chave de grupo.
        const key = JSON.stringify(data);
        const group = byPayload.get(key);
        if (group) group.ids.push(u.id);
        else byPayload.set(key, { data, ids: [u.id] });
      }

      try {
        for (const group of byPayload.values()) {
          for (let start = 0; start < group.ids.length; start += CONTACT_IMPORT_WRITE_CHUNK_SIZE) {
            const updated = await prisma.contact.updateMany({
              // organizationId junto do id — o `prisma` normal já aplica RLS,
              // mas o filtro explícito é a mesma cinta-e-suspensório que todo
              // updateMany desta base usa. scopeWhere é o filtro de papel (ver
              // acima); como ele também devolve uma chave própria, os dois
              // convivem no mesmo objeto sem se sobrescrever (chaves
              // diferentes: id vs responsavelId).
              where: { organizationId, id: { in: group.ids.slice(start, start + CONTACT_IMPORT_WRITE_CHUNK_SIZE) }, ...scopeWhere },
              data: group.data,
            });
            updatedExisting += updated.count;
          }
        }
      } catch (err) {
        // Nunca derruba a importação por causa disto (ver updateFailed acima)
        // — os contatos novos já estão gravados. O log fica com o erro real;
        // a tela recebe uma frase curta e honesta.
        console.error("[contacts:import] falha ao atualizar contatos existentes", err);
        updateFailed = "Os contatos novos entraram, mas a atualização dos que já existiam falhou. Importe o mesmo arquivo de novo para tentar só essa parte.";
      }
    }
    // Só conta como "bloqueado" o que não foi aplicado NEM falhou — se a
    // atualização quebrou no meio, o que faltou é consequência do erro
    // (updateFailed), não de permissão, e dizer "sem permissão" ali seria
    // mentira.
    const updateBlocked = updateFailed ? 0 : Math.max(0, contactUpdates.length - updatedExisting);

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
      detail: `${file.name} — ${actualCreated} de ${plan.summary.totalRows} contatos criados${updatedExisting > 0 ? `, ${updatedExisting} já existentes atualizados` : ""}`,
      ip: getClientIp(req),
    }).catch((err) => console.error("[audit-log] falha ao registrar CONTACTS_IMPORTED", err));

    return NextResponse.json({
      total: plan.summary.totalRows,
      created: actualCreated,
      updatedExisting,
      updateBlocked,
      updateFailed,
      skipped: plan.summary.totalRows - actualCreated,
      skippedNoName: plan.summary.skippedNoName,
      skippedNoJobTitle: plan.summary.skippedNoJobTitle,
      skippedInvalidPhone: plan.summary.skippedInvalidPhone,
      duplicateContacts: plan.summary.duplicateContacts,
      ownerFallbacks: plan.summary.ownerFallbacks,
      addressWarnings: plan.summary.addressWarnings,
      importBatchId,
      // Linhas com problema, pra quem quiser conferir o que exatamente não
      // bateu — cap de 200 pra não estourar o payload numa importação de
      // milhares de linhas todas com o mesmo aviso.
      issueRows: plan.rows.filter((r) => r.issues.length > 0).slice(0, 200),
    });
  });
}
