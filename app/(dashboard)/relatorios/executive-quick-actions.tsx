import Link from "next/link";
import { BriefcaseBusiness, Download, Users } from "lucide-react";
import type { ExecutiveReportData } from "@/lib/reports/executive-data";

export function ExecutiveQuickActions({ data }: { data: ExecutiveReportData }) {
  const periodEnd = endOfMonth(data.reportYear, data.throughMonth);
  const wonDealsHref = `/pipeline?view=lista&status=WON&closedFrom=${data.range.startYear}-01-01&closedTo=${periodEnd}`;
  const rankingExportHref = `/api/reports/executive-ranking?fromYear=${data.range.startYear}&toYear=${data.reportYear}&month=${data.throughMonth + 1}`;

  return (
    <div className="w-full xl:w-auto" aria-label="Ações rápidas do relatório">
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap xl:justify-end">
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
        <a href={rankingExportHref} className="btn-secondary min-h-11 min-w-0 w-full justify-center px-2 text-base sm:w-auto sm:px-4">
          <Download className="h-4 w-4" strokeWidth={2} />
          <span className="sm:hidden">Ranking</span>
          <span className="hidden sm:inline">Baixar ranking</span>
        </a>
      </div>
    </div>
  );
}

function endOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}
