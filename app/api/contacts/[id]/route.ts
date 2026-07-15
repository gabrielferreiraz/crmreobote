import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { findDuplicateContact } from "@/lib/contact-duplicate";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { validateCustomFieldValues } from "@/lib/custom-fields";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const contact = await prisma.contact.findFirst({
      where: { id, organizationId },
      include: {
        deals: { include: { stage: true, pipeline: true }, orderBy: { createdAt: "desc" } },
      },
    });

    if (!contact) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(contact);
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.contact.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const phoneNormalized = normalizePhoneNumber(phone);
    const whatsappNormalized = normalizePhoneNumber(whatsapp);
    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => sanitizeCell(t.trim())).filter(Boolean)
      : undefined;

    const duplicate = await findDuplicateContact(organizationId, phoneNormalized, whatsappNormalized, id);
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
      const contact = await prisma.contact.update({
        where: { id },
        data: {
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
          ...(cleanTags !== undefined ? { tags: cleanTags } : {}),
          phoneNormalized,
          whatsappNormalized,
          customFieldValues: cleanCustomFieldValues,
        },
      });
      return NextResponse.json(contact);
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.contact.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.contact.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
