import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { runWithTenant } from "@/lib/tenant-context";
import { findMissingRequiredFields, labelForRequiredField } from "@/lib/deal-required-fields";
import { brazilDateStringWithNowTimeToUTC } from "@/lib/timezone";
import { recordUserChange } from "@/lib/user-activity";
import { recordUndoableAction } from "@/lib/undo/record";
import type { BulkUpdateGroup, BulkUpdatePayload } from "@/lib/undo/types";

export const dynamic = "force-dynamic";

/**
 * Ações em massa do Pipeline (Kanban e Lista) numa requisição só.
 *
 * Por que esta rota existe: antes, cada ação em massa disparava UMA
 * requisição HTTP por negócio (`Promise.all(ids.map(fetch))`, ver
 * deals-list.tsx), e cada PATCH /api/deals/[id]/move faz ~10 consultas,
 * cada uma na própria transação de RLS (ver withTenantRls em
 * lib/prisma.ts). Com os 200 da página da Lista já eram ~2.000 consultas
 * simultâneas; com "selecionar todos da etapa" no Kanban (etapas reais
 * passam de 5.000 negócios) passaria de 50.000 — o mesmo pool que já
 * estourou timeout de 15s antes (ver comentário em pipeline/page.tsx).
 * Aqui o custo é um punhado de consultas, independente de serem 10 ou
 * 5.000 negócios: uma busca, um `updateMany`, um `createMany` de
 * atividades e um registro de desfazer.
 *
 * Escopo SEMPRE revalidado no servidor: a lista de ids que chega é só uma
 * intenção — o `where` abaixo intersecta com o que o papel de quem chamou
 * enxerga de verdade (getSharedScope/scopeWhere), então mandar id de
 * negócio alheio na mão simplesmente não acha a linha. Mesmo desenho já
 * usado em /api/deals/bulk-send-message.
 *
 * FORA daqui de propósito:
 * - Apagar em massa continua no caminho antigo (uma requisição por
 *   negócio, só Dono/Gerente, teto da página) — o desfazer de exclusão
 *   guarda snapshot completo de cada linha, formato que não cabe no
 *   agrupamento deste arquivo, e apagar milhares é risco de outra
 *   categoria.
 * - Evento de conversão da Meta em "marcar como ganho" (ver
 *   notifyMetaConversionWon): é 1 chamada HTTP externa POR negócio, e
 *   marcar 5.000 negócios antigos como ganhos dispararia 5.000 "Purchase"
 *   carimbados com a data de HOJE na Conversions API — isso não é uma
 *   conversão acontecendo agora, é arrumação de base, e sujaria a
 *   atribuição de anúncio. Continua valendo normalmente no ganho
 *   individual (PUT /api/deals/[id]), que é o caso real.
 * - Webhooks deal.won/deal.lost, pelo mesmo motivo: a fila de entrega
 *   tentaria (com retentativa) milhares de POSTs num endpoint de terceiro
 *   por causa de uma arrumação interna.
 * As duas exceções acima são decisão de produto, não limitação técnica —
 * se um dia precisar, dá pra enfileirar em lote (uma consulta de
 * assinaturas + um createMany).
 */

const MAX_DEALS_PER_BULK = 10000;

type BulkAction = "move" | "status" | "owner" | "source";

type Body = {
  dealIds?: string[];
  action?: BulkAction;
  /** action "move" */
  stageId?: string;
  pipelineId?: string;
  /** action "status" */
  status?: "WON" | "LOST" | "OPEN";
  closedAt?: string;
  lossReasonId?: string;
  /** Observação livre do motivo de perda (o mesmo campo do negócio individual) — aplicada igual em todos os selecionados. */
  lostReason?: string;
  /** action "owner" */
  ownerId?: string;
  /** action "source" — mora em Contact.source, não no negócio (ver abaixo) */
  source?: string;
};

/**
 * Agrupa "quem voltou de onde" pro desfazer: negócios que tinham o MESMO
 * estado anterior viram um grupo só, revertido depois com um `updateMany`
 * (ver BulkUpdatePayload/revertBulkUpdate em lib/undo/). Numa troca de
 * etapa em massa isso costuma colapsar milhares de negócios em poucas
 * entradas — "de quais etapas eles vieram".
 */
function groupByPreviousValues(
  model: BulkUpdateGroup["model"],
  rows: { id: string; previousValues: Record<string, unknown> }[],
): BulkUpdateGroup[] {
  const byKey = new Map<string, BulkUpdateGroup>();
  for (const row of rows) {
    const key = JSON.stringify(row.previousValues);
    const found = byKey.get(key);
    if (found) found.entityIds.push(row.id);
    else byKey.set(key, { model, previousValues: row.previousValues, entityIds: [row.id] });
  }
  return Array.from(byKey.values());
}

function plural(count: number, singular: string, pluralWord: string) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { dealIds, action } = body;

  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um negócio" }, { status: 400 });
  }
  if (dealIds.length > MAX_DEALS_PER_BULK) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_DEALS_PER_BULK} negócios por ação — selecione menos de uma vez` },
      { status: 400 },
    );
  }
  if (action !== "move" && action !== "status" && action !== "owner" && action !== "source") {
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  const uniqueIds = Array.from(new Set(dealIds));

  return runWithTenant(organizationId, async () => {
    // Colaborativo (mesmo escopo do PATCH/PUT individual): quem compartilha
    // o negócio via grupo também age como coautor.
    const scope = await getSharedScope(organizationId, userId, role, "shareDeals");
    const scopedWhere = { id: { in: uniqueIds }, organizationId, ...scopeWhere(scope) };

    switch (action) {
      case "move":
        return bulkMove({ body, scopedWhere, organizationId, userId });
      case "status":
        return bulkStatus({ body, scopedWhere, organizationId, userId });
      case "owner":
        return bulkOwner({ body, scopedWhere, organizationId, userId });
      case "source":
        return bulkSource({ body, scopedWhere, organizationId, userId });
    }
  });
}

type Ctx = {
  body: Body;
  scopedWhere: Record<string, unknown>;
  organizationId: string;
  userId: string;
};

/** Trocar de etapa (mesmo funil) ou de funil (vai pra 1ª etapa do destino, igual à Lista já fazia). */
async function bulkMove({ body, scopedWhere, organizationId, userId }: Ctx) {
  const { stageId, pipelineId } = body;
  if (!stageId) return NextResponse.json({ error: "stageId é obrigatório" }, { status: 400 });

  const stage = await prisma.pipelineStage.findFirst({
    where: { id: stageId, ...(pipelineId ? { pipelineId } : {}), pipeline: { organizationId } },
    select: { id: true, name: true, pipelineId: true, requiredFields: true },
  });
  if (!stage) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });

  const deals = await prisma.deal.findMany({
    where: scopedWhere,
    select: {
      id: true,
      stageId: true,
      pipelineId: true,
      stageEnteredAt: true,
      value: true,
      grossValue: true,
      creditType: true,
      expectedCloseAt: true,
      contact: { select: { source: true, jobTitle: true } },
    },
  });
  if (deals.length === 0) return NextResponse.json({ error: "Nenhum negócio encontrado" }, { status: 404 });

  // Mesma validação por negócio do PATCH individual — uma etapa pode exigir
  // valor/tipo de crédito/previsão, e negócio sem esses campos não pode
  // avançar. Aqui a validação roda em memória (os campos já vieram na busca
  // acima), então continua sendo consulta nenhuma a mais: só separa quem
  // pode de quem não pode e reporta a contagem.
  const movable: typeof deals = [];
  const blockedFields = new Set<string>();
  for (const deal of deals) {
    const missing = findMissingRequiredFields(stage.requiredFields, {
      value: deal.value,
      grossValue: deal.grossValue,
      creditType: deal.creditType,
      expectedCloseAt: deal.expectedCloseAt,
      contactSource: deal.contact.source,
      contactJobTitle: deal.contact.jobTitle,
    });
    if (missing.length === 0) movable.push(deal);
    else for (const field of missing) blockedFields.add(labelForRequiredField(field));
  }

  // Já está exatamente onde a ação quer colocar — nada a fazer, e não pode
  // virar registro de desfazer "vazio" nem atividade na timeline.
  const changed = movable.filter((d) => d.stageId !== stage.id || d.pipelineId !== stage.pipelineId);
  const skipped = deals.length - changed.length;

  if (changed.length === 0) {
    return NextResponse.json({
      updated: 0,
      skipped,
      skippedReason: blockedFields.size > 0 ? `Faltam campos obrigatórios da etapa: ${Array.from(blockedFields).join(", ")}` : null,
    });
  }

  const changedIds = changed.map((d) => d.id);
  const now = new Date();
  await prisma.deal.updateMany({
    where: { id: { in: changedIds } },
    data: { pipelineId: stage.pipelineId, stageId: stage.id, stageEnteredAt: now },
  });

  // Timeline: uma atividade por negócio, mas num createMany só. Nome da
  // etapa de origem resolvido com UMA consulta pras etapas distintas —
  // nunca uma por negócio.
  const originStageIds = Array.from(new Set(changed.map((d) => d.stageId)));
  const originStages = await prisma.pipelineStage.findMany({
    where: { id: { in: originStageIds } },
    select: { id: true, name: true },
  });
  const stageNameById = new Map(originStages.map((s) => [s.id, s.name]));
  await prisma.activity.createMany({
    data: changed.map((deal) => ({
      organizationId,
      dealId: deal.id,
      userId,
      type: "SYSTEM" as const,
      body: `moveu o negócio de ${stageNameById.get(deal.stageId) ?? "—"} para ${stage.name} (ação em massa)`,
    })),
  });

  const undo = await recordBulkUndo({
    organizationId,
    userId,
    groups: groupByPreviousValues(
      "deal",
      changed.map((d) => ({
        id: d.id,
        previousValues: { pipelineId: d.pipelineId, stageId: d.stageId, stageEnteredAt: d.stageEnteredAt },
      })),
    ),
    original: `${plural(changed.length, "negócio movido", "negócios movidos")} para ${stage.name}`,
    afterRevert: `${plural(changed.length, "negócio voltou", "negócios voltaram")} pra etapa anterior`,
  });

  recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

  return NextResponse.json({
    updated: changed.length,
    skipped,
    skippedReason: blockedFields.size > 0 ? `Faltam campos obrigatórios da etapa: ${Array.from(blockedFields).join(", ")}` : null,
    undo,
  });
}

/** Marcar ganho/perdido (ou reabrir) em massa. */
async function bulkStatus({ body, scopedWhere, organizationId, userId }: Ctx) {
  const { status, closedAt: closedAtInput, lossReasonId, lostReason } = body;
  if (status !== "WON" && status !== "LOST" && status !== "OPEN") {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  let lossReasonLabel: string | null = null;
  if (status === "LOST") {
    if (!lossReasonId) return NextResponse.json({ error: "Selecione um motivo de perda" }, { status: 400 });
    const reason = await prisma.lossReason.findFirst({ where: { id: lossReasonId, organizationId }, select: { label: true } });
    if (!reason) return NextResponse.json({ error: "Motivo de perda inválido" }, { status: 400 });
    lossReasonLabel = reason.label;
  }

  // Mesma regra do PUT individual: fechamento carimba closedAt em QUALQUER
  // transição de verdade pra WON/LOST, não só vindo de "Em andamento" —
  // senão o negócio some dos relatórios filtrados por data de fechamento.
  let closedAt: Date | null = null;
  if (status !== "OPEN") {
    if (closedAtInput) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(closedAtInput)) return NextResponse.json({ error: "Data inválida" }, { status: 400 });
      closedAt = brazilDateStringWithNowTimeToUTC(closedAtInput);
      if (isNaN(closedAt.getTime())) return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    } else {
      closedAt = new Date();
    }
  }

  const deals = await prisma.deal.findMany({
    where: scopedWhere,
    select: { id: true, status: true, closedAt: true, lossReasonId: true, lostReason: true },
  });
  if (deals.length === 0) return NextResponse.json({ error: "Nenhum negócio encontrado" }, { status: 404 });

  const changed = deals.filter((d) => d.status !== status);
  const skipped = deals.length - changed.length;
  if (changed.length === 0) {
    return NextResponse.json({ updated: 0, skipped, skippedReason: "Já estavam nesse status" });
  }

  const changedIds = changed.map((d) => d.id);
  await prisma.deal.updateMany({
    where: { id: { in: changedIds } },
    data: {
      status,
      ...(status === "LOST" ? { lossReasonId, ...(lostReason ? { lostReason } : {}) } : {}),
      // Reabrir limpa o fechamento — senão o negócio volta pra "Em
      // andamento" carregando uma data de fechamento antiga que ainda
      // apareceria em relatório por período.
      ...(status === "OPEN" ? { closedAt: null, lossReasonId: null } : { closedAt }),
    },
  });

  const label =
    status === "WON"
      ? "marcou o negócio como ganho (ação em massa)"
      : status === "LOST"
        ? `marcou o negócio como perdido${lossReasonLabel ? ` · ${lossReasonLabel}` : ""} (ação em massa)`
        : "reabriu o negócio (ação em massa)";
  await prisma.activity.createMany({
    data: changedIds.map((dealId) => ({ organizationId, dealId, userId, type: "SYSTEM" as const, body: label })),
  });

  const statusWord = status === "WON" ? "ganho" : status === "LOST" ? "perdido" : "reaberto";
  const undo = await recordBulkUndo({
    organizationId,
    userId,
    groups: groupByPreviousValues(
      "deal",
      changed.map((d) => ({
        id: d.id,
        previousValues: { status: d.status, closedAt: d.closedAt, lossReasonId: d.lossReasonId, lostReason: d.lostReason },
      })),
    ),
    original: `${plural(changed.length, "negócio marcado", "negócios marcados")} como ${statusWord}`,
    afterRevert: `${plural(changed.length, "negócio voltou", "negócios voltaram")} pro status anterior`,
  });

  recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

  return NextResponse.json({ updated: changed.length, skipped, skippedReason: skipped > 0 ? "Já estavam nesse status" : null, undo });
}

/** Trocar responsável — sincroniza Contact.responsavelId junto, igual ao PUT individual. */
async function bulkOwner({ body, scopedWhere, organizationId, userId }: Ctx) {
  const { ownerId } = body;
  if (!ownerId) return NextResponse.json({ error: "Selecione um responsável" }, { status: 400 });

  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId, userId: ownerId, active: true },
    select: { userId: true },
  });
  if (!membership) return NextResponse.json({ error: "Responsável inválido" }, { status: 400 });

  const deals = await prisma.deal.findMany({
    where: scopedWhere,
    select: { id: true, ownerId: true, contactId: true, contact: { select: { responsavelId: true } } },
  });
  if (deals.length === 0) return NextResponse.json({ error: "Nenhum negócio encontrado" }, { status: 404 });

  const changed = deals.filter((d) => d.ownerId !== ownerId);
  const skipped = deals.length - changed.length;
  if (changed.length === 0) {
    return NextResponse.json({ updated: 0, skipped, skippedReason: "Já eram desse responsável" });
  }

  await prisma.deal.updateMany({ where: { id: { in: changed.map((d) => d.id) } }, data: { ownerId } });

  // Mesma sincronização (e mesmo efeito colateral já documentado) do PUT
  // individual: o responsável do CONTATO acompanha o dono do negócio.
  const contactsToSync = changed.filter((d) => d.contact.responsavelId !== ownerId);
  const contactIds = Array.from(new Set(contactsToSync.map((d) => d.contactId)));
  if (contactIds.length > 0) {
    await prisma.contact.updateMany({ where: { id: { in: contactIds } }, data: { responsavelId: ownerId } });
  }

  // Desfazer cobre os dois lados juntos (negócio + contato) — reverter só o
  // negócio reintroduziria a inconsistência que a sincronização evita.
  const groups = [
    ...groupByPreviousValues(
      "deal",
      changed.map((d) => ({ id: d.id, previousValues: { ownerId: d.ownerId } })),
    ),
    ...groupByPreviousValues(
      "contact",
      Array.from(new Map(contactsToSync.map((d) => [d.contactId, d])).values()).map((d) => ({
        id: d.contactId,
        previousValues: { responsavelId: d.contact.responsavelId },
      })),
    ),
  ];

  const undo = await recordBulkUndo({
    organizationId,
    userId,
    groups,
    original: `${plural(changed.length, "negócio reatribuído", "negócios reatribuídos")}`,
    afterRevert: `${plural(changed.length, "negócio voltou", "negócios voltaram")} pro responsável anterior`,
  });

  recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

  return NextResponse.json({ updated: changed.length, skipped, skippedReason: skipped > 0 ? "Já eram desse responsável" : null, undo });
}

/**
 * Trocar a origem. ATENÇÃO: origem não é campo do negócio — mora em
 * Contact.source (é por isso que etapa que "exige origem" valida
 * contactSource, ver lib/deal-required-fields.ts). Então isto altera o
 * CLIENTE vinculado, não só aquele negócio: se o mesmo cliente tiver dois
 * negócios selecionados, ele é contado uma vez só, e a origem nova também
 * passa a valer pros outros negócios dele que nem estavam na seleção. A
 * interface avisa isso antes de aplicar (ver deal-bulk-actions.tsx).
 */
async function bulkSource({ body, scopedWhere, organizationId, userId }: Ctx) {
  const source = body.source?.trim();
  if (!source) return NextResponse.json({ error: "Selecione uma origem" }, { status: 400 });

  const deals = await prisma.deal.findMany({
    where: scopedWhere,
    select: { contactId: true, contact: { select: { source: true } } },
  });
  if (deals.length === 0) return NextResponse.json({ error: "Nenhum negócio encontrado" }, { status: 404 });

  // Um contato por vez, mesmo aparecendo em vários negócios selecionados.
  const byContact = new Map(deals.map((d) => [d.contactId, d.contact.source]));
  const toChange = Array.from(byContact.entries()).filter(([, current]) => current !== source);
  if (toChange.length === 0) {
    return NextResponse.json({ updated: 0, skipped: byContact.size, skippedReason: "Já eram dessa origem" });
  }

  await prisma.contact.updateMany({ where: { id: { in: toChange.map(([id]) => id) } }, data: { source } });

  const undo = await recordBulkUndo({
    organizationId,
    userId,
    groups: groupByPreviousValues(
      "contact",
      toChange.map(([id, previousSource]) => ({ id, previousValues: { source: previousSource } })),
    ),
    original: `Origem de ${plural(toChange.length, "cliente alterada", "clientes alterada")} para ${source}`,
    afterRevert: `Origem de ${plural(toChange.length, "cliente voltou", "clientes voltou")} pro valor anterior`,
  });

  recordUserChange(organizationId, userId).catch((err) => console.error("[user-activity] falha ao registrar alteração", err));

  return NextResponse.json({
    updated: toChange.length,
    skipped: byContact.size - toChange.length,
    skippedReason: byContact.size - toChange.length > 0 ? "Já eram dessa origem" : null,
    undo,
  });
}

async function recordBulkUndo(params: {
  organizationId: string;
  userId: string;
  groups: BulkUpdateGroup[];
  original: string;
  afterRevert: string;
}) {
  if (params.groups.length === 0) return undefined;
  return recordUndoableAction({
    organizationId: params.organizationId,
    userId: params.userId,
    type: "deal.bulkUpdate",
    description: params.original,
    payload: {
      groups: params.groups,
      descriptions: { afterRevert: params.afterRevert, original: params.original },
    } satisfies BulkUpdatePayload,
  });
}
