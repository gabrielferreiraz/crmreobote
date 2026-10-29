import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Building2, CarFront, Table2 } from "lucide-react";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
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

function SummaryItem({ icon: Icon, value, label }: { icon: typeof Table2; value: number; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-4 py-3 first:pl-0 sm:border-r sm:border-neutral-200 sm:last:border-r-0 dark:sm:border-neutral-800">
      <Icon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{value}</p>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      </div>
    </div>
  );
}

export default async function TabelasPage({ searchParams }: { searchParams: Promise<RawSearch> }) {
  const access = await getServopaTablesAccess();
  if (!access.ok) redirect("/login");

  const [tables, lastSync, raw, operations] = await Promise.all([
    listServopaTables(access.organizationId),
    getLastServopaSync(access.organizationId),
    searchParams,
    access.canOperate ? getServopaOperationState(access.organizationId) : Promise.resolve(null),
  ]);
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
        {operations ? (
          <ServopaOperations initialState={operations} />
        ) : lastSync?.finishedAt ? (
          <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"><span className="h-2 w-2 rounded-full bg-emerald-500" />Atualizada em {formatDateBR(lastSync.finishedAt)}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 border-y border-neutral-200 sm:flex dark:border-neutral-800">
        <SummaryItem icon={Building2} value={groups.size} label="grupos publicados" />
        <SummaryItem icon={Table2} value={tables.length} label="tabelas" />
        <SummaryItem icon={Building2} value={realEstateGroups} label="grupos de imóveis" />
        <SummaryItem icon={CarFront} value={groups.size - realEstateGroups} label="grupos de móveis" />
      </div>

      <TablesBrowser tables={tables} initialState={initialState(raw)} canAdjust={access.canAdjust} />
    </div>
  );
}
