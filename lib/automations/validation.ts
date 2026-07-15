/**
 * Validação de trigger/action de uma AutomationRule — compartilhada entre
 * criar (POST) e editar (PATCH), pra editar não ficar com uma versão mais
 * frouxa das regras que só existiam na criação.
 */

import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";

export const VALID_TRIGGERS: $Enums.AutomationTrigger[] = [
  "DEAL_STALE",
  "DEAL_CREATED",
  "DEAL_WON",
  "DEAL_LOST",
  "TASK_OVERDUE",
  "DEAL_STAGE_ENTERED",
  "DEAL_NO_OPEN_TASK",
  "CONTACT_NO_DEAL",
  "SCHEDULED",
  "TASK_DUE_SOON",
];

export const VALID_ACTIONS: $Enums.AutomationAction[] = [
  "CREATE_TASK",
  "ADD_NOTE",
  "MARK_LOST",
  "SEND_PUSH",
  "SEND_WHATSAPP",
  "SEND_EMAIL",
];

export async function validateTriggerConfig(
  organizationId: string,
  trigger: $Enums.AutomationTrigger,
  triggerConfig: Record<string, unknown> | undefined,
): Promise<string | null> {
  if (trigger === "DEAL_STAGE_ENTERED") {
    const stageId = triggerConfig?.stageId as string | undefined;
    if (!stageId) return "Selecione a etapa que dispara a automação";
    const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, pipeline: { organizationId } } });
    if (!stage) return "Etapa inválida";
  }
  if (trigger === "SCHEDULED") {
    const config = triggerConfig as { frequency?: string; time?: string; assigneeId?: string } | undefined;
    if (!config?.frequency || !config?.time || !config?.assigneeId) {
      return "Preencha a frequência, o horário e o responsável do agendamento";
    }
    const member = await prisma.organizationUser.findFirst({
      where: { organizationId, userId: config.assigneeId, active: true },
    });
    if (!member) return "Responsável inválido";
  }
  return null;
}

export async function validateActionConfig(
  organizationId: string,
  action: $Enums.AutomationAction,
  actionConfig: Record<string, unknown> | undefined,
): Promise<string | null> {
  if (action === "MARK_LOST") {
    const lossReasonId = actionConfig?.lossReasonId as string | undefined;
    if (!lossReasonId) return "Selecione o motivo de perda";
    const reason = await prisma.lossReason.findFirst({ where: { id: lossReasonId, organizationId } });
    if (!reason) return "Motivo de perda inválido";
  }
  if (action === "SEND_WHATSAPP") {
    if (!(actionConfig?.whatsappMessage as string | undefined)?.trim()) return "Escreva o texto da mensagem de WhatsApp";
    if (!(actionConfig?.whatsappRecipients as unknown[] | undefined)?.length) return "Selecione ao menos um destinatário";
  }
  if (action === "SEND_EMAIL") {
    if (!(actionConfig?.emailBody as string | undefined)?.trim()) return "Escreva o texto do e-mail";
    if (!(actionConfig?.emailRecipients as unknown[] | undefined)?.length) return "Selecione ao menos um destinatário";
  }
  return null;
}
