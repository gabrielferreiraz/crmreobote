import { prisma } from "@/lib/prisma";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";
import { buildDealName } from "@/lib/deal-name";
import { scopeWhere, type DealScope } from "@/lib/team-scope";

/**
 * Campanha sazonal "Lista dos 50" (Novembro Black). Liga/desliga por
 * organização (Lista50Config), sem apagar nada entre uma temporada e outra —
 * religar no ano seguinte só grava um novo `startsOn`.
 *
 * Mecânica real (decidida pelo Dono, 2026-10-31): a meta de 50 leads/semana é
 * um desafio do consultor, NÃO uma condição. Os 20 leads/dia que a Reobote
 * distribui são incondicionais — valem tenha ou não batido a meta daquela
 * semana. Por isso esta camada nunca trava/libera nada; só registra e conta.
 *
 * Cada lead entregue com nome + WhatsApp vira um Deal real na etapa
 * "Black November" do pipeline padrão, com o consultor que entregou como
 * dono — o próprio Deal é o registro; a contagem semanal/por consultor é
 * derivada dele (createdAt + ownerId), sem tabela de bookkeeping duplicada.
 */

export const LISTA_50_STAGE_NAME = "Black November";
export const LISTA_50_DEAL_SOURCE = "Lista dos 50";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WEEKLY_GOAL = 50;

export type Lista50Config = {
  enabled: boolean;
  startsOn: Date | null;
  weeklyGoal: number;
  pipelineId: string | null;
  stageId: string | null;
};

export async function getLista50Config(organizationId: string): Promise<Lista50Config> {
  const row = await prisma.lista50Config.findUnique({ where: { organizationId } });
  if (!row) return { enabled: false, startsOn: null, weeklyGoal: DEFAULT_WEEKLY_GOAL, pipelineId: null, stageId: null };
  return {
    enabled: row.enabled,
    startsOn: row.startsOn,
    weeklyGoal: row.weeklyGoal,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
  };
}

/** Semana corrente (1-based) a partir de startsOn — antes do início, semana 1. */
export function lista50WeekNumber(startsOn: Date, now = new Date()): number {
  const diff = now.getTime() - startsOn.getTime();
  if (diff < 0) return 1;
  return Math.floor(diff / WEEK_MS) + 1;
}

export function lista50WeekRange(startsOn: Date, weekNumber: number): { start: Date; end: Date } {
  const start = new Date(startsOn.getTime() + (weekNumber - 1) * WEEK_MS);
  return { start, end: new Date(start.getTime() + WEEK_MS) };
}

/**
 * Liga a campanha: garante a etapa "Black November" no pipeline padrão
 * (reaproveita se ela já existir de uma temporada anterior, nunca duplica) e
 * grava o início desta temporada. Só o Dono decide isto (ver requireRole na
 * rota) — é uma decisão de campanha, não uma tarefa operacional do dia a dia.
 */
export async function enableLista50Campaign(organizationId: string, updatedById: string, startsOn: Date): Promise<void> {
  const pipeline =
    (await prisma.pipeline.findFirst({ where: { organizationId, isDefault: true }, include: { stages: true } })) ??
    (await prisma.pipeline.findFirst({ where: { organizationId }, orderBy: { order: "asc" }, include: { stages: true } }));
  if (!pipeline) throw new Error("Nenhum pipeline encontrado nesta organização");

  let stage = pipeline.stages.find((s) => s.name === LISTA_50_STAGE_NAME);
  if (!stage) {
    const maxOrder = Math.max(0, ...pipeline.stages.map((s) => s.order));
    stage = await prisma.pipelineStage.create({
      data: { pipelineId: pipeline.id, name: LISTA_50_STAGE_NAME, order: maxOrder + 1, color: "#ffcc00" },
    });
  }

  await prisma.lista50Config.upsert({
    where: { organizationId },
    create: { organizationId, enabled: true, startsOn, pipelineId: pipeline.id, stageId: stage.id, updatedById },
    update: { enabled: true, startsOn, pipelineId: pipeline.id, stageId: stage.id, updatedById },
  });
}

/** Desliga a campanha — guarda pipelineId/stageId/startsOn de propósito, pra religar no ano seguinte sem duplicar a etapa. */
export async function disableLista50Campaign(organizationId: string, updatedById: string): Promise<void> {
  await prisma.lista50Config.upsert({
    where: { organizationId },
    create: { organizationId, enabled: false, updatedById },
    update: { enabled: false, updatedById },
  });
}

export type Lista50LeadInput = {
  nome: string;
  whatsapp: string;
  circulo?: string;
  interesse?: string;
  temperatura?: string;
  observacao?: string;
};

export type Lista50SubmitResult = {
  created: number;
  skipped: number;
  errors: { nome: string; error: string }[];
  weekNumber: number;
};

export class Lista50CampaignInactiveError extends Error {
  constructor() {
    super("A campanha Lista dos 50 não está ativa agora");
  }
}

function buildDealDescription(lead: Lista50LeadInput): string | undefined {
  const partes: string[] = [];
  if (lead.circulo) partes.push(`Círculo: ${lead.circulo}`);
  if (lead.interesse) partes.push(`Interesse: ${lead.interesse}`);
  if (lead.temperatura) partes.push(`Temperatura: ${lead.temperatura}`);
  const cabecalho = partes.join(" · ");
  const observacao = lead.observacao?.trim();
  if (cabecalho && observacao) return `${cabecalho}\nObservação: ${observacao}`;
  return cabecalho || observacao || undefined;
}

/**
 * Entrega da lista: cada linha válida (nome + WhatsApp) vira um Contato (ou
 * reaproveita um já existente — upsertContactFromIntegration nunca rouba o
 * responsável de um contato que já tem um) e um Deal na etapa "Black
 * November", com o consultor que entregou como dono. Resubmissão do mesmo
 * contato pro mesmo dono na etapa não duplica o Deal (idempotente).
 */
export async function submitLista50Leads(
  organizationId: string,
  userId: string,
  leads: Lista50LeadInput[],
): Promise<Lista50SubmitResult> {
  const config = await getLista50Config(organizationId);
  if (!config.enabled || !config.pipelineId || !config.stageId) {
    throw new Lista50CampaignInactiveError();
  }
  const { pipelineId, stageId } = config;

  const seen = new Set<string>();
  let created = 0;
  let skipped = 0;
  const errors: { nome: string; error: string }[] = [];

  for (const lead of leads) {
    const nome = lead.nome.trim();
    const digitos = lead.whatsapp.replace(/\D/g, "");
    if (nome.length < 2 || digitos.length < 10) {
      skipped++;
      continue;
    }
    if (seen.has(digitos)) {
      skipped++;
      continue;
    }
    seen.add(digitos);

    try {
      const outcome = await upsertContactFromIntegration(organizationId, {
        name: nome,
        whatsapp: lead.whatsapp,
        source: LISTA_50_DEAL_SOURCE,
        ownerId: userId,
      });
      if (!outcome.ok) {
        errors.push({ nome, error: outcome.error });
        continue;
      }

      const existingDeal = await prisma.deal.findFirst({
        where: { organizationId, contactId: outcome.contact.id, stageId, ownerId: userId },
        select: { id: true },
      });
      if (existingDeal) {
        skipped++;
        continue;
      }

      await prisma.deal.create({
        data: {
          organizationId,
          pipelineId,
          stageId,
          contactId: outcome.contact.id,
          ownerId: userId,
          name: buildDealName(nome, LISTA_50_DEAL_SOURCE),
          description: buildDealDescription(lead),
        },
      });
      created++;
    } catch (err) {
      errors.push({ nome, error: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }

  const weekNumber = config.startsOn ? lista50WeekNumber(config.startsOn) : 1;
  return { created, skipped, errors, weekNumber };
}

export type Lista50OwnerCount = { userId: string; name: string; count: number };
export type Lista50WeekSummary = { weekNumber: number; start: Date; end: Date; byOwner: Lista50OwnerCount[] };

export type Lista50Progress = {
  weeklyGoal: number;
  startsOn: Date;
  currentWeek: number;
  /** Semana mais recente primeiro. */
  weeks: Lista50WeekSummary[];
};

/**
 * Progresso por consultor/por semana — pra visão do supervisor (escopo via
 * getDealScope/scopeWhere, mesma regra de visibilidade usada em Pipeline).
 * Sempre inclui todo consultor ATIVO do escopo, mesmo com 0 entregas na
 * semana — é o que deixa visível quem ainda não entregou nada.
 */
export async function getLista50Progress(organizationId: string, scope: DealScope): Promise<Lista50Progress | null> {
  const config = await getLista50Config(organizationId);
  if (!config.enabled || !config.startsOn || !config.stageId) return null;
  const startsOn = config.startsOn;

  const [members, deals] = await Promise.all([
    prisma.organizationUser.findMany({
      where: { organizationId, active: true, ...(scope.type === "owners" ? { userId: { in: scope.ownerIds } } : {}) },
      select: { userId: true, user: { select: { name: true } } },
    }),
    prisma.deal.findMany({
      where: { organizationId, stageId: config.stageId, ...scopeWhere(scope) },
      select: { ownerId: true, createdAt: true },
    }),
  ]);

  const nameByUserId = new Map(members.map((m) => [m.userId, m.user.name ?? "—"]));
  const currentWeek = lista50WeekNumber(startsOn);

  const weeks: Lista50WeekSummary[] = [];
  for (let w = currentWeek; w >= 1; w--) {
    const { start, end } = lista50WeekRange(startsOn, w);
    const counts = new Map<string, number>();
    for (const member of members) counts.set(member.userId, 0);
    for (const deal of deals) {
      if (deal.createdAt >= start && deal.createdAt < end) {
        counts.set(deal.ownerId, (counts.get(deal.ownerId) ?? 0) + 1);
      }
    }
    const byOwner = Array.from(counts.entries())
      .map(([userId, count]) => ({ userId, name: nameByUserId.get(userId) ?? "—", count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    weeks.push({ weekNumber: w, start, end, byOwner });
  }

  return { weeklyGoal: config.weeklyGoal, startsOn, currentWeek, weeks };
}

/** Quantos leads o PRÓPRIO consultor já entregou nesta semana (pro contador da página dele). */
export async function getLista50OwnWeekCount(organizationId: string, userId: string): Promise<{ weekNumber: number; count: number } | null> {
  const config = await getLista50Config(organizationId);
  if (!config.enabled || !config.startsOn || !config.stageId) return null;
  const weekNumber = lista50WeekNumber(config.startsOn);
  const { start, end } = lista50WeekRange(config.startsOn, weekNumber);
  const count = await prisma.deal.count({
    where: { organizationId, stageId: config.stageId, ownerId: userId, createdAt: { gte: start, lt: end } },
  });
  return { weekNumber, count };
}
