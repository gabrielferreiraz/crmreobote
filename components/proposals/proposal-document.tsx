import Image from "next/image";
import { ReoboteLogo } from "@/components/reobote-logo";
import { formatCurrency } from "@/lib/format";
import { creditPerQuota, type ProposalPrintData } from "@/lib/proposals/types";

type CreditCategory = "IMOVEL" | "AUTOMOVEL" | "OUTRO";

function getCreditCategory(creditType: string | null): CreditCategory {
  const normalized = (creditType ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/(imovel|casa|apartamento|terreno)/.test(normalized)) return "IMOVEL";
  if (/(automovel|veiculo|carro|auto)/.test(normalized)) return "AUTOMOVEL";
  return "OUTRO";
}

export function ProposalDocument({ data }: { data: ProposalPrintData }) {
  const { proposal: p } = data;
  const issuedAt = new Date(p.generatedAt ?? p.createdAt);
  const perQuota = creditPerQuota(p.credit, p.quotaCount);
  const category = getCreditCategory(data.creditType);
  const coverSrc = category === "AUTOMOVEL" ? "/proposal-covers/automovel-cover.png" : "/proposal-covers/imovel-cover.png";
  const categoryLabel = category === "IMOVEL" ? "Consórcio de imóveis" : category === "AUTOMOVEL" ? "Consórcio de automóveis" : "Proposta de consórcio";

  return (
    <>
      <style>{`
        @page { size: A4; margin: 16mm 14mm; }
        .proposal-logo path[fill="#ffffff"] { fill: #ffffff; }
        .proposal-details { width: 100%; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .proposal-sheet { box-shadow: none !important; width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
          .proposal-details { break-before: page; page-break-before: always; margin-top: 0 !important; width: 100% !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <article className="proposal-sheet mx-auto min-h-[297mm] w-[210mm] overflow-hidden bg-white text-neutral-900 shadow-lg">
        <header className="relative h-[58mm] overflow-hidden bg-neutral-900 [clip-path:polygon(0_0,100%_0,100%_84%,50%_100%,0_84%)]">
          <Image src={coverSrc} alt="" width={2048} height={700} priority className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-neutral-950/20" />
          <div className="absolute left-8 top-7 flex items-center gap-3 bg-neutral-950/85 px-4 py-3">
            <ReoboteLogo className="proposal-logo shrink-0" style={{ height: "8mm", width: "calc(8mm * 3144 / 1784)" }} />
            <span className="border-l border-white/30 pl-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/85">Proposta comercial</span>
          </div>
        </header>

        <div className="px-[14mm] pb-[14mm]">
          <section className="mt-7 text-center break-inside-avoid">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">Olá, {data.clientName}.</h1>
            <p className="mt-2 text-base text-neutral-600">Esta é a sua proposta personalizada.</p>
          </section>

          <section className="proposal-details mt-10 w-full break-inside-avoid">
            <div className="flex items-center justify-between bg-neutral-900 px-5 py-3 text-white">
              <h2 className="text-base font-semibold">{categoryLabel}</h2>
              {data.creditType && <span className="text-xs text-neutral-300">{data.creditType}</span>}
            </div>

            <dl className="w-full border-x border-b border-neutral-200">
              <DetailRow label="Valor do crédito" value={formatCurrency(p.credit)} strong />
              <DetailRow label="Prazo total" value={`${p.termMonths} ${p.termMonths === 1 ? "mês" : "meses"}`} />
              <DetailRow label="Cotas" value={p.quotaCount > 1 ? `${p.quotaCount} de ${formatCurrency(perQuota)}` : "1 cota"} />
              <DetailRow label="Valor da parcela" value={formatCurrency(p.installment)} inverse />
            </dl>
          </section>

          {p.description && (
            <section className="mt-10 break-inside-avoid">
              <h2 className="border-b border-neutral-300 pb-2 text-base font-semibold text-neutral-950">Observações</h2>
              <p className="mt-4 break-words whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{p.description}</p>
            </section>
          )}

          <footer className="mt-12 flex items-center justify-between border-t border-neutral-200 pt-3 text-[11px] text-neutral-500">
            <span>{data.organizationName}</span>
            <span>{data.consultantName} · {issuedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Campo_Grande" })}</span>
          </footer>
        </div>
      </article>
    </>
  );
}

function DetailRow({ label, value, strong = false, inverse = false }: { label: string; value: string; strong?: boolean; inverse?: boolean }) {
  return (
    <div className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 px-5 py-3 ${inverse ? "bg-neutral-900 text-white" : "border-b border-neutral-200"}`}>
      <dt className={`min-w-0 whitespace-nowrap text-sm ${strong ? "font-semibold" : "font-medium"} ${inverse ? "text-white" : "text-neutral-700"}`}>{label}</dt>
      <dd className={`text-right tabular-nums ${strong || inverse ? "text-lg font-bold" : "font-semibold"} ${inverse ? "text-white" : "text-neutral-900"}`}>{value}</dd>
    </div>
  );
}
