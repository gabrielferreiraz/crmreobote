import { ReoboteLogo } from "@/components/reobote-logo";
import { formatCurrency } from "@/lib/format";
import { creditPerQuota, formatPercent, formatProposalNumber, type ProposalPrintData } from "@/lib/proposals/types";

type CreditCategory = "IMOVEL" | "AUTOMOVEL" | "OUTRO";

/**
 * Documento de proposta em 2 folhas A4, desenhado para impressão ECONÔMICA:
 * nada de fotos de capa, blocos pretos grandes ou preenchimentos pesados que
 * gastam tinta (decisão do usuário, ver histórico). Hierarquia vem de
 * tipografia, filetes finos e espaço em branco — só o necessário vai pra
 * tinta. Mantém o mesmo DOM entre screen e print (as duas folhas aparecem
 * empilhadas na tela com sombra leve; no print quebram em páginas separadas
 * via page-break-after, ver style abaixo).
 */
export function ProposalDocument({ data }: { data: ProposalPrintData }) {
  const { proposal: p } = data;
  const issuedAt = new Date(p.generatedAt ?? p.createdAt);
  const perQuota = creditPerQuota(p.credit, p.quotaCount);
  const category = getCreditCategory(data.creditType);
  const categoryLabel = category === "IMOVEL" ? "Consórcio de imóveis" : category === "AUTOMOVEL" ? "Consórcio de automóveis" : "Proposta de consórcio";
  const formattedDate = issuedAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Campo_Grande",
  });

  return (
    <>
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }

        @media screen {
          .proposal-page {
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          }
        }

        @media print {
          html, body {
            width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
          }
          .no-print {
            display: none !important;
          }
          .proposal-container {
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .proposal-page {
            box-shadow: none !important;
            width: 210mm !important;
            max-width: 210mm !important;
            height: 297mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .proposal-page:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
        }
      `}</style>

      <div className="proposal-container flex flex-col gap-6 sm:gap-8 w-full max-w-[210mm] mx-auto print:block">
        {/* ── PÁGINA 1: só a saudação ao cliente (tinta mínima) ── */}
        <article className="proposal-page relative mx-auto flex w-full max-w-[210mm] min-h-[297mm] h-[297mm] flex-col overflow-hidden rounded-2xl sm:rounded-none bg-white text-neutral-900">
          <div className="flex flex-1 flex-col px-8 sm:px-[18mm] pt-8 sm:pt-[14mm] pb-6 sm:pb-[12mm]">
            {/* Topo: logo + identificação da proposta */}
            <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4 sm:pb-5">
              <ReoboteLogo isLight className="shrink-0" style={{ height: "9mm", width: "calc(9mm * 3144 / 1784)" }} />
              <div className="text-right">
                <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  Proposta Comercial
                </p>
                <p className="mt-0.5 text-sm font-bold text-neutral-900">Nº {formatProposalNumber(p.number)}</p>
                <p className="text-[10px] text-neutral-400">Revisão {p.revision}</p>
              </div>
            </header>

            {/* Saudação centralizada */}
            <main className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
                {categoryLabel}
              </p>
              <h1 className="mt-4 sm:mt-5 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-950">
                Olá, {data.clientName}.
              </h1>
              <div className="mt-5 h-px w-20 bg-neutral-400" />
              <p className="mt-6 max-w-md text-base sm:text-lg text-neutral-600 leading-relaxed">
                Preparamos uma proposta personalizada para planejar a conquista do seu objetivo.
              </p>
              <p className="mt-2 max-w-md text-xs sm:text-sm text-neutral-400">
                Nas próximas páginas você encontra o detalhamento completo dos valores e condições.
              </p>
            </main>

            {/* Rodapé */}
            <footer className="flex items-center justify-between gap-3 border-t border-neutral-300 pt-4 text-[10px] sm:text-[11px] text-neutral-500">
              <span className="font-medium text-neutral-700">{data.organizationName}</span>
              <span className="truncate">
                {data.consultantName} · {formattedDate}
              </span>
              <span className="shrink-0">Pág. 1 / 2</span>
            </footer>
          </div>
        </article>

        {/* ── PÁGINA 2: valores, condições e observações ── */}
        <article className="proposal-page relative mx-auto flex w-full max-w-[210mm] min-h-[297mm] h-[297mm] flex-col overflow-hidden rounded-2xl sm:rounded-none bg-white text-neutral-900">
          {/* Cabeçalho leve (filete, não bloco de tinta) */}
          <header className="flex items-center justify-between gap-4 border-b border-neutral-300 px-8 sm:px-[16mm] pt-8 sm:pt-[12mm] pb-4 sm:pb-5">
            <div className="flex items-center gap-3">
              <ReoboteLogo isLight className="shrink-0" style={{ height: "7mm", width: "calc(7mm * 3144 / 1784)" }} />
              <div className="border-l border-neutral-300 pl-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-900">{categoryLabel}</p>
                <p className="text-[10px] text-neutral-500">Proposta Nº {formatProposalNumber(p.number)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400">Cliente</p>
              <p className="text-xs font-semibold text-neutral-900">{data.clientName}</p>
            </div>
          </header>

          <div className="flex flex-1 flex-col justify-between px-8 sm:px-[16mm] pt-6 sm:pt-8 pb-6 sm:pb-[12mm]">
            <div className="space-y-6 sm:space-y-7">
              {/* Tabela de condições — hierarquia por filetes e peso de fonte,
                  sem faixas pretas (economia de tinta na impressão) */}
              <section className="w-full">
                <div className="flex items-baseline justify-between border-b-2 border-neutral-900 pb-2">
                  <h2 className="text-sm sm:text-base font-bold text-neutral-950">Condições Planejadas</h2>
                  {data.creditType && <span className="text-[11px] text-neutral-500">{data.creditType}</span>}
                </div>

                <dl className="w-full">
                  <DetailRow label="Valor do crédito" value={formatCurrency(p.credit)} strong />
                  <DetailRow label="Prazo total" value={`${p.termMonths} ${p.termMonths === 1 ? "mês" : "meses"}`} />
                  <DetailRow label="Taxa" value={formatPercent(p.feePercent)} />
                  <DetailRow label="Cotas" value={p.quotaCount > 1 ? `${p.quotaCount} de ${formatCurrency(perQuota)}` : "1 cota"} />
                  <DetailRow label="Valor da parcela" value={formatCurrency(p.installment)} strong highlight />
                </dl>
              </section>

              {/* Observações */}
              {p.description && (
                <section className="w-full">
                  <h3 className="border-b border-neutral-300 pb-1.5 text-sm sm:text-base font-bold text-neutral-950">
                    Observações e Condições Gerais
                  </h3>
                  <p className="mt-2.5 break-words whitespace-pre-wrap text-xs sm:text-sm leading-relaxed text-neutral-700">
                    {p.description}
                  </p>
                </section>
              )}
            </div>

            {/* Rodapé */}
            <footer className="flex items-center justify-between gap-3 border-t border-neutral-300 pt-4 mt-6 text-[10px] sm:text-[11px] text-neutral-500">
              <span className="font-medium text-neutral-700">{data.organizationName}</span>
              <span className="truncate">
                {data.consultantName} · {formattedDate}
              </span>
              <span className="shrink-0">Pág. 2 / 2</span>
            </footer>
          </div>
        </article>
      </div>
    </>
  );
}

/**
 * Linha da tabela de condições. `highlight` (usado na parcela) marca com um
 * filete lateral esquerdo + fundo branco — destaque SEM preenchimento escuro,
 * que na impressão doméstica/comercial é o que mais consome tinta.
 */
function DetailRow({ label, value, strong = false, highlight = false }: { label: string; value: string; strong?: boolean; highlight?: boolean }) {
  return (
    <div
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-6 border-b border-neutral-200 py-3 ${
        highlight ? "shadow-[inset_4px_0_0_0_#171717] pl-3" : "pl-0"
      }`}
    >
      <dt className={`min-w-0 whitespace-nowrap text-sm text-neutral-600 ${strong ? "font-semibold text-neutral-900" : "font-medium"}`}>{label}</dt>
      <dd className={`text-right tabular-nums text-neutral-900 ${strong ? "text-lg font-bold" : "text-sm font-semibold"}`}>{value}</dd>
    </div>
  );
}

function getCreditCategory(creditType: string | null): CreditCategory {
  const normalized = (creditType ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/(imovel|casa|apartamento|terreno)/.test(normalized)) return "IMOVEL";
  if (/(automovel|veiculo|carro|auto)/.test(normalized)) return "AUTOMOVEL";
  return "OUTRO";
}
