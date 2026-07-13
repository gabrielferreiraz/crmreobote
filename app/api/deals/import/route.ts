import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet, normalizeHeader } from "@/lib/parse-spreadsheet";
import { buildDealName } from "@/lib/deal-name";
import { pickOwnerId } from "@/lib/auto-assign";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { runWithTenant } from "@/lib/tenant-context";

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

export async function POST(req: Request) {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

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
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o arquivo" }, { status: 400 });
  }

  if (rows.length < 2) {
    return NextResponse.json(
      { error: "Arquivo vazio ou sem linhas de dados" },
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

  const members = await prisma.organizationUser.findMany({
    where: { organizationId, active: true },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const existingContacts = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [{ phoneNormalized: { not: null } }, { whatsappNormalized: { not: null } }],
    },
    select: { id: true, name: true, source: true, phoneNormalized: true, whatsappNormalized: true },
  });
  const contactByNormalizedNumber = new Map<string, (typeof existingContacts)[number]>();
  for (const c of existingContacts) {
    if (c.phoneNormalized) contactByNormalizedNumber.set(c.phoneNormalized, c);
    if (c.whatsappNormalized) contactByNormalizedNumber.set(c.whatsappNormalized, c);
  }

  const stageByName = new Map(pipeline.stages.map((s) => [normalizeHeader(s.name), s.id]));
  const memberByName = new Map(members.map((m) => [normalizeHeader(m.user.name), m.user.id]));
  const memberByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user.id]));

  let created = 0;
  let skipped = 0;

  for (const row of dataRows) {
    const contactName = cell(row, contactIdx);
    if (!contactName) {
      skipped += 1;
      continue;
    }

    const phone = cell(row, phoneIdx) || undefined;
    const whatsapp = cell(row, whatsappIdx) || undefined;
    const email = cell(row, emailIdx) || undefined;
    const source = cell(row, sourceIdx) || undefined;
    const phoneNormalized = normalizePhoneNumber(phone);
    const whatsappNormalized = normalizePhoneNumber(whatsapp);

    let contact =
      (phoneNormalized ? contactByNormalizedNumber.get(phoneNormalized) : undefined) ??
      (whatsappNormalized ? contactByNormalizedNumber.get(whatsappNormalized) : undefined);
    if (!contact) {
      try {
        contact = await prisma.contact.create({
          data: {
            organizationId,
            name: contactName,
            phone,
            whatsapp,
            email,
            source,
            phoneNormalized,
            whatsappNormalized,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          (phoneNormalized || whatsappNormalized)
        ) {
          const conflicting = await prisma.contact.findFirst({
            where: {
              organizationId,
              OR: [
                ...(phoneNormalized ? [{ phoneNormalized }, { whatsappNormalized: phoneNormalized }] : []),
                ...(whatsappNormalized ? [{ phoneNormalized: whatsappNormalized }, { whatsappNormalized }] : []),
              ],
            },
          });
          if (!conflicting) throw err;
          contact = conflicting;
        } else {
          throw err;
        }
      }
      if (phoneNormalized) contactByNormalizedNumber.set(phoneNormalized, contact);
      if (whatsappNormalized) contactByNormalizedNumber.set(whatsappNormalized, contact);
    }

    const stageNameRaw = cell(row, stageIdx);
    const stageId = stageNameRaw
      ? (stageByName.get(normalizeHeader(stageNameRaw)) ?? defaultStageId)
      : defaultStageId;

    const ownerNameRaw = cell(row, ownerIdx);
    let ownerId: string | undefined;
    if (ownerNameRaw) {
      ownerId =
        memberByEmail.get(ownerNameRaw.toLowerCase()) ??
        memberByName.get(normalizeHeader(ownerNameRaw));
    }
    if (!ownerId) {
      ownerId = await pickOwnerId(organizationId, userId);
    }

    const valueRaw = cell(row, valueIdx);
    const parsedValue = valueRaw
      ? Number(valueRaw.replace(/[^\d,.-]/g, "").replace(",", "."))
      : undefined;
    const value = parsedValue !== undefined && Number.isFinite(parsedValue) ? parsedValue : undefined;

    const dealNameRaw = cell(row, dealNameIdx);
    const name = dealNameRaw || buildDealName(contact.name, contact.source);

    await prisma.deal.create({
      data: {
        organizationId,
        pipelineId: pipeline.id,
        stageId,
        contactId: contact.id,
        ownerId,
        name,
        value,
        creditType: cell(row, creditTypeIdx) || undefined,
      },
    });

    created += 1;
  }

  return NextResponse.json({ total: dataRows.length, created, skipped });
  });
}
