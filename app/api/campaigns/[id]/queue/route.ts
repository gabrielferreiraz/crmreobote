import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, campaignScopeWhere } from "@/lib/team-scope";
import { getClientIp, rateLimitOrResponse } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import {
  QUEUE_EDITABLE_STATUSES as EDITABLE_STATUSES,
  getCampaignQueue,
  moveCampaignQueueItem,
  removeCampaignQueueItem,
  reorderCampaignQueue,
  searchCampaignQueue,
} from "@/lib/campaigns/queue";

export const dynamic = "force-dynamic";

/** Uma janela da tela tem até ~500 linhas; folga pra não recusar um pedido legítimo. */
const MAX_REORDER_IDS = 1000;

/**
 * Só quem GERENCIA a campanha (criou, é dono do WhatsApp dela ou é o Dono da
 * conta — campaignScopeWhere) vê e edita a fila. Quem só enxerga um envio em
 * massa por ter parte dos destinatários no próprio WhatsApp cai no mesmo 404
 * de "não existe": a fila mostra e reordena a campanha INTEIRA, inclusive os
 * leads dos outros consultores.
 */
async function authorize(id: string) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return { ok: false as const, response: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };

  const scope = await getDealScope(access.organizationId, access.userId, access.role);
  const campaign = await runWithTenant(access.organizationId, () =>
    prisma.campaign.findFirst({
      where: { id, organizationId: access.organizationId, ...campaignScopeWhere(scope) },
      select: { id: true, name: true, status: true },
    }),
  );
  if (!campaign) return { ok: false as const, response: NextResponse.json({ error: "Não encontrada" }, { status: 404 }) };

  return { ok: true as const, access, campaign };
}

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * A fila numa página (`?offset=&limit=`) — com o horário previsto de cada um e
 * o resumo da próxima hora — ou, com `?q=`, a busca por nome/telefone dentro
 * dela (pra achar quem está lá no fundo de uma fila de milhares).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;
  const { access } = auth;

  const limited = rateLimitOrResponse(`campaign-queue-read:${access.organizationId}:${access.userId}`, 120, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const q = url.searchParams.get("q");

  return runWithTenant(access.organizationId, async () => {
    if (q !== null) {
      const results = await searchCampaignQueue(access.organizationId, id, q);
      if (results === null) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
      return NextResponse.json({ results });
    }

    const view = await getCampaignQueue(access.organizationId, id, {
      offset: positiveInt(url.searchParams.get("offset"), 0),
      limit: positiveInt(url.searchParams.get("limit"), 100) || 100,
    });
    if (!view) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    return NextResponse.json({ ...view, canEdit: EDITABLE_STATUSES.includes(view.status) });
  });
}

/**
 * Salva a nova ordem de uma JANELA da fila (o que a pessoa arrastou na tela):
 * `{ ids: [...] }` na ordem desejada. Quem está fora da janela não muda de
 * lugar, e quem já foi enviado no meio-tempo é ignorado (a fila anda sozinha
 * enquanto se arrasta) — ver reassignWindowPositions em lib/campaigns/queue-order.ts.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;
  const { access, campaign } = auth;

  const limited = rateLimitOrResponse(`campaign-queue-write:${access.organizationId}`, 60, 60_000);
  if (limited) return limited;

  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return NextResponse.json({ error: "Campanha encerrada — não há mais fila pra reordenar." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_REORDER_IDS || !ids.every((v) => typeof v === "string" && v.length > 0)) {
    return NextResponse.json({ error: `Envie de 1 a ${MAX_REORDER_IDS} ids na ordem desejada.` }, { status: 400 });
  }

  const result = await reorderCampaignQueue(access.organizationId, id, ids as string[]);

  if (result.changed > 0) {
    logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session?.user.name ?? access.session?.user.email ?? "?",
      action: "CAMPAIGN_QUEUE_REORDERED",
      targetType: "Campaign",
      targetId: id,
      detail: `${campaign.name} — ${result.changed} contato(s) reposicionado(s) na fila`,
      ip: getClientIp(req),
    }).catch((err) => console.error("[audit-log] falha ao registrar CAMPAIGN_QUEUE_REORDERED", err));
  }

  return NextResponse.json({ ok: true, ...result });
}

/** Move ou remove uma pessoa pendente da fila inteira. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;
  const { access, campaign } = auth;

  const limited = rateLimitOrResponse(`campaign-queue-write:${access.organizationId}`, 60, 60_000);
  if (limited) return limited;

  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return NextResponse.json({ error: "Campanha encerrada — não há mais fila pra reordenar." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; to?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  if (body.action === "remove") {
    const result = await removeCampaignQueueItem(access.organizationId, id, body.id);
    if (result.removed) {
      logAudit({
        organizationId: access.organizationId,
        actorUserId: access.userId,
        actorName: access.session?.user.name ?? access.session?.user.email ?? "?",
        action: "CAMPAIGN_RECIPIENT_REMOVED",
        targetType: "CampaignRecipient",
        targetId: body.id,
        detail: `${campaign.name} — 1 contato removido da fila`,
        ip: getClientIp(req),
      }).catch((err) => console.error("[audit-log] falha ao registrar CAMPAIGN_RECIPIENT_REMOVED", err));
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action !== "move" || (body.to !== "top" && body.to !== "bottom")) {
    return NextResponse.json({ error: 'Pedido inválido — use { action: "move", id, to: "top" | "bottom" } ou { action: "remove", id }.' }, { status: 400 });
  }

  const result = await moveCampaignQueueItem(access.organizationId, id, body.id, body.to);

  if (result.moved) {
    logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session?.user.name ?? access.session?.user.email ?? "?",
      action: "CAMPAIGN_QUEUE_REORDERED",
      targetType: "Campaign",
      targetId: id,
      detail: `${campaign.name} — 1 contato movido pro ${body.to === "top" ? "início" : "fim"} da fila`,
      ip: getClientIp(req),
    }).catch((err) => console.error("[audit-log] falha ao registrar CAMPAIGN_QUEUE_REORDERED", err));
  }

  return NextResponse.json({ ok: true, ...result });
}
