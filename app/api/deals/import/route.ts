import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet, normalizeHeader } from "@/lib/parse-spreadsheet";
import { buildDealName } from "@/lib/deal-name";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { parseBrazilianCurrency } from "@/lib/format";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { linkOrphanThreadsForContact } from "@/lib/whatsapp/threads";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 1000;

const CONTACT_HEADERS = ["contato", "cliente", "nome do contato", "nome"];
const PHONE_HEADERS = [
  "telefone",
  "celular",
  "phone",
  "fone",
  "celular 2",
  "celular2",
  "telefone 2",
  "telefone2",
  "segundo celular",
  "segundo telefone",
];
const WHATSAPP_HEADERS = ["whatsapp", "whats"];
const EMAIL_HEADERS = ["email", "e-mail"];
const SOURCE_HEADERS = ["origem", "source"];
const DEAL_NAME_HEADERS = ["negocio", "nome do negocio", "titulo"];
const VALUE_HEADERS = ["valor", "value"];
const CREDIT_TYPE_HEADERS = ["tipo de credito", "tipo", "credittype"];
const STAGE_HEADERS = ["etapa", "stage"];
const OWNER_HEADERS = ["responsavel", "vendedor", "owner"];

/** Resultado da resolução de contato de uma linha — ou já existe no banco, ou vai ser criado nesta importação. */
type ContactRef =
  | { kind: "existing"; id: string; name: string; source: string | null }
  | { kind: "new"; pendingIndex: number; name: string; source: string | null };

type PendingContact = {
  name: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  source?: string;
  phoneNormalized: string | null;
  whatsappNormalized: string | null;
};

export async function POST(req: Request) {
  const { organizationId, userId: sessionUserId } = await requireSession();
  if (!organizationId || !sessionUserId)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const userId: string = sessionUserId;

  // Cada chamada pode criar até MAX_ROWS negócios/contatos — sem limite de
  // quantas vezes por hora, dava pra inundar a organização de registros.
  const rateLimited = rateLimitOrResponse(`import:${organizationId}`, 5, 60 * 60_000);
  if (rateLimited) return rateLimited;

  const formData = await req.formData();
  const file = formData.get("file");
  const pipelineId = formData.get("pipelineId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx" }, { status: 400 });
  }
  if (typeof pipelineId !== "string" || !pipelineId) {
    return NextResponse.json({ error: "Pipeline inválido" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Arquivo maior que 5MB" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    if (!pipeline || pipeline.stages.length === 0) {
      return NextResponse.json({ error: "Pipeline inválido" }, { status: 400 });
    }
    const defaultStageId = pipeline.stages[0].id;

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
      return NextResponse.json(
        { error: "Arquivo vazio ou sem linhas de dados" },
        { status: 400 },
      );
    }

    const totalDataRows = rows.length - 1;
    if (totalDataRows > MAX_ROWS) {
      // Antes cortava em silêncio (só as primeiras MAX_ROWS entravam, sem
      // avisar) — quem mandasse 3.000 linhas achava que importou tudo e só
      // ia notar depois. Recusa e deixa claro quanto precisa cortar, em vez
      // de importar uma fração sem dizer.
      return NextResponse.json(
        {
          error: `Arquivo tem ${totalDataRows} linhas — o máximo por importação é ${MAX_ROWS}. Divida em arquivos menores e importe em partes.`,
        },
        { status: 400 },
      );
    }

    const dataRows = rows.slice(1, 1 + MAX_ROWS);
    const headerRow = rows[0].map(normalizeHeader);

    function columnIndex(candidates: string[]) {
      return headerRow.findIndex((h) => candidates.includes(h));
    }

    const contactIdx = columnIndex(CONTACT_HEADERS);
    if (contactIdx === -1) {
      return NextResponse.json(
        { error: "Não encontrei uma coluna 'contato' ou 'nome' no arquivo" },
        { status: 400 },
      );
    }
    const phoneIdx = columnIndex(PHONE_HEADERS);
    const whatsappIdx = columnIndex(WHATSAPP_HEADERS);
    const emailIdx = columnIndex(EMAIL_HEADERS);
    const sourceIdx = columnIndex(SOURCE_HEADERS);
    const dealNameIdx = columnIndex(DEAL_NAME_HEADERS);
    const valueIdx = columnIndex(VALUE_HEADERS);
    const creditTypeIdx = columnIndex(CREDIT_TYPE_HEADERS);
    const stageIdx = columnIndex(STAGE_HEADERS);
    const ownerIdx = columnIndex(OWNER_HEADERS);

    const cell = (row: string[], idx: number) => (idx === -1 ? "" : (row[idx] ?? "").trim());

    const [members, existingContacts, openLoads] = await Promise.all([
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.contact.findMany({
        where: {
          organizationId,
          OR: [{ phoneNormalized: { not: null } }, { whatsappNormalized: { not: null } }],
        },
        select: { id: true, name: true, source: true, phoneNormalized: true, whatsappNormalized: true },
      }),
      // Base pro rodízio de responsável (ver pickAutoOwner abaixo) — mesma
      // lógica de lib/auto-assign.ts, só que resolvida uma vez em memória
      // pra todo o arquivo em vez de reconsultar o banco a cada linha.
      prisma.deal.groupBy({ by: ["ownerId"], where: { organizationId, status: "OPEN" }, _count: true }),
    ]);

    const stageByName = new Map(pipeline.stages.map((s) => [normalizeHeader(s.name), s.id]));
    const memberByName = new Map(members.map((m) => [normalizeHeader(m.user.name), m.user.id]));
    const memberByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user.id]));

    const loadByUser = new Map<string, number>(openLoads.map((l) => [l.ownerId, l._count]));
    function pickAutoOwner(): string {
      if (members.length === 0) return userId;
      let picked = members[0].userId;
      let lowest = loadByUser.get(picked) ?? 0;
      for (const m of members) {
        const count = loadByUser.get(m.userId) ?? 0;
        if (count < lowest) {
          lowest = count;
          picked = m.userId;
        }
      }
      // Conta a partir daqui como se o negócio já tivesse sido criado, pra
      // próxima linha sem responsável não cair na mesma pessoa de novo —
      // mesmo efeito do reconsulta-a-cada-linha de antes, sem o round-trip.
      loadByUser.set(picked, (loadByUser.get(picked) ?? 0) + 1);
      return picked;
    }

    // ─── Passo 1: resolve todo mundo em memória, sem escrever no banco ainda.
    const contactRefByNumber = new Map<string, ContactRef>();
    for (const c of existingContacts) {
      const ref: ContactRef = { kind: "existing", id: c.id, name: c.name, source: c.source };
      if (c.phoneNormalized) contactRefByNumber.set(c.phoneNormalized, ref);
      if (c.whatsappNormalized) contactRefByNumber.set(c.whatsappNormalized, ref);
    }

    const pendingNewContacts: PendingContact[] = [];
    const rowContactRef: (ContactRef | null)[] = [];
    let skipped = 0;

    for (const row of dataRows) {
      const contactName = cell(row, contactIdx);
      if (!contactName) {
        skipped += 1;
        rowContactRef.push(null);
        continue;
      }

      const phone = cell(row, phoneIdx) || undefined;
      const whatsapp = cell(row, whatsappIdx) || undefined;
      const email = cell(row, emailIdx) || undefined;
      const source = cell(row, sourceIdx) || undefined;
      const phoneNormalized = normalizePhoneNumber(phone);
      const whatsappNormalized = normalizePhoneNumber(whatsapp);

      let ref =
        (phoneNormalized ? contactRefByNumber.get(phoneNormalized) : undefined) ??
        (whatsappNormalized ? contactRefByNumber.get(whatsappNormalized) : undefined) ??
        null;

      if (!ref) {
        const pendingIndex = pendingNewContacts.length;
        pendingNewContacts.push({ name: contactName, phone, whatsapp, email, source, phoneNormalized, whatsappNormalized });
        ref = { kind: "new", pendingIndex, name: contactName, source: source ?? null };
        // Registra já como se existisse — uma linha seguinte com o mesmo
        // telefone/whatsapp reaproveita este contato em vez de duplicar.
        if (phoneNormalized) contactRefByNumber.set(phoneNormalized, ref);
        if (whatsappNormalized) contactRefByNumber.set(whatsappNormalized, ref);
      }
      rowContactRef.push(ref);
    }

    // Conta quando o texto da planilha não bateu com nada conhecido e caiu
    // no padrão em silêncio — sem isso, um "Proposta enviada" que não existe
    // no funil (etapa certa é só "Proposta") joga a linha inteira na etapa
    // default sem deixar rastro nenhum na resposta.
    let stageFallbacks = 0;
    let ownerFallbacks = 0;
    let valueParseFailures = 0;

    // ─── Passo 2: cria os contatos novos e os negócios em poucas instruções
    // em lote (não uma por linha) — tudo numa transação real, então um erro
    // no meio não deixa metade dos registros presos no banco.
    const { createdCount: created, newContactsForThreadLink } = await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, organizationId);

      const pendingIndexToRealId = new Map<number, string>();

      // Contatos sem telefone/whatsapp nunca colidem (a constraint única é
      // só em cima desses dois campos) — createManyAndReturn devolve todo
      // mundo, na mesma ordem da entrada, sem risco de "sumir" nenhuma linha.
      const withoutNumber = pendingNewContacts
        .map((data, pendingIndex) => ({ data, pendingIndex }))
        .filter((e) => !e.data.phoneNormalized && !e.data.whatsappNormalized);
      if (withoutNumber.length > 0) {
        const rows = await tx.contact.createManyAndReturn({
          data: withoutNumber.map((e) => ({
            organizationId,
            name: e.data.name,
            phone: e.data.phone,
            whatsapp: e.data.whatsapp,
            email: e.data.email,
            source: e.data.source,
          })),
        });
        rows.forEach((r, i) => pendingIndexToRealId.set(withoutNumber[i].pendingIndex, r.id));
      }

      // Contatos com telefone/whatsapp podem colidir com a constraint única
      // (concorrência com outra importação/cadastro rodando ao mesmo tempo,
      // fora do que já foi deduplicado em memória acima) — usa skipDuplicates
      // e recupera pelo próprio número quem entrou, sem depender de ordem.
      const withNumber = pendingNewContacts
        .map((data, pendingIndex) => ({ data, pendingIndex }))
        .filter((e) => e.data.phoneNormalized || e.data.whatsappNormalized);
      if (withNumber.length > 0) {
        const rows = await tx.contact.createManyAndReturn({
          data: withNumber.map((e) => ({
            organizationId,
            name: e.data.name,
            phone: e.data.phone,
            whatsapp: e.data.whatsapp,
            email: e.data.email,
            source: e.data.source,
            phoneNormalized: e.data.phoneNormalized,
            whatsappNormalized: e.data.whatsappNormalized,
          })),
          skipDuplicates: true,
        });
        const idByNumber = new Map<string, string>();
        for (const r of rows) {
          if (r.phoneNormalized) idByNumber.set(r.phoneNormalized, r.id);
          if (r.whatsappNormalized) idByNumber.set(r.whatsappNormalized, r.id);
        }
        const strays = withNumber.filter((e) => {
          const id =
            (e.data.phoneNormalized && idByNumber.get(e.data.phoneNormalized)) ??
            (e.data.whatsappNormalized && idByNumber.get(e.data.whatsappNormalized));
          if (id) pendingIndexToRealId.set(e.pendingIndex, id);
          return !id;
        });
        // Raríssimo (perdeu uma corrida de criação concorrente pro mesmo
        // número) — resolve pegando quem já ficou dono do número agora.
        if (strays.length > 0) {
          const conflicting = await tx.contact.findMany({
            where: {
              organizationId,
              OR: strays.flatMap((e) => [
                ...(e.data.phoneNormalized
                  ? [{ phoneNormalized: e.data.phoneNormalized }, { whatsappNormalized: e.data.phoneNormalized }]
                  : []),
                ...(e.data.whatsappNormalized
                  ? [{ phoneNormalized: e.data.whatsappNormalized }, { whatsappNormalized: e.data.whatsappNormalized }]
                  : []),
              ]),
            },
          });
          for (const e of strays) {
            const match = conflicting.find(
              (c) =>
                c.phoneNormalized === e.data.phoneNormalized ||
                c.whatsappNormalized === e.data.phoneNormalized ||
                c.phoneNormalized === e.data.whatsappNormalized ||
                c.whatsappNormalized === e.data.whatsappNormalized,
            );
            if (match) pendingIndexToRealId.set(e.pendingIndex, match.id);
          }
        }
      }

      function resolveContactId(ref: ContactRef): string | undefined {
        return ref.kind === "existing" ? ref.id : pendingIndexToRealId.get(ref.pendingIndex);
      }

      let createdCount = 0;
      const dealsData: {
        organizationId: string;
        pipelineId: string;
        stageId: string;
        contactId: string;
        ownerId: string;
        name: string;
        value?: number;
        creditType?: string;
      }[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const ref = rowContactRef[i];
        if (!ref) continue; // sem nome de contato — já contado em `skipped`
        const contactId = resolveContactId(ref);
        if (!contactId) {
          skipped += 1;
          continue;
        }

        const row = dataRows[i];
        const stageNameRaw = cell(row, stageIdx);
        let stageId = defaultStageId;
        if (stageNameRaw) {
          const matched = stageByName.get(normalizeHeader(stageNameRaw));
          if (matched) {
            stageId = matched;
          } else {
            stageFallbacks += 1;
          }
        }

        const ownerNameRaw = cell(row, ownerIdx);
        let ownerId = ownerNameRaw
          ? (memberByEmail.get(ownerNameRaw.toLowerCase()) ?? memberByName.get(normalizeHeader(ownerNameRaw)))
          : undefined;
        if (!ownerId) {
          if (ownerNameRaw) ownerFallbacks += 1;
          ownerId = pickAutoOwner();
        }

        const valueRaw = cell(row, valueIdx);
        const value = valueRaw ? parseBrazilianCurrency(valueRaw) : undefined;
        if (valueRaw && value === undefined) valueParseFailures += 1;

        const dealNameRaw = cell(row, dealNameIdx);
        const name = dealNameRaw || buildDealName(ref.name, ref.source ?? undefined);

        dealsData.push({
          organizationId,
          pipelineId: pipeline.id,
          stageId,
          contactId,
          ownerId,
          name,
          value,
          creditType: cell(row, creditTypeIdx) || undefined,
        });
        createdCount += 1;
      }

      if (dealsData.length > 0) {
        await tx.deal.createMany({ data: dealsData });
      }

      // Pra promover conversas de WhatsApp avulsas depois da transação (ver
      // chamada abaixo) — mesmo comportamento que toda outra rota que cria
      // Contact já tem (cadastro manual, importação de contatos, API
      // externa), só que a importação de negócios nunca fazia essa ligação.
      const newContactsForThreadLink = pendingNewContacts
        .map((data, pendingIndex) => ({ data, id: pendingIndexToRealId.get(pendingIndex) }))
        .filter((e): e is { data: PendingContact; id: string } => !!e.id);

      return { createdCount, newContactsForThreadLink };
    });

    // Fora da transação de propósito — não precisa ser atômico com a
    // criação, e linkOrphanThreadsForContact usa o cliente prisma normal
    // (com RLS), não o prismaRaw/tx usado acima.
    for (const c of newContactsForThreadLink) {
      if (c.data.phoneNormalized || c.data.whatsappNormalized) {
        await linkOrphanThreadsForContact(organizationId, c.id, [c.data.phoneNormalized, c.data.whatsappNormalized]);
      }
    }

    return NextResponse.json({
      total: dataRows.length,
      created,
      skipped,
      stageFallbacks,
      ownerFallbacks,
      valueParseFailures,
    });
  });
}
