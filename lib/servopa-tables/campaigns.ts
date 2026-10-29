/**
 * Campanhas do PDF das tabelas (regras em campaign-rules.ts): leitura para a
 * tela de cadastro e para a folha de impressão.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilDateKey } from "@/lib/timezone";
import {
  dateKeyFromDb,
  pickActiveServopaCampaign,
  servopaCampaignArtKeyFor,
  servopaCampaignArtUrl,
  servopaCampaignStatus,
  type ServopaCampaignSegment,
  type ServopaCampaignStatus,
} from "@/lib/servopa-tables/campaign-rules";

/** O que a folha precisa para desenhar a faixa. */
export type ServopaSheetCampaign = { name: string; artUrl: string; textColor: "WHITE" | "BLACK" };

export type ServopaCampaignView = {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  enabled: boolean;
  textColor: "WHITE" | "BLACK";
  artUrl: string | null;
  realEstateArtUrl: string | null;
  movableArtUrl: string | null;
  status: ServopaCampaignStatus;
  /** Vale hoje, mas outra campanha do mesmo período tem preferência. */
  overriddenBy: string | null;
  updatedAt: string;
};

const campaignSelect = {
  id: true,
  name: true,
  startsOn: true,
  endsOn: true,
  enabled: true,
  textColor: true,
  artKey: true,
  realEstateArtKey: true,
  movableArtKey: true,
  updatedAt: true,
} as const;

type CampaignRecord = {
  id: string;
  name: string;
  startsOn: Date | null;
  endsOn: Date | null;
  enabled: boolean;
  textColor: "WHITE" | "BLACK";
  artKey: string | null;
  realEstateArtKey: string | null;
  movableArtKey: string | null;
  updatedAt: Date;
};

function toWindow(record: CampaignRecord) {
  return { ...record, startsOn: dateKeyFromDb(record.startsOn), endsOn: dateKeyFromDb(record.endsOn) };
}

async function loadCampaigns(organizationId: string): Promise<CampaignRecord[]> {
  return runWithTenant(organizationId, () =>
    prisma.servopaCampaign.findMany({ where: { organizationId }, select: campaignSelect }),
  );
}

export async function listServopaCampaigns(organizationId: string): Promise<ServopaCampaignView[]> {
  const today = brazilDateKey();
  const windows = (await loadCampaigns(organizationId)).map(toWindow);
  const winner = pickActiveServopaCampaign(windows, today);
  const url = (key: string | null) => (key ? servopaCampaignArtUrl(key) : null);

  return windows
    .map((campaign) => {
      const status = servopaCampaignStatus(campaign, today);
      return {
        id: campaign.id,
        name: campaign.name,
        startsOn: campaign.startsOn,
        endsOn: campaign.endsOn,
        enabled: campaign.enabled,
        textColor: campaign.textColor,
        artUrl: url(campaign.artKey),
        realEstateArtUrl: url(campaign.realEstateArtKey),
        movableArtUrl: url(campaign.movableArtKey),
        status,
        overriddenBy: status === "ACTIVE" && winner && winner.id !== campaign.id ? winner.name : null,
        updatedAt: campaign.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => {
      // Valendo agora primeiro, depois programadas, depois o resto; dentro de cada grupo, pela data de início mais recente.
      const order: Record<ServopaCampaignStatus, number> = { ACTIVE: 0, SCHEDULED: 1, NO_ART: 2, DISABLED: 3, ENDED: 4 };
      return order[a.status] - order[b.status] || (b.startsOn ?? "").localeCompare(a.startsOn ?? "") || b.updatedAt.localeCompare(a.updatedAt);
    });
}

function sheetCampaign(record: CampaignRecord, segment: ServopaCampaignSegment): ServopaSheetCampaign | null {
  const key = servopaCampaignArtKeyFor(record, segment);
  return key ? { name: record.name, artUrl: servopaCampaignArtUrl(key), textColor: record.textColor } : null;
}

/**
 * Campanha que vale hoje para tabelas deste segmento (null = folha sem faixa).
 * A faixa é enfeite: se a leitura falhar, o PDF sai no modelo normal em vez de quebrar.
 */
export async function getActiveServopaCampaign(organizationId: string, segment: ServopaCampaignSegment): Promise<ServopaSheetCampaign | null> {
  try {
    const records = await loadCampaigns(organizationId);
    const winner = pickActiveServopaCampaign(records.map(toWindow), brazilDateKey(), segment);
    const record = winner && records.find((item) => item.id === winner.id);
    return record ? sheetCampaign(record, segment) : null;
  } catch (error) {
    console.error("[servopa-campaign] falha ao ler a campanha do PDF", error);
    return null;
  }
}

/** Prévia de uma campanha específica (fora do período ou desligada), para quem cadastra. */
export async function getServopaCampaignPreview(organizationId: string, campaignId: string, segment: ServopaCampaignSegment): Promise<ServopaSheetCampaign | null> {
  const record = await runWithTenant(organizationId, () =>
    prisma.servopaCampaign.findFirst({ where: { id: campaignId, organizationId }, select: campaignSelect }),
  );
  return record ? sheetCampaign(record, segment) : null;
}

/** Uma tabela de exemplo de cada segmento, para a prévia na tela de campanhas. */
export async function getServopaCampaignSampleTables(organizationId: string): Promise<Partial<Record<ServopaCampaignSegment, string>>> {
  const pick = (segment: ServopaCampaignSegment) =>
    prisma.servopaTable.findFirst({
      where: { organizationId, active: true, rows: { some: {} }, group: { active: true, segment } },
      orderBy: [{ group: { number: "asc" } }, { admRatePercent: "asc" }],
      select: { id: true },
    });
  const [realEstate, movable] = await runWithTenant(organizationId, () => Promise.all([pick("REAL_ESTATE"), pick("MOVABLE")]));
  return { ...(realEstate && { REAL_ESTATE: realEstate.id }), ...(movable && { MOVABLE: movable.id }) };
}
