import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

// Mesmos limites de lib/campaigns/build.ts — sem eles um valor absurdo
// desliga na prática a proteção anti-ban da engine de campanhas.
const MIN_DELAY_SEC = 10;
const MAX_DELAY_SEC = 3600;
const DEFAULT_DELAY_MIN_SEC = 50;
const DEFAULT_DELAY_MAX_SEC = 120;
const MAX_DEALS_PER_SEND = 2000;

// Isolado numa constante — hoje só Supervisor+, o usuário sinalizou que
// pode querer abrir pra Membro (consultor) mais pra frente.
const ALLOWED_ROLES = ["OWNER", "MANAGER", "SUPERVISOR"] as const;

export async function POST(req: Request) {
  const body = await req.json();
  const { dealIds, scriptId, delayMinSec, delayMaxSec } = body as {
    dealIds?: string[];
    scriptId?: string;
    delayMinSec?: number;
    delayMaxSec?: number;
  };

  const access = await requireRole([...ALLOWED_ROLES]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  if (!Array.isArray(dealIds) || dealIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um negócio" }, { status: 400 });
  }
  if (dealIds.length > MAX_DEALS_PER_SEND) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_DEALS_PER_SEND} negócios por envio — selecione menos de uma vez` },
      { status: 400 },
    );
  }
  if (!scriptId) return NextResponse.json({ error: "Selecione um script" }, { status: 400 });

  let resolvedDelayMinSec = DEFAULT_DELAY_MIN_SEC;
  let resolvedDelayMaxSec = DEFAULT_DELAY_MAX_SEC;
  if (delayMinSec !== undefined || delayMaxSec !== undefined) {
    resolvedDelayMinSec = delayMinSec ?? DEFAULT_DELAY_MIN_SEC;
    resolvedDelayMaxSec = delayMaxSec ?? DEFAULT_DELAY_MAX_SEC;
    if (
      !Number.isInteger(resolvedDelayMinSec) ||
      resolvedDelayMinSec < MIN_DELAY_SEC ||
      resolvedDelayMinSec > MAX_DELAY_SEC
    ) {
      return NextResponse.json(
        { error: `Delay mínimo precisa estar entre ${MIN_DELAY_SEC} e ${MAX_DELAY_SEC} segundos` },
        { status: 400 },
      );
    }
    if (!Number.isInteger(resolvedDelayMaxSec) || resolvedDelayMaxSec < resolvedDelayMinSec || resolvedDelayMaxSec > MAX_DELAY_SEC) {
      return NextResponse.json(
        { error: "Delay máximo precisa ser maior ou igual ao mínimo (e no máximo 1h)" },
        { status: 400 },
      );
    }
  }

  return runWithTenant(organizationId, async () => {
    // Privado por consultor: um script só pode ser usado por quem o criou —
    // reforça no backend o que o picker já filtra (ver GET
    // /api/message-scripts?mine=true), nunca confia só na UI.
    const script = await prisma.messageScript.findFirst({
      where: { id: scriptId, organizationId, createdById: userId },
      select: { id: true, steps: true },
    });
    if (!script) return NextResponse.json({ error: "Script inválido" }, { status: 400 });

    // Nunca confia na seleção vinda do cliente — revalida contra o escopo
    // de negócios que este usuário de fato enxerga (mesmo padrão de toda
    // rota de negócio, ver lib/team-scope.ts).
    const scope = await getDealScope(organizationId, userId, role);
    const deals = await prisma.deal.findMany({
      where: { id: { in: dealIds }, organizationId, ...scopeWhere(scope) },
      include: { contact: true, owner: { select: { id: true, name: true } } },
    });

    if (deals.length === 0) {
      return NextResponse.json({ error: "Nenhum negócio válido nessa seleção" }, { status: 400 });
    }

    const ownerIds = Array.from(new Set(deals.map((d) => d.owner.id)));
    const instances = await prisma.whatsAppInstance.findMany({
      where: { organizationId, userId: { in: ownerIds }, status: "CONNECTED" },
      select: { id: true, userId: true },
    });
    const instanceByOwnerId = new Map(instances.map((i) => [i.userId, i.id]));

    type PendingRecipient = { contactId: string; dealId: string; instanceId: string };
    const pending: PendingRecipient[] = [];
    let skippedNoPhone = 0;
    let skippedNoInstance = 0;

    for (const deal of deals) {
      const phoneNormalized = normalizePhoneNumber(deal.contact.whatsapp || deal.contact.phone);
      if (!phoneNormalized) {
        skippedNoPhone += 1;
        continue;
      }
      const instanceId = instanceByOwnerId.get(deal.owner.id);
      if (!instanceId) {
        skippedNoInstance += 1;
        continue;
      }
      pending.push({ contactId: deal.contactId, dealId: deal.id, instanceId });
    }

    if (pending.length === 0) {
      return NextResponse.json({
        campaignId: null,
        queued: 0,
        skippedNoPhone,
        skippedNoInstance,
        skippedDuplicateContact: 0,
      });
    }

    // Um mesmo contato pode aparecer em 2 negócios selecionados — só a
    // primeira ocorrência vira destinatário (CampaignRecipient é único por
    // contato dentro da campanha), as demais contam como duplicata.
    const seenContactIds = new Set<string>();
    const recipientsData: { contactId: string; dealId: string; instanceId: string }[] = [];
    let skippedDuplicateContact = 0;
    for (const p of pending) {
      if (seenContactIds.has(p.contactId)) {
        skippedDuplicateContact += 1;
        continue;
      }
      seenContactIds.add(p.contactId);
      recipientsData.push(p);
    }

    const now = new Date();
    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        name: `Envio em massa · ${access.session.user.name ?? "Consultor"} · ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        status: "RUNNING",
        source: "PIPELINE_BULK",
        messageTemplates: [{ steps: script.steps, weight: 1, scriptId: script.id }] as unknown as Prisma.InputJsonValue,
        audienceFilter: { jobTitles: [], tags: [], cities: [] } as unknown as Prisma.InputJsonValue,
        // Obrigatório no schema, mas não usado de fato pra PIPELINE_BULK —
        // cada destinatário carrega a própria instanceId (ver acima).
        instanceId: recipientsData[0].instanceId,
        delayMinSec: resolvedDelayMinSec,
        delayMaxSec: resolvedDelayMaxSec,
        createdById: userId,
      },
    });

    await prisma.campaignRecipient.createMany({
      data: recipientsData.map((r) => ({
        campaignId: campaign.id,
        contactId: r.contactId,
        dealId: r.dealId,
        instanceId: r.instanceId,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({
      campaignId: campaign.id,
      queued: recipientsData.length,
      skippedNoPhone,
      skippedNoInstance,
      skippedDuplicateContact,
    });
  });
}
