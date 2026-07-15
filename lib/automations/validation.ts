/**
 * Validação de trigger/action de uma AutomationRule — compartilhada entre
 * criar (POST) e editar (PATCH), pra editar não ficar com uma versão mais
 * frouxa das regras que só existiam na criação.
 */

import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";
import { coerceCustomFieldValue } from "@/lib/custom-fields";
import type { CustomFieldCondition } from "@/lib/automations/custom-field-conditions";

/** Triggers cuja entidade principal é um Deal/Contact estável — únicos onde "condições de campo personalizado" fazem sentido. */
export const CUSTOM_FIELD_CONDITION_ENTITY: Partial<Record<$Enums.AutomationTrigger, "DEAL" | "CONTACT">> = {
  DEAL_STALE: "DEAL",
  DEAL_CREATED: "DEAL",
  DEAL_WON: "DEAL",
  DEAL_LOST: "DEAL",
  DEAL_STAGE_ENTERED: "DEAL",
  DEAL_NO_OPEN_TASK: "DEAL",
  CONTACT_NO_DEAL: "CONTACT",
};

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
  "SET_CUSTOM_FIELD",
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

  const conditions = triggerConfig?.customFieldConditions as CustomFieldCondition[] | undefined;
  if (conditions?.length) {
    const entityType = CUSTOM_FIELD_CONDITION_ENTITY[trigger];
    if (!entityType) return "Esse gatilho não suporta condições de campo personalizado";
    for (const condition of conditions) {
      if (!condition.fieldId) return "Selecione o campo da condição";
      const def = await prisma.customFieldDefinition.findFirst({
        where: { id: condition.fieldId, organizationId, entityType },
      });
      if (!def) return "Campo personalizado inválido na condição";
      if (!["equals", "not_equals", "is_set", "is_not_set"].includes(condition.operator)) {
        return "Operador de condição inválido";
      }
      if ((condition.operator === "equals" || condition.operator === "not_equals") && !condition.value) {
        return `Preencha o valor da condição de "${def.label}"`;
      }
    }
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
    const senderId = actionConfig?.whatsappSenderId as string | undefined;
    if (senderId) {
      const member = await prisma.organizationUser.findFirst({
        where: { organizationId, userId: senderId, active: true },
      });
      if (!member) return "Remetente inválido — o usuário não é membro ativo desta organização";
      const instance = await prisma.whatsAppInstance.findUnique({
        where: { organizationId_userId: { organizationId, userId: senderId } },
        select: { status: true },
      });
      if (!instance || instance.status !== "CONNECTED") {
        return "O número WhatsApp do remetente selecionado não está conectado";
      }
    }
  }
  if (action === "SEND_EMAIL") {
    if (!(actionConfig?.emailBody as string | undefined)?.trim()) return "Escreva o texto do e-mail";
    if (!(actionConfig?.emailRecipients as unknown[] | undefined)?.length) return "Selecione ao menos um destinatário";
  }
  if (action === "SET_CUSTOM_FIELD") {
    const customFieldId = actionConfig?.customFieldId as string | undefined;
    if (!customFieldId) return "Selecione o campo personalizado";
    const def = await prisma.customFieldDefinition.findFirst({ where: { id: customFieldId, organizationId } });
    if (!def) return "Campo personalizado inválido";
    try {
      coerceCustomFieldValue(def, (actionConfig?.customFieldValue as string | undefined) ?? "");
    } catch (err) {
      return (err as Error).message;
    }
  }
  return null;
}
