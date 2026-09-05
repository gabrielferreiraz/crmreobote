import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { getCurrentMembership } from "@/lib/current-membership";
import { normalizePhoneNumber, fallbackWhatsappToPhone } from "@/lib/phone-normalize";
import { findDuplicateContact } from "@/lib/contact-duplicate";
import { fetchContactsList, countContacts } from "@/lib/contacts/list-query";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { linkOrphanThreadsForContact } from "@/lib/whatsapp/threads";
import { enqueueWebhookEvent } from "@/lib/webhooks/enqueue";
import { validateCustomFieldValues } from "@/lib/custom-fields";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

// Sem `limit` explícito: 8 quando é busca por texto (autocomplete, ver
// ContactSearchInput) ou PAGE_SIZE quando é listagem simples (ver
// contacts-table.tsx) — nunca devolve a organização inteira de uma vez só.
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_LIST_LIMIT = 500;
const MAX_LIMIT = 500;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? undefined;
  const skipParam = Number(searchParams.get("skip"));
  const skip = Number.isFinite(skipParam) && skipParam > 0 ? skipParam : 0;
  const limitParam = Number(searchParams.get("limit"));
  const requestedLimit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : null;
  const take = Math.min(requestedLimit ?? (q ? DEFAULT_SEARCH_LIMIT : DEFAULT_LIST_LIMIT), MAX_LIMIT);

  // Filtros que hoje só existiam client-side em contacts-table.tsx.
  const source = searchParams.get("source") ?? undefined;
  const jobTitle = searchParams.get("jobTitle") ?? undefined;
  const responsavelId = searchParams.get("responsavelId") ?? undefined;
  const state = searchParams.get("state") ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const onlyWithDeals = searchParams.get("onlyWithDeals") === "1";
  const registeredFrom = parseDate(searchParams.get("registeredFrom"));
  const registeredTo = parseDate(searchParams.get("registeredTo"));

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Consultor (MEMBER) só enxerga contatos onde ele é o responsável —
  // nunca contatos de outros consultores, mesmo que passe responsavelId
  // diferente na URL (esse parâmetro é ignorado quando o role é MEMBER).
  // OWNER e MANAGER continuam sem restrição de responsável.
  const membership = await getCurrentMembership();
  const isMember = membership?.role === "MEMBER";
  const effectiveResponsavelId = isMember ? userId : responsavelId;

  return runWithTenant(organizationId, async () => {
    const filterParams = { organizationId, q, source, jobTitle, responsavelId: effectiveResponsavelId, state, city, onlyWithDeals, registeredFrom, registeredTo };

    const [contacts, totalCount] = await Promise.all([
      fetchContactsList({ ...filterParams, skip, take }),
      countContacts(filterParams),
    ]);

    return NextResponse.json(contacts, { headers: { "X-Total-Count": String(totalCount) } });
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
    responsavelId,
    customFieldValues,
    claimContactId,
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
    // Confirmação explícita de "assumir esse contato" — ver conflict.claimable
    // na resposta 409 abaixo. Só some com o bloqueio se bater com o MESMO
    // contato que o 409 anterior apontou (nunca um "passe qualquer id e
    // reivindique qualquer contato").
    claimContactId?: string;
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!name) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }
  if (!jobTitle) {
    return NextResponse.json({ error: "Cargo é obrigatório" }, { status: 400 });
  }

  return runWithTenant(organizationId, async () => {
    const whatsappFallback = fallbackWhatsappToPhone(phone, normalizePhoneNumber(phone), whatsapp, normalizePhoneNumber(whatsapp));
    const phoneNormalized = whatsappFallback.phoneNormalized;
    const whatsappNormalized = whatsappFallback.whatsappNormalized;
    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => sanitizeCell(t.trim())).filter(Boolean)
      : [];

    const duplicate = await findDuplicateContact(organizationId, phoneNormalized, whatsappNormalized);
    if (duplicate) {
      // Responsável ativo cuidando do lead → nunca deixa passar direto,
      // mesmo com claimContactId — bloqueia sempre e mostra pra quem
      // procurar (pedido explícito do usuário).
      if (duplicate.responsavelActive) {
        return NextResponse.json(
          {
            error: duplicate.message,
            conflict: {
              contactId: duplicate.contactId,
              contactName: duplicate.contactName,
              createdAt: duplicate.createdAt,
              responsavelName: duplicate.responsavelName,
              claimable: false,
            },
          },
          { status: 409 },
        );
      }

      // Sem responsável ativo (nunca teve, ou o antigo responsável foi
      // desativado) — sem claimContactId ainda é só um aviso (409), com a
      // opção de reivindicar; com claimContactId apontando pro MESMO
      // contato, confirma e vira UPDATE (responsável passa a ser quem está
      // criando agora) em vez de tentar CREATE.
      if (!claimContactId || claimContactId !== duplicate.contactId) {
        return NextResponse.json(
          {
            error: duplicate.message,
            conflict: {
              contactId: duplicate.contactId,
              contactName: duplicate.contactName,
              createdAt: duplicate.createdAt,
              responsavelName: duplicate.responsavelName,
              claimable: true,
            },
          },
          { status: 409 },
        );
      }

      const fieldDefsForClaim = await prisma.customFieldDefinition.findMany({
        where: { organizationId, entityType: "CONTACT" },
      });
      let claimCustomFieldValues;
      try {
        claimCustomFieldValues = validateCustomFieldValues(fieldDefsForClaim, customFieldValues);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }

      // updateMany (não update) com o responsavelId de quando LEMOS o
      // duplicado no `where` — trava otimista contra a corrida de duas
      // pessoas clicando "Assumir" no mesmo contato ao mesmo tempo: só
      // aplica se ninguém mudou o responsável entre a leitura e agora
      // (senão os dois passariam pela checagem de "claimable" e o segundo
      // update pisaria no primeiro, exatamente o tipo de "contato foi
      // parar com outra pessoa" que essa funcionalidade existe pra evitar).
      const claimResult = await prisma.contact.updateMany({
        where: { id: duplicate.contactId, responsavelId: duplicate.responsavelId },
        data: {
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
          tags: cleanTags,
          // Sempre quem está criando agora — não o que veio no formulário
          // (ver comentário no claimContactId acima: reivindicar É a
          // atribuição, não uma escolha separada de responsável).
          responsavelId: userId,
          phoneNormalized,
          whatsappNormalized,
          customFieldValues: claimCustomFieldValues,
        },
      });

      if (claimResult.count === 0) {
        return NextResponse.json(
          { error: "Este contato acabou de ser assumido por outra pessoa — atualize e tente de novo." },
          { status: 409 },
        );
      }

      const claimed = await prisma.contact.findUniqueOrThrow({
        where: { id: duplicate.contactId },
      });

      recordUserChange(organizationId, userId).catch((err) =>
        console.error("[user-activity] falha ao registrar alteração", err),
      );

      return NextResponse.json(claimed, { status: 200 });
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
          tags: cleanTags,
          responsavelId: responsavelId || null,
          phoneNormalized,
          whatsappNormalized,
          customFieldValues: cleanCustomFieldValues,
        },
      });

      // Se esse número já tinha mandado mensagem antes de virar Contact, a
      // conversa estava em "WhatsApp Geral" — promove pra "WhatsApp CRM" na
      // hora, sem esperar a próxima mensagem chegar.
      if (phoneNormalized || whatsappNormalized) {
        await linkOrphanThreadsForContact(organizationId, contact.id, [phoneNormalized, whatsappNormalized]);
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

      recordUserChange(organizationId, userId).catch((err) =>
        console.error("[user-activity] falha ao registrar alteração", err),
      );

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
