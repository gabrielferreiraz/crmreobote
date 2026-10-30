import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Printer } from "lucide-react";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaTable } from "@/lib/servopa-tables/queries";
import { toUnits } from "@/lib/servopa-tables/adjust";
import { splitContemplationText } from "@/lib/servopa-tables/contemplation";
import { formatBRL, formatDateBR, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tabela" };

function Fact({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="min-w-0 border-neutral-200 py-4 sm:border-l sm:pl-5 sm:first:border-l-0 sm:first:pl-0 dark:border-neutral-800">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold leading-none tracking-tight tabular-nums text-neutral-900 dark:text-neutral-100">{children}</dd>
      {note && <p className="mt-1.5 text-xs text-neutral-400">{note}</p>}
    </div>
  );
}

export default async function TabelaPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getServopaTablesAccess();
  if (!access.ok) redirect("/login");

  const { id } = await params;
  const table = await getServopaTable(access.organizationId, id);
  if (!table) notFound();

  const adjusted = toUnits(table.adjustmentPoints, 4) !== 0;
  const blocks = table.contemplationText ? splitContemplationText(table.contemplationText) : [];
  const real = table.segment === "REAL_ESTATE";
  const low = table.vacancies !== null && table.vacancies <= 20;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/tabelas" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Todas as tabelas
        </Link>

        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">Grupo</p>
            <h1 className="text-5xl font-semibold leading-none tracking-tight text-neutral-900 sm:text-6xl dark:text-neutral-100">{table.groupNumber}</h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-neutral-600 dark:text-neutral-300">
              <span className="inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${real ? "bg-emerald-500" : "bg-sky-500"}`} aria-hidden="true" />
                {SEGMENT_LABEL[table.segment]}
              </span>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">/</span>
              <span>{table.termMonths} meses</span>
              <span className="text-neutral-300 dark:text-neutral-600" aria-hidden="true">/</span>
              <span>Taxa de ADM {formatPercent(table.admEffective, { trim: true })}</span>
            </p>
          </div>
          <Link href={`/tabela-servopa/${table.id}`} target="_blank" className="group inline-flex items-center justify-center gap-3 bg-neutral-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand dark:bg-white dark:text-neutral-900 dark:hover:bg-brand dark:hover:text-white">
            <Printer className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Gerar PDF desta tabela
          </Link>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-5 border-y border-neutral-200 sm:grid-cols-5 dark:border-neutral-800">
        <Fact label="Taxa de ADM" note={adjusted ? `Servopa: ${formatPercent(table.admOriginal, { trim: true })}` : undefined}>
          {formatPercent(table.admEffective, { trim: true })}
        </Fact>
        <Fact label="Fundo de reserva">{table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}</Fact>
        <Fact label="Próxima assembleia" note={table.nextAssemblyNumber ? `${table.nextAssemblyNumber}ª assembleia` : undefined}>
          {table.nextAssemblyAt ? formatDateBR(table.nextAssemblyAt) : "—"}
        </Fact>
        <Fact label="Vencimento">{table.dueDay ? `Dia ${table.dueDay}` : "—"}</Fact>
        <Fact label="Vagas" note={low ? "Poucas vagas" : undefined}>
          <span className={low ? "text-amber-600 dark:text-amber-400" : ""}>{table.vacancies === null ? "—" : table.vacancies}</span>
        </Fact>
      </dl>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Categorias e parcelas</h2>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b-2 border-neutral-900 text-left text-[11px] uppercase tracking-[0.14em] text-neutral-500 dark:border-neutral-100 dark:text-neutral-400">
                <th className="py-2.5 pr-4 font-medium">Cat.</th>
                <th className="px-4 py-2.5 text-right font-medium">Valor do bem</th>
                <th className="px-4 py-2.5 text-right font-medium">Contribuição mensal</th>
                <th className="px-4 py-2.5 text-right font-medium">Parcela</th>
                <th className="px-4 py-2.5 text-right font-medium">Seguro</th>
                <th className="py-2.5 pl-4 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {table.rows.map((r) => (
                <tr key={r.category} className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                  <td className="py-3.5 pr-4 font-semibold text-neutral-900 dark:text-neutral-100">{r.category}</td>
                  <td className="px-4 py-3.5 text-right text-base font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatBRL(r.creditValue)}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">{formatPercent(r.monthlyPercent)}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-neutral-700 dark:text-neutral-200">{formatBRL(r.installment)}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">{formatBRL(r.insurance)}</td>
                  <td className="py-3.5 pl-4 text-right text-base font-semibold tabular-nums text-brand">{formatBRL(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {blocks.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800">
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Regras do grupo</h2>
            <p className="text-xs text-neutral-400">Texto publicado pela Servopa</p>
          </div>
          <div className="mt-5 grid gap-x-10 gap-y-6 md:grid-cols-2">
            {blocks.map((block, index) => block.kind === "list" ? (
              <div key={index}>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-900 dark:text-neutral-100">{block.title.replace(/:$/, "")}</h3>
                {block.items.length > 0 && (
                  <ol className="mt-2 divide-y divide-neutral-100 border-t border-neutral-200 dark:divide-neutral-800/70 dark:border-neutral-800">
                    {block.items.map((item, i) => (
                      <li key={i} className="flex gap-4 py-2 text-sm text-neutral-600 dark:text-neutral-300">
                        <span className="w-5 shrink-0 tabular-nums text-neutral-400">{String(i + 1).padStart(2, "0")}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <p key={index} className="border-t border-neutral-200 pt-2 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">{block.text}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
