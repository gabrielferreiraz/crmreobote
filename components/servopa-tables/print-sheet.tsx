import { REOBOTE_CARD_ADDRESS, REOBOTE_INSTAGRAM_HANDLE, REOBOTE_WEBSITE_URL } from "@/lib/digital-cards/config";
import { splitContemplationText } from "@/lib/servopa-tables/contemplation";
import { formatBRL, formatDateBR, formatPercent } from "@/lib/servopa-tables/format";
import type { ServopaTableView } from "@/lib/servopa-tables/queries";
import { ServopaLogo, ServopaSeal } from "@/components/servopa-tables/servopa-brand";
import { SheetFit } from "@/components/servopa-tables/sheet-fit";

/**
 * Folha A4 da tabela de um grupo/taxa: sempre UMA página de 210 × 297 mm.
 *
 * - `@page { margin: 0 }`: sem margem do navegador não sobra lugar para a data
 *   e o endereço que o Chrome/Edge imprimem no cabeçalho/rodapé; a folha tem a
 *   própria margem interna.
 * - O texto de regras vai em duas colunas e `SheetFit` diminui a letra dele
 *   (e, se preciso, o espaçamento da tabela) até tudo caber na folha.
 * - Na tela a folha mantém o tamanho real e só é reduzida visualmente
 *   (`zoom`) em telas estreitas, para o PDF baixado no celular sair igual.
 */
export function ServopaPrintSheet({ table }: { table: ServopaTableView }) {
  const blocks = splitContemplationText(table.contemplationText);
  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        .servopa-sheet { width: 210mm; height: 297mm; overflow: hidden; zoom: var(--servopa-preview-zoom, 1); }
        .servopa-sheet, .servopa-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .servopa-sheet[data-compact="1"] .servopa-row > td { padding-top: 1.1mm; padding-bottom: 1.1mm; }
        .servopa-rules { columns: 2; column-gap: 7mm; }
        .servopa-rules > * { break-inside: avoid; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .servopa-sheet { zoom: 1 !important; margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <main
        className="servopa-sheet mx-auto flex flex-col bg-white px-[12mm] pb-[9mm] pt-[10mm] text-[12px] leading-snug text-neutral-900 shadow-md"
        data-compact="0"
      >
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pb-[4mm]">
          <div className="inline-flex flex-col items-center justify-self-start">
            <ServopaLogo />
            <p className="mt-[1.2mm] whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-[0.2em] text-neutral-500">Parceira Autorizada</p>
          </div>
          <div className="text-center">
            <p className="whitespace-nowrap text-[24px] font-bold leading-tight tracking-tight">GRUPO {table.groupNumber}</p>
            <p className="mt-0.5 whitespace-nowrap text-[15px] font-bold">{table.termMonths} MESES</p>
          </div>
          <div className="flex justify-end">
            <ServopaSeal />
          </div>
        </header>

        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[21%]" />
            <col className="w-[25%]" />
            <col className="w-[23%]" />
            <col className="w-[21%]" />
          </colgroup>
          <thead>
            <tr className="bg-[#c8c8c8] text-center text-[12px] font-bold">
              <th className="px-1 py-[2.2mm]">Cat.</th>
              <th className="px-1 py-[2.2mm]">Contribuição mensal</th>
              <th className="px-1 py-[2.2mm]">Valor do bem</th>
              <th className="px-1 py-[2.2mm]">Parcela</th>
              <th className="px-1 py-[2.2mm]">Seguro</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.category} className="servopa-row border-b border-neutral-900 text-center">
                <td className="whitespace-nowrap px-1 py-[1.8mm]">{r.category}</td>
                <td className="whitespace-nowrap px-1 py-[1.8mm] tabular-nums">{formatPercent(r.monthlyPercent)}</td>
                <td className="whitespace-nowrap px-1 py-[1.8mm] tabular-nums">{formatBRL(r.creditValue)}</td>
                <td className="whitespace-nowrap px-1 py-[1.8mm] tabular-nums">{formatBRL(r.installment)}</td>
                <td className="whitespace-nowrap px-1 py-[1.8mm] tabular-nums">{formatBRL(r.insurance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-[5mm] grid grid-cols-[auto_auto_auto] justify-between gap-x-4 whitespace-nowrap border-b border-neutral-900 pb-[1.2mm] text-[12px] font-bold">
          <span>Taxa de Administração: {formatPercent(table.admEffective, { trim: true })}</span>
          <span>Fundo de Reserva: {table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}</span>
          <span>Vagas disponíveis: {table.vacancies ?? "—"}</span>
        </div>
        <div className="flex justify-between whitespace-nowrap border-b border-neutral-900 py-[1.2mm] text-[12px] font-bold">
          <span>Assembleia provável: {table.nextAssemblyAt ? formatDateBR(table.nextAssemblyAt) : "—"}</span>
          <span>Vencimento: {table.dueDay ?? "—"}</span>
        </div>

        {blocks.length > 0 && (
          <section className="mt-[5mm]">
            <p className="mb-[2mm] text-[8px] font-bold uppercase tracking-[0.14em] text-neutral-500">Condições do grupo</p>
            <div className="servopa-rules leading-[1.35] text-neutral-800" style={{ fontSize: "var(--servopa-rules-size, 9px)" }}>
              {blocks.map((block, index) =>
                block.kind === "list" ? (
                  <div key={index} className="mb-[1.6mm]">
                    <p className="font-semibold text-neutral-900">{block.title}</p>
                    <ul>
                      {block.items.map((item, itemIndex) => (
                        <li key={itemIndex} className="relative pl-[3mm] before:absolute before:left-[0.6mm] before:content-['–']">{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p key={index} className="relative mb-[1.6mm] pl-[3mm] before:absolute before:left-0 before:content-['•']">{block.text}</p>
                ),
              )}
            </div>
          </section>
        )}

        <footer className="mt-auto pt-[4mm] text-center text-[9px] leading-relaxed text-neutral-600">
          <div className="mb-[2mm] h-px bg-[#b60b29]" />
          <p className="font-semibold text-neutral-800">Reobote Consórcios</p>
          <p>{REOBOTE_CARD_ADDRESS}</p>
          <p>{REOBOTE_WEBSITE_URL.replace(/^https?:\/\//, "")} · @{REOBOTE_INSTAGRAM_HANDLE}</p>
        </footer>
      </main>
      <SheetFit />
    </>
  );
}
