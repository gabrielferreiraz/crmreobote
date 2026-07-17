import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
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
    responsavelId,
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
    responsavelId?: string | null;
    customFieldValues?: Record<string, unknown>;
  };

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    const existing = await prisma.contact.findFirst({ where: { id, organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // Só recalcula/valida o que de fato veio no corpo — uma chamada parcial
    // (ex.: ações em massa, que mandam só o campo que está mudando) não pode
    // apagar telefone normalizado nem campos personalizados que não vieram.
    const phoneNormalized = "phone" in body ? normalizePhoneNumber(phone) : undefined;
    const whatsappNormalized = "whatsapp" in body ? normalizePhoneNumber(whatsapp) : undefined;
    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => sanitizeCell(t.trim())).filter(Boolean)
      : undefined;

    if (phoneNormalized !== undefined || whatsappNormalized !== undefined) {
      const duplicate = await findDuplicateContact(organizationId, phoneNormalized ?? null, whatsappNormalized ?? null, id);
      if (duplicate) {
        return NextResponse.json({ error: duplicate.message }, { status: 409 });
      }
    }

    let cleanCustomFieldValues;
    if ("customFieldValues" in body) {
      const fieldDefs = await prisma.customFieldDefinition.findMany({
        where: { organizationId, entityType: "CONTACT" },
      });
      try {
        cleanCustomFieldValues = validateCustomFieldValues(fieldDefs, customFieldValues);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
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
          ...("responsavelId" in body ? { responsavelId: responsavelId || null } : {}),
          phoneNormalized,
          whatsappNormalized,
          ...(cleanCustomFieldValues !== undefined ? { customFieldValues: cleanCustomFieldValues } : {}),
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

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const existing = await prisma.contact.findFirst({ where: { id, organizationId: access.organizationId } });
    if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    await prisma.contact.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
