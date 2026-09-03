import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { getCurrentMembership } from "@/lib/current-membership";
import { normalizePhoneNumber, fallbackWhatsappToPhone } from "@/lib/phone-normalize";
import { findDuplicateContact } from "@/lib/contact-duplicate";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { validateCustomFieldValues } from "@/lib/custom-fields";
import { recordUserChange } from "@/lib/user-activity";
import { recordUndoableAction } from "@/lib/undo/record";
import type { DeleteSnapshotPayload, FieldUpdatePayload } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(organizationId, async () => {
    // MEMBER só acessa contato do qual é responsável — não pode ver o
    // detalhe de um contato de outro consultor mesmo conhecendo o ID.
    const membership = await getCurrentMembership();
    const isMember = membership?.role === "MEMBER";
    const ownerFilter = isMember ? { responsavelId: userId } : {};

    const contact = await prisma.contact.findFirst({
      where: { id, organizationId, ...ownerFilter },
      include: {
        deals: { include: { stage: true, pipeline: true }, orderBy: { createdAt: "desc" } },
        // Só o nome — o painel de Informações da conversa de WhatsApp
        // (ver app/(dashboard)/whatsapp/conversas/contact-info-panel.tsx)
        // mostra "Responsável" junto do resto, mesmo dado que a página do
        // Cliente já mostra.
        responsavel: { select: { name: true } },
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

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Só bloqueia quando o corpo tenta de fato apagar o cargo (campo presente
  // e vazio) — uma chamada parcial que nem toca em jobTitle (ex.: ação em
  // massa mudando só responsável/origem) não pode ser barrada por isso.
  if ("jobTitle" in body && !jobTitle) {
    return NextResponse.json({ error: "Cargo é obrigatório" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    // MEMBER só pode editar contato do qual é responsável.
    const membership = await getCurrentMembership();
    const isMember = membership?.role === "MEMBER";
    const ownerFilter = isMember ? { responsavelId: userId } : {};

    // Primeiro verifica se o contato existe na organização
    const rawExisting = await prisma.contact.findFirst({ where: { id, organizationId } });
    if (!rawExisting) return NextResponse.json({ error: "Este contato não foi encontrado no sistema." }, { status: 404 });

    // Se o usuário for MEMBER, verifica se ele é de fato o responsável por este contato
    if (isMember && rawExisting.responsavelId !== userId) {
      const reason = rawExisting.responsavelId
        ? "Contato pertence a outro consultor."
        : "Contato sem responsável. Peça atribuição a um gestor.";
      return NextResponse.json(
        { error: "Sem permissão para editar", details: reason, type: "PERMISSION" },
        { status: 403 }
      );
    }

    const existing = rawExisting;

    // Só recalcula/valida o que de fato veio no corpo — uma chamada parcial
    // (ex.: ações em massa, que mandam só o campo que está mudando) não pode
    // apagar telefone normalizado nem campos personalizados que não vieram.
    const phoneNormalized = "phone" in body ? normalizePhoneNumber(phone) : undefined;
    const whatsappNormalized = "whatsapp" in body ? normalizePhoneNumber(whatsapp) : undefined;

    // Estado efetivo pós-update (existente + o que veio nessa chamada) — só
    // assim dá pra saber se o contato vai FICAR com celular e sem WhatsApp,
    // mesmo quando essa chamada em particular só tocou num dos dois campos.
    const effectivePhone = "phone" in body ? sanitizeCell(phone) : existing.phone;
    const effectivePhoneNormalized = phoneNormalized !== undefined ? phoneNormalized : existing.phoneNormalized;
    const effectiveWhatsappRaw = "whatsapp" in body ? whatsapp : existing.whatsapp ?? undefined;
    const effectiveWhatsappNormalized = whatsappNormalized !== undefined ? whatsappNormalized : existing.whatsappNormalized;
    const whatsappFallback = fallbackWhatsappToPhone(effectivePhone, effectivePhoneNormalized, effectiveWhatsappRaw, effectiveWhatsappNormalized);

    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => sanitizeCell(t.trim())).filter(Boolean)
      : undefined;

    if (phoneNormalized !== undefined || whatsappNormalized !== undefined) {
      const duplicate = await findDuplicateContact(organizationId, whatsappFallback.phoneNormalized, whatsappFallback.whatsappNormalized, id);
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

    const updateData = {
      name: sanitizeCell(name),
      email: sanitizeCell(email),
      phone: sanitizeCell(whatsappFallback.phone),
      whatsapp: sanitizeCell(whatsappFallback.whatsapp),
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
      phoneNormalized: whatsappFallback.phoneNormalized,
      whatsappNormalized: whatsappFallback.whatsappNormalized,
      ...(cleanCustomFieldValues !== undefined ? { customFieldValues: cleanCustomFieldValues } : {}),
    };

    try {
      const contact = await prisma.contact.update({ where: { id }, data: updateData });
      recordUserChange(organizationId, userId).catch((err) =>
        console.error("[user-activity] falha ao registrar alteração", err),
      );

      // Ctrl+Z (ver lib/undo/) — phoneNormalized/whatsappNormalized sempre
      // aparecem em updateData (recalculados mesmo quando não mudou nada,
      // ver comentário acima de whatsappFallback), então sempre entram em
      // changedKeys — reverter pra "o mesmo valor de antes" nesse caso é
      // um no-op inofensivo, não um bug.
      const changedKeys = (Object.keys(updateData) as (keyof typeof updateData)[]).filter((k) => updateData[k] !== undefined);
      let undo: { id: string; description: string } | undefined;
      if (changedKeys.length > 0) {
        const previousValues: Record<string, unknown> = {};
        for (const key of changedKeys) previousValues[key] = existing[key as keyof typeof existing];
        undo = await recordUndoableAction({
          organizationId,
          userId,
          type: "contact.update",
          description: `Contato "${existing.name}" atualizado`,
          payload: {
            entities: [{ model: "contact", entityId: id, previousValues }],
            descriptions: { afterRevert: `Contato "${existing.name}" revertido`, original: `Contato "${existing.name}" atualizado` },
          } satisfies FieldUpdatePayload,
        });
      }

      return NextResponse.json({ ...contact, undo });
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

    // Ctrl+Z (ver lib/undo/) — snapshot ANTES de apagar, junto da única
    // relação em cascade real de Contact (CampaignRecipient; Deal não é
    // cascade de propósito, ver catch abaixo — se o delete chegou a
    // acontecer, é porque não sobrou Deal nenhum apontando pra cá).
    const cascadedCampaignRecipients = await prisma.campaignRecipient.findMany({ where: { contactId: id } });

    try {
      await prisma.contact.delete({ where: { id } });
    } catch (err) {
      // Deal.contactId não tem onDelete: Cascade (de propósito — apagar um
      // cliente não deveria conseguir levar negócio nenhum junto sem querer
      // de verdade), então o Postgres barra com uma violação de FK (P2003)
      // quando ainda existe negócio apontando pra este contato. Sem esse
      // catch, isso vazava como 500 cru pro cliente (stack trace nos logs,
      // sem mensagem nenhuma explicando o motivo real) — a UI (ver
      // contact-tabs.tsx) já evita chegar aqui desabilitando o botão
      // enquanto houver negócio vinculado, mas isso continua sendo a defesa
      // de verdade (2 abas abertas, chamada direta à API, etc.).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return NextResponse.json(
          { error: "Esse contato ainda tem negócio vinculado — apague os negócios primeiro." },
          { status: 409 },
        );
      }
      throw err;
    }
    recordUserChange(access.organizationId, access.userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    const undo = await recordUndoableAction({
      organizationId: access.organizationId,
      userId: access.userId,
      type: "contact.delete",
      description: `Contato "${existing.name}" excluído`,
      payload: {
        snapshot: existing,
        cascaded:
          cascadedCampaignRecipients.length > 0 ? [{ model: "campaignRecipient", rows: cascadedCampaignRecipients }] : undefined,
        descriptions: { afterRevert: `Contato "${existing.name}" restaurado`, original: `Contato "${existing.name}" excluído` },
      } satisfies DeleteSnapshotPayload,
    });

    return NextResponse.json({ ok: true, undo });
  });
}
