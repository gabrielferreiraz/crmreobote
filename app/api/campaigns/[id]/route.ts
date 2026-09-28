import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveCampaignInput, type CampaignInput } from "@/lib/campaigns/build";
import { getDealScope, campaignScopeWhere } from "@/lib/team-scope";
import { PAUSE_REASON, parsePauseReason } from "@/lib/campaigns/pause-reasons";
import type { $Enums, Prisma } from "@/app/generated/prisma/client";

export const dynamic = "force-dynamic";

const VALID_STATUSES: $Enums.CampaignStatus[] = ["DRAFT", "RUNNING", "PAUSED", "DONE"];

/** Config completa (não o resumo de lib/campaigns/list.ts) — usada pelo modal de edição pra pré-preencher o formulário. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    // Escopo por papel (ver lib/team-scope.ts) — sem isso, Consultor lia a
    // config completa da campanha de qualquer outro só sabendo o id (e nem
    // precisava adivinhar, a lista sem escopo já mostrava o id de todo mundo).
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: access.organizationId, ...campaignScopeWhere(scope) },
    });
    if (!campaign) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    return NextResponse.json(campaign);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    // Mesmo escopo do GET acima — sem isso, Consultor pausava/editava/
    // apagava a campanha de qualquer outro só sabendo o id.
    const scope = await getDealScope(access.organizationId, access.userId, access.role);

    const bodyKeys = Object.keys(body);
    const isStatusOnly = bodyKeys.length === 1 && bodyKeys[0] === "status";

    // Pausar/retomar/parar é o clique mais frequente desta tela, e o caminho
    // curto abaixo tira uma ida ao banco do meio dele: o `findFirst` que
    // existia só pra checar se a linha é acessível some, porque o próprio
    // `updateMany` já leva o MESMO filtro de escopo no WHERE — `count === 0`
    // significa exatamente o que o `!existing` significava (não existe ou
    // está fora do escopo). Em troca, a resposta deixa de ser a campanha
    // inteira e vira um ok: nenhum dos dois chamadores desta rota (a lista e
    // a barra de ações da página de detalhe) lê esse corpo — a lista se
    // atualiza sozinha na tela e depois com o router.refresh().
    if (isStatusOnly) {
      const { status } = body as { status?: string };
      if (!status || !VALID_STATUSES.includes(status as $Enums.CampaignStatus)) {
        return NextResponse.json({ error: "Status inválido" }, { status: 400 });
      }

      // Iniciar/retomar com o WhatsApp desconectado não adianta: o motor pausaria a campanha de novo
      // no tick seguinte (ver lib/campaigns/instance-guard.ts) e a pessoa ficaria sem entender por quê.
      // Recusa AQUI, com o motivo. Só olha campanha de UM WhatsApp (MANUAL/LEAD_CAPTURE): no envio em
      // massa do Pipeline cada destinatário tem o seu, e o motor confere um a um (o `instanceId` da
      // campanha ali é só o do 1º destinatário).
      if (status === "RUNNING") {
        const target = await prisma.campaign.findFirst({
          where: { id, organizationId: access.organizationId, ...campaignScopeWhere(scope) },
          select: { source: true, pausedReason: true, instance: { select: { status: true, user: { select: { name: true } } } } },
        });
        if (!target) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
        if (target.source !== "PIPELINE_BULK" && target.instance.status !== "CONNECTED") {
          const comesBackAlone = parsePauseReason(target.pausedReason) === PAUSE_REASON.WHATSAPP_DISCONNECTED;
          return NextResponse.json(
            {
              error: comesBackAlone
                ? `O WhatsApp de ${target.instance.user.name} está desconectado. Reconecte-o (Configurações → Perfil → WhatsApp) — esta campanha volta a enviar sozinha assim que ele reconectar, não precisa retomar na mão.`
                : `O WhatsApp de ${target.instance.user.name} está desconectado. Reconecte-o (Configurações → Perfil → WhatsApp) e tente de novo.`,
              code: "WHATSAPP_OFFLINE",
            },
            { status: 409 },
          );
        }
      }

      // Toda mudança MANUAL de status zera o motivo de pausa automática: pausar na mão é definitivo
      // (não retoma sozinha quando o WhatsApp voltar) e retomar/parar/iniciar não deixa motivo velho pra trás.
      const { count } = await prisma.campaign.updateMany({
        where: { id, organizationId: access.organizationId, ...campaignScopeWhere(scope) },
        data: { status: status as $Enums.CampaignStatus, pausedReason: null, pausedInstanceId: null },
      });
      if (count === 0) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
      return NextResponse.json({ ok: true, status });
    }

    const existing = await prisma.campaign.findFirst({
      where: { id, organizationId: access.organizationId, ...campaignScopeWhere(scope) },
    });
    if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    // Edição completa (nome, público, scripts, agenda...) só é permitida
    // enquanto a campanha nunca começou a rodar — depois disso, duplicar é o
    // caminho pra mudar algo (ver /api/campaigns/[id]/duplicate).
    if (existing.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Só é possível editar campanhas em rascunho — duplique pra criar uma nova com outra configuração" },
        { status: 400 },
      );
    }

    const resolved = await resolveCampaignInput(access.organizationId, body as CampaignInput, scope, {
      userId: access.userId,
      role: access.role,
      currentInstanceId: existing.instanceId,
    });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });
    const v = resolved.value;

    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        name: v.name,
        audienceFilter: v.audienceFilter as unknown as Prisma.InputJsonValue,
        instanceId: v.instanceId,
        messageTemplates: v.messageTemplates,
        delayMinSec: v.delayMinSec,
        delayMaxSec: v.delayMaxSec,
        dailyCap: v.dailyCap,
        allowedWeekdays: v.allowedWeekdays,
        windowStartHour: v.windowStartHour,
        windowEndHour: v.windowEndHour,
        followUpEnabled: v.followUpEnabled,
        followUpDelayHours: v.followUpDelayHours,
        followUpTemplates: v.followUpTemplates,
        rmktWaves: v.rmktWaves,
        noReplyDays: v.noReplyDays,
      },
    });

    // Rascunho nunca enviou nada ainda — seguro remontar a lista de
    // destinatários do zero a partir do público (re)configurado.
    await prisma.campaignRecipient.deleteMany({ where: { campaignId: id } });
    await prisma.campaignRecipient.createMany({
      data: v.contactIds.map((contactId) => ({ campaignId: id, contactId })),
      skipDuplicates: true,
    });

    return NextResponse.json({ ...campaign, recipientCount: v.contactIds.length });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    // Mesmo escopo do GET/PATCH acima — e mesma troca do `findFirst` pelo
    // filtro dentro do próprio DELETE (ver comentário no PATCH): uma ida ao
    // banco em vez de duas, com a mesma garantia de escopo.
    const scope = await getDealScope(access.organizationId, access.userId, access.role);
    const { count } = await prisma.campaign.deleteMany({
      where: { id, organizationId: access.organizationId, ...campaignScopeWhere(scope) },
    });
    if (count === 0) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    return NextResponse.json({ ok: true });
  });
}
