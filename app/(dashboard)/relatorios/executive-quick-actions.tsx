"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Check, Download, Share2, Users } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/format";
import type { ExecutiveReportData } from "@/lib/reports/executive-data";

type Feedback = "shared" | "copied" | "downloaded" | null;

export function ExecutiveQuickActions({ data }: { data: ExecutiveReportData }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const feedbackTimer = useRef<number | null>(null);
  const periodEnd = useMemo(() => endOfMonth(data.reportYear, data.throughMonth), [data.reportYear, data.throughMonth]);
  const wonDealsHref = `/pipeline?view=lista&status=WON&closedFrom=${data.reportYear}-01-01&closedTo=${periodEnd}`;

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
  }, []);

  const announce = (next: Exclude<Feedback, null>) => {
    setFeedback(next);
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 2200);
  };

  const shareSummary = async () => {
    const text = buildExecutiveSummary(data);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Resumo executivo ${data.reportYear}`, text });
        announce("shared");
        return;
      }
      await copyText(text);
      announce("copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyText(text);
      announce("copied");
    }
  };

  const downloadRanking = () => {
    const header = ["Posição", "Vendedor", "Equipe atual", `Vendas ${data.reportYear}`, "Últimos 3 meses", "Participações em ganhos", "Meses com venda"];
    const rows = data.ranking.map((row, index) => [
      index + 1,
      row.name,
      row.team,
      decimalForCsv(row.yearValue),
      decimalForCsv(row.recentValue),
      row.sales,
      row.activeMonths,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ranking-vendedores-${data.reportYear}-ate-${data.throughMonthLabel}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    announce("downloaded");
  };

  const shareLabel = feedback === "shared" ? "Compartilhado" : feedback === "copied" ? "Resumo copiado" : "Compartilhar resumo";
  const downloadLabel = feedback === "downloaded" ? "Ranking baixado" : "Baixar ranking";

  return (
    <div className="w-full xl:w-auto" aria-label="Ações rápidas do relatório">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:justify-end">
        <Link href={wonDealsHref} className="btn-secondary min-h-11 min-w-0 w-full justify-center px-2 text-base sm:w-auto sm:px-4">
          <BriefcaseBusiness className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="sm:hidden">Vendas</span>
          <span className="hidden sm:inline">Vendas do período</span>
        </Link>
        <Link href="/configuracoes/usuarios" className="btn-secondary min-h-11 min-w-0 w-full justify-center px-2 text-base sm:w-auto sm:px-4">
          <Users className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="sm:hidden">Equipe</span>
          <span className="hidden sm:inline">Gerenciar equipe</span>
        </Link>
        <button type="button" className="btn-secondary min-h-11 min-w-0 w-full justify-center px-2 text-base sm:w-auto sm:px-4" onClick={shareSummary}>
          {feedback === "shared" || feedback === "copied" ? <Check className="h-4 w-4 text-emerald-500" strokeWidth={2.5} /> : <Share2 className="h-4 w-4" strokeWidth={2} />}
          <span className="sm:hidden">Compartilhar</span>
          <span className="hidden sm:inline">{shareLabel}</span>
        </button>
        <button type="button" className="btn-secondary min-h-11 min-w-0 w-full justify-center px-2 text-base sm:w-auto sm:px-4" onClick={downloadRanking}>
          {feedback === "downloaded" ? <Check className="h-4 w-4 text-emerald-500" strokeWidth={2.5} /> : <Download className="h-4 w-4" strokeWidth={2} />}
          <span className="sm:hidden">Ranking</span>
          <span className="hidden sm:inline">{downloadLabel}</span>
        </button>
        <span className="sr-only" aria-live="polite">
          {feedback === "shared" ? "Resumo compartilhado." : feedback === "copied" ? "Resumo copiado." : feedback === "downloaded" ? "Ranking baixado." : ""}
        </span>
      </div>
    </div>
  );
}

function buildExecutiveSummary(data: ExecutiveReportData): string {
  const change = data.yearToDate.changePct;
  const comparison = change === null
    ? "sem base comparável"
    : `${change >= 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs ${data.reportYear - 1}`;
  const topNames = data.topTwo.names.length > 0 ? ` (${data.topTwo.names.join(" e ")})` : "";

  return [
    `Resumo executivo — jan–${data.throughMonthLabel}/${String(data.reportYear).slice(-2)}`,
    `Vendas líquidas: ${formatCurrencyCompact(data.yearToDate.value)} (${comparison})`,
    `Média por vendedor em ${MONTHS_LONG[data.throughMonth]}: ${formatCurrencyCompact(data.sellerAverage.value)}`,
    `Vendedores com venda no mês: ${data.sellerAverage.sellers}`,
    `Concentração nos 2 maiores: ${data.topTwo.sharePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%${topNames}`,
    "Base: negócios ganhos em meses já fechados.",
  ].join("\n");
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function endOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

function decimalForCsv(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function csvCell(value: string | number): string {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
