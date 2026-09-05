import Link from "next/link";
import {
  Clock,
  CircleCheck,
  CircleDollarSign,
  FileWarning,
  MessageCircle,
  Flag,
  Inbox,
  TrendingUp,
  Layers,
  Wallet,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { runWithTenant } from "@/lib/tenant-context";
import { getContactsWithUnreadWhatsApp } from "@/lib/processes/whatsapp-signals";
import { isStale, STALE_DEAL_DAYS } from "@/lib/stale";
import { daysSince, formatDuration, formatCurrency } from "@/lib/format";
import { brazilDateStringToUTC, brazilEndOfDayUTC, getBrazilParts } from "@/lib/timezone";
import { Avatar } from "@/components/avatar";
import { Leaderboard } from "@/components/leaderboard";
import { TrendAreaChart } from "@/components/charts/trend-area-chart";
import { BarRow } from "./bar-row";
import { DateRangeFilter } from "./date-range-filter";
import { TeamOwnerFilter } from "./team-owner-filter";
import { ProcessPipelineFilter } from "./process-pipeline-filter";
import { defaultTrendWindow, buildMonthlyBuckets, findBucket } from "@/lib/reports/trend";
import { summarizeDurations as stats } from "@/lib/reports/stats";

/**
 * Relatório do Administrativo (pós-venda) — substitui o dashboard de
 * vendas (funil/metas não fazem sentido aqui). Foco no que o administrativo
 * precisa saber de relance: quantos processos em cada etapa, quantos
 * parados, quantos com pagamento/documentação pendente — e, desde a
 * Categoria/Subcategoria (Imóvel/Automóvel × Aquisição/Construção/...),
 * tudo isso quebrado por essa hierarquia também, com os cálculos
 * financeiros (valor total, por categoria) e os tempos (média E mediana)
 * que o time pediu. Sem métrica de "contemplado" separada — todo processo
 * aqui já nasce contemplado (é a própria condição pra entrar via
 * "Adicionar ao processo", ver lib/processes/create.ts), então essa
 * distinção nunca varia de verdade.
 */
export async function AdminReportsView({
  from,
  to,
  who,
  pipelineId,
}: {
  from?: string;
  to?: string;
  who?: string;
  /** Id de ProcessPipeline (Subcategoria) — vazio/undefined = todas juntas. */
  pipelineId?: string;
}) {
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
  const ownerFilter = {
    ...scopeWhere,
    ...(filterOwnerId ? { ownerId: filterOwnerId } : {}),
    ...(pipelineId ? { pipelineId } : {}),
  };
  // ProcessStageHistory e ProcessRequest não têm ownerId próprio (não são
  // "do consultor" diretamente) — escopa pela relação com Process, mesma
  // regra de admin-vê-tudo/consultor-só-o-seu de processScopeWhere.
  const relatedProcessFilter = { process: ownerFilter };

  // fromParam/toParam são dias civis de Brasília (mesma UI/convenção do
  // relatório comercial) — servidor roda em UTC, então usa os mesmos
  // helpers Brasília-aware pra não deslocar o filtro em 3h.
  const rangeFrom = from ? brazilDateStringToUTC(from) : null;
  const rangeTo = to ? brazilEndOfDayUTC(to) : null;

  const [processes, documentPendingCount, categoriesRaw, stageHistory, processRequests, ownerRows] =
    await Promise.all([
      prisma.process.findMany({
        where: { organizationId: access.organizationId, ...ownerFilter },
        include: {
          stage: true,
          contact: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          deal: { select: { value: true } },
          pipeline: { select: { id: true, name: true, categoryId: true, category: { select: { name: true } } } },
        },
      }),
      prisma.process.count({
        where: { organizationId: access.organizationId, ...ownerFilter, documentStatus: { not: "DELIVERED" } },
      }),
      // Árvore inteira (Categoria → Subcategoria → Etapa) — alimenta o
      // filtro de Categoria/Subcategoria E os rótulos com contexto de cada
      // etapa abaixo (sem isso, duas subcategorias com uma etapa chamada
      // "Finalizado" cada uma apareciam como se fossem a mesma barra).
      prisma.processCategory.findMany({
        where: { organizationId: access.organizationId },
        orderBy: { order: "asc" },
        include: {
          pipelines: {
            orderBy: { order: "asc" },
            select: { id: true, name: true, stages: { select: { id: true, name: true, color: true, order: true, isFinal: true } } },
          },
        },
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

  const filterCategories = categoriesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    pipelines: c.pipelines.map((p) => ({ id: p.id, name: p.name })),
  }));

  const unreadContactIds = await getContactsWithUnreadWhatsApp(
    access.organizationId,
    processes.map((p) => p.contact.id),
  );

  // ─── Catálogos derivados da árvore — etapa/subcategoria/categoria por id,
  // pra rotular e pra "tempo médio por etapa" cobrir também etapa sem
  // ninguém nela agora mas que já teve passagem no histórico.
  type StageCatalogEntry = {
    id: string;
    name: string;
    color: string | null;
    order: number;
    isFinal: boolean;
    pipelineId: string;
    pipelineName: string;
    categoryId: string;
    categoryName: string;
  };
  const stageCatalog = new Map<string, StageCatalogEntry>();
  for (const category of categoriesRaw) {
    for (const pipeline of category.pipelines) {
      for (const stage of pipeline.stages) {
        stageCatalog.set(stage.id, {
          ...stage,
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          categoryId: category.id,
          categoryName: category.name,
        });
      }
    }
  }

  const stageCounts = new Map<string, { name: string; color: string | null; count: number; valueSum: number }>();
  for (const p of processes) {
    const value = p.deal.value ? Number(p.deal.value) : 0;
    const existing = stageCounts.get(p.stageId);
    const label = stageCatalog.has(p.stageId) ? `${p.pipeline.name} · ${p.stage.name}` : p.stage.name;
    if (existing) {
      existing.count += 1;
      existing.valueSum += value;
    } else {
      stageCounts.set(p.stageId, { name: label, color: p.stage.color, count: 1, valueSum: value });
    }
  }
  const maxStageCount = Math.max(1, ...Array.from(stageCounts.values()).map((s) => s.count));

  const staleProcesses = processes
    .filter((p) => !p.stage.isFinal && isStale(p.stageEnteredAt))
    .sort((a, b) => a.stageEnteredAt.getTime() - b.stageEnteredAt.getTime());

  // ─── Cálculos financeiros — valor total processado (soma do valor do
  // negócio de cada processo) e o ticket médio. Sem quebra "contemplado vs
  // pendente": todo processo que chega aqui JÁ foi contemplado (é a própria
  // condição pra entrar via "Adicionar ao processo" — ver
  // lib/processes/create.ts), então essa distinção nunca varia de verdade.
  let totalValue = 0;
  for (const p of processes) {
    totalValue += p.deal.value ? Number(p.deal.value) : 0;
  }
  const avgProcessValue = processes.length > 0 ? totalValue / processes.length : null;

  const valueByCategory = new Map<string, { name: string; count: number; value: number }>();
  for (const p of processes) {
    const value = p.deal.value ? Number(p.deal.value) : 0;
    const key = p.pipeline.categoryId;
    const prev = valueByCategory.get(key) ?? { name: p.pipeline.category.name, count: 0, value: 0 };
    prev.count += 1;
    prev.value += value;
    valueByCategory.set(key, prev);
  }
  const categoryBreakdown = Array.from(valueByCategory.values()).sort((a, b) => b.value - a.value);
  const maxCategoryValue = Math.max(1, ...categoryBreakdown.map((c) => c.value));

  // ─── Tempo por etapa e tempo até finalização ────────────────────────────
  // createProcessForDeal (lib/processes/create.ts) já grava a 1ª linha de
  // histórico na criação do processo (fromStageId null, toStageId = etapa
  // inicial da subcategoria) — history[0] É a entrada na 1ª etapa, não
  // precisa reconstruir nada antes dela.
  const ownerNameById = new Map(processes.map((p) => [p.ownerId, p.owner.name]));

  const historyByProcess = new Map<string, typeof stageHistory>();
  for (const h of stageHistory) {
    if (!historyByProcess.has(h.processId)) historyByProcess.set(h.processId, []);
    historyByProcess.get(h.processId)!.push(h);
  }

  const stageDurations = new Map<string, { totalMs: number; count: number }>();
  const finalizationDurationsMs: number[] = [];
  // Por Subcategoria — categorias diferentes (ex.: Imóvel vs Automóvel)
  // tendem a ter prazos bem diferentes; a média/mediana global sozinha
  // escondia isso.
  const finalizationByPipeline = new Map<string, number[]>();

  // ─── Processos adicionados por mês — todo processo já nasce contemplado
  // (ver nota acima), então isto é o que "contemplações por mês" queria
  // dizer na prática: quando cada cliente entrou no acompanhamento de
  // pós-venda. Período filtrado, ou os últimos 6 meses por padrão (mesma
  // janela do gráfico de evolução do relatório comercial — ver
  // lib/reports/trend.ts, compartilhado entre os dois relatórios).
  const { trendStart, trendEnd } = defaultTrendWindow(rangeFrom, rangeTo);
  const processesByMonth = buildMonthlyBuckets(trendStart, trendEnd).map((b) => ({
    ...b,
    breakdown: [] as { label: string; value: number }[],
    byOwner: new Map<string, number>(),
  }));

  for (const process of processes) {
    const history = historyByProcess.get(process.id) ?? [];
    const segments: { stageId: string; enteredAt: Date; exitedAt: Date | null }[] = [];
    if (history.length === 0) {
      // Não deveria acontecer no fluxo normal (createProcessForDeal sempre
      // grava a 1ª linha de histórico na criação, fromStageId null) — só
      // cobre dado legado/manual sem histórico nenhum: assume que está na
      // etapa atual desde que nasceu.
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

    if (process.createdAt >= trendStart && process.createdAt <= trendEnd) {
      const parts = getBrazilParts(process.createdAt);
      const bucket = findBucket(processesByMonth, false, parts);
      if (bucket) {
        bucket.value += 1;
        // Chave por ownerId, não por nome — dois responsáveis com o mesmo
        // nome (comum, nome brasileiro) misturariam a contagem dos dois
        // num "breakdown" só.
        bucket.byOwner.set(process.ownerId, (bucket.byOwner.get(process.ownerId) ?? 0) + 1);
      }
    }
    const finalSegment = segments.find((s) => stageCatalog.get(s.stageId)?.isFinal);
    if (finalSegment) {
      const ms = finalSegment.enteredAt.getTime() - process.createdAt.getTime();
      finalizationDurationsMs.push(ms);
      const list = finalizationByPipeline.get(process.pipelineId) ?? [];
      list.push(ms);
      finalizationByPipeline.set(process.pipelineId, list);
    }
  }

  for (const bucket of processesByMonth) {
    bucket.breakdown = Array.from(bucket.byOwner.entries())
      .map(([ownerId, value]) => ({ label: ownerNameById.get(ownerId) ?? "—", value }))
      .sort((a, b) => b.value - a.value);
  }

  const stageTimeBreakdown = Array.from(stageDurations.entries())
    .map(([stageId, d]) => {
      const stage = stageCatalog.get(stageId);
      return {
        id: stageId,
        name: stage ? `${stage.pipelineName} · ${stage.name}` : "Etapa removida",
        order: stage?.order ?? 999,
        avgMs: d.totalMs / d.count,
      };
    })
    .sort((a, b) => a.order - b.order);
  const maxStageAvgMs = Math.max(1, ...stageTimeBreakdown.map((s) => s.avgMs));

  const finalizationStats = stats(finalizationDurationsMs);

  // Nome da subcategoria pra cada linha da tabela de tempo por subcategoria
  // — só entram subcategorias com pelo menos 1 finalização registrada
  // (senão a tabela mostraria uma fileira de travessões pra subcategoria
  // nova sem histórico nenhum ainda).
  const pipelineNameById = new Map<string, string>();
  for (const category of categoriesRaw) {
    for (const pipeline of category.pipelines) pipelineNameById.set(pipeline.id, `${category.name} · ${pipeline.name}`);
  }
  const timeByPipeline = Array.from(finalizationByPipeline.keys())
    .map((id) => ({
      id,
      name: pipelineNameById.get(id) ?? "Subcategoria removida",
      finalization: stats(finalizationByPipeline.get(id) ?? []),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  // ─── Solicitações do consultor pro administrativo ("Solicitar" no
  // detalhe do processo) — quantas ainda esperam resposta e, das já
  // respondidas, quanto tempo em média o administrativo levou.
  const pendingRequestsCount = processRequests.filter((r) => !r.resolvedAt).length;
  const requestStats = stats(processRequests.filter((r) => r.resolvedAt).map((r) => r.resolvedAt!.getTime() - r.createdAt.getTime()));

  // ─── Cliente com mais cotas — cada Process é UMA cota de consórcio; quem
  // tem mais de um Process comprou mais de uma cota ao mesmo tempo. Só
  // entra quem tem mais de uma (ter 1 é o padrão, não é destaque nenhum).
  const cotasByContact = new Map<string, { name: string; count: number; quotaNumbers: string[]; value: number }>();
  for (const p of processes) {
    const prev = cotasByContact.get(p.contactId) ?? { name: p.contact.name, count: 0, quotaNumbers: [], value: 0 };
    prev.count += 1;
    prev.value += p.deal.value ? Number(p.deal.value) : 0;
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
      {/* Mesmo ajuste de app/(dashboard)/relatorios/page.tsx (ver comentário
          lá) — flex-col + xl:flex-row/flex-nowrap em vez de flex-wrap+
          justify-between, que saltava o bloco de filtros pro lado esquerdo
          assim que crescia demais pra caber ao lado do título. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:flex-nowrap xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
            Relatório do Administrativo
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Acompanhamento de pós-venda.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
          <ProcessPipelineFilter categories={filterCategories} />
          <TeamOwnerFilter teams={[]} members={ownerOptions} />
          <DateRangeFilter />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 lg:gap-4">
        <StatTile icon={CircleCheck} label="Total de processos" value={processes.length} />
        <StatTile icon={FileWarning} label="Com documentação pendente" value={documentPendingCount} />
        <StatTile icon={Clock} label={`Parados ${STALE_DEAL_DAYS}+ dias`} value={staleProcesses.length} />
        <StatTile icon={MessageCircle} label="Com mensagem não lida" value={unreadContactIds.size} />
        <StatTile icon={Inbox} label="Solicitações pendentes" value={pendingRequestsCount} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">Valores</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4">
          <StatTile icon={Wallet} label="Valor total em processo" value={formatCurrency(totalValue)} />
          <StatTile
            icon={CircleDollarSign}
            label="Ticket médio por processo"
            value={avgProcessValue !== null ? formatCurrency(avgProcessValue) : "—"}
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">Tempos (média · mediana)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4">
          <StatTile
            icon={Flag}
            label="Até finalização"
            value={finalizationStats.avgMs !== null ? formatDuration(finalizationStats.avgMs) : "—"}
            hint={finalizationStats.medianMs !== null ? `mediana ${formatDuration(finalizationStats.medianMs)}` : undefined}
          />
          <StatTile
            icon={Inbox}
            label="Resposta a solicitações"
            value={requestStats.avgMs !== null ? formatDuration(requestStats.avgMs) : "—"}
            hint={requestStats.medianMs !== null ? `mediana ${formatDuration(requestStats.medianMs)}` : undefined}
          />
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Processos adicionados por mês</h2>
        </div>
        <p className="mb-6 text-xs text-neutral-400 dark:text-neutral-500">
          Quando cada cliente entrou no acompanhamento de pós-venda — o filtro de data acima afeta só este gráfico; o
          resto do painel é sempre o estado atual.
        </p>
        <TrendAreaChart
          data={processesByMonth}
          format={{ type: "count", singular: "processo", plural: "processos" }}
        />
      </div>

      {categoryBreakdown.length > 1 && (
        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <Layers className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Processos e valor por categoria</h2>
          </div>
          <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">Soma do valor do negócio de cada processo.</p>
          <div className="space-y-3">
            {categoryBreakdown.map((c) => (
              <BarRow
                key={c.name}
                label={c.name}
                value={c.value}
                max={maxCategoryValue}
                displayValue={`${formatCurrency(c.value)} · ${c.count}`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        <div className="card col-span-12 p-5 lg:col-span-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-100">Processos por etapa</h2>
          {stageCounts.size === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum processo ainda.</p>
          ) : (
            <div className="space-y-3">
              {Array.from(stageCounts.values()).map((stage) => (
                <BarRow
                  key={stage.name}
                  label={stage.name}
                  value={stage.count}
                  max={maxStageCount}
                  displayValue={`${stage.count} · ${formatCurrency(stage.valueSum)}`}
                  color={stage.color}
                />
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

      {timeByPipeline.length > 1 && (
        <div className="card overflow-x-auto p-5">
          <h2 className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">Tempo por subcategoria</h2>
          <p className="mb-4 text-xs text-neutral-400 dark:text-neutral-500">
            Categorias diferentes costumam ter prazo bem diferente — aqui não é uma média só, é por subcategoria.
          </p>
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                <th className="pb-2 font-medium">Subcategoria</th>
                <th className="pb-2 font-medium">Até finalização (média)</th>
                <th className="pb-2 font-medium">Até finalização (mediana)</th>
              </tr>
            </thead>
            <tbody>
              {timeByPipeline.map((row) => (
                <tr key={row.id} className="border-b border-neutral-50 last:border-0 dark:border-neutral-900">
                  <td className="py-2 pr-3 text-neutral-800 dark:text-neutral-200">{row.name}</td>
                  <td className="py-2 pr-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {row.finalization.avgMs !== null ? formatDuration(row.finalization.avgMs) : "—"}
                  </td>
                  <td className="py-2 tabular-nums text-neutral-500 dark:text-neutral-400">
                    {row.finalization.medianMs !== null ? formatDuration(row.finalization.medianMs) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
              secondaryValue:
                (c.quotaNumbers.length > 0 ? `Cotas ${c.quotaNumbers.join(", ")} · ` : "") + formatCurrency(c.value),
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
                  {process.pipeline.name} · {process.stage.name} · {daysSince(process.stageEnteredAt)}d
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

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="card p-3 lg:p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="truncate text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
      </div>
      <p className="text-lg font-semibold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100 lg:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}
