import { prisma } from "@/lib/prisma";
import { upsertContactFromIntegration } from "@/lib/api/upsert-contact";
import { findDuplicateContact } from "@/lib/contact-duplicate";
import { resolveContactPhones } from "@/lib/phone-normalize";
import { buildDealName } from "@/lib/deal-name";
import { sanitizeCell } from "@/lib/csv-sanitize";
import { scopeWhere, type DealScope } from "@/lib/team-scope";
import { brazilDateStringToUTC, brazilDateKey } from "@/lib/timezone";

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
 * Cada lead entregue com nome + WhatsApp vira um Deal real na etapa "Black
 * November" do pipeline padrão, com o consultor que entregou como dono — o
 * próprio Deal é o registro, marcado com `lista50: true` (campo DURÁVEL,
 * independente da etapa atual — ver comentário no schema). A contagem
 * semanal/por consultor e a checagem de "já entregue antes" usam sempre esse
 * campo, nunca `stageId`: o consultor arrasta o negócio pelo pipeline
 * normalmente depois de entregue, e isso não pode fazê-lo sumir da meta nem
 * abrir brecha pra entregar o mesmo contato duas vezes.
 */

export const LISTA_50_STAGE_NAME = "Black November";
export const LISTA_50_DEAL_SOURCE = "Lista dos 50";
const DEFAULT_WEEKLY_GOAL = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

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

// ─── Datas: tudo em CHAVE DE CALENDÁRIO ("AAAA-MM-DD"), nunca em aritmética
// de milissegundos sobre o valor cru do banco ───────────────────────────────
//
// `Lista50Config.startsOn` é coluna DATE do Postgres — o Prisma sempre
// devolve meia-noite UTC pra ela, não importa o que foi gravado (confirmado
// na prática: gravar 04:00 UTC volta como 00:00 UTC na próxima leitura; mesma
// pegadinha já documentada em lib/servopa-tables/campaign-rules.ts). Por
// isso: NUNCA comparar `startsOn` com milissegundos de "agora" — só a chave
// de calendário (`dateKey`) importa, e o fuso correto (Campo Grande) só entra
// na hora de transformar uma chave em instante real pra filtrar `createdAt`.

/** Coluna DATE do Postgres → "AAAA-MM-DD" (sempre meia-noite UTC, não precisa de fuso aqui). */
function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dateKey(d);
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00.000Z`).getTime();
  const to = new Date(`${toKey}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / DAY_MS);
}

/**
 * Converte a data escolhida pelo Dono ("AAAA-MM-DD", do `<input type=date>`,
 * já validada pelo chamador) numa Date pra gravar na coluna DATE — sem
 * undefined vira "hoje" no calendário de Campo Grande. Formato inválido é
 * responsabilidade do chamador rejeitar ANTES de chegar aqui (ver
 * POST /api/lista-50/config).
 */
export function parseLista50StartDate(dateKeyStr: string | undefined): Date {
  const key = dateKeyStr ?? brazilDateKey();
  return new Date(`${key}T00:00:00.000Z`);
}

/** Semana corrente (1-based) a partir de startsOn, pelo calendário de Campo Grande — antes do início, semana 1. */
export function lista50WeekNumber(startsOn: Date, now: Date = new Date()): number {
  const days = daysBetweenKeys(dateKey(startsOn), brazilDateKey(now));
  if (days < 0) return 1;
  return Math.floor(days / 7) + 1;
}

/** Limites REAIS (instantes UTC corretos, Campo Grande) de uma semana — usável direto num filtro de `createdAt`. */
export function lista50WeekRange(startsOn: Date, weekNumber: number): { start: Date; end: Date } {
  const startKey = dateKey(startsOn);
  const rangeStartKey = addDaysToKey(startKey, (weekNumber - 1) * 7);
  const rangeEndKey = addDaysToKey(startKey, weekNumber * 7);
  return { start: brazilDateStringToUTC(rangeStartKey), end: brazilDateStringToUTC(rangeEndKey) };
}

/** A campanha está ligada E já começou (pelo calendário de Campo Grande) — uma data futura agendada não conta como "no ar" ainda. */
export function lista50IsLive(config: Pick<Lista50Config, "enabled" | "startsOn">, now: Date = new Date()): boolean {
  if (!config.enabled || !config.startsOn) return false;
  return brazilDateKey(now) >= dateKey(config.startsOn);
}

/**
 * Liga a campanha: garante a etapa "Black November" no pipeline padrão
 * (reaproveita se ela já existir de uma temporada anterior, nunca duplica) e
 * grava o início desta temporada. Só o Dono decide isto (ver requireRole na
 * rota) — é uma decisão de campanha, não uma tarefa operacional do dia a dia.
 * A rota (POST /api/lista-50/config) serializa chamadas concorrentes — esta
 * função sozinha não é atômica contra duas chamadas simultâneas.
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
  const texto = cabecalho && observacao ? `${cabecalho}\nObservação: ${observacao}` : cabecalho || observacao || undefined;
  // Mesma proteção que POST /api/deals já aplica em `description` (prefixo
  // perigoso tipo "=1+1" vira texto inofensivo) — sem isso, exportar esse
  // texto como planilha (ex.: "Obter Dados do CRM" em Planilhas) carregaria
  // uma fórmula/injeção de quem digitou a observação.
  return texto !== undefined ? sanitizeCell(texto) : undefined;
}

/**
 * Trava em memória (processo único, mesma limitação de lib/rate-limit.ts) —
 * serializa o processamento do MESMO telefone dentro da mesma organização,
 * mesmo entre duas chamadas concorrentes de CONSULTORES DIFERENTES (o
 * `emVoo` de POST /api/lista-50/entregar só protege contra o mesmo usuário
 * se duplicando). Sem isso, dois consultores entregando o mesmo número novo
 * ao mesmo tempo podiam cada um não encontrar o contato ainda e criar um
 * Contato + Deal próprio pro mesmo lead — exatamente o "repetir nome de
 * outro vendedor" que a campanha proíbe.
 */
const phoneLocks = new Map<string, Promise<unknown>>();

function withPhoneLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = phoneLocks.get(key) ?? Promise.resolve();
  const task = prior.then(fn, fn);
  const guarded = task.catch(() => {});
  phoneLocks.set(key, guarded);
  guarded.finally(() => {
    if (phoneLocks.get(key) === guarded) phoneLocks.delete(key);
  });
  return task;
}

/**
 * Entrega da lista: cada linha válida (nome + WhatsApp) vira um Contato (ou
 * reaproveita um já existente — upsertContactFromIntegration nunca rouba o
 * responsável de um contato que já tem um) e um Deal `lista50: true` na
 * etapa "Black November", com o consultor que entregou como dono.
 * Resubmissão do mesmo contato pro mesmo dono não duplica o Deal
 * (idempotente) — mesmo que o Deal já tenha saído da etapa original.
 */
export async function submitLista50Leads(
  organizationId: string,
  userId: string,
  leads: Lista50LeadInput[],
): Promise<Lista50SubmitResult> {
  const config = await getLista50Config(organizationId);
  if (!lista50IsLive(config) || !config.pipelineId || !config.stageId) {
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
      const resultado = await withPhoneLock(`${organizationId}:${digitos}`, async () => {
        const phones = resolveContactPhones({ whatsapp: lead.whatsapp });
        // Só manda `source` quando o contato ainda NÃO existe — upsertContactFromIntegration
        // sobrescreve o campo quando ele vem no corpo, então mandar sempre
        // apagaria a origem real (Facebook Ads, Indicação…) de um contato que
        // já existia antes e só está sendo reentregue numa semana seguinte.
        const existingContact = phones.whatsappNormalized
          ? await findDuplicateContact(organizationId, null, phones.whatsappNormalized)
          : null;

        const outcome = await upsertContactFromIntegration(organizationId, {
          name: nome,
          whatsapp: lead.whatsapp,
          ownerId: userId,
          ...(existingContact ? {} : { source: LISTA_50_DEAL_SOURCE }),
        });
        if (!outcome.ok) return { kind: "error" as const, message: outcome.error };

        // upsertContactFromIntegration nunca ROUBA o responsável de um contato
        // que já tem um (comportamento certo) — mas isso sozinho não impede
        // criar um Deal "Black November" em nome deste consultor sobre um
        // contato que continua sendo de outra pessoa. "Sem repetir nome de
        // outro vendedor" (regra da própria campanha) precisa ser cumprida de
        // verdade: se o contato é de outra pessoa, este lead não entra pela
        // entrega em massa — só pelo caminho de assumir/solicitar (o aviso no
        // campo WhatsApp → POST /api/lead-requests), que fica auditado e
        // avisa quem era o dono.
        if (outcome.contact.responsavelId && outcome.contact.responsavelId !== userId) {
          return {
            kind: "error" as const,
            message: "Esse contato já pertence a outro consultor — assuma ou solicite o lead primeiro (veja o aviso que aparece ao digitar o WhatsApp).",
          };
        }

        // `lista50: true` (não `stageId`) é o que marca "já entregue por este
        // consultor" — o Deal pode ter avançado pro pipeline normal desde a
        // entrega anterior, e mesmo assim não deve ser entregue de novo.
        const existingDeal = await prisma.deal.findFirst({
          where: { organizationId, contactId: outcome.contact.id, ownerId: userId, lista50: true },
          select: { id: true },
        });
        if (existingDeal) return { kind: "skip" as const };

        await prisma.deal.create({
          data: {
            organizationId,
            pipelineId,
            stageId,
            contactId: outcome.contact.id,
            ownerId: userId,
            lista50: true,
            name: buildDealName(nome, LISTA_50_DEAL_SOURCE),
            description: buildDealDescription(lead),
          },
        });
        return { kind: "created" as const };
      });

      if (resultado.kind === "created") created++;
      else if (resultado.kind === "skip") skipped++;
      else errors.push({ nome, error: resultado.message });
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
 * semana — é o que deixa visível quem ainda não entregou nada. Filtra por
 * `lista50: true` (nunca `stageId`) — negócio que o consultor já avançou no
 * pipeline continua contando pra meta da semana em que foi entregue.
 */
export async function getLista50Progress(organizationId: string, scope: DealScope): Promise<Lista50Progress | null> {
  const config = await getLista50Config(organizationId);
  if (!lista50IsLive(config) || !config.startsOn) return null;
  const startsOn = config.startsOn;

  const [members, deals] = await Promise.all([
    prisma.organizationUser.findMany({
      where: { organizationId, active: true, ...(scope.type === "owners" ? { userId: { in: scope.ownerIds } } : {}) },
      select: { userId: true, user: { select: { name: true } } },
    }),
    prisma.deal.findMany({
      where: { organizationId, lista50: true, ...scopeWhere(scope) },
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

/**
 * Quantos leads o PRÓPRIO consultor já entregou nesta semana (pro contador
 * da página dele). Filtra por `lista50: true`, nunca `stageId` — mesmo
 * motivo de getLista50Progress acima.
 */
export async function getLista50OwnWeekCount(organizationId: string, userId: string): Promise<{ weekNumber: number; count: number } | null> {
  const config = await getLista50Config(organizationId);
  if (!lista50IsLive(config) || !config.startsOn) return null;
  const weekNumber = lista50WeekNumber(config.startsOn);
  const { start, end } = lista50WeekRange(config.startsOn, weekNumber);
  const count = await prisma.deal.count({
    where: { organizationId, ownerId: userId, lista50: true, createdAt: { gte: start, lt: end } },
  });
  return { weekNumber, count };
}
