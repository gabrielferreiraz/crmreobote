import { Prisma, type $Enums } from "@/app/generated/prisma/client";
import { prisma, prismaRaw } from "@/lib/prisma";
import { setTenantOnTx } from "@/lib/tenant-context";
import { parseAudienceFilter, describeAudienceFilter, type AudienceFilter } from "@/lib/campaigns/audience";
import { estimateCampaignCompletion, nextAllowedSendWindow, type CompletionEstimate } from "@/lib/campaigns/estimate";
import {
  campaignVisibilityWhere,
  campaignRecipientVisibilityWhere,
  canManageCampaign,
  scopeWhere,
  type DealScope,
} from "@/lib/team-scope";
import { listCampaignScriptEntries, normalizeSteps, ACTIVE_CAMPAIGN_STATUSES } from "@/lib/campaigns/script-sync";
import { PAUSE_REASON, parsePauseReason, type PauseReason } from "@/lib/campaigns/pause-reasons";

export type CampaignSummary = {
  id: string;
  name: string;
  status: $Enums.CampaignStatus;
  /** Por que está PAUSED sem alguém ter clicado em "Pausar" (Campaign.pausedReason no schema) — null = pausa manual ou não pausada. */
  pausedReason: PauseReason | null;
  audienceFilter: AudienceFilter;
  audienceLabel: string;
  instanceName: string;
  createdByName: string;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  createdAt: Date;
  counts: { pending: number; sent: number; failed: number; skipped: number; replied: number };
  /**
   * Pode pausar/editar/apagar/duplicar (criou a campanha, ou é dono do WhatsApp
   * que ela usa — ver campaignScopeWhere em lib/team-scope.ts). false = só
   * enxerga: envio em massa do Pipeline em que só alguns destinatários saíram
   * do WhatsApp dela; a tela esconde os botões e as rotas recusam.
   */
  canManage: boolean;
};

/**
 * Reaproveitado pela página (SSR) e por GET /api/campaigns, pra não duplicar
 * o merge de contagens. `scope` (ver lib/team-scope.ts) é OBRIGATÓRIO —
 * Dono/Gerente/Supervisor sem equipe enxergam tudo/a própria equipe,
 * Consultor só as campanhas que ele mesmo criou. Achado em produção sem
 * NENHUM escopo aqui (só organizationId): qualquer Consultor via a campanha
 * de qualquer outro, recipientes (nome/telefone) incluídos.
 */
export async function listCampaigns(organizationId: string, scope: DealScope): Promise<CampaignSummary[]> {
  // VISIBILIDADE (quem enxerga a campanha, incluindo a de outra pessoa que sai
  // do WhatsApp dela) — não confundir com o escopo de EDIÇÃO (canManage abaixo).
  const scopeFilter = campaignVisibilityWhere(scope);
  const recipientVisibility = campaignRecipientVisibilityWhere(scope);
  // `select` em vez de trazer a linha inteira: Campaign tem `messageTemplates`,
  // `audienceFilter`, `followUpTemplates` e `rmktWaves` (JSONs de vários KB em
  // campanha de várias variantes de script) — nada disso é usado na lista, e
  // eram transferidos do banco a cada carregamento da tela E a cada
  // router.refresh() depois de pausar/retomar/parar uma campanha.
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId, ...scopeFilter },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      pausedReason: true,
      audienceFilter: true,
      delayMinSec: true,
      delayMaxSec: true,
      dailyCap: true,
      allowedWeekdays: true,
      windowStartHour: true,
      windowEndHour: true,
      followUpEnabled: true,
      followUpDelayHours: true,
      createdAt: true,
      createdById: true,
      source: true,
      instance: { select: { personalOwnerId: true, personalOwner: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });

  const campaignIds = campaigns.map((c) => c.id);
  const [statusCounts, repliedCounts] = campaignIds.length
    ? await Promise.all([
        prisma.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          where: { campaignId: { in: campaignIds }, ...recipientVisibility },
          _count: true,
        }),
        // Contagem de respondidos, não a lista deles: antes isto era um findMany que
        // trazia UMA LINHA POR RESPOSTA (só o campaignId era lido) — uma campanha
        // com 5.000 respostas transferia 5.000 linhas pra depois contar de um em um.
        // O banco já devolve o número pronto.
        prisma.campaignRecipient.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: campaignIds }, repliedAt: { not: null }, ...recipientVisibility },
          _count: true,
        }),
      ])
    : [[], []];

  const countsByCampaign = new Map<string, CampaignSummary["counts"]>();
  for (const row of statusCounts) {
    const entry = countsByCampaign.get(row.campaignId) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
    if (row.status === "PENDING") entry.pending += row._count;
    if (row.status === "SENT") entry.sent += row._count;
    if (row.status === "FAILED") entry.failed += row._count;
    if (row.status === "SKIPPED") entry.skipped += row._count;
    countsByCampaign.set(row.campaignId, entry);
  }
  for (const row of repliedCounts) {
    const entry = countsByCampaign.get(row.campaignId) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
    entry.replied += row._count;
    countsByCampaign.set(row.campaignId, entry);
  }

  return campaigns.map((c) => {
    const audienceFilter = parseAudienceFilter(c.audienceFilter);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      pausedReason: c.status === "PAUSED" ? parsePauseReason(c.pausedReason) : null,
      audienceFilter,
      audienceLabel: describeAudienceFilter(audienceFilter),
      instanceName: c.instance.personalOwner?.name ?? "WhatsApp pessoal",
      createdByName: c.createdBy.name,
      delayMinSec: c.delayMinSec,
      delayMaxSec: c.delayMaxSec,
      dailyCap: c.dailyCap,
      allowedWeekdays: c.allowedWeekdays,
      windowStartHour: c.windowStartHour,
      windowEndHour: c.windowEndHour,
      followUpEnabled: c.followUpEnabled,
      followUpDelayHours: c.followUpDelayHours,
      createdAt: c.createdAt,
      counts: countsByCampaign.get(c.id) ?? { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 },
      canManage: canManageCampaign(scope, {
        createdById: c.createdById,
        source: c.source,
        instanceUserId: c.instance.personalOwnerId ?? "",
      }),
    };
  });
}

export type CampaignRecipientRow = {
  id: string;
  contactName: string;
  contactPhone: string | null;
  contactJobTitle: string | null;
  status: $Enums.CampaignRecipientStatus;
  /** Setado quando enviado (ver CampaignRecipient.threadId no schema) — link
   * direto pra conversa em /whatsapp/conversas?threadId=... (ver
   * recipients-table.tsx), sem precisar buscar o contato de novo lá. */
  threadId: string | null;
  /**
   * Negócio pra abrir em /negocios/[id] — só preenchido pra quem já
   * respondeu (pedido explícito: "para quem respondeu, 'ver negócio'") E
   * quando quem está olhando de fato enxerga esse negócio (ver dealScope em
   * getCampaignDetail). null = sem link, nunca um link que cairia em 404.
   */
  dealId: string | null;
  sentAt: Date | null;
  repliedAt: Date | null;
  followUpSentAt: Date | null;
  /**
   * Quando a ÚLTIMA onda de RMKT foi enviada pra ESTE destinatário (ver
   * CampaignRecipient.lastWaveSentAt no schema) — pedido explícito: "deve
   * mostrar também quando foi enviado as ondas de rmkt". null quando a
   * campanha não usa rmktWaves, ou nenhuma onda saiu ainda. Junto com
   * nextWaveNumber (a onda que ISSO foi) dá pra mostrar "Onda 2 enviada:
   * 11/09" em vez de só uma data solta sem contexto de qual onda era.
   */
  lastWaveSentAt: Date | null;
  /** Número (1-based) da onda que lastWaveSentAt registra — null quando lastWaveSentAt também é null. */
  lastWaveNumber: number | null;
  /**
   * Previsão de quando o reenvio automático deve sair pra ESTE destinatário
   * — sentAt + followUpDelayHours (reenvio único) ou sentAt +
   * rmktWaves[nextWaveIndex].dayOffset dias (onda de RMKT), só quando ele
   * de fato está na fila (ver findFollowUpCandidate/findNextWaveCandidate
   * em lib/campaigns/engine.ts). null quando já foi reenviado/todas as
   * ondas já saíram, já respondeu, ou a campanha não tem reenvio nem RMKT
   * ligado. Mesma ideia de "estimativa, não garantia" que
   * nextSendEstimateAt já é lá embaixo: o motor real ainda respeita janela
   * de horário/dias e teto diário.
   */
  nextFollowUpAt: Date | null;
  scriptName: string | null;
  followUpScriptName: string | null;
  error: string | null;
};

/** Um ponto do gráfico do painel de métricas — um dia (calendário de Brasília), quantos envios e quantas respostas. */
export type CampaignDailyMetric = { date: string; sent: number; replied: number };

/**
 * Um script usado pela campanha (envio inicial, reenvio ou onda de RMKT) — o
 * que o painel "Scripts desta campanha" mostra (ver campaign-scripts-panel.tsx).
 * `state` compara a CÓPIA da campanha com a biblioteca: "outdated" = a
 * biblioteca tem texto/versão diferente (alguém editou e a campanha não
 * recebeu), "missing" = script apagado da biblioteca (a cópia continua
 * enviando normalmente).
 */
export type CampaignScriptRow = {
  key: string;
  scriptId: string;
  name: string;
  kind: "initial" | "followUp" | "wave";
  /** "Onda 2 · dia 5" — só pra kind "wave". */
  waveLabel: string | null;
  /** Fatia de sorteio entre as variantes do mesmo grupo (só quando há mais de uma). */
  sharePct: number | null;
  copyVersion: number;
  libraryVersion: number | null;
  state: "in-sync" | "outdated" | "missing";
  preview: string | null;
};

export type CampaignDetail = CampaignSummary & {
  /**
   * O WhatsApp por trás do aviso "pausada automaticamente" (o que derrubou a campanha — em envio em
   * massa do Pipeline, um dos vários). Só vem preenchido quando o motivo da pausa é sobre um WhatsApp.
   */
  pauseInstance: { ownerName: string; status: $Enums.WhatsAppInstanceStatus; disconnectedAt: Date | null } | null;
  /**
   * RUNNING com o WhatsApp da campanha fora do ar: o motor só PAUSA quando há um envio a fazer (uma
   * campanha que só espera prazo de reenvio segue "Rodando" sem mandar nada), então a tela avisa nesse
   * meio-tempo. Só campanha de UM WhatsApp (no envio em massa do Pipeline cada destinatário tem o seu).
   */
  whatsappOffline: { ownerName: string; disconnectedAt: Date | null } | null;
  /** Scripts em uso e se a cópia da campanha está igual à biblioteca. */
  scripts: CampaignScriptRow[];
  /** A campanha ainda pode receber alteração de script (rascunho/rodando/pausada). */
  scriptsEditable: boolean;
  dailyMetrics: CampaignDailyMetric[];
  completionEstimate: CompletionEstimate;
  /**
   * Estimativa de quando o próximo envio deve acontecer — último envio (ou
   * reenvio) + o delay médio configurado. É só uma expectativa: o motor real
   * (lib/campaigns/engine.ts's shouldSendNow) sorteia um novo limiar dentro
   * da faixa min/max a cada checagem do cron, então o disparo de verdade pode
   * acontecer um pouco antes ou depois deste instante. null quando não há
   * envio em andamento pra estimar (campanha não RUNNING, ou sem pendentes).
   */
  nextSendEstimateAt: Date | null;
  /**
   * Quantos destinatários já foram enviados, não responderam, e ainda vão
   * receber o reenvio automático (ver nextFollowUpAt em
   * CampaignRecipientRow) — pedido explícito: "não mostra quando vai
   * começar a fase de follow-up". 0 quando followUpEnabled é falso, ou
   * quando todo mundo já respondeu/já foi reenviado. Alimentado tanto por
   * followUpEnabled (reenvio único) quanto por rmktWaves (várias ondas,
   * campanhas LEAD_CAPTURE) — os dois mecanismos que a engine processa.
   */
  pendingFollowUpCount: number;
  /** O mais próximo entre todos os nextFollowUpAt de pendingFollowUpCount — null quando esse contador é 0. */
  nextFollowUpEstimateAt: Date | null;
  /** true quando a campanha usa ondas de RMKT (Campaign.rmktWaves) em vez do reenvio único — decide o texto do card de fase de follow-up (dias por onda, não "Xh depois"). */
  hasRmktWaves: boolean;
};

/**
 * Agrupa os eventos por dia dentro do Postgres. Uma campanha pode ter dezenas
 * de milhares de destinatarios; transferir sentAt/repliedAt de todos eles so
 * para somar no Node anulava a paginacao da tabela da mesma tela.
 */
async function getCampaignDailyMetrics(
  organizationId: string,
  campaignId: string,
  visibleInstanceOwnerIds: string[] | null,
): Promise<CampaignDailyMetric[]> {
  const recipientScopeSql =
    visibleInstanceOwnerIds === null
      ? Prisma.empty
      : visibleInstanceOwnerIds.length > 0
        ? Prisma.sql`AND EXISTS (
            SELECT 1
            FROM "WhatsAppInstance" i
            WHERE i.id = r."instanceId"
              AND i."kind" = 'PERSONAL'
              AND i."userId" IN (${Prisma.join(visibleInstanceOwnerIds)})
          )`
        : Prisma.sql`AND false`;

  const rows = await prismaRaw.$transaction(async (tx) => {
    await setTenantOnTx(tx, organizationId);
    return tx.$queryRaw<{ date: string; sent: number; replied: number }[]>`
      WITH events AS (
        SELECT
          ((r."sentAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande')::date AS day,
          1::int AS sent,
          0::int AS replied
        FROM "CampaignRecipient" r
        WHERE r."campaignId" = ${campaignId}
          AND r."sentAt" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "Campaign" c
            WHERE c.id = r."campaignId" AND c."organizationId" = ${organizationId}
          )
          ${recipientScopeSql}

        UNION ALL

        SELECT
          ((r."repliedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande')::date AS day,
          0::int AS sent,
          1::int AS replied
        FROM "CampaignRecipient" r
        WHERE r."campaignId" = ${campaignId}
          AND r."repliedAt" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "Campaign" c
            WHERE c.id = r."campaignId" AND c."organizationId" = ${organizationId}
          )
          ${recipientScopeSql}
      )
      SELECT
        to_char(day, 'YYYY-MM-DD') AS date,
        SUM(sent)::int AS sent,
        SUM(replied)::int AS replied
      FROM events
      GROUP BY day
      ORDER BY day
    `;
  });

  return rows.map((row) => ({
    date: row.date,
    sent: Number(row.sent),
    replied: Number(row.replied),
  }));
}

/**
 * Usado pela tela de destinatários — uma linha por contato (nome/telefone
 * incluídos), com status individual, mais a série diária pro painel de
 * métricas. `scope` obrigatório pelo mesmo motivo de listCampaigns acima —
 * sem ele, Consultor abrindo a URL de uma campanha alheia (nem precisava
 * adivinhar o id: aparecia na própria lista) via a lista de leads de outro.
 *
 * `dealScope` é um escopo SEPARADO de `scope`, de propósito: `scope` decide
 * quais CAMPANHAS a pessoa vê (por quem criou), `dealScope` decide quais
 * NEGÓCIOS ela consegue abrir (mesmo escopo de /negocios/[id], inclusive
 * grupos de compartilhamento — ver getSharedScope). Numa campanha MANUAL o
 * negócio de quem respondeu cai num dono sorteado (rodízio, ver
 * lib/campaigns/reply.ts), que pode ser outro consultor — sem filtrar aqui,
 * o "Ver negócio" levaria o criador da campanha pra um 404.
 */
export async function getCampaignDetail(
  organizationId: string,
  campaignId: string,
  scope: DealScope,
): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, ...campaignVisibilityWhere(scope) },
    include: {
      instance: { include: { personalOwner: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!campaign) return null;
  const canManage = canManageCampaign(scope, {
    createdById: campaign.createdById,
    source: campaign.source,
    instanceUserId: campaign.instance.personalOwnerId ?? "",
  });

  const templateEntries = listCampaignScriptEntries(campaign);
  const scriptIds = Array.from(new Set(templateEntries.map((entry) => entry.scriptId)));
  const recipientWhere: Prisma.CampaignRecipientWhereInput = {
    campaignId,
    ...campaignRecipientVisibilityWhere(scope),
  };
  const visibleInstanceOwnerIds = !canManage && scope.type === "owners" ? scope.ownerIds : null;
  const rmktWaves = Array.isArray(campaign.rmktWaves) ? (campaign.rmktWaves as { dayOffset: number }[]) : [];

  const followUpSummaryPromise = (async (): Promise<{ count: number; nextAt: Date | null }> => {
    if (campaign.followUpEnabled) {
      const summary = await prisma.campaignRecipient.aggregate({
        where: {
          ...recipientWhere,
          status: "SENT",
          repliedAt: null,
          followUpSentAt: null,
          sentAt: { not: null },
        },
        _count: { _all: true },
        _min: { sentAt: true },
      });
      return {
        count: summary._count._all,
        nextAt: summary._min.sentAt
          ? new Date(summary._min.sentAt.getTime() + campaign.followUpDelayHours * 60 * 60 * 1000)
          : null,
      };
    }

    if (rmktWaves.length === 0) return { count: 0, nextAt: null };

    const groups = await prisma.campaignRecipient.groupBy({
      by: ["nextWaveIndex"],
      where: {
        ...recipientWhere,
        status: "SENT",
        repliedAt: null,
        sentAt: { not: null },
        nextWaveIndex: { lt: rmktWaves.length },
      },
      _count: { _all: true },
      _min: { sentAt: true },
    });

    let count = 0;
    let nextAt: Date | null = null;
    for (const group of groups) {
      const wave = rmktWaves[group.nextWaveIndex];
      if (!wave || !group._min.sentAt) continue;
      count += group._count._all;
      const candidate = new Date(group._min.sentAt.getTime() + wave.dayOffset * 24 * 60 * 60 * 1000);
      if (!nextAt || candidate < nextAt) nextAt = candidate;
    }
    return { count, nextAt };
  })();

  const [scripts, statusCounts, repliedCount, lastEvents, dailyMetrics, followUpSummary] = await Promise.all([
    scriptIds.length
      ? prisma.messageScript.findMany({
          where: { id: { in: scriptIds } },
          select: { id: true, name: true, version: true, steps: true },
        })
      : Promise.resolve([]),
    prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: recipientWhere,
      _count: { _all: true },
    }),
    prisma.campaignRecipient.count({ where: { ...recipientWhere, repliedAt: { not: null } } }),
    prisma.campaignRecipient.aggregate({
      where: recipientWhere,
      _max: { sentAt: true, followUpSentAt: true },
    }),
    getCampaignDailyMetrics(organizationId, campaignId, visibleInstanceOwnerIds),
    followUpSummaryPromise,
  ]);
  const libraryById = new Map(scripts.map((s) => [s.id, s]));

  const firstStepText = (steps: unknown): string | null => {
    const first = Array.isArray(steps) ? (steps[0] as { text?: string } | undefined)?.text : undefined;
    return first ? (first.length > 160 ? `${first.slice(0, 160)}…` : first) : null;
  };
  // Peso só vira "%" quando há mais de uma variante no MESMO grupo (envio
  // inicial / reenvio / cada onda) — uma variante sozinha é sempre 100%.
  const groupKey = (e: { kind: string; waveIndex?: number }) => `${e.kind}:${e.waveIndex ?? ""}`;
  const groupWeight = new Map<string, { total: number; count: number }>();
  for (const e of templateEntries) {
    const g = groupWeight.get(groupKey(e)) ?? { total: 0, count: 0 };
    g.total += Math.max(0, e.weight);
    g.count += 1;
    groupWeight.set(groupKey(e), g);
  }
  const scriptRows: CampaignScriptRow[] = templateEntries.map((e, i) => {
    const lib = libraryById.get(e.scriptId);
    const g = groupWeight.get(groupKey(e))!;
    const copyVersion = e.scriptVersion ?? 1;
    const state: CampaignScriptRow["state"] = !lib
      ? "missing"
      : normalizeSteps(e.steps) !== normalizeSteps(lib.steps) || copyVersion !== lib.version
        ? "outdated"
        : "in-sync";
    return {
      key: `${groupKey(e)}:${e.scriptId}:${i}`,
      scriptId: e.scriptId,
      name: lib?.name ?? "Script removido da biblioteca",
      kind: e.kind,
      waveLabel: e.kind === "wave" ? `Onda ${(e.waveIndex ?? 0) + 1}${e.waveDayOffset != null ? ` · dia ${e.waveDayOffset}` : ""}` : null,
      sharePct: g.count > 1 && g.total > 0 ? Math.round((Math.max(0, e.weight) / g.total) * 100) : null,
      copyVersion,
      libraryVersion: lib?.version ?? null,
      state,
      preview: firstStepText(e.steps),
    };
  });

  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0, replied: repliedCount };
  for (const row of statusCounts) {
    if (row.status === "PENDING") counts.pending = row._count._all;
    if (row.status === "SENT") counts.sent = row._count._all;
    if (row.status === "FAILED") counts.failed = row._count._all;
    if (row.status === "SKIPPED") counts.skipped = row._count._all;
  }

  const lastAt = [lastEvents._max.sentAt, lastEvents._max.followUpSentAt]
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  // Previsão de reenvio por destinatário — cobre os DOIS mecanismos que a
  // engine (lib/campaigns/engine.ts) sabe processar, cada campanha usa só
  // um dos dois na prática (nunca os dois ao mesmo tempo):
  // - followUpEnabled: reenvio único, mesmo critério de findFollowUpCandidate
  //   (SENT, nunca respondeu, reenvio ainda não tentado).
  // - rmktWaves: sequência de ondas (campanhas LEAD_CAPTURE), mesmo critério
  //   de findNextWaveCandidate (SENT, nunca respondeu, ainda dentro do
  //   array de ondas) — dayOffset conta do envio INICIAL, não da onda
  //   anterior (mesma regra da engine).
  // Calculado uma vez aqui e reaproveitado tanto no total agregado
  // (pendingFollowUpCount/nextFollowUpEstimateAt) quanto por linha
  // (recipients.map lá embaixo) — sem isso, uma campanha com RMKT
  // configurado (não followUpEnabled) nunca mostrava nada na coluna
  // "Reenvio" nem no card de fase de follow-up, mesmo enviando onda de
  // verdade sozinha (relatado: "verifique se está sendo enviado o rmkt
  // porque foi programado e não foi ainda parece" — a engine estava
  // funcionando certo, só a tela não sabia mostrar esse tipo de campanha).
  const pendingFollowUpCount = followUpSummary.count;
  const nextFollowUpEstimateAt = followUpSummary.nextAt;

  const audienceFilter = parseAudienceFilter(campaign.audienceFilter);
  const completionEstimate = estimateCampaignCompletion(
    {
      delayMinSec: campaign.delayMinSec,
      delayMaxSec: campaign.delayMaxSec,
      dailyCap: campaign.dailyCap,
      allowedWeekdays: campaign.allowedWeekdays,
      windowStartHour: campaign.windowStartHour,
      windowEndHour: campaign.windowEndHour,
    },
    counts.pending,
  );

  // Sem nenhum envio ainda (lastAt null), o motor manda no próximo tick sem
  // exigir delay nenhum (ver shouldSendNow em lib/campaigns/engine.ts) — só
  // soma o delay médio quando já existe um envio anterior pra contar a partir dele.
  // Sempre empurrado pra dentro da janela de horário/dias permitida — sem
  // isso, uma campanha fora do horário (ex.: depois das 18h) mostrava "a
  // qualquer momento" mesmo não podendo mandar nada até o próximo dia útil.
  const nextSendEstimateAt =
    campaign.status === "RUNNING" && counts.pending > 0
      ? nextAllowedSendWindow(
          campaign,
          lastAt ? new Date(lastAt.getTime() + completionEstimate.avgDelaySec * 1000) : new Date(),
        )
      : null;

  // Mesmo empurrão pra dentro da janela permitida que nextSendEstimateAt já
  // leva acima — reenvio passa pelo mesmo shouldSendNow/janela de horário
  // do envio inicial (ver lib/campaigns/engine.ts), então um prazo que caiu
  // de madrugada só sai de verdade na próxima janela permitida.
  const nextFollowUpEstimateAtInWindow =
    campaign.status === "RUNNING" && nextFollowUpEstimateAt ? nextAllowedSendWindow(campaign, nextFollowUpEstimateAt) : nextFollowUpEstimateAt;

  const pausedReason = campaign.status === "PAUSED" ? parsePauseReason(campaign.pausedReason) : null;
  let pauseInstance: CampaignDetail["pauseInstance"] = null;
  if (pausedReason === PAUSE_REASON.WHATSAPP_DISCONNECTED || pausedReason === PAUSE_REASON.WHATSAPP_INSTABILITY) {
    // Numa campanha de UM WhatsApp é o `instance` que já veio no include; no envio em massa do Pipeline
    // (um WhatsApp por destinatário) é o que a pausa gravou.
    const source =
      campaign.pausedInstanceId && campaign.pausedInstanceId !== campaign.instanceId
        ? await prisma.whatsAppInstance.findUnique({
            where: { id: campaign.pausedInstanceId },
            select: { status: true, disconnectedAt: true, personalOwner: { select: { name: true } } },
          })
        : campaign.instance;
    if (source) {
      pauseInstance = {
        ownerName: source.personalOwner?.name ?? "WhatsApp pessoal",
        status: source.status,
        disconnectedAt: source.disconnectedAt,
      };
    }
  }
  const whatsappOffline: CampaignDetail["whatsappOffline"] =
    campaign.status === "RUNNING" && campaign.source !== "PIPELINE_BULK" && campaign.instance.status !== "CONNECTED"
      ? { ownerName: campaign.instance.personalOwner?.name ?? "WhatsApp pessoal", disconnectedAt: campaign.instance.disconnectedAt }
      : null;

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    pausedReason,
    pauseInstance,
    whatsappOffline,
    audienceFilter,
    audienceLabel: describeAudienceFilter(audienceFilter),
    instanceName: campaign.instance.personalOwner?.name ?? "WhatsApp pessoal",
    createdByName: campaign.createdBy.name,
    delayMinSec: campaign.delayMinSec,
    delayMaxSec: campaign.delayMaxSec,
    dailyCap: campaign.dailyCap,
    allowedWeekdays: campaign.allowedWeekdays,
    windowStartHour: campaign.windowStartHour,
    windowEndHour: campaign.windowEndHour,
    followUpEnabled: campaign.followUpEnabled,
    followUpDelayHours: campaign.followUpDelayHours,
    createdAt: campaign.createdAt,
    counts,
    canManage,
    scripts: scriptRows,
    // Trocar o script mexe na campanha — só quem pode gerenciá-la (as rotas de
    // edição/sync usam o escopo de criador e recusariam).
    scriptsEditable: canManage && ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status),
    dailyMetrics,
    completionEstimate,
    nextSendEstimateAt,
    pendingFollowUpCount,
    nextFollowUpEstimateAt: nextFollowUpEstimateAtInWindow,
    hasRmktWaves: rmktWaves.length > 0,
  };
}

export type CampaignRecipientsPage = {
  items: CampaignRecipientRow[];
  total: number;
  offset: number;
  limit: number;
};

export type CampaignRecipientFilters = {
  offset?: number;
  limit?: number;
  q?: string;
  status?: $Enums.CampaignRecipientStatus;
  onlyReplied?: boolean;
};

/**
 * Carrega apenas a janela de destinatarios que a tela consegue exibir. A
 * autorizacao da campanha e o recorte dos destinatarios sao independentes:
 * quem apenas enxerga um envio compartilhado continua vendo somente as linhas
 * do proprio WhatsApp.
 */
export async function getCampaignRecipientsPage(
  organizationId: string,
  campaignId: string,
  scope: DealScope,
  dealScope: DealScope,
  filters: CampaignRecipientFilters = {},
): Promise<CampaignRecipientsPage | null> {
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(filters.limit ?? 50)));
  const q = filters.q?.trim().slice(0, 100) ?? "";

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, ...campaignVisibilityWhere(scope) },
    select: {
      id: true,
      followUpEnabled: true,
      followUpDelayHours: true,
      rmktWaves: true,
    },
  });
  if (!campaign) return null;

  const where: Prisma.CampaignRecipientWhereInput = {
    campaignId,
    ...campaignRecipientVisibilityWhere(scope),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.onlyReplied ? { repliedAt: { not: null } } : {}),
    ...(q
      ? {
          contact: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { whatsapp: { contains: q } },
            ],
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.campaignRecipient.count({ where }),
    prisma.campaignRecipient.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        contactId: true,
        status: true,
        threadId: true,
        dealId: true,
        sentAt: true,
        repliedAt: true,
        followUpSentAt: true,
        lastWaveSentAt: true,
        nextWaveIndex: true,
        scriptId: true,
        followUpScriptId: true,
        error: true,
        followUpError: true,
        contact: { select: { name: true, whatsapp: true, phone: true, jobTitle: true } },
      },
    }),
  ]);

  const scriptIds = Array.from(
    new Set(rows.flatMap((row) => [row.scriptId, row.followUpScriptId]).filter((id): id is string => !!id)),
  );
  const repliedContactIds = Array.from(new Set(rows.filter((row) => row.repliedAt).map((row) => row.contactId)));
  const scriptsPromise: Promise<{ id: string; name: string }[]> = scriptIds.length
    ? prisma.messageScript.findMany({ where: { id: { in: scriptIds } }, select: { id: true, name: true } })
    : Promise.resolve([]);
  const dealsPromise: Promise<{ id: string; contactId: string; status: $Enums.DealStatus }[]> = repliedContactIds.length
    ? prisma.deal.findMany({
        where: { organizationId, contactId: { in: repliedContactIds }, ...scopeWhere(dealScope) },
        select: { id: true, contactId: true, status: true },
        orderBy: { createdAt: "desc" },
      })
    : Promise.resolve([]);
  const [scripts, visibleDeals] = await Promise.all([scriptsPromise, dealsPromise]);

  const scriptNameById = new Map(scripts.map((script) => [script.id, script.name]));
  const dealsByContact = new Map<string, typeof visibleDeals>();
  for (const deal of visibleDeals) {
    const list = dealsByContact.get(deal.contactId);
    if (list) list.push(deal);
    else dealsByContact.set(deal.contactId, [deal]);
  }

  const waves = Array.isArray(campaign.rmktWaves) ? (campaign.rmktWaves as { dayOffset: number }[]) : [];

  const items = rows.map((row): CampaignRecipientRow => {
    let nextFollowUpAt: Date | null = null;
    if (campaign.followUpEnabled && row.status === "SENT" && !row.repliedAt && !row.followUpSentAt && row.sentAt) {
      nextFollowUpAt = new Date(row.sentAt.getTime() + campaign.followUpDelayHours * 60 * 60 * 1000);
    } else if (waves.length > 0 && row.status === "SENT" && !row.repliedAt && row.nextWaveIndex < waves.length && row.sentAt) {
      const wave = waves[row.nextWaveIndex];
      if (wave) nextFollowUpAt = new Date(row.sentAt.getTime() + wave.dayOffset * 24 * 60 * 60 * 1000);
    }

    const deals = row.repliedAt ? dealsByContact.get(row.contactId) : undefined;
    const dealId = deals
      ? deals.find((deal) => deal.id === row.dealId)?.id ??
        deals.find((deal) => deal.status === "OPEN")?.id ??
        deals[0]?.id ??
        null
      : null;

    return {
      id: row.id,
      contactName: row.contact.name,
      contactPhone: row.contact.whatsapp || row.contact.phone,
      contactJobTitle: row.contact.jobTitle,
      status: row.status,
      threadId: row.threadId,
      dealId,
      sentAt: row.sentAt,
      repliedAt: row.repliedAt,
      followUpSentAt: row.followUpSentAt,
      lastWaveSentAt: row.lastWaveSentAt,
      lastWaveNumber: row.lastWaveSentAt ? row.nextWaveIndex : null,
      nextFollowUpAt,
      scriptName: row.scriptId ? (scriptNameById.get(row.scriptId) ?? "Script removido") : null,
      followUpScriptName: row.followUpScriptId
        ? (scriptNameById.get(row.followUpScriptId) ?? "Script removido")
        : null,
      error: row.error ?? row.followUpError,
    };
  });

  return { items, total, offset, limit };
}
