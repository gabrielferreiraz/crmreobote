import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaTable } from "@/lib/servopa-tables/queries";
import { formatBRL, formatDateBR, formatPercent } from "@/lib/servopa-tables/format";
import { REOBOTE_CARD_ADDRESS, REOBOTE_INSTAGRAM_HANDLE, REOBOTE_WEBSITE_URL } from "@/lib/digital-cards/config";
import { ServopaLogo, ServopaSeal } from "@/components/servopa-tables/servopa-brand";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** Uma consulta por requisição (metadata + página). */
const load = cache(async (id: string) => {
  const access = await getServopaTablesAccess();
  if (!access.ok) return { access, table: null };
  return { access, table: await getServopaTable(access.organizationId, id) };
});

/**
 * O título vira o nome sugerido do arquivo no "Salvar como PDF" do navegador:
 * "GRUPO 1568 - 120 MESES - ADM 13%".
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { table } = await load(id);
  if (!table) return { title: "Tabela" };
  return { title: `GRUPO ${table.groupNumber} - ${table.termMonths} MESES - ADM ${formatPercent(table.admEffective, { trim: true })}` };
}

/**
 * Tabela de UM grupo/taxa pronta para imprimir ou "Salvar como PDF" — FORA de
 * (dashboard) de propósito (mesmo desenho de app/comprovante-comissao): o
 * documento nasce sem menu nem cabeçalho do CRM. Mostra a taxa já com o
 * desconto/acréscimo aplicado; os valores sem ajuste saem exatamente como a
 * Servopa publica.
 */
export default async function PrintServopaTablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { access, table } = await load(id);
  if (!access.ok) redirect("/login");
  if (!table) notFound();

  return (
    <div className="min-h-dvh bg-neutral-200 py-6 print:bg-white print:py-0">
      {/* Cores de fundo (cinza do cabeçalho da tabela) precisam sair no PDF; A4 sem margem do navegador. */}
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print { html, body { background: #fff !important; } .servopa-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 277mm !important; padding: 0 !important; } }
        .servopa-sheet, .servopa-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .servopa-sheet table { break-inside: avoid; }
      `}</style>

      <div className="mx-auto mb-4 flex w-[210mm] max-w-full justify-end px-2 print:hidden">
        <PrintButton />
      </div>

      <main className="servopa-sheet mx-auto flex min-h-[277mm] w-[210mm] max-w-full flex-col bg-white px-[12mm] py-[10mm] text-[12px] text-neutral-900 shadow-md">
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pb-3">
          <ServopaLogo />
          <div className="text-center">
            <p className="text-[22px] font-bold tracking-tight">GRUPO {table.groupNumber}</p>
            <p className="mt-1 text-[15px] font-bold">{table.termMonths} MESES</p>
          </div>
          <div className="flex justify-end">
            <ServopaSeal />
          </div>
        </header>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-[#c8c8c8] text-center font-bold">
              <th className="px-2 py-2">Cat.</th>
              <th className="px-2 py-2">Contribuição mensal</th>
              <th className="px-2 py-2">Valor do bem</th>
              <th className="px-2 py-2">Parcela</th>
              <th className="px-2 py-2">Seguro</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.category} className="border-b border-neutral-900 text-center">
                <td className="px-2 py-1.5">{r.category}</td>
                <td className="px-2 py-1.5 tabular-nums">{formatPercent(r.monthlyPercent)}</td>
                <td className="px-2 py-1.5 tabular-nums">{formatBRL(r.creditValue)}</td>
                <td className="px-2 py-1.5 tabular-nums">{formatBRL(r.installment)}</td>
                <td className="px-2 py-1.5 tabular-nums">{formatBRL(r.insurance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 border-b border-neutral-900 pb-1 font-bold">
          <div className="grid grid-cols-3 gap-3">
            <span>Taxa de Administração: {formatPercent(table.admEffective, { trim: true })}</span>
            <span className="text-center">Fundo de Reserva: {table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}</span>
            <span className="text-right">Vagas disponíveis: {table.vacancies ?? "—"}</span>
          </div>
        </div>
        <div className="flex justify-between border-b border-neutral-900 py-1 font-bold">
          <span>Assembleia provável: {table.nextAssemblyAt ? formatDateBR(table.nextAssemblyAt) : "—"}</span>
          <span>Vencimento: {table.dueDay ?? "—"}</span>
        </div>

        {table.contemplationText && (
          <section className="mt-4 whitespace-pre-line text-[11px] leading-snug">{table.contemplationText}</section>
        )}
        <footer className="mt-auto pt-6 text-center text-[9.5px] leading-relaxed text-neutral-600">
          <div className="mb-2 h-px bg-[#b60b29]" />
          <p className="font-semibold text-neutral-800">Reobote Consórcios</p>
          <p>{REOBOTE_CARD_ADDRESS}</p>
          <p>{REOBOTE_WEBSITE_URL.replace(/^https?:\/\//, "")} · @{REOBOTE_INSTAGRAM_HANDLE}</p>
        </footer>
      </main>
    </div>
  );
}
