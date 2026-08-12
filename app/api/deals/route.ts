import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireRole } from "@/lib/require-role";
import { getDealScope } from "@/lib/team-scope";
import { fetchDealsList, countDeals, aggregateDealValues } from "@/lib/deals/list-query";
import { buildDealName } from "@/lib/deal-name";
import { pickOwnerId } from "@/lib/auto-assign";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { runWithTenant } from "@/lib/tenant-context";
import { validateCustomFieldValues } from "@/lib/custom-fields";
import { recordUserChange } from "@/lib/user-activity";

export const dynamic = "force-dynamic";

const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 500;
const MAX_LIMIT = 500;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId") ?? undefined;
  const status = searchParams.get("status") as "OPEN" | "WON" | "LOST" | null;
  const q = searchParams.get("q") ?? undefined;
  const skipParam = Number(searchParams.get("skip"));
  const skip = Number.isFinite(skipParam) && skipParam > 0 ? skipParam : 0;
  const limitParam = Number(searchParams.get("limit"));
  const requestedLimit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : null;
  const take = Math.min(requestedLimit ?? (q ? DEFAULT_SEARCH_LIMIT : DEFAULT_LIST_LIMIT), MAX_LIMIT);

  // Filtros que hoje só existiam client-side em deals-list.tsx — "está numa
  // dessas ids" (ownerId aceita lista) cobre tanto "responsável X" quanto
  // "responsável ativo/inativo", já resolvido pelo cliente antes de mandar
  // (ver deals-list.tsx), sem precisar de um lookup extra aqui.
  const ownerIdParam = searchParams.get("ownerId");
  const ownerIds = ownerIdParam ? ownerIdParam.split(",").filter(Boolean) : undefined;
  const stageId = searchParams.get("stageId") ?? undefined;
  const lossReasonId = searchParams.get("lossReasonId") ?? undefined;
  const jobTitle = searchParams.get("jobTitle") ?? undefined;
  const source = searchParams.get("source") ?? undefined;
  const state = searchParams.get("state") ?? undefined;
  const city = searchParams.get("city") ?? undefined;
  const createdFrom = parseDate(searchParams.get("createdFrom"));
  const createdTo = parseDate(searchParams.get("createdTo"));
  const closedFrom = parseDate(searchParams.get("closedFrom"));
  const closedTo = parseDate(searchParams.get("closedTo"));
  const stageEnteredBefore = parseDate(searchParams.get("stageEnteredBefore"));
  const withoutProcess = searchParams.get("withoutProcess") === "1";
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const hasNoOpenTask = searchParams.get("hasNoOpenTask") === "1";
  const taskDueBefore = parseDate(searchParams.get("taskDueBefore"));
  const noValue = searchParams.get("noValue") === "1";
  const sortParam = searchParams.get("sort");
  const sort = sortParam === "value" || sortParam === "stale" || sortParam === "urgency" ? sortParam : undefined;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const filterParams = {
      organizationId: access.organizationId,
      pipelineId,
      scope,
      status: status ?? undefined,
      q,
      ownerIds,
      stageId,
      lossReasonId,
      jobTitle,
      source,
      state,
      city,
      createdFrom,
      createdTo,
      closedFrom,
      closedTo,
      stageEnteredBefore,
      withoutProcess,
      hasNoOpenTask: hasNoOpenTask || undefined,
      taskDueBefore,
      noValue: noValue || undefined,
    };

    const [deals, totalCount, sums] = await Promise.all([
      fetchDealsList({ ...filterParams, skip, take, sortDir, sort }),
      countDeals(filterParams),
      aggregateDealValues(filterParams),
    ]);

    return NextResponse.json(deals, {
      headers: {
        "X-Total-Count": String(totalCount),
        "X-Won-Sum": String(sums.wonSum),
        "X-Lost-Sum": String(sums.lostSum),
        "X-Total-Sum": String(sums.totalSum),
      },
    });
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const {
    pipelineId,
    stageId,
    contactId,
    ownerId,
    name,
    value,
    creditType,
    description,
    expectedCloseAt,
    customFieldValues,
  } = body as {
    pipelineId?: string;
    stageId?: string;
    contactId?: string;
    ownerId?: string;
    name?: string;
    value?: number;
    creditType?: string;
    description?: string;
    expectedCloseAt?: string;
    customFieldValues?: Record<string, unknown>;
  };

  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!pipelineId || !stageId || !contactId) {
    return NextResponse.json(
      { error: "pipelineId, stageId e contactId são obrigatórios" },
      { status: 400 },
    );
  }

  return runWithTenant(organizationId, async () => {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!contact) return NextResponse.json({ error: "Contato inválido" }, { status: 400 });

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: stageId, pipeline: { organizationId } },
    });
    if (!stage) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });

    if (ownerId) {
      const membership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      if (!membership) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });
    }

    const resolvedOwnerId = ownerId || (await pickOwnerId(organizationId, userId));

    const fieldDefs = await prisma.customFieldDefinition.findMany({
      where: { organizationId, entityType: "DEAL" },
    });
    let cleanCustomFieldValues;
    try {
      cleanCustomFieldValues = validateCustomFieldValues(fieldDefs, customFieldValues);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    const deal = await prisma.deal.create({
      data: {
        organizationId,
        pipelineId,
        stageId,
        contactId,
        ownerId: resolvedOwnerId,
        name: sanitizeCell(name?.trim() || buildDealName(contact.name, contact.source)),
        value,
        creditType: sanitizeCell(creditType),
        description: sanitizeCell(description),
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : undefined,
        customFieldValues: cleanCustomFieldValues,
      },
      include: { contact: true, owner: true, stage: true },
    });

    recordUserChange(organizationId, userId).catch((err) =>
      console.error("[user-activity] falha ao registrar alteração", err),
    );

    return NextResponse.json(deal, { status: 201 });
  });
}
