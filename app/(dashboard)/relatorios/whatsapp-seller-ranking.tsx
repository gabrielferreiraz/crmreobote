"use client";

import { useMemo, useState } from "react";
import {
  Clock,
  LayoutGrid,
  List,
  MessageCircle,
  MessageSquareText,
  Search,
  Send,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { formatDuration } from "@/lib/format";

type Seller = {
  userId: string;
  name: string;
  connected: boolean;
  sent: number;
  contacted: number;
  replied: number;
  replyRate: number;
  conversionRate: number;
  campaignSent: number;
  campaignReplied: number;
  campaignReplyRate: number;
  possibleColdDeals: number;
  manualProspectSent: number;
  manualProspectReplied: number;
  manualProspectReplyRate: number;
  deal: {
    conversations: number;
    sent: number;
    responseRate: number | null;
    avgFirstResponseMs: number | null;
    avgDurationMs: number | null;
    messagesPerDay: number;
  } | null;
};

type SortBy = "sent" | "replies" | "conversion";
type StatusFilter = "all" | "connected" | "disconnected";
type ViewMode = "cards" | "table";

const sortOptions: { id: SortBy; label: string; icon: typeof Send }[] = [
  { id: "sent", label: "Mensagens", icon: Send },
  { id: "replies", label: "Respostas", icon: MessageCircle },
  { id: "conversion", label: "Conversão", icon: TrendingUp },
];

function rankBadgeClass(index: number): string {
  if (index === 0) return "bg-amber-100 text-amber-800 ring-1 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30";
  if (index === 1) return "bg-neutral-200/80 text-neutral-700 ring-1 ring-neutral-300/80 dark:bg-neutral-700/80 dark:text-neutral-200 dark:ring-neutral-600/60";
  if (index === 2) return "bg-orange-100 text-orange-800 ring-1 ring-orange-300/60 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-400/30";
  return "bg-neutral-100 text-neutral-500 dark:bg-neutral-800/90 dark:text-neutral-400";
}

function replyRateTone(rate: number | null): string {
  if (rate == null) return "text-neutral-400 dark:text-neutral-500";
  if (rate >= 65) return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400";
  if (rate >= 40) return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400";
  return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
}

function MetricTile({
  title,
  dotColor,
  primary,
  primaryLabel,
  rate,
  rateLabel = "resposta",
  chips,
}: {
  title: string;
  dotColor: string;
  primary: string | number;
  primaryLabel: string;
  rate?: number | null;
  rateLabel?: string;
  chips?: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-lg border border-neutral-100 bg-neutral-50/70 px-3.5 py-2.5 dark:border-neutral-800/80 dark:bg-neutral-900/45">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
          <h4 className="truncate text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            {title}
          </h4>
        </div>
        {rate !== undefined && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${replyRateTone(rate)}`}>
            {rate != null ? `${rate}% ${rateLabel}` : "—"}
          </span>
        )}
      </div>

      <p className="mt-2 truncate text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
        {typeof primary === "number" ? primary.toLocaleString("pt-BR") : primary}{" "}
        <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">{primaryLabel}</span>
      </p>

      {chips && chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((chip, idx) => (
            <span
              key={idx}
              className="inline-flex items-center rounded-md bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-neutral-600 ring-1 ring-neutral-200/80 dark:bg-neutral-800/80 dark:text-neutral-300 dark:ring-neutral-700/70"
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function WhatsappSellerRanking({ sellers }: { sellers: Seller[] }) {
  const [sortBy, setSortBy] = useState<SortBy>("sent");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [query, setQuery] = useState("");

  // Totais consolidados do time para o painel de resumo no topo
  const summary = useMemo(() => {
    let totalSent = 0;
    let totalReplied = 0;
    let totalGeneral = 0;
    let totalCampaign = 0;
    let totalManual = 0;
    let totalDealConvs = 0;
    let connectedCount = 0;
    let firstResponseWeightedSum = 0;
    let firstResponseWeight = 0;

    for (const s of sellers) {
      const sent = s.sent + s.campaignSent + s.manualProspectSent;
      const replied = s.replied + s.campaignReplied + s.manualProspectReplied;
      totalSent += sent;
      totalReplied += replied;
      totalGeneral += s.sent;
      totalCampaign += s.campaignSent;
      totalManual += s.manualProspectSent;
      if (s.connected) connectedCount += 1;
      if (s.deal) {
        totalDealConvs += s.deal.conversations;
        if (s.deal.avgFirstResponseMs != null && s.deal.conversations > 0) {
          firstResponseWeightedSum += s.deal.avgFirstResponseMs * s.deal.conversations;
          firstResponseWeight += s.deal.conversations;
        }
      }
    }

    const overallReplyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;
    const avgFirstResponseMs = firstResponseWeight > 0 ? firstResponseWeightedSum / firstResponseWeight : null;
    const disconnectedCount = sellers.length - connectedCount;

    return {
      totalSent,
      totalReplied,
      totalGeneral,
      totalCampaign,
      totalManual,
      totalDealConvs,
      overallReplyRate,
      avgFirstResponseMs,
      connectedCount,
      disconnectedCount,
    };
  }, [sellers]);

  const metricValue = (seller: Seller) => {
    if (sortBy === "conversion") return seller.conversionRate;
    if (sortBy === "replies") return seller.replied + seller.campaignReplied + seller.manualProspectReplied;
    return seller.sent + seller.campaignSent + seller.manualProspectSent;
  };

  const sortedSellers = useMemo(() => {
    const metric = (seller: Seller) => {
      if (sortBy === "conversion") return seller.conversionRate;
      if (sortBy === "replies") return seller.replied + seller.campaignReplied + seller.manualProspectReplied;
      return seller.sent + seller.campaignSent + seller.manualProspectSent;
    };
    return [...sellers].sort((a, b) => metric(b) - metric(a) || a.name.localeCompare(b.name, "pt-BR"));
  }, [sellers, sortBy]);

  const normalizedQuery = query.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

  const visibleSellers = sortedSellers
    .map((seller, index) => ({ seller, index }))
    .filter(({ seller }) => {
      if (statusFilter === "connected" && !seller.connected) return false;
      if (statusFilter === "disconnected" && seller.connected) return false;
      if (!normalizedQuery) return true;
      return seller.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedQuery);
    });

  const maxMetric = Math.max(1, ...sortedSellers.map(metricValue));

  return (
    <div className="space-y-4">
      {/* ─── Resumo consolidado do time ──────────────────────────────── */}
      {sellers.length > 1 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Mensagens iniciadas</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                <Send className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
              {summary.totalSent.toLocaleString("pt-BR")}
            </p>
            <p className="mt-1 truncate text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
              {summary.totalGeneral.toLocaleString("pt-BR")} geral
              {summary.totalManual > 0 ? ` · ${summary.totalManual.toLocaleString("pt-BR")} prospecção` : ""}
              {summary.totalCampaign > 0 ? ` · ${summary.totalCampaign.toLocaleString("pt-BR")} campanha` : ""}
            </p>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Taxa de resposta</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
                <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
              {summary.overallReplyRate}%
            </p>
            <p className="mt-1 truncate text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
              {summary.totalReplied.toLocaleString("pt-BR")} respostas no período
            </p>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Conversas de negócio</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <MessageSquareText className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
              {summary.totalDealConvs.toLocaleString("pt-BR")}
            </p>
            <p className="mt-1 flex items-center gap-1 truncate text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
              <Clock className="h-3 w-3 shrink-0" />
              {summary.avgFirstResponseMs != null
                ? `1ª resposta média: ${formatDuration(summary.avgFirstResponseMs)}`
                : "Sem tempo médio registrado"}
            </p>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">WhatsApps conectados</span>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  summary.disconnectedCount > 0
                    ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                    : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                }`}
              >
                {summary.disconnectedCount > 0 ? <WifiOff className="h-3.5 w-3.5" strokeWidth={2} /> : <Wifi className="h-3.5 w-3.5" strokeWidth={2} />}
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">
              {summary.connectedCount}
              <span className="text-base font-medium text-neutral-400 dark:text-neutral-500">/{sellers.length}</span>
            </p>
            <p className="mt-1 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {summary.disconnectedCount > 0
                ? `${summary.disconnectedCount} desconectado${summary.disconnectedCount === 1 ? "" : "s"} agora`
                : "Todos os números online"}
            </p>
          </div>
        </div>
      )}

      {/* ─── Barra de busca, filtros, ordenação e alternador de visão ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar consultor"
              aria-label="Buscar consultor no ranking de WhatsApp"
              className="field-input h-9 w-full pl-9 text-sm"
            />
          </div>

          {sellers.length > 1 && (
            <div className="inline-flex rounded-lg border border-neutral-200/80 bg-neutral-100/70 p-0.5 text-xs dark:border-neutral-800 dark:bg-neutral-900">
              {(
                [
                  { id: "all", label: `Todos (${sellers.length})` },
                  { id: "connected", label: `Online (${summary.connectedCount})` },
                  ...(summary.disconnectedCount > 0 ? [{ id: "disconnected" as const, label: `Offline (${summary.disconnectedCount})` }] : []),
                ] as { id: StatusFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                    statusFilter === tab.id
                      ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                      : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex max-w-full rounded-lg border border-neutral-200/80 bg-neutral-100/70 p-0.5 dark:border-neutral-800 dark:bg-neutral-900" role="group" aria-label="Ordenar consultores por">
            {sortOptions.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSortBy(id)}
                aria-pressed={sortBy === id}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 ${
                  sortBy === id
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          {sellers.length > 1 && (
            <div className="inline-flex rounded-lg border border-neutral-200/80 bg-neutral-100/70 p-0.5 dark:border-neutral-800 dark:bg-neutral-900" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                aria-pressed={viewMode === "cards"}
                title="Visualizar em cards detalhados"
                className={`inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  viewMode === "cards"
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
                title="Visualizar em tabela comparativa"
                className={`inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  viewMode === "table"
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Tabela</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Visualização em Tabela Comparativa ──────────────────────── */}
      {viewMode === "table" && visibleSellers.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[740px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400">
                <th className="w-10 py-3 pl-4 pr-2 text-center">#</th>
                <th className="px-3 py-3">Consultor</th>
                <th className="px-3 py-3 text-right">Iniciadas</th>
                <th className="px-3 py-3 text-right">Respostas</th>
                <th className="px-3 py-3 text-right">Prospecção</th>
                <th className="px-3 py-3 text-right">Negócios</th>
                <th className="px-3 py-3 text-right">1ª Resposta</th>
                <th className="py-3 pl-3 pr-4 text-right">Conversão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
              {visibleSellers.map(({ seller, index }) => {
                const totalOutreach = seller.sent + seller.campaignSent + seller.manualProspectSent;
                const totalReplied = seller.replied + seller.campaignReplied + seller.manualProspectReplied;
                const overallRate = totalOutreach > 0 ? Math.round((totalReplied / totalOutreach) * 100) : 0;
                const metric = metricValue(seller);
                const barPct = sortBy === "conversion" ? Math.min(100, metric) : Math.min(100, (metric / maxMetric) * 100);

                return (
                  <tr key={seller.userId} className="transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35">
                    <td className="py-3 pl-4 pr-2 text-center">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${rankBadgeClass(index)}`}>
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={seller.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{seller.name}</p>
                          <span className={`inline-flex items-center gap-1 text-[11px] ${seller.connected ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${seller.connected ? "bg-emerald-500" : "bg-neutral-400"}`} />
                            {seller.connected ? "Conectado" : "Desconectado"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <p className={`font-semibold ${sortBy === "sent" ? "text-violet-600 dark:text-violet-400" : "text-neutral-900 dark:text-neutral-100"}`}>
                        {totalOutreach.toLocaleString("pt-BR")}
                      </p>
                      <div className="ml-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div
                          className={`h-full rounded-full ${sortBy === "conversion" ? "bg-emerald-500" : sortBy === "replies" ? "bg-sky-500" : "bg-violet-500"}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <p className={`font-semibold ${sortBy === "replies" ? "text-sky-600 dark:text-sky-400" : "text-neutral-900 dark:text-neutral-100"}`}>
                        {totalReplied.toLocaleString("pt-BR")}
                      </p>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{overallRate}%</p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {seller.manualProspectSent + seller.campaignSent > 0 ? (
                        <span>{(seller.manualProspectSent + seller.campaignSent).toLocaleString("pt-BR")}</span>
                      ) : (
                        <span className="text-neutral-300 dark:text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {seller.deal ? (
                        <div>
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{seller.deal.conversations}</span>
                          {seller.deal.responseRate != null && (
                            <span className="ml-1 text-[11px] text-emerald-600 dark:text-emerald-400">({seller.deal.responseRate}%)</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-neutral-300 dark:text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs text-neutral-600 dark:text-neutral-300">
                      {seller.deal?.avgFirstResponseMs != null ? formatDuration(seller.deal.avgFirstResponseMs) : <span className="text-neutral-300 dark:text-neutral-600">—</span>}
                    </td>
                    <td className="py-3 pl-3 pr-4 text-right tabular-nums">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          sortBy === "conversion" || seller.conversionRate > 0
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                        }`}
                      >
                        {seller.conversionRate}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Visualização em Cards Refinados ─────────────────────────── */}
      {viewMode === "cards" && (
        <div className="space-y-3">
          {visibleSellers.map(({ seller, index }) => {
            const metric = metricValue(seller);
            const totalOutreach = seller.sent + seller.campaignSent + seller.manualProspectSent;
            const totalReplied = seller.replied + seller.campaignReplied + seller.manualProspectReplied;
            const overallReplyRate = totalOutreach > 0 ? Math.round((totalReplied / totalOutreach) * 100) : 0;
            const conversation = seller.deal;

            const tiles: React.ReactNode[] = [
              <MetricTile
                key="geral"
                title="Geral"
                dotColor="bg-neutral-400"
                primary={seller.sent}
                primaryLabel="enviadas"
                rate={seller.replyRate}
              />,
            ];

            if (seller.campaignSent > 0) {
              tiles.push(
                <MetricTile
                  key="campanha"
                  title="Campanha"
                  dotColor="bg-violet-500"
                  primary={seller.campaignSent}
                  primaryLabel="enviadas"
                  rate={seller.campaignReplyRate}
                  chips={seller.possibleColdDeals > 0 ? [`${seller.possibleColdDeals} possíveis negociações`] : undefined}
                />,
              );
            }

            if (seller.manualProspectSent > 0) {
              tiles.push(
                <MetricTile
                  key="prospeccao"
                  title="Prospecção manual"
                  dotColor="bg-amber-500"
                  primary={seller.manualProspectSent}
                  primaryLabel="enviadas"
                  rate={seller.manualProspectReplyRate}
                />,
              );
            }

            if (conversation) {
              const dealChips = [
                conversation.avgFirstResponseMs != null ? `1ª resp. ${formatDuration(conversation.avgFirstResponseMs)}` : null,
                conversation.avgDurationMs != null ? `Duração ${formatDuration(conversation.avgDurationMs)}` : null,
                `${conversation.messagesPerDay.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} msgs/dia`,
              ].filter((v): v is string => Boolean(v));

              tiles.push(
                <MetricTile
                  key="negocio"
                  title="Conversas de negócio"
                  dotColor="bg-emerald-500"
                  primary={conversation.conversations}
                  primaryLabel={conversation.conversations === 1 ? "conversa" : "conversas"}
                  rate={conversation.responseRate}
                  chips={dealChips}
                />,
              );
            }

            const gridColsClass =
              tiles.length === 1
                ? "grid-cols-1"
                : tiles.length === 2
                  ? "grid-cols-1 sm:grid-cols-2"
                  : tiles.length === 3
                    ? "grid-cols-1 sm:grid-cols-3"
                    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";

            const barPct = sortBy === "conversion" ? Math.min(100, metric) : Math.min(100, (metric / maxMetric) * 100);

            return (
              <article
                key={seller.userId}
                className="card p-4 transition-all duration-200 hover:border-brand/30 hover:shadow-sm sm:p-5"
              >
                <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${rankBadgeClass(index)}`}
                    >
                      {index + 1}
                    </span>
                    <Avatar name={seller.name} size="sm" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
                          {seller.name}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            seller.connected
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${seller.connected ? "bg-emerald-500" : "bg-neutral-400"}`} />
                          {seller.connected ? "Conectado" : "Desconectado"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3 KPIs rápidos alinhados à direita, destacando a métrica da ordenação */}
                  <div className="flex flex-wrap items-center gap-4 sm:gap-5">
                    <div className="text-right">
                      <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                        Iniciadas
                      </p>
                      <p
                        className={`text-base font-bold tabular-nums ${
                          sortBy === "sent" ? "text-violet-600 dark:text-violet-400" : "text-neutral-800 dark:text-neutral-200"
                        }`}
                      >
                        {totalOutreach.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="h-6 w-px bg-neutral-200 dark:bg-neutral-800" />
                    <div className="text-right">
                      <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                        Respostas
                      </p>
                      <p
                        className={`text-base font-bold tabular-nums ${
                          sortBy === "replies" ? "text-sky-600 dark:text-sky-400" : "text-neutral-800 dark:text-neutral-200"
                        }`}
                      >
                        {overallReplyRate}%
                        <span className="ml-1 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                          ({totalReplied.toLocaleString("pt-BR")})
                        </span>
                      </p>
                    </div>
                    <div className="h-6 w-px bg-neutral-200 dark:bg-neutral-800" />
                    <div className="text-right">
                      <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                        Conversão
                      </p>
                      <p
                        className={`text-base font-bold tabular-nums ${
                          sortBy === "conversion" ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-800 dark:text-neutral-200"
                        }`}
                      >
                        {seller.conversionRate}%
                      </p>
                    </div>
                  </div>
                </header>

                {/* Barra de progresso proporcional */}
                <div
                  className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800/90"
                  aria-label={`${Math.round(barPct)}% no ranking`}
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                      sortBy === "conversion"
                        ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                        : sortBy === "replies"
                          ? "bg-gradient-to-r from-sky-600 to-sky-400"
                          : "bg-gradient-to-r from-violet-600 to-indigo-400"
                    }`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>

                {/* Grade adaptativa de tiles (sem coluna vazia sobrando) */}
                <div className={`mt-3.5 grid gap-2.5 ${gridColsClass}`}>{tiles}</div>
              </article>
            );
          })}
        </div>
      )}

      {visibleSellers.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">Nenhum consultor encontrado neste filtro.</p>
      )}
    </div>
  );
}
