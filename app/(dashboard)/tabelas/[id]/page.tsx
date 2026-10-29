import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Printer } from "lucide-react";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaTable } from "@/lib/servopa-tables/queries";
import { toUnits } from "@/lib/servopa-tables/adjust";
import { formatBRL, formatDateBR, formatPercent, SEGMENT_LABEL } from "@/lib/servopa-tables/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tabela" };

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">{children}</dd>
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/tabelas" className="btn-ghost btn-sm" aria-label="Voltar para as tabelas">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Grupo {table.groupNumber} · {table.termMonths} meses
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {SEGMENT_LABEL[table.segment]} · Taxa de ADM {formatPercent(table.admEffective, { trim: true })}
            </p>
          </div>
        </div>
        <Link href={`/tabela-servopa/${table.id}`} target="_blank" className="btn-primary">
          <Printer className="h-4 w-4" strokeWidth={2} />
          Imprimir tabela
        </Link>
      </div>

      <dl className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
        <Info label="Taxa de ADM">
          {formatPercent(table.admEffective, { trim: true })}
          {adjusted && (
            <span className="ml-1.5 text-xs font-normal text-neutral-500">
              (Servopa: {formatPercent(table.admOriginal, { trim: true })})
            </span>
          )}
        </Info>
        <Info label="Fundo de reserva">{table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}</Info>
        <Info label="Próxima assembleia">
          {table.nextAssemblyAt ? formatDateBR(table.nextAssemblyAt) : "—"}
          {table.nextAssemblyNumber && <span className="ml-1.5 text-xs font-normal text-neutral-500">({table.nextAssemblyNumber}ª)</span>}
        </Info>
        <Info label="Vencimento">{table.dueDay ? `Dia ${table.dueDay}` : "—"}</Info>
        <Info label="Vagas disponíveis">{table.vacancies === null ? "Não informado" : table.vacancies}</Info>
      </dl>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <th className="px-4 py-3 font-medium">Cat.</th>
              <th className="px-4 py-3 text-right font-medium">Valor do bem</th>
              <th className="px-4 py-3 text-right font-medium">Contribuição mensal</th>
              <th className="px-4 py-3 text-right font-medium">Parcela</th>
              <th className="px-4 py-3 text-right font-medium">Seguro</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
            {table.rows.map((r) => (
              <tr key={r.category}>
                <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">{r.category}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatBRL(r.creditValue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPercent(r.monthlyPercent)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatBRL(r.installment)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatBRL(r.insurance)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{formatBRL(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.contemplationText && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Regras do grupo (texto da Servopa)</h2>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-neutral-600 dark:text-neutral-300">{table.contemplationText}</pre>
        </div>
      )}
    </div>
  );
}
