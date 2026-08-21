/**
 * Gatilho MESSAGE_RECEIVED do motor de Automações — reage a CONTEÚDO de
 * mensagem de WhatsApp recebida (palavra-chave, horário de atendimento,
 * contexto do contato), pensado pra substituir automações simples de
 * atendimento (tipo BotConversa) sem sair do CRM.
 *
 * Isolado de lib/automations/engine.ts (que já tem 800+ linhas) de
 * propósito — reaproveita de lá só o que já existe pronto (performAction,
 * resolveTemplateValues, recordExecution, matchesTarget), sem duplicar
 * nenhuma lógica de execução de ação.
 *
 * Disparado INLINE por lib/whatsapp/events.ts (fire-and-forget, dentro do
 * runWithTenant que o webhook já ativou), não por um cron periódico — ao
 * contrário dos outros gatilhos, este já nasce sabendo organização/contato/
 * thread (é um evento, não um estado pra descobrir varrendo o banco). Ver
 * o comentário em runAutomations (engine.ts) que exclui este trigger da
 * varredura do cron.
 */

import { prisma } from "@/lib/prisma";
import { getBrazilParts, brazilDateKey } from "@/lib/timezone";
import { performAction, recordExecution, matchesTarget, type TriggerConfig } from "@/lib/automations/engine";
import type { $Enums } from "@/app/generated/prisma/client";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_FIRES = 3;
/** Entre os 15-30min sugeridos — se um atendente mandou mensagem na conversa há menos tempo que isso, o bot de palavra-chave fica em silêncio (ver ignoreIfHumanActive). */
const HUMAN_ACTIVITY_WINDOW_MINUTES = 20;

/**
 * Lowercase + sem acento + sem pontuação/emoji nas bordas + trim — cliente
 * real digita "Preço?", "preço!" ou "🙂 preço", não a palavra pura. Sem essa
 * normalização, o modo EXACT nunca bateria com nada digitado de verdade.
 */
// Todo caractere não-ASCII abaixo é escapado por código (\uXXXX) de
// propósito, nunca colado como caractere literal — marca de acento/emoji é
// fácil de digitar errado de um jeito invisível no editor.
const COMBINING_DIACRITICS = /[̀-ͯ]/g; // acentos, depois de normalize("NFD")
const EMOJI = /[\p{Extended_Pictographic}‍️]/gu; // pictográficos + ZWJ (‍) + variation selector-16 (️)
// Hífen "-" tem que ficar no FIM da classe de caracteres — no meio, viraria
// especificador de intervalo (ex.: ")-–" seria um range de U+0029 a U+2013,
// engolindo letra/número de verdade, não só pontuação. Testado manualmente
// contra esse bug antes de fechar esta linha.
const EDGE_PUNCTUATION = /^[\s"'.,!?;:()–—-]+|[\s"'.,!?;:()–—-]+$/g;

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(EMOJI, "")
    .replace(EDGE_PUNCTUATION, "")
    .trim();
}

/** Sem palavra-chave configurada = gatilho coringa (dispara em qualquer mensagem de texto). */
export function matchesKeyword(config: TriggerConfig, body: string | null): boolean {
  const keywords = (config.messageKeywords ?? []).map(normalizeText).filter(Boolean);
  if (keywords.length === 0) return true;

  const text = normalizeText(body ?? "");
  if (!text) return false;

  const matchType = config.messageMatchType ?? "CONTAINS";
  return keywords.some((kw) => {
    if (matchType === "EXACT") return text === kw;
    if (matchType === "STARTS_WITH") return text.startsWith(kw);
    if (matchType === "ENDS_WITH") return text.endsWith(kw);
    return text.includes(kw);
  });
}

type BusinessHours = { start?: string; end?: string; days?: number[]; holidays?: string[] };

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isWithinBusinessWindow(bh: BusinessHours, now: Date): boolean {
  if (!bh.start || !bh.end) return false; // sem janela configurada = nunca "dentro"
  if ((bh.holidays ?? []).includes(brazilDateKey(now))) return false;
  const parts = getBrazilParts(now);
  const days = bh.days ?? [1, 2, 3, 4, 5];
  if (!days.includes(parts.weekday)) return false;
  const nowMinutes = parts.hour * 60 + parts.minute;
  return nowMinutes >= timeToMinutes(bh.start) && nowMinutes < timeToMinutes(bh.end);
}

/**
 * ALWAYS sempre passa. INSIDE/OUTSIDE_BUSINESS_HOURS comparam contra a janela
 * única da organização (Organization.businessHours) — feriado (bh.holidays)
 * conta como fora do expediente, independente do dia da semana/hora.
 */
export function matchesBusinessHours(businessHours: unknown, mode: TriggerConfig["businessHoursMode"]): boolean {
  const effectiveMode = mode ?? "ALWAYS";
  if (effectiveMode === "ALWAYS") return true;
  const within = isWithinBusinessWindow((businessHours ?? {}) as BusinessHours, new Date());
  return effectiveMode === "INSIDE_BUSINESS_HOURS" ? within : !within;
}

export function matchesContactContext(
  mode: TriggerConfig["contactContext"],
  stats: { totalDeals: number; openDeals: number },
): boolean {
  const effective = mode ?? "ANY";
  if (effective === "NEW_LEAD") return stats.totalDeals === 0;
  if (effective === "HAS_OPEN_DEAL") return stats.openDeals > 0;
  return true;
}

async function isOptedOut(contactId: string | null): Promise<boolean> {
  if (!contactId) return false;
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { whatsappOptOutAt: true } });
  return !!contact?.whatsappOptOutAt;
}

/**
 * OUTBOUND sem campaignId e sem automationRuleId = mandada por um atendente
 * de verdade (nem campanha, nem automação) — WhatsAppMessage.sentByUserId
 * NÃO serve pra essa checagem (só é preenchido no caso raro de "enviar como
 * outro consultor", fica nulo na esmagadora maioria das mensagens humanas
 * normais também).
 */
async function hasRecentHumanMessage(threadId: string): Promise<boolean> {
  const since = new Date(Date.now() - HUMAN_ACTIVITY_WINDOW_MINUTES * 60 * 1000);
  const recent = await prisma.whatsAppMessage.findFirst({
    where: { threadId, direction: "OUTBOUND", campaignId: null, automationRuleId: null, createdAt: { gte: since } },
    select: { id: true },
  });
  return !!recent;
}

/** Quantas vezes essa regra já disparou pra essa conversa nos últimos 5 minutos — 3+ bloqueia (anti-loop/anti-spam). */
async function isRateLimited(ruleId: string, threadId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await prisma.automationExecution.count({ where: { ruleId, threadId, createdAt: { gte: since } } });
  return count >= RATE_LIMIT_MAX_FIRES;
}

/**
 * Sem Contact vinculado (thread em "WhatsApp Geral") conta como lead novo —
 * nunca teve negócio, literalmente. Quando existe negócio aberto, o dono
 * dele vira o "responsável" da entidade (pro {{responsavel.*}} e pro filtro
 * de alvo Todos/Eu/Usuários/Equipe); sem negócio aberto, cai no dono da
 * instância de WhatsApp que recebeu a mensagem — alguém tem que ser o
 * "responsável" mesmo sem negócio ainda.
 */
async function resolveContactContext(
  organizationId: string,
  contactId: string | null,
  fallbackOwnerId: string,
): Promise<{ totalDeals: number; openDeals: number; ownerId: string }> {
  if (!contactId) return { totalDeals: 0, openDeals: 0, ownerId: fallbackOwnerId };

  const [totalDeals, openDeal] = await Promise.all([
    prisma.deal.count({ where: { organizationId, contactId } }),
    prisma.deal.findFirst({
      where: { organizationId, contactId, status: "OPEN" },
      select: { ownerId: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { totalDeals, openDeals: openDeal ? 1 : 0, ownerId: openDeal?.ownerId ?? fallbackOwnerId };
}

export type IncomingMessageRef = {
  id: string;
  type: $Enums.WhatsAppMessageType;
  body: string | null;
};

/**
 * Ponto de entrada único, chamado fire-and-forget de
 * lib/whatsapp/events.ts::saveIncomingMessage — já dentro do runWithTenant
 * que o webhook ativou, então todo Prisma call aqui já é RLS-scoped pra
 * `organizationId` normalmente.
 */
export async function dispatchMessageReceivedAutomations(
  organizationId: string,
  instance: { id: string; userId: string },
  thread: { id: string; contactId: string | null; phoneNormalized: string },
  message: IncomingMessageRef,
): Promise<void> {
  // Áudio/figurinha/imagem sem legenda etc. — não tem palavra-chave pra
  // rodar match. Mensagem de grupo já nem chega aqui (filtrada antes, ver
  // saveIncomingMessage).
  if (message.type !== "TEXT" || !message.body?.trim()) return;

  // Contato que já pediu pra não receber mensagem não recebe resposta
  // automática nova — LGPD/anti-spam, mesmo raciocínio de campanha.
  if (await isOptedOut(thread.contactId)) return;

  const rules = await prisma.automationRule.findMany({
    where: { organizationId, enabled: true, trigger: "MESSAGE_RECEIVED" },
    orderBy: { createdAt: "asc" },
  });
  if (rules.length === 0) return;

  const [organization, contactContext] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { businessHours: true } }),
    resolveContactContext(organizationId, thread.contactId, instance.userId),
  ]);

  const entity = {
    entityId: message.id,
    organizationId,
    contactId: thread.contactId ?? undefined,
    ownerId: contactContext.ownerId,
    // Último recurso pro destinatário "Cliente" (ver
    // lib/automations/recipients.ts) — número de quem mandou ESTA mensagem,
    // já conhecido pela conversa mesmo sem Contact cadastrado ainda.
    clientPhoneNormalized: thread.phoneNormalized,
  };

  for (const rule of rules) {
    const config = (rule.triggerConfig ?? {}) as TriggerConfig;

    if (await isRateLimited(rule.id, thread.id)) continue;
    if (!matchesBusinessHours(organization?.businessHours, config.businessHoursMode)) continue;
    if (!matchesContactContext(config.contactContext, contactContext)) continue;
    if ((config.ignoreIfHumanActive ?? true) && (await hasRecentHumanMessage(thread.id))) continue;
    if (!matchesKeyword(config, message.body)) continue;
    if (!(await matchesTarget(rule, entity.ownerId))) continue;

    const executionId = await recordExecution(rule.id, entity.entityId, thread.id);
    if (!executionId) continue; // P2002: outro processo concorrente já reivindicou essa (rule, message)

    let result;
    try {
      result = await performAction(rule, entity);
    } catch (err) {
      console.error(`[automations] erro inesperado ao executar ação (regra "${rule.name}", MESSAGE_RECEIVED)`, err);
      result = { success: false, detail: `Erro inesperado: ${err instanceof Error ? err.message : String(err)}` };
    }

    await prisma.automationExecution.update({
      where: { id: executionId },
      data: { success: result.success, detail: result.detail },
    });
    await prisma.automationRule.update({
      where: { id: rule.id },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });

    if (config.stopOnMatch && result.success) break;
  }
}
