import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight, Palette, Table2 } from "lucide-react";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { listServopaCampaigns } from "@/lib/servopa-tables/campaigns";
import { getLastServopaSync, getServopaOperationState, listServopaTables } from "@/lib/servopa-tables/queries";
import { formatDateBR } from "@/lib/servopa-tables/format";
import { TablesBrowser, type TableBrowserInitialState, type TableSortKey } from "./tables-browser";
import { ServopaOperations } from "./servopa-operations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tabelas" };

type RawSearch = {
  segmento?: string | string[];
  grupo?: string | string[];
  prazo?: string | string[];
  taxa?: string | string[];
  ordenar?: string | string[];
  ordem?: string | string[];
};

const SORT_KEYS = new Set<TableSortKey>(["grupo", "segmento", "prazo", "taxa", "credito", "parcela", "vagas", "assembleia"]);

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function initialState(raw: RawSearch): TableBrowserInitialState {
  const requestedSort = first(raw.ordenar) as TableSortKey;
  return {
    segmento: first(raw.segmento),
    grupo: first(raw.grupo).replace(/\D/g, ""),
    prazo: first(raw.prazo),
    taxa: first(raw.taxa),
    ordenar: SORT_KEYS.has(requestedSort) ? requestedSort : "grupo",
    ordem: first(raw.ordem) === "desc" ? "desc" : "asc",
  };
}

function SummaryItem({ value, label, dot }: { value: number; label: string; dot?: string }) {
  return (
    <div className="min-w-0 border-l border-neutral-200 pl-4 first:border-l-0 first:pl-0 dark:border-neutral-800 max-sm:odd:border-l-0 max-sm:odd:pl-0">
      <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
      <p className="mt-2 flex items-center gap-1.5 truncate text-xs uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
        {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
        {label}
      </p>
    </div>
  );
}

export default async function TabelasPage({ searchParams }: { searchParams: Promise<RawSearch> }) {
  const access = await getServopaTablesAccess();
  if (!access.ok) redirect("/login");

  const [tables, lastSync, raw, operations, campaigns] = await Promise.all([
    listServopaTables(access.organizationId),
    getLastServopaSync(access.organizationId),
    searchParams,
    access.canOperate ? getServopaOperationState(access.organizationId) : Promise.resolve(null),
    access.canManageCampaigns ? listServopaCampaigns(access.organizationId).catch(() => []) : Promise.resolve([]),
  ]);
  const activeCampaign = campaigns.find((campaign) => campaign.status === "ACTIVE" && !campaign.overriddenBy)?.name ?? null;
  const groups = new Map(tables.map((table) => [table.groupNumber, table.segment]));
  const realEstateGroups = [...groups.values()].filter((segment) => segment === "REAL_ESTATE").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-brand"><Table2 className="h-4 w-4" aria-hidden="true" /></div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Tabelas Servopa</h1>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Crédito, prazo e parcela por grupo e taxa de administração.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {access.canManageCampaigns && (
            <Link
              href="/tabelas/campanhas"
              className="group inline-flex items-center gap-3 rounded-lg border border-neutral-200 bg-white py-2 pl-2.5 pr-3.5 text-left shadow-sm transition-colors hover:border-brand/40 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-brand/50"
              title="Escolher a campanha (Black Friday, 12 do 12…) que aparece no topo do PDF"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand"><Palette className="h-[18px] w-[18px]" aria-hidden="true" /></span>
              <span className="min-w-0 leading-tight">
                <span className="block text-sm font-semibold text-neutral-900 group-hover:text-brand dark:text-neutral-100">Alterar estilo do PDF</span>
                {activeCampaign ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="truncate">Campanha no ar: {activeCampaign}</span>
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">Campanhas e datas especiais</span>
                )}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
            </Link>
          )}
          {operations ? (
            <ServopaOperations initialState={operations} />
          ) : lastSync?.finishedAt ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"><span className="h-2 w-2 rounded-full bg-emerald-500" />Atualizada em {formatDateBR(lastSync.finishedAt)}</div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-neutral-200 py-5 lg:grid-cols-4 dark:border-neutral-800">
        <SummaryItem value={groups.size} label="Grupos publicados" />
        <SummaryItem value={tables.length} label="Tabelas" />
        <SummaryItem value={realEstateGroups} label="Imóveis" dot="bg-emerald-500" />
        <SummaryItem value={groups.size - realEstateGroups} label="Móveis" dot="bg-sky-500" />
      </div>

      <TablesBrowser tables={tables} initialState={initialState(raw)} canAdjust={access.canAdjust} />
    </div>
  );
}
