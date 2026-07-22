import Link from "next/link";
import { Clock, CircleCheck, CircleDollarSign, FileWarning, MessageCircle, Target, Flag, Inbox, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { getContactsWithUnreadWhatsApp } from "@/lib/processes/whatsapp-signals";
import { isStale, STALE_DEAL_DAYS } from "@/lib/stale";
import { daysSince, formatDuration } from "@/lib/format";
import { brazilDateStringToUTC, brazilEndOfDayUTC, brazilStartOfMonth, getBrazilParts } from "@/lib/timezone";
import { Avatar } from "@/components/avatar";
import { Leaderboard } from "@/components/leaderboard";
import { TrendAreaChart } from "@/components/charts/trend-area-chart";
import { BarRow } from "./bar-row";
import { DateRangeFilter } from "./date-range-filter";
import { TeamOwnerFilter } from "./team-owner-filter";

/**
 * Relatório do Administrativo (pós-venda) — substitui o dashboard de
 * vendas (funil/metas não fazem sentido aqui). Foco no que o administrativo
 * precisa saber de relance: quantos processos em cada etapa, quantos
 * parados, quantos com pagamento/documentação pendente.
 */
export async function AdminReportsView({ from, to, who }: { from?: string; to?: string; who?: string }) {
  const access = await requireProcessAccess();
  if (!access.ok) return null;

  return runWithTenant(access.organizationId, async () => {
  const scopeWhere = processScopeWhere(access);
  // Filtro "responsável" só estreita o que o escopo já permite — nunca
  // deixa alguém sem `isAdmin` escolher outro dono via URL e ver processo
  // que não é dele (mesmo risco de BOLA já resolvido no comercial).
  // whoParam vem no formato "owner:<id>" (mesmo componente TeamOwnerFilter
  // do relatório comercial, sem opção de equipe aqui).
  const filterOwnerId = access.isAdmin && who?.startsWith("owner:") ? who.slice(6) : undefined;
  const ownerFilter = { ...scopeWhere, ...(filterOwnerId ? { ownerId: filterOwnerId } : {}) };
  // ProcessStageHistory e ProcessRequest não têm ownerId próprio (não são
  // "do consultor" diretamente) — escopa pela relação com Process, mesma
  // regra de admin-vê-tudo/consultor-só-o-seu de processScopeWhere.
  const relatedProcessFilter = { process: ownerFilter };

  // fromParam/toParam são dias civis de Brasília (mesma UI/convenção do
  // relatório comercial) — servidor roda em UTC, então usa os mesmos
  // helpers Brasília-aware pra não deslocar o filtro em 3h.
  const rangeFrom = from ? brazilDateStringToUTC(from) : null;
  const rangeTo = to ? brazilEndOfDayUTC(to) : null;

  const [processes, contemplatedCount, paymentPendingCount, documentPendingCount, stageCatalogRows, stageHistory, processRequests, ownerRows] =
    await Promise.all([
      prisma.process.findMany({
        where: { organizationId: access.organizationId, ...ownerFilter },
        include: { stage: true, contact: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } },
      }),
      prisma.process.count({ where: { organizationId: access.organizationId, ...ownerFilter, contemplated: true } }),
      prisma.process.count({ where: { organizationId: access.organizationId, ...ownerFilter, paymentPending: true } }),
      prisma.process.count({
        where: { organizationId: access.organizationId, ...ownerFilter, documentStatus: { not: "DELIVERED" } },
      }),
      // Catálogo completo de etapas (não só as ocupadas agora) — uma etapa
      // pode ter passado gente no histórico sem ter ninguém nela hoje, e
      // ainda assim entra no "tempo médio por etapa" abaixo.
      prisma.processStage.findMany({
        where: { pipeline: { organizationId: access.organizationId } },
        select: { id: true, name: true, color: true, order: true, isFinal: true },
      }),
      prisma.processStageHistory.findMany({
        where: { organizationId: access.organizationId, ...relatedProcessFilter },
        orderBy: [{ processId: "asc" }, { changedAt: "asc" }],
        select: { processId: true, fromStageId: true, toStageId: true, changedAt: true },
      }),
      prisma.processRequest.findMany({
        where: { organizationId: access.organizationId, ...relatedProcessFilter },
        select: { createdAt: true, resolvedAt: true },
      }),
      // Catálogo do filtro "responsável" — sempre TODOS os donos visíveis no
      // escopo base (ignora o `who` atual), senão escolher alguém some com
      // as outras opções do dropdown.
      prisma.process.findMany({
        where: { organizationId: access.organizationId, ...scopeWhere },
        select: { ownerId: true, owner: { select: { name: true } } },
        distinct: ["ownerId"],
      }),
    ]);

  const ownerOptions = ownerRows
    .map((o) => ({ id: o.ownerId, name: o.owner.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const unreadContactIds = await getContactsWithUnreadWhatsApp(
    access.organizationId,
    processes.map((p) => p.contact.id),
  );

  const stageCounts = new Map<string, { name: string; color: string | null; count: number }>();
  for (const p of processes) {
    const existing = stageCounts.get(p.stageId);
    if (existing) existing.count += 1;
    else stageCounts.set(p.stageId, { name: p.stage.name, color: p.stage.color, count: 1 });
  }
  const maxStageCount = Math.max(1, ...Array.from(stageCounts.values()).map((s) => s.count));

  const staleProcesses = processes
    .filter((p) => !p.stage.isFinal && isStale(p.stageEnteredAt))
    .sort((a, b) => a.stageEnteredAt.getTime() - b.stageEnteredAt.getTime());

  // ─── Tempo por etapa, tempo até contemplação e até finalização ─────────
  // createProcessForWonDeal (lib/processes/create.ts) já grava a 1ª linha de
  // histórico na criação do processo (fromStageId null, toStageId = etapa
  // inicial do pipeline) — history[0] É a entrada na 1ª etapa, não precisa
  // reconstruir nada antes dela.
  const stageCatalog = new Map(stageCatalogRows.map((s) => [s.id, s]));
  const ownerNameById = new Map(processes.map((p) => [p.ownerId, p.owner.name]));
  const isContemplationStage = (stageId: string) => (stageCatalog.get(stageId)?.name ?? "").toLowerCase().includes("contempl");

  const historyByProcess = new Map<string, typeof stageHistory>();
  for (const h of stageHistory) {
    if (!historyByProcess.has(h.processId)) historyByProcess.set(h.processId, []);
    historyByProcess.get(h.processId)!.push(h);
  }

  const stageDurations = new Map<string, { totalMs: number; count: number }>();
  const contemplationDurationsMs: number[] = [];
  const finalizationDurationsMs: number[] = [];

  // ─── Contemplações por mês — mesma definição de "contemplação" usada
  // acima (1ª entrada numa etapa "Contemplado"). Período filtrado, ou os
  // últimos 6 meses por padrão (mesma janela do gráfico de evolução do
  // relatório comercial).
  const trendEnd = rangeTo ?? new Date();
  const trendStart =
    rangeFrom ??
    (() => {
      const d = brazilStartOfMonth(trendEnd);
      d.setUTCMonth(d.getUTCMonth() - 5);
      return d;
    })();
  const contemplationsByMonth: {
    year: number;
    month: number;
    label: string;
    tooltipLabel: string;
    value: number;
    breakdown: { label: string; value: number }[];
    byOwner: Map<string, number>;
  }[] = [];
  {
    const startParts = getBrazilParts(trendStart);
    const endParts = getBrazilParts(trendEnd);
    let year = startParts.year;
    let month = startParts.month;
    while (year < endParts.year || (year === endParts.year && month <= endParts.month)) {
      const labelDate = new Date(Date.UTC(year, month, 1));
      contemplationsByMonth.push({
        year,
        month,
        label: labelDate.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }),
        tooltipLabel: labelDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
        value: 0,
        breakdown: [],
        byOwner: new Map(),
      });
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
  }

  for (const process of processes) {
    const history = historyByProcess.get(process.id) ?? [];
    const segments: { stageId: string; enteredAt: Date; exitedAt: Date | null }[] = [];
    if (history.length === 0) {
      // Não deveria acontecer no fluxo normal (createProcessForWonDeal
      // sempre grava a 1ª linha de histórico na criação, fromStageId null)
      // — só cobre dado legado/manual sem histórico nenhum: assume que está
      // na etapa atual desde que nasceu.
      segments.push({ stageId: process.stageId, enteredAt: process.createdAt, exitedAt: null });
    } else {
      // history[0] JÁ é a entrada na 1ª etapa (fromStageId null, gravado na
      // criação do processo) — não existe uma "etapa anterior" antes dele
      // pra reconstruir; usar `process.stageId` (a etapa ATUAL) como
      // fallback aqui inventava uma passagem fantasma de poucos milissegundos
      // atribuída à etapa errada.
      for (let i = 0; i < history.length; i++) {
        segments.push({ stageId: history[i].toStageId, enteredAt: history[i].changedAt, exitedAt: history[i + 1]?.changedAt ?? null });
      }
    }

    // Só etapas já concluídas (com saída conhecida) entram na média — a
    // etapa atual ainda está "em aberto", incluir ela penalizaria processo
    // recente e infla a média artificialmente pra baixo.
    for (const seg of segments) {
      if (seg.exitedAt === null) continue;
      const prev = stageDurations.get(seg.stageId) ?? { totalMs: 0, count: 0 };
      prev.totalMs += seg.exitedAt.getTime() - seg.enteredAt.getTime();
      prev.count += 1;
      stageDurations.set(seg.stageId, prev);
    }

    const contemplationSegment = segments.find((s) => isContemplationStage(s.stageId));
    if (contemplationSegment) {
      contemplationDurationsMs.push(contemplationSegment.enteredAt.getTime() - process.createdAt.getTime());

      if (contemplationSegment.enteredAt >= trendStart && contemplationSegment.enteredAt <= trendEnd) {
        const parts = getBrazilParts(contemplationSegment.enteredAt);
        const bucket = contemplationsByMonth.find((b) => b.year === parts.year && b.month === parts.month);
        if (bucket) {
          bucket.value += 1;
          // Chave por ownerId, não por nome — dois responsáveis com o mesmo
          // nome (comum, nome brasileiro) misturariam a contagem dos dois
          // num "breakdown" só.
          bucket.byOwner.set(process.ownerId, (bucket.byOwner.get(process.ownerId) ?? 0) + 1);
        }
      }
    }
    const finalSegment = segments.find((s) => stageCatalog.get(s.stageId)?.isFinal);
    if (finalSegment) {
      finalizationDurationsMs.push(finalSegment.enteredAt.getTime() - process.createdAt.getTime());
    }
  }

  for (const bucket of contemplationsByMonth) {
    bucket.breakdown = Array.from(bucket.byOwner.entries())
      .map(([ownerId, value]) => ({ label: ownerNameById.get(ownerId) ?? "—", value }))
      .sort((a, b) => b.value - a.value);
  }

  const avg = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

  const stageTimeBreakdown = Array.from(stageDurations.entries())
    .map(([stageId, d]) => {
      const stage = stageCatalog.get(stageId);
      return {
        id: stageId,
        name: stage?.name ?? "Etapa removida",
        order: stage?.order ?? 999,
        avgMs: d.totalMs / d.count,
      };
    })
    .sort((a, b) => a.order - b.order);
  const maxStageAvgMs = Math.max(1, ...stageTimeBreakdown.map((s) => s.avgMs));

  const avgContemplationMs = avg(contemplationDurationsMs);
  const avgFinalizationMs = avg(finalizationDurationsMs);

  // ─── Solicitações do consultor pro administrativo ("Solicitar" no
  // detalhe do processo) — quantas ainda esperam resposta e, das já
  // respondidas, quanto tempo em média o administrativo levou.
  const pendingRequestsCount = processRequests.filter((r) => !r.resolvedAt).length;
  const avgRequestResolutionMs = avg(
    processRequests.filter((r) => r.resolvedAt).map((r) => r.resolvedAt!.getTime() - r.createdAt.getTime()),
  );

  // ─── Cliente com mais cotas — cada Process é UMA cota de consórcio; quem
  // tem mais de um Process comprou mais de uma cota ao mesmo tempo. Só
  // entra quem tem mais de uma (ter 1 é o padrão, não é destaque nenhum).
  const cotasByContact = new Map<string, { name: string; count: number; quotaNumbers: string[] }>();
  for (const p of processes) {
    const prev = cotasByContact.get(p.contactId) ?? { name: p.contact.name, count: 0, quotaNumbers: [] };
    prev.count += 1;
    if (p.quotaNumber) prev.quotaNumbers.push(p.quotaNumber);
    cotasByContact.set(p.contactId, prev);
  }
  const topQuotaClients = Array.from(cotasByContact.entries())
    .map(([contactId, c]) => ({ id: contactId, ...c }))
    .filter((c) => c.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
            Relatório do Administrativo
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Acompanhamento de pós-venda.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TeamOwnerFilter teams={[]} members={ownerOptions} />
          <DateRangeFilter />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 lg:gap-4">
        <StatTile icon={CircleCheck} label="Contemplados" value={contemplatedCount} />
        <StatTile icon={CircleDollarSign} label="Com pagamento pendente" value={paymentPendingCount} />
        <StatTile icon={FileWarning} label="Com documentação pendente" value={documentPendingCount} />
        <StatTile icon={Clock} label={`Parados ${STALE_DEAL_DAYS}+ dias`} value={staleProcesses.length} />
        <StatTile icon={MessageCircle} label="Com mensagem não lida" value={unreadContactIds.size} />
        <StatTile icon={Inbox} label="Solicitações pendentes" value={pendingRequestsCount} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">Tempos médios</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:gap-4">
          <StatTile
            icon={Target}
            label="Até contemplação"
            value={avgContemplationMs !== null ? formatDuration(avgContemplationMs) : "—"}
          />
          <StatTile
            icon={Flag}
            label="Até finalização"
            value={avgFinalizationMs !== null ? formatDuration(avgFinalizationMs) : "—"}
          />
          <StatTile
            icon={Inbox}
            label="Resposta a solicitações"
            value={avgRequestResolutionMs !== null ? formatDuration(avgRequestResolutionMs) : "—"}
          />
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Contemplações por mês</h2>
        </div>
        <p className="mb-6 text-xs text-neutral-400 dark:text-neutral-500">
          1ª vez que cada processo entrou numa etapa de contemplação — o filtro de data acima afeta só este gráfico; o
          resto do painel é sempre o estado atual.
        </p>
        <TrendAreaChart
          data={contemplationsByMonth}
          formatValue={(v) => `${v} contemplaç${v === 1 ? "ão" : "ões"}`}
        />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="card col-span-12 p-5 lg:col-span-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Processos por etapa</h2>
          {stageCounts.size === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum processo ainda.</p>
          ) : (
            <div className="space-y-3">
              {Array.from(stageCounts.values()).map((stage) => (
                <BarRow key={stage.name} label={stage.name} value={stage.count} max={maxStageCount} displayValue={String(stage.count)} />
              ))}
            </div>
          )}
        </div>

        <div className="card col-span-12 p-5 lg:col-span-6">
          <h2 className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">Tempo médio por etapa</h2>
          <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
            Só considera passagens já concluídas — quem está na etapa agora ainda não entra na média.
          </p>
          {stageTimeBreakdown.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
              Nenhuma mudança de etapa registrada ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {stageTimeBreakdown.map((stage) => (
                <BarRow
                  key={stage.id}
                  label={stage.name}
                  value={stage.avgMs}
                  max={maxStageAvgMs}
                  displayValue={formatDuration(stage.avgMs)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {topQuotaClients.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">Clientes com mais cotas</h2>
          <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
            Quem tem mais de um processo — mais de uma cota de consórcio ao mesmo tempo.
          </p>
          <Leaderboard
            entries={topQuotaClients.map((c) => ({
              id: c.id,
              name: c.name,
              photoUrl: null,
              primaryValue: `${c.count} cotas`,
              secondaryValue: c.quotaNumbers.length > 0 ? `Cotas ${c.quotaNumbers.join(", ")}` : undefined,
            }))}
            emptyLabel="Nenhum cliente com mais de uma cota ainda"
          />
        </div>
      )}

      {staleProcesses.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Processos parados (sem trocar de etapa há {STALE_DEAL_DAYS}+ dias)
          </h2>
          <div className="space-y-2">
            {staleProcesses.map((process) => (
              <Link
                key={process.id}
                href={`/processos/${process.id}`}
                className="card flex items-center justify-between p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <span className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
                  <Avatar name={process.contact.name} size="xs" />
                  {process.contact.name}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  {process.stage.name} · {daysSince(process.stageEnteredAt)}d
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  });
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: number | string }) {
  return (
    <div className="card p-3 lg:p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="truncate text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100 lg:text-2xl">{value}</p>
    </div>
  );
}
