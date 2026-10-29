import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { requireSheetsAccess } from "@/lib/sheets/access";
import { contactWriteCheck, DEAL_STATUS_LABELS, isCrmEntity } from "@/lib/sheets/crm-integration";
import { getCurrentMembership } from "@/lib/current-membership";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 1_000;

function dateCell(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

function numberCell(value: { toString(): string } | null | undefined): number | undefined {
  if (value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export async function GET(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const limited = rateLimitOrResponse(`sheets:crm-read:${access.organizationId}:${access.userId}`, 120, 60_000);
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const entity = params.get("entity");
  if (!isCrmEntity(entity)) return NextResponse.json({ error: "Origem do CRM inválida" }, { status: 400 });
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const skipRaw = Number(params.get("skip"));
  const limitRaw = Number(params.get("limit"));
  const skip = Number.isInteger(skipRaw) && skipRaw > 0 ? skipRaw : 0;
  const limit = Math.min(Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 100, MAX_LIMIT);
  // ?ids=a,b,c — prévia do "Enviar ao CRM": só os registros vinculados na planilha (até 200 por chamada).
  const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9]{10,40}$/i.test(s))
    .slice(0, 200);
  const membership = await getCurrentMembership();
  const role = membership?.role ?? "MEMBER";

  return runWithTenant(access.organizationId, async () => {
    if (entity === "contacts") {
      const where: Prisma.ContactWhereInput = {
        organizationId: access.organizationId,
        ...(ids.length ? { id: { in: ids } } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { whatsapp: { contains: q } },
                { company: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: ids.length ? 0 : skip,
          take: ids.length ? ids.length : limit,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            whatsapp: true,
            source: true,
            company: true,
            jobTitle: true,
            birthDate: true,
            address: true,
            addressNumber: true,
            addressComplement: true,
            neighborhood: true,
            city: true,
            state: true,
            zipCode: true,
            tags: true,
            responsavelId: true,
            responsavel: { select: { name: true } },
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.contact.count({ where }),
      ]);
      return NextResponse.json({
        entity,
        total,
        items: items.map((contact) => ({
          id: contact.id,
          label: contact.name,
          values: {
            __record: contact.id,
            name: contact.name,
            email: contact.email ?? undefined,
            phone: contact.phone ?? undefined,
            whatsapp: contact.whatsapp ?? undefined,
            source: contact.source ?? undefined,
            company: contact.company ?? undefined,
            jobTitle: contact.jobTitle ?? undefined,
            birthDate: dateCell(contact.birthDate),
            address: contact.address ?? undefined,
            addressNumber: contact.addressNumber ?? undefined,
            addressComplement: contact.addressComplement ?? undefined,
            neighborhood: contact.neighborhood ?? undefined,
            city: contact.city ?? undefined,
            state: contact.state ?? undefined,
            zipCode: contact.zipCode ?? undefined,
            tags: contact.tags.join(", "),
            responsavelId: contact.responsavelId ?? undefined,
            createdAt: dateCell(contact.createdAt),
            updatedAt: dateCell(contact.updatedAt),
          },
          display: { responsavelId: contact.responsavel?.name ?? "Sem responsável" },
          writeCheck: contactWriteCheck(role, contact.responsavelId),
        })),
      });
    }

    const where: Prisma.DealWhereInput = {
      organizationId: access.organizationId,
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { contact: { name: { contains: q, mode: "insensitive" } } },
              { owner: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: ids.length ? 0 : skip,
        take: ids.length ? ids.length : limit,
        select: {
          id: true,
          name: true,
          contactId: true,
          ownerId: true,
          status: true,
          value: true,
          grossValue: true,
          creditType: true,
          description: true,
          expectedCloseAt: true,
          startedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          contact: { select: { name: true } },
          owner: { select: { name: true } },
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
        },
      }),
      prisma.deal.count({ where }),
    ]);
    return NextResponse.json({
      entity,
      total,
      items: items.map((deal) => ({
        id: deal.id,
        label: deal.name,
        values: {
          __record: deal.id,
          name: deal.name,
          contactId: deal.contactId,
          ownerId: deal.ownerId,
          status: DEAL_STATUS_LABELS[deal.status as keyof typeof DEAL_STATUS_LABELS] ?? deal.status,
          value: numberCell(deal.value),
          grossValue: numberCell(deal.grossValue),
          creditType: deal.creditType ?? undefined,
          description: deal.description ?? undefined,
          expectedCloseAt: dateCell(deal.expectedCloseAt),
          pipelineName: deal.pipeline.name,
          stageName: deal.stage.name,
          startedAt: dateCell(deal.startedAt),
          closedAt: dateCell(deal.closedAt),
          createdAt: dateCell(deal.createdAt),
          updatedAt: dateCell(deal.updatedAt),
        },
        display: {
          contactId: deal.contact.name,
          ownerId: deal.owner.name,
        },
        // Negócio: a API do CRM confere carteira/equipe/co-responsável na hora do envio.
        writeCheck: "ok",
      })),
    });
  });
}
