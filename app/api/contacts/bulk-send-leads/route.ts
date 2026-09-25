import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { getDealScope, contactScopeWhere } from "@/lib/team-scope";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { validateRmktAndDelay, type RmktWaveInput } from "@/lib/campaigns/validate-rmkt";
import type { Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

// Mais espaçado que bulk-send-message (50–120s) de propósito — aqui é
// prospecção fria, ainda sem relação estabelecida com o lead.
const DEFAULT_DELAY_MIN_SEC = 80;
const DEFAULT_DELAY_MAX_SEC = 1220;
const MAX_CONTACTS_PER_SEND = 2000;

export async function POST(req: Request) {
  const body = await req.json();
  const {
    contactIds,
    scriptIds,
    rmktEnabled,
    rmktWaves,
    noReplyDays,
    targetPipelineId,
    targetStageId,
    delayMinSec,
    delayMaxSec,
    dailyCap,
    allowedWeekdays,
    windowStartHour,
    windowEndHour,
  } = body as {
    contactIds?: string[];
    scriptIds?: string[];
    rmktEnabled?: boolean;
    rmktWaves?: RmktWaveInput[];
    noReplyDays?: number;
    targetPipelineId?: string;
    targetStageId?: string;
    delayMinSec?: number;
    delayMaxSec?: number;
    dailyCap?: number | null;
    allowedWeekdays?: number[];
    windowStartHour?: number;
    windowEndHour?: number;
  };

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId, role } = access;

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um contato" }, { status: 400 });
  }
  if (contactIds.length > MAX_CONTACTS_PER_SEND) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_CONTACTS_PER_SEND} contatos por envio — selecione menos de uma vez` },
      { status: 400 },
    );
  }
  const uniqueScriptIds = Array.from(new Set(scriptIds ?? []));
  if (uniqueScriptIds.length === 0) return NextResponse.json({ error: "Selecione ao menos um script inicial" }, { status: 400 });
  if (!targetPipelineId || !targetStageId) {
    return NextResponse.json({ error: "Selecione o pipeline e a etapa de destino" }, { status: 400 });
  }

  const validated = validateRmktAndDelay({
    rmktEnabled,
    rmktWaves,
    noReplyDays,
    delayMinSec,
    delayMaxSec,
    dailyCap,
    allowedWeekdays,
    windowStartHour,
    windowEndHour,
    defaultDelayMinSec: DEFAULT_DELAY_MIN_SEC,
    defaultDelayMaxSec: DEFAULT_DELAY_MAX_SEC,
  });
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const {
    resolvedNoReplyDays,
    waves,
    resolvedDelayMinSec,
    resolvedDelayMaxSec,
    resolvedDailyCap,
    resolvedAllowedWeekdays,
    resolvedWindowStartHour,
    resolvedWindowEndHour,
  } = validated;

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
    const allScriptIds = Array.from(new Set([...uniqueScriptIds, ...waves.map((w) => w.scriptId)]));
    const scriptRows = await prisma.messageScript.findMany({
      where: { id: { in: allScriptIds }, organizationId, createdById: userId },
      select: { id: true, steps: true, version: true },
    });
    const stepsByScriptId = new Map(scriptRows.map((s) => [s.id, s.steps]));
    // Versão do script no momento da cópia (ver lib/campaigns/script-sync.ts).
    const versionByScriptId = new Map(scriptRows.map((s) => [s.id, s.version]));
    for (const id of uniqueScriptIds) {
      if (!stepsByScriptId.has(id)) return NextResponse.json({ error: "Um dos scripts iniciais selecionados é inválido" }, { status: 400 });
    }
    for (const wave of waves) {
      if (!stepsByScriptId.has(wave.scriptId)) {
        return NextResponse.json({ error: "Script de uma das ondas de RMKT é inválido" }, { status: 400 });
      }
    }

    // Nunca confia na seleção vinda do cliente — revalida contra o escopo de
    // contato que este usuário de fato enxerga (mesmo padrão de
    // bulk-send-message pra negócio). Faltava aqui: sem isso, um MEMBER
    // conseguia mandar `contactId` de qualquer contato da organização (não
    // só os dele) e a rota disparava a campanha mesmo assim.
    //
    // O `OR` com "já é dono de uma conversa de WhatsApp com este contato"
    // (além do `contactScopeWhere` de sempre, baseado em responsavelId) é
    // pedido explícito depois de um bug real: "Selecionar todas" na aba
    // WhatsApp CRM (ver conversations-view.tsx) elege pelo dono da
    // CONVERSA (quem tem o número conectado — o único "responsável" que
    // faz sentido pra um lead ainda sem negócio, ver o comentário em
    // lib/whatsapp/conversations.ts), não pelo Contact.responsavelId. Os
    // dois campos divergem sempre que um lead foi reatribuído no CRM
    // depois da conversa já existir (medido em produção: 78% das conversas
    // vinculadas) — sem este OR, selecionar "todas as minhas" e enviar
    // esbarrava direto em "Nenhum contato válido nessa seleção", mesmo a
    // pessoa estando, de fato, conversando com todos eles pelo próprio
    // WhatsApp. Continua seguro: só aceita quando EXISTE de verdade uma
    // WhatsAppThread com esse contactId E ownerUserId = quem está
    // chamando — não dá pra forjar mandando o id de um contato qualquer.
    const scope = await getDealScope(organizationId, userId, role);
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
        organizationId,
        OR: [contactScopeWhere(scope), { whatsappThreads: { some: { ownerUserId: userId } } }],
      },
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
        // Mais de um script selecionado = sorteio com peso igual entre eles
        // a cada lead (ver pickWeighted em lib/campaigns/spintax.ts).
        messageTemplates: uniqueScriptIds.map((id) => ({ steps: stepsByScriptId.get(id), weight: 1, scriptId: id, scriptVersion: versionByScriptId.get(id) })) as unknown as Prisma.InputJsonValue,
        audienceFilter: { jobTitles: [], tags: [], cities: [] } as unknown as Prisma.InputJsonValue,
        instanceId: instance.id,
        delayMinSec: resolvedDelayMinSec,
        delayMaxSec: resolvedDelayMaxSec,
        dailyCap: resolvedDailyCap,
        allowedWeekdays: resolvedAllowedWeekdays,
        windowStartHour: resolvedWindowStartHour,
        windowEndHour: resolvedWindowEndHour,
        rmktWaves:
          waves.length > 0
            ? (waves.map((w) => ({
                dayOffset: w.dayOffset,
                templates: [{ steps: stepsByScriptId.get(w.scriptId), weight: 1, scriptId: w.scriptId, scriptVersion: versionByScriptId.get(w.scriptId) }],
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
