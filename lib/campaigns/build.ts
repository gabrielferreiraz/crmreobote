/**
 * Monta os dados de uma campanha a partir do payload recebido (criação em
 * app/api/campaigns/route.ts e edição de rascunho em
 * app/api/campaigns/[id]/route.ts) — compartilhado pelas duas rotas pra não
 * duplicar validação/resolução de scripts/público.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { parseAudienceFilter, audienceFilterIsEmpty, buildAudienceWhere, type AudienceFilter } from "@/lib/campaigns/audience";

export type ScriptRef = { scriptId: string; weight: number };

export type CampaignInput = {
  name?: string;
  audienceFilter?: unknown;
  instanceId?: string;
  scripts?: ScriptRef[];
  followUpEnabled?: boolean;
  followUpDelayHours?: number;
  followUpScripts?: ScriptRef[];
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
const MIN_DELAY_SEC = 10;
const MAX_DELAY_SEC = 3600;
const MAX_DAILY_CAP = 10_000;
const MAX_FOLLOW_UP_DELAY_HOURS = 720; // 30 dias

function validateScheduleAndThrottle(input: CampaignInput): string | null {
  const delayMinSec = input.delayMinSec ?? 30;
  const delayMaxSec = input.delayMaxSec ?? 90;
  if (!Number.isInteger(delayMinSec) || delayMinSec < MIN_DELAY_SEC || delayMinSec > MAX_DELAY_SEC) {
    return `Delay mínimo precisa estar entre ${MIN_DELAY_SEC} e ${MAX_DELAY_SEC} segundos`;
  }
  if (!Number.isInteger(delayMaxSec) || delayMaxSec < delayMinSec || delayMaxSec > MAX_DELAY_SEC) {
    return "Delay máximo precisa ser maior ou igual ao mínimo (e no máximo 1h)";
  }

  if (input.dailyCap != null && (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > MAX_DAILY_CAP)) {
    return `Teto diário precisa ser um número entre 1 e ${MAX_DAILY_CAP} (ou vazio, sem limite)`;
  }

  const allowedWeekdays = input.allowedWeekdays ?? [1, 2, 3, 4, 5];
  if (
    !Array.isArray(allowedWeekdays) ||
    allowedWeekdays.length === 0 ||
    allowedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  ) {
    return "Selecione ao menos um dia da semana válido (0 a 6)";
  }

  const windowStartHour = input.windowStartHour ?? 9;
  const windowEndHour = input.windowEndHour ?? 18;
  if (!Number.isInteger(windowStartHour) || windowStartHour < 0 || windowStartHour > 23) {
    return "Horário inicial precisa estar entre 0 e 23";
  }
  if (!Number.isInteger(windowEndHour) || windowEndHour < 0 || windowEndHour > 23) {
    return "Horário final precisa estar entre 0 e 23";
  }
  if (windowEndHour <= windowStartHour) {
    return "Horário final precisa ser depois do horário inicial";
  }

  if (input.followUpEnabled) {
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
): Promise<{ ok: true; value: ResolvedCampaign } | { ok: false; error: string }> {
  if (!input.name?.trim()) return { ok: false, error: "Nome é obrigatório" };

  const scheduleError = validateScheduleAndThrottle(input);
  if (scheduleError) return { ok: false, error: scheduleError };

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
  const allScriptIds = [...input.scripts.map((s) => s.scriptId), ...(input.followUpScripts ?? []).map((s) => s.scriptId)];
  const scriptRows = await prisma.messageScript.findMany({
    where: { id: { in: allScriptIds }, organizationId },
    select: { id: true, steps: true },
  });
  const stepsById = new Map(scriptRows.map((s) => [s.id, s.steps]));

  const messageTemplates = input.scripts
    .filter((s) => stepsById.has(s.scriptId))
    .map((s) => ({ steps: stepsById.get(s.scriptId), weight: s.weight, scriptId: s.scriptId }));
  if (messageTemplates.length === 0) return { ok: false, error: "Nenhum script válido selecionado" };

  const followUpTemplatesList = input.followUpScripts?.length
    ? input.followUpScripts
        .filter((s) => stepsById.has(s.scriptId))
        .map((s) => ({ steps: stepsById.get(s.scriptId), weight: s.weight, scriptId: s.scriptId }))
    : null;

  const contacts = await prisma.contact.findMany({
    where: buildAudienceWhere(organizationId, audienceFilter),
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
      followUpTemplates: followUpTemplatesList
        ? (followUpTemplatesList as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      followUpEnabled: input.followUpEnabled ?? false,
      followUpDelayHours: input.followUpDelayHours ?? 24,
      delayMinSec: input.delayMinSec ?? 30,
      delayMaxSec: input.delayMaxSec ?? 90,
      dailyCap: input.dailyCap ?? null,
      allowedWeekdays: input.allowedWeekdays ?? [1, 2, 3, 4, 5],
      windowStartHour: input.windowStartHour ?? 9,
      windowEndHour: input.windowEndHour ?? 18,
      contactIds: contacts.map((c) => c.id),
    },
  };
}
