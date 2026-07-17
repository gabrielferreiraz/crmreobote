/**
 * Upsert de contato pra ingestão externa (/api/v1/contacts e /bulk) — a
 * diferença de propósito em relação a POST /api/contacts (interno, usado
 * pelo vendedor no CRM) é que ali duplicata é erro (409: "já existe"), aqui
 * duplicata é normal (o integrador externo reenvia o mesmo lead várias
 * vezes, esperando atualização, não erro). Reaproveita a mesma normalização/
 * sanitização/dedupe já usada internamente.
 *
 * Só entra no `data` do update o campo que o integrador de fato mandou nessa
 * chamada (checado via `field in input`) — nunca apaga um campo já
 * preenchido só porque uma chamada seguinte não repetiu ele.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { findDuplicateContact } from "@/lib/contact-duplicate";
import { linkOrphanThreadsForOrganization } from "@/lib/whatsapp/threads";
import { enqueueWebhookEvent } from "@/lib/webhooks/enqueue";

const TEXT_FIELDS = [
  "email",
  "phone",
  "whatsapp",
  "source",
  "company",
  "jobTitle",
  "address",
  "addressNumber",
  "addressComplement",
  "neighborhood",
  "city",
  "state",
  "zipCode",
] as const;

export type ContactUpsertOutcome =
  | { ok: true; outcome: "created" | "updated"; contact: Prisma.ContactGetPayload<object>; warnings: string[] }
  | { ok: false; error: string };

export async function upsertContactFromIntegration(
  organizationId: string,
  input: Record<string, unknown>,
): Promise<ContactUpsertOutcome> {
  const warnings: string[] = [];
  const phone = typeof input.phone === "string" ? input.phone : undefined;
  const whatsapp = typeof input.whatsapp === "string" ? input.whatsapp : undefined;
  const phoneNormalized = normalizePhoneNumber(phone);
  const whatsappNormalized = normalizePhoneNumber(whatsapp);

  const duplicate = await findDuplicateContact(organizationId, phoneNormalized, whatsappNormalized);

  const data: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    if (field in input) {
      const raw = input[field];
      data[field] = sanitizeCell(typeof raw === "string" ? raw : null);
    }
  }
  if ("phone" in input) data.phoneNormalized = phoneNormalized;
  if ("whatsapp" in input) data.whatsappNormalized = whatsappNormalized;
  if ("tags" in input && Array.isArray(input.tags)) {
    data.tags = input.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => sanitizeCell(t.trim()))
      .filter(Boolean);
  }
  if ("customFields" in input && input.customFields && typeof input.customFields === "object") {
    data.customFields = input.customFields as Prisma.InputJsonValue;
  }
  if ("ownerId" in input) {
    const ownerId = typeof input.ownerId === "string" ? input.ownerId : null;
    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      // Responsável é só informativo — nunca vale a pena perder o lead inteiro
      // por causa de um ownerId errado/desconhecido. Avisa e segue sem
      // atribuir, em vez de rejeitar a chamada inteira.
      if (!membership) {
        warnings.push(`ownerId "${ownerId}" não corresponde a nenhum usuário desta organização — contato salvo sem responsável atribuído.`);
      } else {
        data.responsavelId = ownerId;
      }
    } else {
      data.responsavelId = null;
    }
  }

  if (duplicate) {
    if ("name" in input && typeof input.name === "string" && input.name.trim()) {
      data.name = sanitizeCell(input.name.trim());
    }
    const contact = await prisma.contact.update({
      where: { id: duplicate.contactId },
      data: data as Prisma.ContactUpdateInput,
    });
    return { ok: true, outcome: "updated", contact, warnings };
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Campo 'name' é obrigatório para criar um contato novo" };

  try {
    const contact = await prisma.contact.create({
      data: {
        organizationId,
        name: sanitizeCell(name),
        tags: [],
        ...data,
      } as Prisma.ContactUncheckedCreateInput,
    });

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

    return { ok: true, outcome: "created", contact, warnings };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Conflito ao criar contato — tente novamente" };
    }
    throw err;
  }
}
