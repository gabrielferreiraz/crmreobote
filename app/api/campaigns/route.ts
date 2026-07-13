import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { listCampaigns } from "@/lib/campaigns/list";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const campaigns = await listCampaigns(access.organizationId);
    return NextResponse.json(campaigns);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const {
    name,
    audienceJobTitle,
    instanceId,
    scripts,
    delayMinSec,
    delayMaxSec,
    dailyCap,
    allowedWeekdays,
    windowStartHour,
    windowEndHour,
    followUpEnabled,
    followUpDelayHours,
    followUpScripts,
  } = body as {
    name?: string;
    audienceJobTitle?: string;
    instanceId?: string;
    scripts?: { scriptId: string; weight: number }[];
    delayMinSec?: number;
    delayMaxSec?: number;
    dailyCap?: number | null;
    allowedWeekdays?: number[];
    windowStartHour?: number;
    windowEndHour?: number;
    followUpEnabled?: boolean;
    followUpDelayHours?: number;
    followUpScripts?: { scriptId: string; weight: number }[];
  };

  const access = await requireRole(["OWNER", "ADMIN"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!name?.trim()) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  if (!audienceJobTitle?.trim()) {
    return NextResponse.json({ error: "Informe o cargo/público-alvo" }, { status: 400 });
  }
  if (!instanceId) return NextResponse.json({ error: "Selecione de qual WhatsApp enviar" }, { status: 400 });
  if (!scripts?.length) {
    return NextResponse.json({ error: "Selecione ao menos um script" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    const instance = await prisma.whatsAppInstance.findFirst({
      where: { id: instanceId, organizationId: access.organizationId },
    });
    if (!instance) return NextResponse.json({ error: "Instância de WhatsApp inválida" }, { status: 400 });

    // O texto do script é copiado (snapshot) pra dentro da campanha — editar
    // ou apagar o script depois nunca muda uma campanha que já estava rodando.
    const allScriptIds = [...scripts.map((s) => s.scriptId), ...(followUpScripts ?? []).map((s) => s.scriptId)];
    const scriptRows = await prisma.messageScript.findMany({
      where: { id: { in: allScriptIds }, organizationId: access.organizationId },
      select: { id: true, text: true },
    });
    const textById = new Map(scriptRows.map((s) => [s.id, s.text]));
    const messageTemplates = scripts
      .filter((s) => textById.has(s.scriptId))
      .map((s) => ({ text: textById.get(s.scriptId)!, weight: s.weight }));
    if (messageTemplates.length === 0) {
      return NextResponse.json({ error: "Nenhum script válido selecionado" }, { status: 400 });
    }

    // followUpTemplates null = reenvio reaproveita os mesmos scripts do envio inicial.
    const followUpTemplates = followUpScripts?.length
      ? followUpScripts.filter((s) => textById.has(s.scriptId)).map((s) => ({ text: textById.get(s.scriptId)!, weight: s.weight }))
      : null;

    const contacts = await prisma.contact.findMany({
      where: { organizationId: access.organizationId, jobTitle: { equals: audienceJobTitle.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (contacts.length === 0) {
      return NextResponse.json({ error: "Nenhum contato encontrado com esse cargo" }, { status: 400 });
    }

    const campaign = await prisma.campaign.create({
      data: {
        organizationId: access.organizationId,
        name: name.trim(),
        audienceJobTitle: audienceJobTitle.trim(),
        instanceId,
        messageTemplates: messageTemplates as unknown as Prisma.InputJsonValue,
        delayMinSec: delayMinSec ?? 30,
        delayMaxSec: delayMaxSec ?? 90,
        dailyCap: dailyCap ?? undefined,
        allowedWeekdays: allowedWeekdays ?? [1, 2, 3, 4, 5],
        windowStartHour: windowStartHour ?? 9,
        windowEndHour: windowEndHour ?? 18,
        followUpEnabled: followUpEnabled ?? false,
        followUpDelayHours: followUpDelayHours ?? 24,
        followUpTemplates: followUpTemplates as unknown as Prisma.InputJsonValue | undefined,
        createdById: access.userId,
      },
    });

    await prisma.campaignRecipient.createMany({
      data: contacts.map((c) => ({ campaignId: campaign.id, contactId: c.id })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ...campaign, recipientCount: contacts.length }, { status: 201 });
  });
}
