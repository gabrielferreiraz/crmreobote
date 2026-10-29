/**
 * Peças comuns às rotas de cadastro das campanhas (app/api/servopa-tables/campaigns).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { listServopaCampaigns } from "@/lib/servopa-tables/campaigns";
import { isServopaDateKey, SERVOPA_CAMPAIGN_NAME_MAX, type ServopaCampaignArtSlot } from "@/lib/servopa-tables/campaign-rules";

export async function requireServopaCampaignManager() {
  const access = await getServopaTablesAccess();
  if (!access.ok) return { response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) } as const;
  if (!access.canManageCampaigns) {
    return { response: NextResponse.json({ error: "Somente o dono e o administrativo cadastram campanhas." }, { status: 403 }) } as const;
  }
  return { access } as const;
}

const dateKey = z.string().refine(isServopaDateKey, "Data inválida.").nullable();

export const servopaCampaignFieldsSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a campanha.").max(SERVOPA_CAMPAIGN_NAME_MAX, "Nome muito longo."),
  startsOn: dateKey,
  endsOn: dateKey,
  enabled: z.boolean(),
  textColor: z.enum(["WHITE", "BLACK"]),
}).strict();

export type ServopaCampaignFields = z.infer<typeof servopaCampaignFieldsSchema>;

export function servopaCampaignPeriodError(startsOn: string | null, endsOn: string | null): string | null {
  return startsOn && endsOn && startsOn > endsOn ? "A data de fim não pode ser antes da data de início." : null;
}

/** Primeira mensagem de validação, pronta para mostrar na tela. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message && !error.issues[0].message.startsWith("Invalid") ? error.issues[0].message : "Dados da campanha inválidos.";
}

function brDate(key: string | null) {
  return key ? key.split("-").reverse().join("/") : null;
}

export function describeServopaCampaign(fields: Pick<ServopaCampaignFields, "name" | "startsOn" | "endsOn" | "enabled">): string {
  const start = brDate(fields.startsOn);
  const end = brDate(fields.endsOn);
  const period = start && end ? `de ${start} a ${end}` : start ? `a partir de ${start}` : end ? `até ${end}` : "sem período";
  return `"${fields.name}" (${period}, ${fields.enabled ? "ligada" : "desligada"})`;
}

export const SERVOPA_CAMPAIGN_ART_COLUMN = {
  ALL: "artKey",
  REAL_ESTATE: "realEstateArtKey",
  MOVABLE: "movableArtKey",
} as const satisfies Record<ServopaCampaignArtSlot, string>;

export const SERVOPA_CAMPAIGN_ART_LABEL: Record<ServopaCampaignArtSlot, string> = {
  ALL: "arte principal",
  REAL_ESTATE: "arte de imóveis",
  MOVABLE: "arte de automóveis",
};

export async function servopaCampaignsResponse(organizationId: string, init?: ResponseInit) {
  return NextResponse.json({ campaigns: await listServopaCampaigns(organizationId) }, init);
}
