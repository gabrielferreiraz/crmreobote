import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { brazilStartOfDay, brazilNow } from "@/lib/timezone";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { TIP_APPLIES_ON, TIP_PRIORITY, type EvaluatedTip, type ProductivityTipType } from "./types";
import type { $Enums } from "@/app/generated/prisma/client";

/** Limpa dismissals antigos (de dias passados não-forever) — chamado a cada evaluate, barato. */
export async function cleanupExpiredDismissals(userId: string, todayStart: Date): Promise<void> {
  await prisma.productivityTipDismissal.deleteMany({
    where: {
      dismissedBy: userId,
      forever: false,
      dismissDate: { lt: todayStart },
    },
  });
}

export async function isTipDismissed(params: {
  userId: string;
  tipType: ProductivityTipType;
  scope: string;
  todayStart: Date;
}): Promise<boolean> {
  const { userId, tipType, scope, todayStart } = params;
  const row = await prisma.productivityTipDismissal.findFirst({
    where: {
      dismissedBy: userId,
      tipType,
      scope,
      OR: [{ forever: true }, { dismissDate: { gte: todayStart } }],
    },
    select: { id: true },
  });
  return !!row;
}

export async function markTipDismissed(params: {
  organizationId: string;
  userId: string;
  tipType: ProductivityTipType;
  scope: string;
  forever: boolean;
}): Promise<void> {
  const { organizationId, userId, tipType, scope, forever } = params;
  const todayStart = brazilStartOfDay();
  await runWithTenant(organizationId, () =>
    prisma.productivityTipDismissal.upsert({
      where: {
        tipType_scope_dismissedBy_dismissDate_forever: {
          tipType,
          scope,
          dismissedBy: userId,
          dismissDate: todayStart,
          forever,
        },
      },
      create: {
        organizationId,
        tipType,
        scope,
        dismissedBy: userId,
        dismissDate: todayStart,
        forever,
      },
      update: { dismissedAt: new Date() },
    }),
  );
}

function matchesRoute(tip: ProductivityTipType, pathname: string): boolean {
  const applies = TIP_APPLIES_ON[tip];
  if (applies === "GLOBAL") return true;
  if (applies === "PIPELINE") return pathname === "/pipeline" || pathname.startsWith("/negocios");
  if (applies === "AGENDA") return pathname === "/" || pathname.startsWith("/agenda");
  return false;
}

// ─── WhatsApp desconectado ──────────────────────────────────────────

async function evaluateWhatsAppDisconnected(
  organizationId: string,
  userId: string,
): Promise<EvaluatedTip | null> {
  const instances = await prisma.whatsAppInstance.findMany({
    where: { organizationId, userId, status: "CONNECTED" },
    select: { id: true },
  });
  if (instances.length > 0) return null;
  const now = brazilNow();
  const hour = now.getHours();
  // Só dispara "primeiro horário do dia" — até 11h. Depois disso, a dica de
  // conectar cansa.
  if (hour >= 11) return null;
  return {
    tipType: "WHATSAPP_DISCONNECTED",
    scope: "GLOBAL",
    priority: TIP_PRIORITY.WHATSAPP_DISCONNECTED,
    payload: { type: "WHATSAPP_DISCONNECTED" },
  };
}

// ─── No-show / negócios parados em etapa tipo "Não compareceu" ─────

const NOSHOW_KEYWORDS = ["no-show", "no show", "noshow", "não compareceu", "nao compareceu", "faltou", "ausente"];

function isNoShowStageName(name: string): boolean {
  const lower = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return NOSHOW_KEYWORDS.some((kw) => lower.includes(kw));
}

const SAFE_BATCH_SIZE = 10;
const NOSHOW_TRIGGER_COUNT = 8;

async function evaluateNoShowDeals(
  organizationId: string,
  userId: string,
  role: $Enums.OrgRole,
): Promise<EvaluatedTip | null> {
  const scope = await getSharedScope(organizationId, userId, role, "shareDeals");
  const stages = await prisma.pipelineStage.findMany({
    where: {
      pipeline: { organizationId },
    },
    select: { id: true, name: true, order: true },
  });
  // Procura a 1ª etapa (menor order) cujo nome contenha keywords de no-show.
  const noShowStage = stages
    .filter((s) => isNoShowStageName(s.name))
    .sort((a, b) => a.order - b.order)[0];
  if (!noShowStage) return null;
  const count = await prisma.deal.count({
    where: {
      organizationId,
      stageId: noShowStage.id,
      status: "OPEN",
      ...scopeWhere(scope),
    },
  });
  if (count < NOSHOW_TRIGGER_COUNT) return null;
  const dealsAll = await prisma.deal.findMany({
    where: {
      organizationId,
      stageId: noShowStage.id,
      status: "OPEN",
      ...scopeWhere(scope),
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: SAFE_BATCH_SIZE * 20,
  });
  const idsAll = dealsAll.map((d) => d.id);
  return {
    tipType: "NOSHOW_DEALS",
    scope: `STAGE_${noShowStage.id}`,
    priority: TIP_PRIORITY.NOSHOW_DEALS,
    payload: {
      type: "NOSHOW_DEALS",
      stageId: noShowStage.id,
      stageName: noShowStage.name,
      count,
      safeBatch: Math.min(SAFE_BATCH_SIZE, idsAll.length),
      dealIdsAll: idsAll,
    },
  };
}

// ─── Muitas tarefas WhatsApp pendentes ────────────────────────────

const MANY_TASKS_TODAY_THRESHOLD = 5;
const MANY_TASKS_WEEK_THRESHOLD = 12;

async function evaluateManyWhatsAppTasks(
  organizationId: string,
  userId: string,
): Promise<EvaluatedTip | null> {
  const todayStart = brazilStartOfDay();
  const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000);
  const weekEnd = new Date(todayStart.getTime() + 7 * 24 * 3600 * 1000 - 1);
  // Uma consulta só, pra semana inteira, já filtrando scheduledMessageText:
  // null (só o que ainda precisa de ação) — todayCount é um subconjunto
  // dela (dueAt < todayEnd), não uma segunda contagem à parte. Antes eram
  // 2 consultas com critério diferente (todayCount só contava não-agendada,
  // weekCount contava TUDO inclusive já agendada) e unscheduledIds só
  // cobria hoje — então quando o gatilho vinha só do volume da SEMANA (ex.:
  // 0 hoje, 12+ na semana), o botão "Prosseguir" não tinha nada pra
  // oferecer. Agora unscheduledIds cobre a semana toda, sempre coerente com
  // o texto mostrado.
  const weekTasks = await prisma.task.findMany({
    where: {
      organizationId,
      ownerId: userId,
      type: "WHATSAPP",
      completedAt: null,
      dueAt: { gte: todayStart, lte: weekEnd },
      scheduledMessageText: null,
    },
    select: { id: true, dueAt: true },
  });
  const todayCount = weekTasks.filter((t) => t.dueAt && t.dueAt < todayEnd).length;
  const weekCount = weekTasks.length;
  if (todayCount < MANY_TASKS_TODAY_THRESHOLD && weekCount < MANY_TASKS_WEEK_THRESHOLD) return null;
  return {
    tipType: "MANY_WHATSAPP_TASKS",
    scope: "GLOBAL",
    priority: TIP_PRIORITY.MANY_WHATSAPP_TASKS,
    payload: {
      type: "MANY_WHATSAPP_TASKS",
      todayCount,
      weekCount,
      unscheduledIds: weekTasks.map((t) => t.id),
    },
  };
}

// ─── Entrada principal: roda todos os avaliadores e retorna o de maior prioridade ainda não-dismissed ─

export async function evaluateAllTips(params: {
  organizationId: string;
  userId: string;
  role: $Enums.OrgRole;
  pathname: string;
}): Promise<EvaluatedTip | null> {
  const { organizationId, userId, role, pathname } = params;
  const todayStart = brazilStartOfDay();

  // Limpeza roda só ocasionalmente (~1 em cada 10 chamadas), não a cada
  // avaliação — isto é chamado a cada navegação + a cada 2min por usuário
  // aberto (ver lib/use-productivity-tips.ts), então "sempre limpar" vira
  // um DELETE constante no banco só pra manter uma tabela pequena em dia;
  // não ter zero atraso na limpeza é inofensivo (a linha expirada só fica
  // ali mais um pouco, nunca afeta isTipDismissed — a query de dismissed já
  // ignora dismissDate vencido independente desta limpeza rodar ou não).
  if (Math.random() < 0.1) {
    await runWithTenant(organizationId, () => cleanupExpiredDismissals(userId, todayStart));
  }

  // Só roda o avaliador cujo tipo de dica PODE aparecer nesta rota — antes
  // os 3 rodavam sempre (inclusive a consulta cara de no-show: escopo +
  // todas as etapas do funil + contagem de negócios) e o filtro de rota só
  // era aplicado depois, descartando o resultado — ou seja, em qualquer
  // tela fora de Pipeline/Agenda essas consultas rodavam à toa em toda
  // navegação e a cada poll de 2min, para TODO consultor logado.
  const allEvaluators: Array<{ type: ProductivityTipType; run: () => Promise<EvaluatedTip | null> }> = [
    { type: "WHATSAPP_DISCONNECTED", run: () => evaluateWhatsAppDisconnected(organizationId, userId) },
    { type: "NOSHOW_DEALS", run: () => evaluateNoShowDeals(organizationId, userId, role) },
    { type: "MANY_WHATSAPP_TASKS", run: () => evaluateManyWhatsAppTasks(organizationId, userId) },
  ];
  const evaluators = allEvaluators.filter((e) => matchesRoute(e.type, pathname));

  if (evaluators.length === 0) return null;

  const results = await Promise.all(
    evaluators.map(async ({ run }) => {
      try {
        return await runWithTenant(organizationId, run);
      } catch (err) {
        // Um avaliador falhar nunca deve impedir os outros de rodar.
        console.error("[productivity-tips] evaluator error", err);
        return null;
      }
    }),
  );

  const applicable = results.filter((r): r is EvaluatedTip => !!r);

  // Filtra por dismissed — em paralelo (eram sequenciais, uma ida-e-volta
  // ao banco de cada vez, quando às vezes há mais de um tipo aplicável ao
  // mesmo tempo, ex.: WHATSAPP_DISCONNECTED é GLOBAL e pode coexistir com
  // MANY_WHATSAPP_TASKS na Home).
  const dismissChecks = await Promise.all(
    applicable.map(async (tip) => {
      try {
        const dismissed = await runWithTenant(organizationId, () =>
          isTipDismissed({ userId, tipType: tip.tipType, scope: tip.scope, todayStart }),
        );
        return dismissed ? null : tip;
      } catch (err) {
        console.error("[productivity-tips] dismiss check error", err);
        // Em dúvida, não mostra (evita spam de popup bugado).
        return null;
      }
    }),
  );
  const notDismissed = dismissChecks.filter((t): t is EvaluatedTip => !!t);

  if (notDismissed.length === 0) return null;
  notDismissed.sort((a, b) => b.priority - a.priority);
  return notDismissed[0];
}
