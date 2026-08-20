/**
 * Validação de trigger/action de uma AutomationRule — compartilhada entre
 * criar (POST) e editar (PATCH), pra editar não ficar com uma versão mais
 * frouxa das regras que só existiam na criação.
 */

import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";
import { coerceCustomFieldValue } from "@/lib/custom-fields";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
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
  "MESSAGE_RECEIVED",
];

const VALID_MESSAGE_MATCH_TYPES = ["EXACT", "CONTAINS", "STARTS_WITH", "ENDS_WITH"];
const VALID_BUSINESS_HOURS_MODES = ["ALWAYS", "INSIDE_BUSINESS_HOURS", "OUTSIDE_BUSINESS_HOURS"];
const VALID_CONTACT_CONTEXTS = ["ANY", "NEW_LEAD", "HAS_OPEN_DEAL"];
/** Limite generoso o bastante pra qualquer caso de uso real, curto o bastante pra não virar vetor de abuso (regra com milhares de palavras-chave). */
const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LENGTH = 100;

export const VALID_ACTIONS: $Enums.AutomationAction[] = [
  "CREATE_TASK",
  "ADD_NOTE",
  "MARK_LOST",
  "SEND_PUSH",
  "SEND_WHATSAPP",
  "SEND_EMAIL",
  "SET_CUSTOM_FIELD",
  "SEND_SCRIPT",
];

const VALID_TARGET_TYPES: $Enums.AutomationTargetType[] = ["EVERYONE", "SELF", "USERS", "TEAM"];

export type TargetConfig = {
  targetType: $Enums.AutomationTargetType;
  targetUserIds: string[];
  targetTeamId: string | null;
};

/**
 * Resolve e valida o ALVO da regra (em quem ela age, além do gatilho) —
 * Todos/Eu/Usuários específicos/Equipe. Só OWNER/MANAGER escolhem isso; pra
 * qualquer outro papel, ignora completamente o que o cliente mandou e força
 * SELF — nunca confia no body pra decidir um escopo mais amplo que o
 * próprio usuário que está criando/editando a regra.
 */
export async function resolveTargetConfig(
  organizationId: string,
  isManager: boolean,
  input: { targetType?: string; targetUserIds?: string[]; targetTeamId?: string | null } | undefined,
): Promise<{ ok: true; value: TargetConfig } | { ok: false; error: string }> {
  if (!isManager) {
    return { ok: true, value: { targetType: "SELF", targetUserIds: [], targetTeamId: null } };
  }

  const targetType = (input?.targetType ?? "EVERYONE") as $Enums.AutomationTargetType;
  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return { ok: false, error: "Alvo inválido" };
  }

  if (targetType === "SELF" || targetType === "EVERYONE") {
    return { ok: true, value: { targetType, targetUserIds: [], targetTeamId: null } };
  }

  if (targetType === "USERS") {
    const ids = Array.from(new Set((input?.targetUserIds ?? []).filter(Boolean)));
    if (ids.length === 0) return { ok: false, error: "Selecione ao menos um usuário" };
    const members = await prisma.organizationUser.findMany({ where: { organizationId, userId: { in: ids } } });
    if (members.length !== ids.length) return { ok: false, error: "Um dos usuários selecionados é inválido" };
    return { ok: true, value: { targetType, targetUserIds: ids, targetTeamId: null } };
  }

  // TEAM
  const teamId = input?.targetTeamId;
  if (!teamId) return { ok: false, error: "Selecione a equipe" };
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId } });
  if (!team) return { ok: false, error: "Equipe inválida" };
  return { ok: true, value: { targetType, targetUserIds: [], targetTeamId: teamId } };
}

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

  if (trigger === "MESSAGE_RECEIVED") {
    const config = triggerConfig as {
      messageMatchType?: string;
      messageKeywords?: string[];
      businessHoursMode?: string;
      contactContext?: string;
      stopOnMatch?: unknown;
      ignoreIfHumanActive?: unknown;
    } | undefined;

    if (config?.messageMatchType !== undefined && !VALID_MESSAGE_MATCH_TYPES.includes(config.messageMatchType)) {
      return "Tipo de correspondência de palavra-chave inválido";
    }
    if (config?.messageKeywords !== undefined) {
      if (!Array.isArray(config.messageKeywords)) return "Palavras-chave inválidas";
      if (config.messageKeywords.length > MAX_KEYWORDS) return `No máximo ${MAX_KEYWORDS} palavras-chave por regra`;
      if (config.messageKeywords.some((k) => typeof k !== "string" || k.length > MAX_KEYWORD_LENGTH)) {
        return `Cada palavra-chave deve ter no máximo ${MAX_KEYWORD_LENGTH} caracteres`;
      }
    }
    if (config?.businessHoursMode !== undefined && !VALID_BUSINESS_HOURS_MODES.includes(config.businessHoursMode)) {
      return "Modo de horário de atendimento inválido";
    }
    if (config?.contactContext !== undefined && !VALID_CONTACT_CONTEXTS.includes(config.contactContext)) {
      return "Contexto de contato inválido";
    }
    if (config?.stopOnMatch !== undefined && typeof config.stopOnMatch !== "boolean") {
      return "Configuração de 'parar outras regras' inválida";
    }
    if (config?.ignoreIfHumanActive !== undefined && typeof config.ignoreIfHumanActive !== "boolean") {
      return "Configuração de 'pausa por atendimento humano' inválida";
    }
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
      const instance = await resolveConnectedInstance(organizationId, senderId);
      if (!instance) {
        return "O número WhatsApp do remetente selecionado não está conectado";
      }
    }
  }
  if (action === "SEND_SCRIPT") {
    const scriptId = actionConfig?.scriptId as string | undefined;
    if (!scriptId) return "Selecione o script";
    const script = await prisma.messageScript.findFirst({ where: { id: scriptId, organizationId } });
    if (!script) return "Script inválido";
    if (!(actionConfig?.scriptRecipients as unknown[] | undefined)?.length) return "Selecione ao menos um destinatário";
    const senderId = actionConfig?.scriptSenderId as string | undefined;
    if (senderId) {
      const member = await prisma.organizationUser.findFirst({
        where: { organizationId, userId: senderId, active: true },
      });
      if (!member) return "Remetente inválido — o usuário não é membro ativo desta organização";
      const instance = await resolveConnectedInstance(organizationId, senderId);
      if (!instance) {
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
