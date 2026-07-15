/**
 * Estimativa de conclusão de uma campanha — quantos leads por dia ela
 * consegue processar (dado o delay médio configurado, a janela de horário e
 * o teto diário) e, a partir disso, uma data/hora aproximada de quando
 * termina de passar por todos os destinatários pendentes. É só uma
 * projeção (assume que o ritmo atual se mantém) — nunca uma garantia,
 * já que falhas/respostas/pausas mudam o ritmo real.
 */

import { brazilStartOfDay, brazilWeekday } from "@/lib/timezone";

export type CampaignScheduleConfig = {
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
};

export type CompletionEstimate = {
  avgDelaySec: number;
  windowHoursPerDay: number;
  /** Quantos envios por dia o ritmo atual sustenta, já considerando o teto diário. */
  leadsPerDay: number;
  /** null = não dá pra estimar (sem pendentes, sem dia permitido, ou delay zerado). */
  completionAt: Date | null;
};

const MAX_DAYS_SIMULATED = 3650; // trava de segurança (10 anos) — evita loop infinito se algo vier inconsistente

export function estimateCampaignCompletion(
  campaign: CampaignScheduleConfig,
  pendingCount: number,
): CompletionEstimate {
  const avgDelaySec = (campaign.delayMinSec + campaign.delayMaxSec) / 2;
  const windowHoursPerDay = Math.max(0, campaign.windowEndHour - campaign.windowStartHour);
  const messagesPerHour = avgDelaySec > 0 ? 3600 / avgDelaySec : 0;
  const rawPerDay = messagesPerHour * windowHoursPerDay;
  const leadsPerDay = campaign.dailyCap != null ? Math.min(campaign.dailyCap, rawPerDay) : rawPerDay;

  if (pendingCount <= 0 || leadsPerDay <= 0 || campaign.allowedWeekdays.length === 0) {
    return { avgDelaySec, windowHoursPerDay, leadsPerDay, completionAt: null };
  }

  // Simula dia a dia (calendário de Brasília) até esgotar os pendentes,
  // pulando dias da semana não permitidos.
  let remaining = pendingCount;
  let cursor = brazilStartOfDay();
  let finalDayMessages = 0;
  let converged = false;

  for (let i = 0; i < MAX_DAYS_SIMULATED; i++) {
    if (campaign.allowedWeekdays.includes(brazilWeekday(cursor))) {
      if (remaining <= leadsPerDay) {
        finalDayMessages = remaining;
        converged = true;
        break;
      }
      remaining -= leadsPerDay;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  if (!converged) return { avgDelaySec, windowHoursPerDay, leadsPerDay, completionAt: null };

  // Fração de hora dentro da janela do dia final, com base em quantas
  // mensagens ainda faltavam nesse dia — cursor já é meia-noite (Brasil) do
  // dia final, então soma a fração em ms.
  const hoursIntoWindow = messagesPerHour > 0 ? finalDayMessages / messagesPerHour : 0;
  const completionHour = Math.min(campaign.windowEndHour, campaign.windowStartHour + hoursIntoWindow);
  const completionAt = new Date(cursor.getTime() + completionHour * 60 * 60 * 1000);

  return { avgDelaySec, windowHoursPerDay, leadsPerDay, completionAt };
}
