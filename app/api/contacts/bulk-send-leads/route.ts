import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

// Mesmos limites de lib/campaigns/build.ts / bulk-send-message — sem eles um
// valor absurdo desliga na prática a proteção anti-ban da engine de campanhas.
const MIN_DELAY_SEC = 10;
const MAX_DELAY_SEC = 3600;
const DEFAULT_DELAY_MIN_SEC = 80;
const DEFAULT_DELAY_MAX_SEC = 1220;
const MIN_NO_REPLY_DAYS = 1;
const MAX_NO_REPLY_DAYS = 90;
const MAX_RMKT_WAVES = 10;
const MAX_CONTACTS_PER_SEND = 2000;

type RmktWaveInput = { dayOffset: number; scriptId: string };

export async function POST(req: Request) {
  const body = await req.json();
  const {
    contactIds,
    scriptId,
    rmktEnabled,
    rmktWaves,
    noReplyDays,
    targetPipelineId,
    targetStageId,
    delayMinSec,
    delayMaxSec,
  } = body as {
    contactIds?: string[];
    scriptId?: string;
    rmktEnabled?: boolean;
    rmktWaves?: RmktWaveInput[];
    noReplyDays?: number;
    targetPipelineId?: string;
    targetStageId?: string;
    delayMinSec?: number;
    delayMaxSec?: number;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId } = access;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um contato" }, { status: 400 });
  }
  if (contactIds.length > MAX_CONTACTS_PER_SEND) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_CONTACTS_PER_SEND} contatos por envio — selecione menos de uma vez` },
      { status: 400 },
    );
  }
  if (!scriptId) return NextResponse.json({ error: "Selecione um script inicial" }, { status: 400 });
  if (!targetPipelineId || !targetStageId) {
    return NextResponse.json({ error: "Selecione o pipeline e a etapa de destino" }, { status: 400 });
  }

  const resolvedNoReplyDays = noReplyDays ?? 3;
  if (!Number.isInteger(resolvedNoReplyDays) || resolvedNoReplyDays < MIN_NO_REPLY_DAYS || resolvedNoReplyDays > MAX_NO_REPLY_DAYS) {
    return NextResponse.json(
      { error: `Prazo pra considerar "não respondeu" precisa estar entre ${MIN_NO_REPLY_DAYS} e ${MAX_NO_REPLY_DAYS} dias` },
      { status: 400 },
    );
  }

  const waves = rmktEnabled ? (rmktWaves ?? []) : [];
  if (rmktEnabled) {
    if (waves.length === 0) return NextResponse.json({ error: "Adicione ao menos uma onda de RMKT" }, { status: 400 });
    if (waves.length > MAX_RMKT_WAVES) {
      return NextResponse.json({ error: `Máximo de ${MAX_RMKT_WAVES} ondas de RMKT` }, { status: 400 });
    }
    let previousDayOffset = 0;
    for (const wave of waves) {
      if (!Number.isInteger(wave.dayOffset) || wave.dayOffset <= previousDayOffset) {
        return NextResponse.json(
          { error: "Os dias das ondas de RMKT precisam ser crescentes (cada onda depois da anterior)" },
          { status: 400 },
        );
      }
      if (wave.dayOffset >= resolvedNoReplyDays) {
        return NextResponse.json(
          { error: `Cada onda precisa cair antes do prazo de "não respondeu" (${resolvedNoReplyDays} dias)` },
          { status: 400 },
        );
      }
      if (!wave.scriptId) return NextResponse.json({ error: "Selecione um script pra cada onda de RMKT" }, { status: 400 });
      previousDayOffset = wave.dayOffset;
    }
  }

  let resolvedDelayMinSec = DEFAULT_DELAY_MIN_SEC;
  let resolvedDelayMaxSec = DEFAULT_DELAY_MAX_SEC;
  if (delayMinSec !== undefined || delayMaxSec !== undefined) {
    resolvedDelayMinSec = delayMinSec ?? DEFAULT_DELAY_MIN_SEC;
    resolvedDelayMaxSec = delayMaxSec ?? DEFAULT_DELAY_MAX_SEC;
    if (!Number.isInteger(resolvedDelayMinSec) || resolvedDelayMinSec < MIN_DELAY_SEC || resolvedDelayMinSec > MAX_DELAY_SEC) {
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
    const instance = await resolveConnectedInstance(organizationId, userId);
    if (!instance || instance.status !== "CONNECTED") {
      return NextResponse.json({ error: "Conecte seu WhatsApp antes de enviar" }, { status: 400 });
    }

    const stage = await prisma.pipelineStage.findFirst({
      where: { id: targetStageId, pipelineId: targetPipelineId, pipeline: { organizationId } },
    });
    if (!stage) return NextResponse.json({ error: "Pipeline/etapa de destino inválidos" }, { status: 400 });

    // Privado por consultor: um script só pode ser usado por quem o criou —
    // mesma regra de bulk-send-message.
    const allScriptIds = Array.from(new Set([scriptId, ...waves.map((w) => w.scriptId)]));
    const scriptRows = await prisma.messageScript.findMany({
      where: { id: { in: allScriptIds }, organizationId, createdById: userId },
      select: { id: true, steps: true },
    });
    const stepsByScriptId = new Map(scriptRows.map((s) => [s.id, s.steps]));
    if (!stepsByScriptId.has(scriptId)) return NextResponse.json({ error: "Script inicial inválido" }, { status: 400 });
    for (const wave of waves) {
      if (!stepsByScriptId.has(wave.scriptId)) {
        return NextResponse.json({ error: "Script de uma das ondas de RMKT é inválido" }, { status: 400 });
      }
    }

    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds }, organizationId },
      select: { id: true, whatsapp: true, phone: true },
    });
    if (contacts.length === 0) {
      return NextResponse.json({ error: "Nenhum contato válido nessa seleção" }, { status: 400 });
    }

    let skippedNoPhone = 0;
    const recipientContactIds: string[] = [];
    for (const contact of contacts) {
      if (!normalizePhoneNumber(contact.whatsapp || contact.phone)) {
        skippedNoPhone += 1;
        continue;
      }
      recipientContactIds.push(contact.id);
    }

    if (recipientContactIds.length === 0) {
      return NextResponse.json({ campaignId: null, queued: 0, skippedNoPhone });
    }

    const now = new Date();
    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        name: `Prospecção · ${access.session.user.name ?? "Consultor"} · ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
        status: "RUNNING",
        source: "LEAD_CAPTURE",
        messageTemplates: [{ steps: stepsByScriptId.get(scriptId), weight: 1, scriptId }] as unknown as Prisma.InputJsonValue,
        audienceFilter: { jobTitles: [], tags: [], cities: [] } as unknown as Prisma.InputJsonValue,
        instanceId: instance.id,
        delayMinSec: resolvedDelayMinSec,
        delayMaxSec: resolvedDelayMaxSec,
        rmktWaves:
          waves.length > 0
            ? (waves.map((w) => ({
                dayOffset: w.dayOffset,
                templates: [{ steps: stepsByScriptId.get(w.scriptId), weight: 1, scriptId: w.scriptId }],
              })) as unknown as Prisma.InputJsonValue)
            : undefined,
        noReplyDays: resolvedNoReplyDays,
        targetPipelineId,
        targetStageId,
        createdById: userId,
      },
    });

    await prisma.campaignRecipient.createMany({
      data: recipientContactIds.map((contactId) => ({ campaignId: campaign.id, contactId })),
      skipDuplicates: true,
    });

    return NextResponse.json({
      campaignId: campaign.id,
      queued: recipientContactIds.length,
      skippedNoPhone,
    });
  });
}
