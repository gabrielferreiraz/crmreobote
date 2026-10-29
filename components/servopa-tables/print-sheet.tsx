import { REOBOTE_CARD_ADDRESS, REOBOTE_INSTAGRAM_HANDLE, REOBOTE_WEBSITE_URL } from "@/lib/digital-cards/config";
import { splitContemplationText } from "@/lib/servopa-tables/contemplation";
import { formatBRL, formatDateBR, formatPercent } from "@/lib/servopa-tables/format";
import type { ServopaTableView } from "@/lib/servopa-tables/queries";
import type { ServopaSheetCampaign } from "@/lib/servopa-tables/campaigns";
import { ReoboteLogo } from "@/components/reobote-logo";
import { CampaignBand, SheetTitle } from "@/components/servopa-tables/sheet-header";
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
 * - Com campanha (Black November…), o cabeçalho vira uma faixa de ponta a
 *   ponta de 210 × 52 mm com a arte de fundo (cortada para cobrir, centrada);
 *   o resto da folha não muda.
 */
export function ServopaPrintSheet({ table, campaign }: { table: ServopaTableView; campaign?: ServopaSheetCampaign | null }) {
  const blocks = splitContemplationText(table.contemplationText);
  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        .servopa-sheet { width: 210mm; height: 297mm; overflow: hidden; zoom: var(--servopa-preview-zoom, 1); }
        .servopa-sheet, .servopa-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .servopa-sheet[data-compact="1"] .servopa-row > td { padding-top: 1.1mm; padding-bottom: 1.1mm; font-size: 13.5px; }
        .servopa-sheet[data-compact="1"] .servopa-reobote-header { margin-bottom: 6mm; padding-bottom: 3mm; }
        .servopa-campaign-band { margin: -7mm -12mm 5mm; }
        .servopa-rules { columns: 2; column-gap: 7mm; }
        .servopa-rules > * { break-inside: avoid; }
        /*
         * Ctrl+P direto na página (o botão "Imprimir" imprime o PDF gerado).
         * Numa impressora de verdade a área útil é MENOR que 210 × 297 mm
         * (margens físicas, escala lembrada pelo navegador): a folha não pode
         * ter largura fixa — com 210 mm travados ela era cortada à direita
         * (coluna Seguro sumia) e sobrava uma 2ª página. Aqui ela ocupa a área
         * que existir: largura 100% e altura da página, sem cortar nada.
         */
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .servopa-sheet {
            box-sizing: border-box !important;
            width: 100% !important;
            max-width: 210mm !important;
            height: auto !important;
            min-height: 100vh !important;
            margin: 0 auto !important;
            padding: 7mm 10mm !important;
            zoom: 1 !important;
            box-shadow: none !important;
            overflow: visible !important;
          }
          /* A faixa acompanha a margem interna da folha impressa (7mm 10mm). */
          .servopa-campaign-band { margin: -7mm -10mm 5mm !important; }
          .servopa-campaign-content { padding: 0 10mm !important; }
        }
      `}</style>

      <main
        className="servopa-sheet mx-auto flex flex-col bg-white px-[12mm] pb-[8mm] pt-[7mm] text-[13.5px] leading-snug text-neutral-900 shadow-md"
        data-compact="0"
      >
        {campaign ? (
          <CampaignBand
            artUrl={campaign.artUrl}
            textColor={campaign.textColor}
            groupNumber={table.groupNumber}
            termMonths={table.termMonths}
            campaignName={campaign.name}
          />
        ) : (
          <>
            <div className="servopa-reobote-header mb-[6mm] flex justify-center border-b border-neutral-200 pb-[3mm]">
              <ReoboteLogo isLight className="h-[15mm] w-auto" />
            </div>
            <div className="pb-[4.5mm]">
              <SheetTitle groupNumber={table.groupNumber} termMonths={table.termMonths} tone="dark" />
            </div>
          </>
        )}

        <table className="w-full table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-[8%]" />
            <col className="w-[22%]" />
            <col className="w-[26%]" />
            <col className="w-[24%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr className="bg-[#c8c8c8] text-center text-[13px] font-bold">
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
                <td className="whitespace-nowrap px-1 py-[2mm]">{r.category}</td>
                <td className="whitespace-nowrap px-1 py-[2mm] tabular-nums">{formatPercent(r.monthlyPercent)}</td>
                <td className="whitespace-nowrap px-1 py-[2mm] tabular-nums">{formatBRL(r.creditValue)}</td>
                <td className="whitespace-nowrap px-1 py-[2mm] tabular-nums">{formatBRL(r.installment)}</td>
                <td className="whitespace-nowrap px-1 py-[2mm] tabular-nums">{formatBRL(r.insurance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-[4.5mm] grid grid-cols-[auto_auto_auto] justify-between gap-x-4 whitespace-nowrap border-b border-neutral-900 pb-[1.4mm] text-[13px] font-bold">
          <span>Taxa de Administração: {formatPercent(table.admEffective, { trim: true })}</span>
          <span>Fundo de Reserva: {table.reserveFundPercent ? formatPercent(table.reserveFundPercent, { trim: true }) : "—"}</span>
          <span>Vagas disponíveis: {table.vacancies ?? "—"}</span>
        </div>
        <div className="flex justify-between whitespace-nowrap border-b border-neutral-900 py-[1.6mm] text-[14px] font-bold">
          <span>Assembleia provável: {table.nextAssemblyAt ? formatDateBR(table.nextAssemblyAt) : "—"}</span>
          <span>Vencimento: {table.dueDay ?? "—"}</span>
        </div>

        {blocks.length > 0 && (
          <section className="mt-[4.5mm]">
            <p className="mb-[2mm] text-[10.5px] font-bold uppercase tracking-[0.14em] text-neutral-500">Condições do grupo</p>
            {(() => {
              const listBlocks = blocks.filter((b): b is Extract<typeof b, { kind: "list" }> => b.kind === "list");
              const noteBlocks = blocks.filter((b): b is Extract<typeof b, { kind: "note" }> => b.kind === "note");

              if (listBlocks.length > 0 && noteBlocks.length > 0) {
                return (
                  <div
                    className="grid grid-cols-2 gap-x-[7mm] text-neutral-800"
                    style={{ fontSize: "var(--servopa-rules-size, 10.5px)" }}
                  >
                    {/* Coluna 1: Etapas de Contemplação */}
                    <div className="space-y-[1.8mm]">
                      <p className="border-b border-neutral-300 pb-[1mm] text-[9.5px] font-bold uppercase tracking-[0.12em] text-neutral-600">
                        Etapas de Contemplação
                      </p>
                      {listBlocks.map((block, index) => (
                        <div key={index} className="rounded border border-neutral-200/90 bg-neutral-50 px-[2.5mm] py-[1.6mm]">
                          <p className="font-bold text-neutral-900 leading-tight">{block.title}</p>
                          <p className="mt-[0.8mm] text-neutral-700 leading-snug">{block.items.join(" · ")}</p>
                        </div>
                      ))}
                    </div>

                    {/* Coluna 2: Regras e Observações */}
                    <div className="space-y-[1.8mm]">
                      <p className="border-b border-neutral-300 pb-[1mm] text-[9.5px] font-bold uppercase tracking-[0.12em] text-neutral-600">
                        Regras e Observações
                      </p>
                      {noteBlocks.map((block, index) => (
                        <HighlightedNote key={index} text={block.text} />
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <div className="servopa-rules leading-[1.35] text-neutral-800" style={{ fontSize: "var(--servopa-rules-size, 10.5px)" }}>
                  {blocks.map((block, index) =>
                    block.kind === "list" ? (
                      <div key={index} className="mb-[1.8mm]">
                        <p className="font-semibold text-neutral-900">{block.title}</p>
                        <p className="mt-[0.6mm] leading-snug text-neutral-700">{block.items.join(" · ")}</p>
                      </div>
                    ) : (
                      <HighlightedNote key={index} text={block.text} />
                    ),
                  )}
                </div>
              );
            })()}
          </section>
        )}

        <footer className="relative mt-auto pt-[4mm] text-center text-[11px] leading-relaxed text-neutral-600">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <ReoboteLogo isLight className="h-[45mm] w-auto opacity-[0.07] select-none" />
          </div>
          <div className="relative mb-[2mm] h-px bg-[#b60b29]" />
          <p className="relative text-[12px] font-bold text-neutral-900">Reobote Consórcios</p>
          <p className="relative">{REOBOTE_CARD_ADDRESS}</p>
          <div className="relative mt-0.5 flex items-center justify-center gap-3">
            <a
              href={REOBOTE_WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-neutral-600 hover:text-neutral-900"
            >
              <WebsiteIcon className="h-4 w-4 text-neutral-500" />
              <span>{REOBOTE_WEBSITE_URL.replace(/^https?:\/\//, "")}</span>
            </a>
            <span className="text-neutral-400">·</span>
            <a
              href={`https://instagram.com/${REOBOTE_INSTAGRAM_HANDLE}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-neutral-600 hover:text-neutral-900"
            >
              <InstagramIcon className="h-4 w-4 text-neutral-500" />
              <span>{REOBOTE_INSTAGRAM_HANDLE}</span>
            </a>
          </div>
        </footer>
      </main>
      <SheetFit />
    </>
  );
}

function HighlightedNote({ text }: { text: string }) {
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0 && colonIdx < 35) {
    const prefix = text.slice(0, colonIdx + 1);
    const rest = text.slice(colonIdx + 1);
    return (
      <p className="relative pl-[3mm] leading-snug before:absolute before:left-0 before:content-['•']">
        <strong className="font-bold text-neutral-900">{prefix}</strong>
        {rest}
      </p>
    );
  }

  const match = text.match(
    /^(NA MODALIDADE [^,]+|REAJUSTE DO CREDITO[^–—\n(]+|OPCAO FLEX[^–—\n,]+|O SEGURO PRESTAMISTA[^–—\n,]+|O LANCE PAGO E EMBUTIDO[^–—\n,]+|PARTICIPA DE [^–—\n,]+)/i,
  );
  if (match) {
    const boldPart = match[0];
    const rest = text.slice(boldPart.length);
    return (
      <p className="relative pl-[3mm] leading-snug before:absolute before:left-0 before:content-['•']">
        <strong className="font-bold text-neutral-900">{boldPart}</strong>
        {rest}
      </p>
    );
  }

  return (
    <p className="relative pl-[3mm] leading-snug before:absolute before:left-0 before:content-['•']">
      {text}
    </p>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.16c3.2 0 3.58.02 4.85.07 3.25.15 4.77 1.7 4.92 4.92.05 1.27.07 1.65.07 4.85s-.02 3.58-.07 4.85c-.15 3.23-1.67 4.77-4.92 4.92-1.27.05-1.65.07-4.85.07s-3.58-.02-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.18 15.58 2.16 15.2 2.16 12s.02-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.18 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.7 21.3.27 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.4-11.84a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
    </svg>
  );
}

function WebsiteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
    </svg>
  );
}
