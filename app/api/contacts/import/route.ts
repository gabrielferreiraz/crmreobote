import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { parseSpreadsheet, normalizeHeader } from "@/lib/parse-spreadsheet";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { runWithTenant } from "@/lib/tenant-context";
import { linkOrphanThreadsForOrganization } from "@/lib/whatsapp/threads";
import { rateLimitOrResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROWS = 5000;

const NAME_HEADERS = ["nome", "name"];
const EMAIL_HEADERS = ["email", "e-mail"];
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
const SOURCE_HEADERS = ["origem", "source"];
const COMPANY_HEADERS = ["empresa", "company"];
const JOB_TITLE_HEADERS = ["cargo", "jobtitle", "job title", "funcao", "função"];
const TAGS_HEADERS = ["tags", "etiquetas"];

export async function POST(req: Request) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Cada chamada pode criar até MAX_ROWS contatos — sem limite de quantas
  // vezes por hora, dava pra inundar a organização de registros.
  const rateLimited = rateLimitOrResponse(`import:${organizationId}`, 5, 60 * 60_000);
  if (rateLimited) return rateLimited;

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Arquivo maior que 5MB" }, { status: 400 });
  }

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

  const nameIdx = columnIndex(NAME_HEADERS);
  if (nameIdx === -1) {
    return NextResponse.json(
      { error: "Não encontrei uma coluna 'nome' no arquivo" },
      { status: 400 },
    );
  }
  const emailIdx = columnIndex(EMAIL_HEADERS);
  const phoneIdx = columnIndex(PHONE_HEADERS);
  const whatsappIdx = columnIndex(WHATSAPP_HEADERS);
  const sourceIdx = columnIndex(SOURCE_HEADERS);
  const companyIdx = columnIndex(COMPANY_HEADERS);
  const jobTitleIdx = columnIndex(JOB_TITLE_HEADERS);
  const tagsIdx = columnIndex(TAGS_HEADERS);

  const cell = (row: string[], idx: number) => (idx === -1 ? "" : (row[idx] ?? "").trim());

  const parsed = dataRows
    .map((row) => ({
      name: cell(row, nameIdx),
      email: cell(row, emailIdx) || undefined,
      phone: cell(row, phoneIdx) || undefined,
      whatsapp: cell(row, whatsappIdx) || undefined,
      source: cell(row, sourceIdx) || undefined,
      company: cell(row, companyIdx) || undefined,
      jobTitle: cell(row, jobTitleIdx) || undefined,
      tags: cell(row, tagsIdx)
        ? cell(row, tagsIdx)
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    }))
    .filter((r) => r.name);

  if (parsed.length === 0) {
    return NextResponse.json({ error: "Nenhum contato válido encontrado" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const result = await prisma.contact.createMany({
      data: parsed.map((c) => ({
        organizationId,
        ...c,
        phoneNormalized: normalizePhoneNumber(c.phone),
        whatsappNormalized: normalizePhoneNumber(c.whatsapp),
      })),
      skipDuplicates: true,
    });

    // Mesma promoção automática do cadastro manual (ver app/api/contacts/route.ts),
    // só que de uma vez pro lote inteiro em vez de por linha — importação
    // pode trazer milhares de contatos, então re-checa as conversas avulsas
    // da organização uma única vez no final.
    if (result.count > 0) {
      await linkOrphanThreadsForOrganization(organizationId);
    }

    return NextResponse.json({
      total: parsed.length,
      created: result.count,
      skipped: parsed.length - result.count,
    });
  });
}
