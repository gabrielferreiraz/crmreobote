/**
 * Monta os dados de uma campanha a partir do payload recebido (criação em
 * app/api/campaigns/route.ts e edição de rascunho em
 * app/api/campaigns/[id]/route.ts) — compartilhado pelas duas rotas pra não
 * duplicar validação/resolução de scripts/público.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { parseAudienceFilter, audienceFilterIsEmpty, buildAudienceWhere, type AudienceFilter } from "@/lib/campaigns/audience";
import { validateRmktAndDelay, type RmktWaveInput } from "@/lib/campaigns/validate-rmkt";
import type { DealScope } from "@/lib/team-scope";

export type ScriptRef = { scriptId: string; weight: number };

export type CampaignInput = {
  name?: string;
  audienceFilter?: unknown;
  instanceId?: string;
  scripts?: ScriptRef[];
  followUpEnabled?: boolean;
  followUpDelayHours?: number;
  followUpScripts?: ScriptRef[];
  rmktEnabled?: boolean;
  rmktWaves?: RmktWaveInput[];
  noReplyDays?: number;
  delayMinSec?: number;
  delayMaxSec?: number;
  dailyCap?: number | null;
  allowedWeekdays?: number[];
  windowStartHour?: number;
  windowEndHour?: number;
};

export type ResolvedCampaign = {
  name: string;
  audienceFilter: AudienceFilter;
  instanceId: string;
  messageTemplates: Prisma.InputJsonValue;
  followUpTemplates: Prisma.InputJsonValue | typeof Prisma.DbNull;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  rmktWaves: Prisma.InputJsonValue | typeof Prisma.DbNull;
  noReplyDays: number | null;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  contactIds: string[];
};

// Faixas aceitas pro agendamento/throttle — sem isso, um valor absurdo (ex.:
// delayMinSec: 0, windowStartHour: 99) desliga na prática a proteção
// anti-ban do motor de campanhas (lib/campaigns/engine.ts), que confia
// nesses números pra espaçar os envios.
const MAX_FOLLOW_UP_DELAY_HOURS = 720; // 30 dias

function validateLegacyFollowUp(input: CampaignInput): string | null {
  if (input.rmktEnabled === undefined && input.followUpEnabled) {
    const followUpDelayHours = input.followUpDelayHours ?? 24;
    if (!Number.isInteger(followUpDelayHours) || followUpDelayHours < 1 || followUpDelayHours > MAX_FOLLOW_UP_DELAY_HOURS) {
      return `Prazo do reenvio precisa ser entre 1 e ${MAX_FOLLOW_UP_DELAY_HOURS} horas`;
    }
  }

  return null;
}

export async function resolveCampaignInput(
  organizationId: string,
  input: CampaignInput,
  scope?: DealScope,
): Promise<{ ok: true; value: ResolvedCampaign } | { ok: false; error: string }> {
  if (!input.name?.trim()) return { ok: false, error: "Nome é obrigatório" };

  const schedule = validateRmktAndDelay({
    rmktEnabled: input.rmktEnabled,
    rmktWaves: input.rmktWaves,
    noReplyDays: input.noReplyDays,
    delayMinSec: input.delayMinSec,
    delayMaxSec: input.delayMaxSec,
    dailyCap: input.dailyCap,
    allowedWeekdays: input.allowedWeekdays,
    windowStartHour: input.windowStartHour,
    windowEndHour: input.windowEndHour,
    defaultDelayMinSec: 120,
    defaultDelayMaxSec: 1200,
  });
  if (!schedule.ok) return { ok: false, error: schedule.error };
  const legacyFollowUpError = validateLegacyFollowUp(input);
  if (legacyFollowUpError) return { ok: false, error: legacyFollowUpError };

  const audienceFilter = parseAudienceFilter(input.audienceFilter);
  if (audienceFilterIsEmpty(audienceFilter)) {
    return { ok: false, error: "Defina ao menos um critério de público (cargo, tag ou cidade)" };
  }

  if (!input.instanceId) return { ok: false, error: "Selecione de qual WhatsApp enviar" };
  const instance = await prisma.whatsAppInstance.findFirst({ where: { id: input.instanceId, organizationId } });
  if (!instance) return { ok: false, error: "Instância de WhatsApp inválida" };

  if (!input.scripts?.length) return { ok: false, error: "Selecione ao menos um script" };

  // O texto (steps) do script é copiado (snapshot) pra dentro da campanha —
  // editar/apagar o script depois nunca muda uma campanha que já existia.
  // scriptId vai junto só como referência pra "onde esse script é usado".
  const allScriptIds = [
    ...input.scripts.map((s) => s.scriptId),
    ...(input.followUpScripts ?? []).map((s) => s.scriptId),
    ...schedule.waves.map((wave) => wave.scriptId),
  ];
  const scriptRows = await prisma.messageScript.findMany({
    where: { id: { in: allScriptIds }, organizationId },
    select: { id: true, steps: true, version: true },
  });
  const stepsById = new Map(scriptRows.map((s) => [s.id, s.steps]));
  // Versão do script NO MOMENTO da cópia — vai junto no snapshot pra cada
  // envio saber de qual versão é (ver lib/campaigns/script-sync.ts).
  const versionById = new Map(scriptRows.map((s) => [s.id, s.version]));

  const messageTemplates = input.scripts
    .filter((s) => stepsById.has(s.scriptId))
    .map((s) => ({ steps: stepsById.get(s.scriptId), weight: s.weight, scriptId: s.scriptId, scriptVersion: versionById.get(s.scriptId) }));
  if (messageTemplates.length === 0) return { ok: false, error: "Nenhum script válido selecionado" };

  const followUpTemplatesList = input.followUpScripts?.length
    ? input.followUpScripts
        .filter((s) => stepsById.has(s.scriptId))
        .map((s) => ({ steps: stepsById.get(s.scriptId), weight: s.weight, scriptId: s.scriptId, scriptVersion: versionById.get(s.scriptId) }))
    : null;

  if (schedule.waves.some((wave) => !stepsById.has(wave.scriptId))) {
    return { ok: false, error: "Script de uma das ondas de remarketing é inválido" };
  }
  const rmktWaves = schedule.waves.map((wave) => ({
    dayOffset: wave.dayOffset,
    templates: [{ steps: stepsById.get(wave.scriptId), weight: 1, scriptId: wave.scriptId, scriptVersion: versionById.get(wave.scriptId) }],
  }));
  const usesLegacyFollowUp = input.rmktEnabled === undefined && !!input.followUpEnabled;

  const contacts = await prisma.contact.findMany({
    where: buildAudienceWhere(organizationId, audienceFilter, scope),
    select: { id: true },
  });
  if (contacts.length === 0) return { ok: false, error: "Nenhum contato encontrado com esse público" };

  return {
    ok: true,
    value: {
      name: input.name.trim(),
      audienceFilter,
      instanceId: input.instanceId,
      messageTemplates: messageTemplates as unknown as Prisma.InputJsonValue,
      followUpTemplates: usesLegacyFollowUp && followUpTemplatesList
        ? (followUpTemplatesList as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      followUpEnabled: usesLegacyFollowUp,
      followUpDelayHours: usesLegacyFollowUp ? (input.followUpDelayHours ?? 24) : 24,
      rmktWaves: rmktWaves.length ? (rmktWaves as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      noReplyDays: rmktWaves.length ? schedule.resolvedNoReplyDays : null,
      delayMinSec: schedule.resolvedDelayMinSec,
      delayMaxSec: schedule.resolvedDelayMaxSec,
      dailyCap: schedule.resolvedDailyCap,
      allowedWeekdays: schedule.resolvedAllowedWeekdays,
      windowStartHour: schedule.resolvedWindowStartHour,
      windowEndHour: schedule.resolvedWindowEndHour,
      contactIds: contacts.map((c) => c.id),
    },
  };
}
