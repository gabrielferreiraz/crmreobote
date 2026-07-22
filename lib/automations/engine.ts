import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { $Enums } from "@/app/generated/prisma/client";
import { STALE_DEAL_DAYS } from "@/lib/stale";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilianMobileVariants } from "@/lib/phone-normalize";
import { sendPushToUser } from "@/lib/push";
import { sendWhatsAppMessage, resolveConnectedInstance } from "@/lib/whatsapp/send";
import { getOrCreateThread } from "@/lib/whatsapp/threads";
import { sendEmail } from "@/lib/email";
import { resolveEmailAddresses, resolveWhatsappRecipients, type RecipientEntry } from "@/lib/automations/recipients";
import { interpolateAutomationTemplate } from "@/lib/automations/variables";
import { escapeHtmlValues } from "@/lib/security/html-escape";
import { brazilHour, brazilWeekday, brazilDayOfMonth, brazilDateKey, brazilGreeting } from "@/lib/timezone";
import { renderSteps } from "@/lib/campaigns/spintax";
import { formatCurrency, daysSince } from "@/lib/format";
import { enqueueWebhookEvent, buildDealWebhookPayload } from "@/lib/webhooks/enqueue";
import { matchesCustomFieldConditions, type CustomFieldCondition } from "@/lib/automations/custom-field-conditions";
import { coerceCustomFieldValue, stringifyCustomFieldValue, type CustomFieldDefinitionLike } from "@/lib/custom-fields";

/** Resultado de uma ação executada — vira o `success`/`detail` gravados em AutomationExecution, exibidos no "Ver detalhes" do histórico. */
type ActionResult = { success: boolean; detail: string };

type TriggerConfig = {
  days?: number;
  stageId?: string;
  minHours?: number;
  frequency?: "daily" | "weekly" | "monthly";
  time?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  assigneeId?: string;
  minutesBefore?: number;
  /** Só avaliado nos triggers cuja entidade principal é Deal ou Contact — ver findMatches. */
  customFieldConditions?: CustomFieldCondition[];
};
type ActionConfig = {
  title?: string;
  dueInDays?: number;
  note?: string;
  lossReasonId?: string;
  pushTitle?: string;
  pushBody?: string;
  whatsappMessage?: string;
  whatsappRecipients?: RecipientEntry[];
  /** userId do remetente fixo. Quando presente, ignora entity.ownerId pra escolha da instância. */
  whatsappSenderId?: string;
  emailSubject?: string;
  emailBody?: string;
  emailRecipients?: RecipientEntry[];
  /** SET_CUSTOM_FIELD: id da CustomFieldDefinition e o valor (texto cru, coerido pro tipo do campo na hora de gravar). */
  customFieldId?: string;
  customFieldValue?: string;
  /** SEND_SCRIPT: id do MessageScript salvo (biblioteca de Scripts). */
  scriptId?: string;
  scriptRecipients?: RecipientEntry[];
  /** userId do remetente fixo — mesmo raciocínio de whatsappSenderId acima. */
  scriptSenderId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Entity = {
  entityId: string;
  organizationId: string;
  dealId?: string;
  contactId?: string;
  ownerId: string;
};

type RuleWithOrg = {
  id: string;
  organizationId: string;
  name: string;
  trigger: $Enums.AutomationTrigger;
  triggerConfig: Prisma.JsonValue;
  action: $Enums.AutomationAction;
  actionConfig: Prisma.JsonValue;
  createdAt: Date;
};

// DEAL_CREATED/DEAL_WON/DEAL_LOST/DEAL_STAGE_ENTERED usavam só rule.createdAt
// como piso da busca — cada tick reprocessava TODO o histórico desde que a
// regra existe, um conjunto que só cresce pra sempre. Generoso o bastante
// pra tolerar o cron ficar fora do ar por um tempo, mas limitado o bastante
// pra manter o custo da query ~constante conforme a base de negócios cresce.
const MATCH_LOOKBACK_MS = 48 * 60 * 60 * 1000;

function matchFloor(ruleCreatedAt: Date): Date {
  const lookback = new Date(Date.now() - MATCH_LOOKBACK_MS);
  return ruleCreatedAt > lookback ? ruleCreatedAt : lookback;
}

async function filterUnexecuted(ruleId: string, candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const executed = await prisma.automationExecution.findMany({
    where: { ruleId, entityId: { in: candidateIds } },
    select: { entityId: true },
  });
  const executedSet = new Set(executed.map((e) => e.entityId));
  return new Set(candidateIds.filter((id) => !executedSet.has(id)));
}

async function recordExecution(ruleId: string, entityId: string): Promise<string | null> {
  try {
    const execution = await prisma.automationExecution.create({ data: { ruleId, entityId } });
    return execution.id;
  } catch (err) {
    // P2002: outra execução concorrente já registrou esse par (ruleId, entityId) primeiro.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

/**
 * Resolve os valores reais das variáveis `{{negocio.x}}`/`{{cliente.x}}`/
 * `{{responsavel.x}}` (ver lib/automations/variables.ts) pra essa entidade
 * específica. Gatilhos sem negócio (ex.: CONTACT_NO_DEAL, SCHEDULED) só
 * preenchem o que existir — token sem valor vira string vazia na hora de
 * interpolar, nunca quebra o envio.
 */
async function resolveTemplateValues(entity: Entity): Promise<Record<string, string>> {
  const values: Record<string, string> = {};

  if (entity.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: entity.dealId },
      include: { stage: true, contact: true, owner: true },
    });
    if (deal) {
      values["negocio.nome"] = deal.name;
      values["negocio.valor"] = deal.value ? formatCurrency(Number(deal.value)) : "—";
      values["negocio.etapa"] = deal.stage.name;
      values["negocio.tipoCredito"] = deal.creditType ?? "—";
      values["negocio.diasNaEtapa"] = String(daysSince(deal.stageEnteredAt));
      values["negocio.diasAberto"] = String(daysSince(deal.startedAt));
      values["cliente.nome"] = deal.contact.name;
      values["cliente.cargo"] = deal.contact.jobTitle ?? "—";
      values["cliente.telefone"] = deal.contact.phone ?? deal.contact.whatsapp ?? "—";
      values["responsavel.nome"] = deal.owner.name;
      return values;
    }
  }

  if (entity.contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: entity.contactId } });
    if (contact) {
      values["cliente.nome"] = contact.name;
      values["cliente.cargo"] = contact.jobTitle ?? "—";
      values["cliente.telefone"] = contact.phone ?? contact.whatsapp ?? "—";
    }
  }

  const owner = await prisma.user.findUnique({ where: { id: entity.ownerId }, select: { name: true } });
  if (owner) values["responsavel.nome"] = owner.name;

  return values;
}

async function performAction(rule: RuleWithOrg, entity: Entity): Promise<ActionResult> {
  const actionConfig = (rule.actionConfig ?? {}) as ActionConfig;

  if (rule.action === "CREATE_TASK") {
    const dueInDays = actionConfig.dueInDays ?? 1;
    const title = actionConfig.title?.trim() || `Automação: ${rule.name}`;
    await prisma.task.create({
      data: {
        organizationId: entity.organizationId,
        dealId: entity.dealId,
        contactId: entity.contactId,
        ownerId: entity.ownerId,
        type: "OTHER",
        title,
        dueAt: new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000),
      },
    });
    return { success: true, detail: `Tarefa criada: "${title}".` };
  }

  if (rule.action === "ADD_NOTE") {
    await prisma.activity.create({
      data: {
        organizationId: entity.organizationId,
        dealId: entity.dealId,
        contactId: entity.contactId,
        userId: entity.ownerId,
        type: "NOTE",
        body: `[Automação: ${rule.name}] ${actionConfig.note?.trim() || ""}`.trim(),
      },
    });
    return { success: true, detail: "Nota registrada." };
  }

  if (rule.action === "MARK_LOST") {
    if (!entity.dealId || !actionConfig.lossReasonId) {
      return { success: false, detail: "Configuração inválida: falta negócio ou motivo de perda." };
    }
    const updated = await prisma.deal.updateMany({
      where: { id: entity.dealId, organizationId: entity.organizationId, status: "OPEN" },
      data: { status: "LOST", closedAt: new Date(), lossReasonId: actionConfig.lossReasonId },
    });
    if (updated.count === 0) {
      return { success: false, detail: "Negócio já não estava aberto — nada foi alterado." };
    }

    await prisma.activity.create({
      data: {
        organizationId: entity.organizationId,
        dealId: entity.dealId,
        contactId: entity.contactId,
        userId: entity.ownerId,
        type: "NOTE",
        body: `[Automação: ${rule.name}] Negócio marcado como perdido automaticamente.`,
      },
    });

    const dealForWebhook = await prisma.deal.findUnique({
      where: { id: entity.dealId },
      include: { contact: true, owner: true, stage: true, lossReason: true },
    });
    if (dealForWebhook) {
      enqueueWebhookEvent(entity.organizationId, "deal.lost", buildDealWebhookPayload(dealForWebhook)).catch((err) =>
        console.error("[webhooks] falha ao enfileirar deal.lost (automação)", err),
      );
    }
    return { success: true, detail: "Negócio marcado como perdido." };
  }

  if (rule.action === "SEND_PUSH") {
    const url = entity.dealId
      ? `/negocios/${entity.dealId}`
      : entity.contactId
        ? `/clientes/${entity.contactId}`
        : "/";
    const { sent, total } = await sendPushToUser(entity.ownerId, {
      title: actionConfig.pushTitle?.trim() || `Automação: ${rule.name}`,
      body: actionConfig.pushBody?.trim() || undefined,
      url,
    });
    if (total === 0) return { success: false, detail: "Responsável não tem notificações push ativadas." };
    if (sent === 0) return { success: false, detail: "Falha ao entregar a notificação push." };
    return {
      success: true,
      detail: `Notificação push enviada${total > 1 ? ` (${sent}/${total} dispositivos)` : ""}.`,
    };
  }

  if (rule.action === "SEND_WHATSAPP") {
    const rawMessage = actionConfig.whatsappMessage?.trim();
    if (!rawMessage) return { success: false, detail: "Mensagem vazia — nada foi enviado." };
    const templateValues = await resolveTemplateValues(entity);
    const message = interpolateAutomationTemplate(rawMessage, templateValues);

    // Se a regra tem um remetente fixo (whatsappSenderId), usa a instância
    // desse usuário. Caso contrário, cai no comportamento padrão: a instância
    // do responsável pela entidade (deal/contact/tarefa).
    const senderId = actionConfig.whatsappSenderId ?? entity.ownerId;
    const instance = await resolveConnectedInstance(entity.organizationId, senderId);
    if (!instance) {
      return { success: false, detail: "WhatsApp do remetente não está conectado." };
    }

    const recipientConfig = actionConfig.whatsappRecipients?.length
      ? actionConfig.whatsappRecipients
      : [{ type: "CLIENT" as const }];
    const targets = await resolveWhatsappRecipients(
      { organizationId: entity.organizationId, ownerId: entity.ownerId, contactId: entity.contactId },
      recipientConfig,
    );
    if (targets.length === 0) return { success: false, detail: "Nenhum destinatário resolvido para o envio." };

    let sent = 0;
    for (const target of targets) {
      try {
        const thread = await getOrCreateThread({
          organizationId: entity.organizationId,
          instanceId: instance.id,
          phoneNormalized: target.phoneNormalized,
        });
        await sendWhatsAppMessage({ organizationId: entity.organizationId, threadId: thread.id, text: message });
        sent += 1;
      } catch (err) {
        // Falha de envio (ex.: WhatsApp desconectado) não deve travar o
        // resto da automação nem os outros destinatários — só fica
        // registrado no log do servidor.
        console.error(
          `[automations] falha ao enviar WhatsApp pra ${target.phoneNormalized} (regra "${rule.name}")`,
          err,
        );
      }
    }
    const failed = targets.length - sent;
    return {
      success: sent > 0,
      detail: `WhatsApp enviado para ${sent}/${targets.length} destinatário(s).${failed > 0 ? ` ${failed} falharam.` : ""}`,
    };
  }

  if (rule.action === "SEND_SCRIPT") {
    const scriptId = actionConfig.scriptId;
    if (!scriptId) return { success: false, detail: "Nenhum script selecionado." };
    const script = await prisma.messageScript.findFirst({
      where: { id: scriptId, organizationId: entity.organizationId },
    });
    if (!script) return { success: false, detail: "Script não encontrado (pode ter sido excluído)." };

    // Mesmo raciocínio do SEND_WHATSAPP acima: remetente fixo se configurado, senão a instância do responsável pela entidade.
    const senderId = actionConfig.scriptSenderId ?? entity.ownerId;
    const instance = await resolveConnectedInstance(entity.organizationId, senderId);
    if (!instance) {
      return { success: false, detail: "WhatsApp do remetente não está conectado." };
    }

    const recipientConfig = actionConfig.scriptRecipients?.length
      ? actionConfig.scriptRecipients
      : [{ type: "CLIENT" as const }];
    const targets = await resolveWhatsappRecipients(
      { organizationId: entity.organizationId, ownerId: entity.ownerId, contactId: entity.contactId },
      recipientConfig,
    );
    if (targets.length === 0) return { success: false, detail: "Nenhum destinatário resolvido para o envio." };

    let sent = 0;
    for (const target of targets) {
      try {
        // Variáveis do script ({nome}/{cargo}/{empresa}/{cidade} + spintax)
        // exigem o Contact de cada destinatário — resolveWhatsappRecipients
        // só devolve o telefone normalizado, então busca o Contact
        // correspondente (mesmo padrão do envio manual em
        // app/api/whatsapp/threads/[threadId]/send-script/route.ts). Por
        // variante (9º dígito) — um destinatário "CUSTOM" (número digitado à
        // mão na configuração da automação, não vinculado a um Contact
        // específico) pode estar num formato de dígitos diferente do que
        // está salvo no Contact de verdade, e sem isso a personalização
        // (nome/cargo/empresa) simplesmente vinha em branco.
        const contactPhoneVariants = brazilianMobileVariants(target.phoneNormalized);
        const contact = await prisma.contact.findFirst({
          where: {
            organizationId: entity.organizationId,
            OR: [
              { phoneNormalized: { in: contactPhoneVariants } },
              { whatsappNormalized: { in: contactPhoneVariants } },
            ],
          },
        });
        const steps = renderSteps(
          script.steps as { text: string; delayAfterSec: number }[],
          { nome: contact?.name ?? "", cargo: contact?.jobTitle, empresa: contact?.company, cidade: contact?.city },
          brazilGreeting(),
        );
        if (steps.length === 0) continue;

        const thread = await getOrCreateThread({
          organizationId: entity.organizationId,
          instanceId: instance.id,
          phoneNormalized: target.phoneNormalized,
        });

        // Só o 1º passo decide sucesso/falha aqui — os seguintes (com delay
        // real entre eles) seguem em segundo plano, sem bloquear o cron de
        // automações (mesmo ajuste já feito no motor de campanhas, ver
        // lib/campaigns/engine.ts): uma regra que dispara pra várias
        // entidades no mesmo tick não deve ficar presa atrás de um único
        // script de várias mensagens.
        await sendWhatsAppMessage({ organizationId: entity.organizationId, threadId: thread.id, text: steps[0].text });
        sent += 1;

        if (steps.length > 1) {
          void (async () => {
            for (let i = 0; i < steps.length - 1; i++) {
              if (steps[i].delayAfterSec > 0) await sleep(steps[i].delayAfterSec * 1000);
              try {
                await sendWhatsAppMessage({ organizationId: entity.organizationId, threadId: thread.id, text: steps[i + 1].text });
              } catch (err) {
                console.error(
                  `[automations] falha ao enviar passo ${i + 2}/${steps.length} do script (regra "${rule.name}")`,
                  err,
                );
                break;
              }
            }
          })();
        }
      } catch (err) {
        console.error(`[automations] falha ao enviar script pra ${target.phoneNormalized} (regra "${rule.name}")`, err);
      }
    }
    const failed = targets.length - sent;
    return {
      success: sent > 0,
      detail: `Script enviado para ${sent}/${targets.length} destinatário(s).${failed > 0 ? ` ${failed} falharam.` : ""}`,
    };
  }

  if (rule.action === "SEND_EMAIL") {
    const rawBody = actionConfig.emailBody?.trim() ?? "";
    if (!rawBody) return { success: false, detail: "Corpo do e-mail vazio — nada foi enviado." };

    const recipientConfig = actionConfig.emailRecipients?.length
      ? actionConfig.emailRecipients
      : [{ type: "RESPONSIBLE" as const }];
    const addresses = await resolveEmailAddresses(
      { organizationId: entity.organizationId, ownerId: entity.ownerId, contactId: entity.contactId },
      recipientConfig,
    );
    if (addresses.size === 0) return { success: false, detail: "Nenhum destinatário de e-mail resolvido." };

    const templateValues = await resolveTemplateValues(entity);
    // Assunto é texto puro (nunca vira HTML), então usa os valores crus; o
    // corpo vira HTML de verdade (`<p>`), então precisa dos valores
    // escapados — sem isso, um nome de contato/negócio com `<`/`>` virava
    // HTML de verdade dentro de um e-mail "confiável" saído da automação.
    const subject = interpolateAutomationTemplate(
      actionConfig.emailSubject?.trim() || `Automação: ${rule.name}`,
      templateValues,
    );
    const body = interpolateAutomationTemplate(rawBody, escapeHtmlValues(templateValues));
    const html = `<p>${body.replace(/\n/g, "<br>")}</p>`;

    const result = await sendEmail({ to: Array.from(addresses.keys()), subject, html });
    if (!result.ok) {
      return { success: false, detail: `Falha ao enviar e-mail: ${result.error}` };
    }
    return { success: true, detail: `E-mail enviado para ${addresses.size} destinatário(s).` };
  }

  if (rule.action === "SET_CUSTOM_FIELD") {
    if (!actionConfig.customFieldId) return { success: false, detail: "Nenhum campo selecionado." };
    const def = await prisma.customFieldDefinition.findFirst({
      where: { id: actionConfig.customFieldId, organizationId: entity.organizationId },
    });
    if (!def) return { success: false, detail: "Campo personalizado não encontrado (pode ter sido excluído)." };

    // Campo de Cliente só faz sentido se a entidade do evento tiver um
    // contactId (idem Negócio/dealId) — em triggers onde não tem (ex.:
    // SCHEDULED nunca tem dealId/contactId), pula em silêncio.
    const targetId = def.entityType === "DEAL" ? entity.dealId : entity.contactId;
    if (!targetId) {
      return {
        success: false,
        detail: `Sem ${def.entityType === "DEAL" ? "negócio" : "contato"} associado a este evento — campo não definido.`,
      };
    }

    let coerced;
    try {
      coerced = coerceCustomFieldValue(def, actionConfig.customFieldValue ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, detail: `Valor inválido para "${def.label}": ${message}` };
    }

    if (def.entityType === "DEAL") {
      const current = await prisma.deal.findUnique({ where: { id: targetId }, select: { customFieldValues: true } });
      const merged = { ...((current?.customFieldValues as Record<string, string | number | boolean | null>) ?? {}), [def.id]: coerced };
      await prisma.deal.update({ where: { id: targetId }, data: { customFieldValues: merged } });
    } else {
      const current = await prisma.contact.findUnique({ where: { id: targetId }, select: { customFieldValues: true } });
      const merged = { ...((current?.customFieldValues as Record<string, string | number | boolean | null>) ?? {}), [def.id]: coerced };
      await prisma.contact.update({ where: { id: targetId }, data: { customFieldValues: merged } });
    }
    return { success: true, detail: `Campo "${def.label}" definido para "${stringifyCustomFieldValue(def, coerced)}".` };
  }

  return { success: false, detail: "Ação desconhecida." };
}

async function findMatches(rule: RuleWithOrg, customFieldDefs: CustomFieldDefinitionLike[]): Promise<Entity[]> {
  const triggerConfig = (rule.triggerConfig ?? {}) as TriggerConfig;
  const conditions = triggerConfig.customFieldConditions;
  const definitionsById = new Map(customFieldDefs.map((d) => [d.id, d]));

  if (rule.trigger === "DEAL_STALE") {
    const days = triggerConfig.days ?? STALE_DEAL_DAYS;
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, status: "OPEN", stageEnteredAt: { lte: threshold } },
      select: { id: true, contactId: true, ownerId: true, customFieldValues: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id) && matchesCustomFieldConditions(d.customFieldValues as Record<string, unknown>, conditions, definitionsById))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_CREATED") {
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, createdAt: { gte: matchFloor(rule.createdAt) } },
      select: { id: true, contactId: true, ownerId: true, customFieldValues: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id) && matchesCustomFieldConditions(d.customFieldValues as Record<string, unknown>, conditions, definitionsById))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_WON" || rule.trigger === "DEAL_LOST") {
    const status = rule.trigger === "DEAL_WON" ? "WON" : "LOST";
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, status, closedAt: { gte: matchFloor(rule.createdAt) } },
      select: { id: true, contactId: true, ownerId: true, customFieldValues: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id) && matchesCustomFieldConditions(d.customFieldValues as Record<string, unknown>, conditions, definitionsById))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "TASK_OVERDUE") {
    const tasks = await prisma.task.findMany({
      where: { organizationId: rule.organizationId, completedAt: null, dueAt: { lte: new Date() } },
      select: { id: true, dealId: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, tasks.map((t) => t.id));
    return tasks
      .filter((t) => pending.has(t.id))
      .map((t) => ({
        entityId: t.id,
        organizationId: rule.organizationId,
        dealId: t.dealId ?? undefined,
        contactId: t.contactId ?? undefined,
        ownerId: t.ownerId,
      }));
  }

  if (rule.trigger === "TASK_DUE_SOON") {
    const minutesBefore = triggerConfig.minutesBefore ?? 15;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + minutesBefore * 60 * 1000);
    // Janela [agora, agora+N min) — dueAt já passado é assunto do TASK_OVERDUE,
    // não deste gatilho, pra não avisar duas vezes pela mesma tarefa.
    const tasks = await prisma.task.findMany({
      where: { organizationId: rule.organizationId, completedAt: null, dueAt: { gte: now, lte: windowEnd } },
      select: { id: true, dealId: true, contactId: true, ownerId: true },
    });
    const pending = await filterUnexecuted(rule.id, tasks.map((t) => t.id));
    return tasks
      .filter((t) => pending.has(t.id))
      .map((t) => ({
        entityId: t.id,
        organizationId: rule.organizationId,
        dealId: t.dealId ?? undefined,
        contactId: t.contactId ?? undefined,
        ownerId: t.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_STAGE_ENTERED") {
    const stageId = triggerConfig.stageId;
    if (!stageId) return [];
    const deals = await prisma.deal.findMany({
      where: { organizationId: rule.organizationId, stageId, stageEnteredAt: { gte: matchFloor(rule.createdAt) } },
      select: { id: true, contactId: true, ownerId: true, stageEnteredAt: true, customFieldValues: true },
    });
    // A entidade inclui o timestamp de entrada na etapa para permitir que a
    // mesma regra dispare de novo se o negócio sair e voltar a essa etapa.
    const keyed = deals.map((d) => ({ ...d, key: `${d.id}:${d.stageEnteredAt.getTime()}` }));
    const pending = await filterUnexecuted(rule.id, keyed.map((d) => d.key));
    return keyed
      .filter((d) => pending.has(d.key) && matchesCustomFieldConditions(d.customFieldValues as Record<string, unknown>, conditions, definitionsById))
      .map((d) => ({
        entityId: d.key,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "DEAL_NO_OPEN_TASK") {
    const minHours = triggerConfig.minHours ?? 24;
    const threshold = new Date(Date.now() - minHours * 60 * 60 * 1000);
    const deals = await prisma.deal.findMany({
      where: {
        organizationId: rule.organizationId,
        status: "OPEN",
        createdAt: { lte: threshold },
        tasks: { none: { completedAt: null } },
      },
      select: { id: true, contactId: true, ownerId: true, customFieldValues: true },
    });
    const pending = await filterUnexecuted(rule.id, deals.map((d) => d.id));
    return deals
      .filter((d) => pending.has(d.id) && matchesCustomFieldConditions(d.customFieldValues as Record<string, unknown>, conditions, definitionsById))
      .map((d) => ({
        entityId: d.id,
        organizationId: rule.organizationId,
        dealId: d.id,
        contactId: d.contactId,
        ownerId: d.ownerId,
      }));
  }

  if (rule.trigger === "CONTACT_NO_DEAL") {
    const days = triggerConfig.days ?? 2;
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const contacts = await prisma.contact.findMany({
      where: { organizationId: rule.organizationId, createdAt: { lte: threshold }, deals: { none: {} } },
      select: { id: true, customFieldValues: true },
    });
    const pending = await filterUnexecuted(rule.id, contacts.map((c) => c.id));
    const candidates = contacts.filter(
      (c) => pending.has(c.id) && matchesCustomFieldConditions(c.customFieldValues as Record<string, unknown>, conditions, definitionsById),
    );
    if (candidates.length === 0) return [];

    const members = await prisma.organizationUser.findMany({
      where: { organizationId: rule.organizationId, active: true },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (members.length === 0) return [];

    const loads = await prisma.deal.groupBy({
      by: ["ownerId"],
      where: { organizationId: rule.organizationId, status: "OPEN" },
      _count: true,
    });
    const loadByUser = new Map(loads.map((l) => [l.ownerId, l._count]));

    return candidates.map((c) => {
      let picked = members[0].userId;
      let lowest = loadByUser.get(picked) ?? 0;
      for (const member of members) {
        const count = loadByUser.get(member.userId) ?? 0;
        if (count < lowest) {
          lowest = count;
          picked = member.userId;
        }
      }
      loadByUser.set(picked, (loadByUser.get(picked) ?? 0) + 1);
      return { entityId: c.id, organizationId: rule.organizationId, contactId: c.id, ownerId: picked };
    });
  }

  if (rule.trigger === "SCHEDULED") {
    const { frequency, time, dayOfWeek, dayOfMonth, assigneeId } = triggerConfig;
    if (!frequency || !time || !assigneeId) return [];

    const hour = Number(time.split(":")[0]);
    if (!Number.isFinite(hour)) return [];

    // O cron roda de hora em hora, então a granularidade é "a hora certa",
    // não o minuto exato — checa se estamos na janela configurada agora.
    // O horário digitado na regra ("08:00") é sempre horário de Brasília, não
    // o do servidor (que roda em UTC no container) — daí usar brazilHour/
    // brazilWeekday/brazilDayOfMonth em vez dos getters nativos do Date.
    const now = new Date();
    const isScheduledNow =
      brazilHour(now) === hour &&
      (frequency === "daily" ||
        (frequency === "weekly" && brazilWeekday(now) === (dayOfWeek ?? 1)) ||
        (frequency === "monthly" && brazilDayOfMonth(now) === (dayOfMonth ?? 1)));

    if (!isScheduledNow) return [];

    // Uma ocorrência por dia+hora — impede disparo duplicado se o cron rodar
    // mais de uma vez na mesma janela, mas libera a próxima ocorrência normal.
    const occurrenceId = `${brazilDateKey(now)}T${String(hour).padStart(2, "0")}`;
    const pending = await filterUnexecuted(rule.id, [occurrenceId]);
    if (!pending.has(occurrenceId)) return [];

    const assignee = await prisma.organizationUser.findFirst({
      where: { organizationId: rule.organizationId, userId: assigneeId, active: true },
      select: { userId: true },
    });
    if (!assignee) return [];

    return [{ entityId: occurrenceId, organizationId: rule.organizationId, ownerId: assignee.userId }];
  }

  return [];
}

async function runRule(rule: RuleWithOrg, customFieldDefs: CustomFieldDefinitionLike[]): Promise<number> {
  const matches = await findMatches(rule, customFieldDefs);

  let fired = 0;
  for (const entity of matches) {
    const executionId = await recordExecution(rule.id, entity.entityId);
    if (!executionId) continue;

    let result: ActionResult;
    try {
      result = await performAction(rule, entity);
    } catch (err) {
      console.error(`[automations] erro inesperado ao executar ação (regra "${rule.name}")`, err);
      result = { success: false, detail: `Erro inesperado: ${err instanceof Error ? err.message : String(err)}` };
    }

    await prisma.automationExecution.update({
      where: { id: executionId },
      data: { success: result.success, detail: result.detail },
    });
    fired += 1;
  }
  return fired;
}

export async function runAutomations(): Promise<{ rulesEvaluated: number; actionsFired: number }> {
  // Organization não é uma tabela com RLS (é a própria organização, não tem
  // organizationId) — listar todas aqui é seguro sem tenant context. As regras
  // de cada uma são buscadas depois, já com o tenant daquela organização
  // definido, pra respeitar o RLS normalmente.
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  let rulesEvaluated = 0;
  let actionsFired = 0;

  for (const org of organizations) {
    const orgResult = await runWithTenant(org.id, async () => {
      const rules = await prisma.automationRule.findMany({ where: { enabled: true } });
      const customFieldDefs = await prisma.customFieldDefinition.findMany({ where: { organizationId: org.id } });

      let fired = 0;
      for (const rule of rules) {
        const ruleFired = await runRule(rule, customFieldDefs);
        fired += ruleFired;
        if (ruleFired > 0) {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: { runCount: { increment: ruleFired }, lastRunAt: new Date() },
          });
        }
      }

      return { rulesEvaluated: rules.length, actionsFired: fired };
    });

    rulesEvaluated += orgResult.rulesEvaluated;
    actionsFired += orgResult.actionsFired;
  }

  return { rulesEvaluated, actionsFired };
}
