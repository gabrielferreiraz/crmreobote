import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { findDuplicateContact } from "@/lib/contact-duplicate";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { linkOrphanThreadsForOrganization } from "@/lib/whatsapp/threads";
import { enqueueWebhookEvent } from "@/lib/webhooks/enqueue";
import { validateCustomFieldValues } from "@/lib/custom-fields";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { deals: true } } },
      take: q ? 8 : undefined,
    });

    return NextResponse.json(contacts);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const {
    name,
    email,
    phone,
    whatsapp,
    source,
    company,
    jobTitle,
    address,
    addressNumber,
    addressComplement,
    neighborhood,
    city,
    state,
    zipCode,
    tags,
    customFieldValues,
  } = body as {
    name?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    source?: string;
    company?: string;
    jobTitle?: string;
    address?: string;
    addressNumber?: string;
    addressComplement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    tags?: string[];
    customFieldValues?: Record<string, unknown>;
  };

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const phoneNormalized = normalizePhoneNumber(phone);
    const whatsappNormalized = normalizePhoneNumber(whatsapp);
    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => sanitizeCell(t.trim())).filter(Boolean)
      : [];

    const duplicate = await findDuplicateContact(organizationId, phoneNormalized, whatsappNormalized);
    if (duplicate) {
      return NextResponse.json({ error: duplicate.message }, { status: 409 });
    }

    const fieldDefs = await prisma.customFieldDefinition.findMany({
      where: { organizationId, entityType: "CONTACT" },
    });
    let cleanCustomFieldValues;
    try {
      cleanCustomFieldValues = validateCustomFieldValues(fieldDefs, customFieldValues);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    try {
      const contact = await prisma.contact.create({
        data: {
          organizationId,
          name: sanitizeCell(name),
          email: sanitizeCell(email),
          phone: sanitizeCell(phone),
          whatsapp: sanitizeCell(whatsapp),
          source: sanitizeCell(source),
          company: sanitizeCell(company),
          jobTitle: sanitizeCell(jobTitle),
          address: sanitizeCell(address),
          addressNumber: sanitizeCell(addressNumber),
          addressComplement: sanitizeCell(addressComplement),
          neighborhood: sanitizeCell(neighborhood),
          city: sanitizeCell(city),
          state: sanitizeCell(state),
          zipCode: sanitizeCell(zipCode),
          tags: cleanTags,
          phoneNormalized,
          whatsappNormalized,
          customFieldValues: cleanCustomFieldValues,
        },
      });

      // Se esse número já tinha mandado mensagem antes de virar Contact, a
      // conversa estava em "WhatsApp Geral" — promove pra "WhatsApp CRM" na
      // hora, sem esperar a próxima mensagem chegar.
      if (phoneNormalized || whatsappNormalized) {
        await linkOrphanThreadsForOrganization(organizationId);
      }

      enqueueWebhookEvent(organizationId, "contact.created", {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        whatsapp: contact.whatsapp,
        source: contact.source,
        tags: contact.tags,
        createdAt: contact.createdAt,
      }).catch((err) => console.error("[webhooks] falha ao enfileirar contact.created", err));

      return NextResponse.json(contact, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json(
          { error: "Já existe um contato com esse número de telefone ou WhatsApp." },
          { status: 409 },
        );
      }
      throw err;
    }
  });
}
