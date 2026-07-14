import { NextResponse } from "next/server";
import { prismaRaw } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { setTenantOnTx } from "@/lib/tenant-context";
import { normalizePhoneNumber } from "@/lib/phone-normalize";

export const dynamic = "force-dynamic";

type ContactRow = { id: string; name: string; email: string | null };
type DealRow = { id: string; name: string; contactName: string };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!q) return NextResponse.json({ contacts: [], deals: [] });

  // Dígitos do termo buscado (ex.: "11 98888-7777" → "11988887777"), pra casar
  // com o telefone/WhatsApp do contato independente de como a pessoa formatou
  // a busca. String vazia quando o termo não tem nenhum dígito — nesse caso a
  // cláusula de telefone é ignorada (ver guarda "<> ''" abaixo; sem ela, um
  // LIKE '%%' bateria com toda linha).
  const digits = normalizePhoneNumber(q) ?? "";

  // Raw query (não o `prisma` com a extensão de RLS automática) porque
  // precisamos do operador `%`/`similarity()` do pg_trgm (busca tolerante a
  // erro de digitação, ranqueada por relevância) — algo que a API tipada do
  // Prisma não expõe. `setTenantOnTx` faz manualmente o SET LOCAL que a
  // extensão de RLS faria sozinha (ver lib/prisma.ts).
  const [contacts, deals] = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);

    const contactRows = await tx.$queryRaw<ContactRow[]>`
      SELECT id, name, email
      FROM "Contact"
      WHERE "organizationId" = ${organizationId}
        AND (
          name ILIKE '%' || ${q} || '%' OR
          name % ${q} OR
          company ILIKE '%' || ${q} || '%' OR
          company % ${q} OR
          email ILIKE '%' || ${q} || '%' OR
          (${digits} <> '' AND (
            "phoneNormalized" LIKE '%' || ${digits} || '%' OR
            "whatsappNormalized" LIKE '%' || ${digits} || '%'
          ))
        )
      ORDER BY GREATEST(similarity(name, ${q}), similarity(coalesce(company, ''), ${q})) DESC, name ASC
      LIMIT 5
    `;

    const dealRows = await tx.$queryRaw<DealRow[]>`
      SELECT d.id, d.name, c.name AS "contactName"
      FROM "Deal" d
      JOIN "Contact" c ON c.id = d."contactId"
      WHERE d."organizationId" = ${organizationId}
        AND (d.name ILIKE '%' || ${q} || '%' OR d.name % ${q})
      ORDER BY similarity(d.name, ${q}) DESC, d.name ASC
      LIMIT 5
    `;

    return [contactRows, dealRows] as const;
  });

  return NextResponse.json({
    contacts,
    deals: deals.map((d) => ({ id: d.id, name: d.name, contact: { name: d.contactName } })),
  });
}
