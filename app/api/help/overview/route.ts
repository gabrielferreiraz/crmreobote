import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getCurrentMembership } from "@/lib/current-membership";
import { FEATURE_KEYS } from "@/lib/feature-usage/features";
import type { ChecklistItemId } from "@/lib/help/checklist";
import type { HelpOverview } from "@/lib/help/types";

export const dynamic = "force-dynamic";

/**
 * Dado que personaliza a Central de Ajuda: o que já está configurado e o que
 * a pessoa ainda não descobriu.
 *
 * Chamado UMA vez por carregamento do dashboard, com atraso e só com a aba
 * visível (ver components/help/help-center.tsx) — nunca em polling. É ajuda,
 * não monitoramento: não pode competir com a consulta da tela que a pessoa
 * abriu de fato.
 *
 * Nunca devolve erro pro cliente: ajuda quebrada não pode virar aviso
 * vermelho no canto de quem só queria usar o CRM. Em caso de falha, devolve
 * um estado vazio e a ajuda simplesmente aparece sem a parte personalizada.
 */
export async function GET() {
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return NextResponse.json({ done: [], neverUsed: [] } satisfies HelpOverview);
  }
  const { organizationId, userId, photoKey, cardShortcut } = membership;

  try {
    // Foto e cartão já vieram de graça na consulta de filiação (ver
    // getCurrentMembership) — só o que falta vai ao banco, e em paralelo.
    const [instance, deal, script, usedRows] = await runWithTenant(organizationId, () =>
      Promise.all([
        prisma.whatsAppInstance.findFirst({
          where: { organizationId, userId, status: "CONNECTED" },
          select: { id: true },
        }),
        prisma.deal.findFirst({ where: { organizationId, ownerId: userId }, select: { id: true } }),
        prisma.messageScript.findFirst({
          where: { organizationId, createdById: userId },
          select: { id: true },
        }),
        // `distinct` em vez de groupBy: só interessa SE usou alguma vez, não
        // quantas. Sem recorte de data de propósito — quem usou a busca uma
        // vez há seis meses já descobriu que ela existe, e repetir a dica
        // seria a ajuda insistindo no que a pessoa já sabe.
        prisma.featureUsageDaily.findMany({
          where: { organizationId, userId },
          select: { feature: true },
          distinct: ["feature"],
        }),
      ]),
    );

    const done: ChecklistItemId[] = [];
    if (instance) done.push("whatsapp");
    if (photoKey) done.push("foto");
    if (deal) done.push("negocio");
    if (script) done.push("script");
    if (cardShortcut?.active) done.push("cartao");

    const used = new Set(usedRows.map((row) => row.feature));
    const neverUsed = FEATURE_KEYS.filter((key) => !used.has(key));

    return NextResponse.json({ done, neverUsed } satisfies HelpOverview);
  } catch (err) {
    console.error("[help] overview error", err);
    return NextResponse.json({ done: [], neverUsed: [] } satisfies HelpOverview);
  }
}
