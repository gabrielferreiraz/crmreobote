/**
 * Validação da sequência de mensagens de um MessageScript e rastreamento de
 * onde cada script está em uso — já que o texto é copiado (snapshot) pra
 * dentro da campanha na criação (ver Campaign.messageTemplates), a única
 * forma de saber "onde esse script foi usado" é guardar o scriptId junto no
 * snapshot e depois varrer as campanhas por ele (não há relação de banco
 * direta de propósito, pra apagar/editar um script nunca afetar campanha já
 * criada).
 */

import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";
import type { ScriptStep } from "@/lib/campaigns/spintax";

const MAX_DELAY_SEC = 120;

export function validateSteps(input: unknown): { ok: true; steps: ScriptStep[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Adicione ao menos uma mensagem ao script" };
  }
  const steps: ScriptStep[] = [];
  for (const raw of input) {
    const record = raw as Record<string, unknown>;
    const text = typeof record?.text === "string" ? record.text.trim() : "";
    if (!text) return { ok: false, error: "Toda mensagem da sequência precisa ter texto" };
    const delayRaw = Number(record?.delayAfterSec);
    const delayAfterSec = Number.isFinite(delayRaw) ? Math.min(MAX_DELAY_SEC, Math.max(0, Math.round(delayRaw))) : 0;
    steps.push({ text, delayAfterSec });
  }
  return { ok: true, steps };
}

export type ScriptUsage = { campaignId: string; campaignName: string; status: $Enums.CampaignStatus };

/** scriptId -> campanhas (atuais e passadas) que usaram esse script no envio inicial ou no reenvio. */
export async function getScriptUsageMap(organizationId: string): Promise<Map<string, ScriptUsage[]>> {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    select: { id: true, name: true, status: true, messageTemplates: true, followUpTemplates: true },
  });

  const usage = new Map<string, ScriptUsage[]>();
  const add = (scriptId: string | undefined, campaign: { id: string; name: string; status: $Enums.CampaignStatus }) => {
    if (!scriptId) return;
    const list = usage.get(scriptId) ?? [];
    if (!list.some((u) => u.campaignId === campaign.id)) {
      list.push({ campaignId: campaign.id, campaignName: campaign.name, status: campaign.status });
    }
    usage.set(scriptId, list);
  };

  for (const c of campaigns) {
    const all = [
      ...(Array.isArray(c.messageTemplates) ? c.messageTemplates : []),
      ...(Array.isArray(c.followUpTemplates) ? c.followUpTemplates : []),
    ] as { scriptId?: string }[];
    for (const t of all) add(t?.scriptId, { id: c.id, name: c.name, status: c.status });
  }

  return usage;
}
