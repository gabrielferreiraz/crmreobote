import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaTable } from "@/lib/servopa-tables/queries";
import { formatPercent } from "@/lib/servopa-tables/format";
import { ServopaPrintSheet } from "@/components/servopa-tables/print-sheet";
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
    <div className="min-h-dvh bg-neutral-200 py-6 print:min-h-0 print:h-auto print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] max-w-full justify-end px-2 print:hidden">
        <PrintButton />
      </div>
      <ServopaPrintSheet table={table} />
    </div>
  );
}
