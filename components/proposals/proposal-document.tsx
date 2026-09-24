import { ReoboteLogo } from "@/components/reobote-logo";
import { formatCurrency } from "@/lib/format";
import { creditPerQuota, formatProposalNumber, type ProposalPrintData } from "@/lib/proposals/types";

/**
 * O DOCUMENTO da proposta (folha A4 que o consultor imprime/salva em PDF) —
 * só apresentação, sem estado e sem hook: mesma peça serve a página de
 * impressão (app/propostas/[id]) e qualquer preview futuro (WhatsApp, e-mail,
 * link público) sem recriar o layout. Padrão já usado pelo Cartão Digital
 * (components/digital-card/*: visão compartilhada entre a página pública e o
 * preview de edição).
 *
 * SEMPRE claro (nenhuma variante `dark:`) — é uma folha de papel: o consultor
 * usando tema escuro no CRM não pode imprimir texto claro em fundo branco.
 *
 * Impressão: o `<style>` abaixo cuida do @page (A4, margem generosa em
 * cima/embaixo) e de esconder o que tem `.no-print`. O site NÃO controla o
 * cabeçalho/rodapé que o navegador desenha (URL, data, nº de página — é
 * opção do diálogo de impressão de cada um), então a margem em cima/embaixo
 * é folgada de propósito: mesmo com essa opção ligada, o que o navegador
 * escreve cai na margem e não por cima do conteúdo.
 */
export function ProposalDocument({ data }: { data: ProposalPrintData }) {
  const { proposal: p } = data;
  const issuedAt = new Date(p.generatedAt ?? p.createdAt);
  const perQuota = creditPerQuota(p.credit, p.quotaCount);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 16mm 14mm; }
        /* O texto "reobote CONSÓRCIOS" do SVG é branco (feito pra fundo
           escuro — ver components/reobote-logo.tsx); em papel branco sumiria.
           CSS fill vence o atributo fill="" do SVG. */
        .proposal-logo path[fill="#ffffff"] { fill: #0c4a6e; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .proposal-sheet { box-shadow: none !important; width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <article className="proposal-sheet mx-auto w-[210mm] min-h-[297mm] bg-white p-[14mm] text-neutral-900 shadow-lg">
        {/* Cabeçalho: largura E altura explícitas no logo, nunca "auto" — lição
            documentada em components/reobote-logo.tsx (proporção intrínseca de
            SVG inconsistente entre motores de navegador). */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-[#00aeee] pb-5">
          <ReoboteLogo
            className="proposal-logo shrink-0"
            style={{ height: "20mm", width: "calc(20mm * 3144 / 1784)" }}
          />
          <div className="text-right">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-neutral-500 uppercase">Proposta comercial</p>
            <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">Nº {formatProposalNumber(p.number)}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Revisão {p.revision} · Emitida em{" "}
              {issuedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })}
            </p>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-8 break-inside-avoid">
          <div>
            <h2 className="text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">Cliente</h2>
            <p className="mt-1.5 text-lg font-semibold">{data.clientName}</p>
            {data.clientPhone && <p className="text-sm text-neutral-600">{data.clientPhone}</p>}
            {data.clientEmail && <p className="text-sm text-neutral-600">{data.clientEmail}</p>}
          </div>
          <div>
            <h2 className="text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">Consultor</h2>
            <p className="mt-1.5 text-lg font-semibold">{data.consultantName}</p>
            {data.consultantEmail && <p className="text-sm text-neutral-600">{data.consultantEmail}</p>}
            <p className="text-sm text-neutral-600">{data.organizationName}</p>
          </div>
        </section>

        <section className="mt-10 break-inside-avoid">
          <h2 className="text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">Condições da proposta</h2>
          {/* gap-px sobre fundo cinza desenha as linhas divisórias sem borda
              por célula (borda por célula quebra com número ímpar de itens —
              aqui são 4, ou 5 com Tipo de crédito); a célula "vazia" que
              sobra no ímpar é preenchida de branco pra não aparecer um bloco
              cinza. */}
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200">
            <Condition label="Crédito total" value={formatCurrency(p.credit)} big />
            <Condition
              label="Quantidade de cotas"
              value={String(p.quotaCount)}
              hint={p.quotaCount > 1 ? `${formatCurrency(perQuota)} por cota` : undefined}
            />
            <Condition label="Prazo" value={`${p.termMonths} ${p.termMonths === 1 ? "mês" : "meses"}`} />
            <Condition label="Parcela" value={formatCurrency(p.installment)} big />
            {data.creditType && (
              <>
                <Condition label="Tipo de crédito" value={data.creditType} />
                <div className="bg-white" />
              </>
            )}
          </dl>
        </section>

        {p.description && (
          <section className="mt-10">
            <h2 className="text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">Observações</h2>
            <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-neutral-700">{p.description}</p>
          </section>
        )}

        <footer className="mt-14 border-t border-neutral-200 pt-3 text-[11px] text-neutral-400">
          {data.organizationName} · Proposta Nº {formatProposalNumber(p.number)} · Revisão {p.revision}
        </footer>
      </article>
    </>
  );
}

function Condition({ label, value, hint, big }: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className="bg-white p-4">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`mt-1 font-bold tabular-nums ${big ? "text-2xl" : "text-xl"}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
