import { prisma } from "@/lib/prisma";
import type { $Enums } from "@/app/generated/prisma/client";
import { parseAudienceFilter, describeAudienceFilter, type AudienceFilter } from "@/lib/campaigns/audience";
import { brazilDateKey } from "@/lib/timezone";
import { estimateCampaignCompletion, nextAllowedSendWindow, type CompletionEstimate } from "@/lib/campaigns/estimate";
import {
  campaignVisibilityWhere,
  campaignRecipientVisibilityWhere,
  canManageCampaign,
  scopeWhere,
  type DealScope,
} from "@/lib/team-scope";
import { listCampaignScriptEntries, normalizeSteps, ACTIVE_CAMPAIGN_STATUSES } from "@/lib/campaigns/script-sync";

export type CampaignSummary = {
  id: string;
  name: string;
  status: $Enums.CampaignStatus;
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
      instance: { select: { userId: true, user: { select: { name: true } } } },
      createdBy: { select: { name: true } },
    },
  });

  const campaignIds = campaigns.map((c) => c.id);
  const statusCounts = await prisma.campaignRecipient.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaignIds }, ...recipientVisibility },
    _count: true,
  });
  // Contagem de respondidos, não a lista deles: antes isto era um findMany que
  // trazia UMA LINHA POR RESPOSTA (só o campaignId era lido) — uma campanha
  // com 5.000 respostas transferia 5.000 linhas pra depois contar de um em um.
  // O banco já devolve o número pronto.
  const repliedCounts = await prisma.campaignRecipient.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: campaignIds }, repliedAt: { not: null }, ...recipientVisibility },
    _count: true,
  });

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
      audienceFilter,
      audienceLabel: describeAudienceFilter(audienceFilter),
      instanceName: c.instance.user.name,
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
      canManage: canManageCampaign(scope, { createdById: c.createdById, source: c.source, instanceUserId: c.instance.userId }),
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
  recipients: CampaignRecipientRow[];
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
  dealScope: DealScope,
): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, ...campaignVisibilityWhere(scope) },
    include: {
      instance: { include: { user: { select: { name: true } } } },
      createdBy: { select: { name: true } },
      recipients: {
        // Quem só enxerga um envio em massa (por ter o WhatsApp usado) vê só os
        // destinatários que saíram do WhatsApp dele — ver campaignRecipientVisibilityWhere.
        where: campaignRecipientVisibilityWhere(scope),
        orderBy: { createdAt: "asc" },
        include: { contact: { select: { name: true, whatsapp: true, phone: true, jobTitle: true } } },
      },
    },
  });
  if (!campaign) return null;
  const canManage = canManageCampaign(scope, {
    createdById: campaign.createdById,
    source: campaign.source,
    instanceUserId: campaign.instance.userId,
  });

  const templateEntries = listCampaignScriptEntries(campaign);
  const scriptIds = Array.from(
    new Set([
      ...campaign.recipients.flatMap((r) => [r.scriptId, r.followUpScriptId]).filter((id): id is string => !!id),
      ...templateEntries.map((e) => e.scriptId),
    ]),
  );
  const scripts = scriptIds.length
    ? await prisma.messageScript.findMany({ where: { id: { in: scriptIds } }, select: { id: true, name: true, version: true, steps: true } })
    : [];
  const scriptNameById = new Map(scripts.map((s) => [s.id, s.name]));
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

  // Negócio de quem respondeu. recipient.dealId sozinho não basta: reply.ts
  // só o grava quando CRIA um negócio novo — se o contato já tinha um
  // negócio aberto na hora da resposta, sai sem gravar nada, então esse caso
  // (o mais comum) chega aqui com dealId null. Por isso busca pelo contato,
  // já filtrando pelo que quem está olhando consegue abrir.
  const repliedContactIds = Array.from(new Set(campaign.recipients.filter((r) => r.repliedAt).map((r) => r.contactId)));
  const visibleDeals = repliedContactIds.length
    ? await prisma.deal.findMany({
        where: { organizationId, contactId: { in: repliedContactIds }, ...scopeWhere(dealScope) },
        select: { id: true, contactId: true, status: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const dealsByContact = new Map<string, typeof visibleDeals>();
  for (const d of visibleDeals) {
    const list = dealsByContact.get(d.contactId);
    if (list) list.push(d);
    else dealsByContact.set(d.contactId, [d]);
  }
  // Preferência: o negócio que a própria campanha ligou a este destinatário
  // (dealId) → o mais recente ainda aberto → o mais recente de qualquer
  // status (ex.: já ganho/perdido, ainda vale abrir pra ver o histórico).
  const pickDealId = (r: { dealId: string | null; contactId: string; repliedAt: Date | null }): string | null => {
    if (!r.repliedAt) return null;
    const deals = dealsByContact.get(r.contactId);
    if (!deals || deals.length === 0) return null;
    return (
      deals.find((d) => d.id === r.dealId)?.id ?? deals.find((d) => d.status === "OPEN")?.id ?? deals[0].id
    );
  };

  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0, replied: 0 };
  let lastAt: Date | null = null;
  const metricsByDay = new Map<string, CampaignDailyMetric>();
  const bump = (date: Date, field: "sent" | "replied") => {
    const key = brazilDateKey(date);
    const entry = metricsByDay.get(key) ?? { date: key, sent: 0, replied: 0 };
    entry[field] += 1;
    metricsByDay.set(key, entry);
  };

  // Ondas de RMKT (Campaign.rmktWaves) — mesmo parse trivial (sem validação,
  // o formato já foi validado na criação) de parseRmktWaves em
  // lib/campaigns/engine.ts, não exportado de lá pra não criar acoplamento
  // com um arquivo de motor só por causa de uma linha.
  const rmktWaves = Array.isArray(campaign.rmktWaves) ? (campaign.rmktWaves as { dayOffset: number }[]) : [];

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
  const nextFollowUpAtByRecipient = new Map<string, Date>();
  let pendingFollowUpCount = 0;
  let nextFollowUpEstimateAt: Date | null = null;

  for (const r of campaign.recipients) {
    if (r.status === "PENDING") counts.pending += 1;
    if (r.status === "SENT") counts.sent += 1;
    if (r.status === "FAILED") counts.failed += 1;
    if (r.status === "SKIPPED") counts.skipped += 1;
    if (r.repliedAt) counts.replied += 1;
    if (r.sentAt) bump(r.sentAt, "sent");
    if (r.repliedAt) bump(r.repliedAt, "replied");
    // Mesmo "último evento" que shouldSendNow usa em engine.ts — precisa do
    // maior timestamp entre envio inicial e reenvio, não só um dos dois.
    if (r.sentAt && (!lastAt || r.sentAt > lastAt)) lastAt = r.sentAt;
    if (r.followUpSentAt && (!lastAt || r.followUpSentAt > lastAt)) lastAt = r.followUpSentAt;

    let at: Date | null = null;
    if (campaign.followUpEnabled && r.status === "SENT" && !r.repliedAt && !r.followUpSentAt && r.sentAt) {
      at = new Date(r.sentAt.getTime() + campaign.followUpDelayHours * 60 * 60 * 1000);
    } else if (rmktWaves.length > 0 && r.status === "SENT" && !r.repliedAt && r.nextWaveIndex < rmktWaves.length && r.sentAt) {
      const wave = rmktWaves[r.nextWaveIndex];
      if (wave) at = new Date(r.sentAt.getTime() + wave.dayOffset * 24 * 60 * 60 * 1000);
    }
    if (at) {
      nextFollowUpAtByRecipient.set(r.id, at);
      pendingFollowUpCount += 1;
      if (!nextFollowUpEstimateAt || at < nextFollowUpEstimateAt) nextFollowUpEstimateAt = at;
    }
  }

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

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    audienceFilter,
    audienceLabel: describeAudienceFilter(audienceFilter),
    instanceName: campaign.instance.user.name,
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
    recipients: campaign.recipients.map((r) => ({
      id: r.id,
      contactName: r.contact.name,
      contactPhone: r.contact.whatsapp || r.contact.phone,
      contactJobTitle: r.contact.jobTitle,
      status: r.status,
      threadId: r.threadId,
      dealId: pickDealId(r),
      sentAt: r.sentAt,
      repliedAt: r.repliedAt,
      followUpSentAt: r.followUpSentAt,
      lastWaveSentAt: r.lastWaveSentAt,
      // nextWaveIndex já avançou pra depois da onda enviada quando
      // lastWaveSentAt existe (ver claimRecipient em lib/campaigns/engine.ts:
      // os dois são gravados juntos, no mesmo updateMany) — nextWaveIndex
      // (1-based) É o número da onda que acabou de sair.
      lastWaveNumber: r.lastWaveSentAt ? r.nextWaveIndex : null,
      nextFollowUpAt: nextFollowUpAtByRecipient.get(r.id) ?? null,
      scriptName: r.scriptId ? (scriptNameById.get(r.scriptId) ?? "Script removido") : null,
      followUpScriptName: r.followUpScriptId ? (scriptNameById.get(r.followUpScriptId) ?? "Script removido") : null,
      error: r.error ?? r.followUpError,
    })),
    dailyMetrics: Array.from(metricsByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    completionEstimate,
    nextSendEstimateAt,
    pendingFollowUpCount,
    nextFollowUpEstimateAt: nextFollowUpEstimateAtInWindow,
    hasRmktWaves: rmktWaves.length > 0,
  };
}
