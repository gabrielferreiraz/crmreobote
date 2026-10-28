"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, FileText, Loader2, Pencil, Save, X } from "lucide-react";
import Image from "next/image";
import { ReoboteLogo } from "@/components/reobote-logo";
import { formatCurrency } from "@/lib/format";
import { proposalApi, type ProposalTemplateDTO } from "@/lib/proposals/client";
import { creditPerQuota, formatPercent, isProposalEditable, type ProposalPrintData } from "@/lib/proposals/types";

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
  const editable = isProposalEditable(p.status);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(p.displayName ?? data.clientName);
  const [coverIntro, setCoverIntro] = useState(p.coverIntro ?? "Preparamos uma proposta personalizada para ajudar no planejamento do seu objetivo com clareza, segurança e uma leitura simples.");
  const [coverDetails, setCoverDetails] = useState(p.coverDetails ?? "Na próxima página estão os valores, prazos, taxa e demais condições calculadas para esta simulação.");
  const [coverImagePosition, setCoverImagePosition] = useState(p.coverImagePosition);
  const [description, setDescription] = useState(p.description);
  const [templates, setTemplates] = useState<ProposalTemplateDTO[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showTemplateTools, setShowTemplateTools] = useState(false);

  useEffect(() => {
    if (!editing || templates.length) return;
    proposalApi.templates().then((res) => {
      if (res.ok) setTemplates(res.data);
    });
  }, [editing, templates.length]);

  async function saveContent() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await proposalApi.update(p.id, {
      credit: p.credit,
      termMonths: p.termMonths,
      installment: p.installment,
      feePercent: p.feePercent,
      quotaCount: p.quotaCount,
      description,
      displayName,
      coverIntro,
      coverDetails,
      coverImagePosition,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDisplayName(result.data.displayName ?? "");
    setCoverIntro(result.data.coverIntro ?? "");
    setCoverDetails(result.data.coverDetails ?? "");
    setCoverImagePosition(result.data.coverImagePosition);
    setDescription(result.data.description);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function saveTemplate() {
    if (!templateName.trim() || !description.trim()) return;
    setSavingTemplate(true);
    setError(null);
    const result = await proposalApi.saveTemplate(templateName, description);
    setSavingTemplate(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTemplates((current) => [result.data, ...current]);
    setTemplateId(result.data.id);
    setTemplateName("");
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (template) setDescription(template.description);
  }

  function cancelEditing() {
    setDisplayName(p.displayName ?? data.clientName);
    setCoverIntro(p.coverIntro ?? "Preparamos uma proposta personalizada para ajudar no planejamento do seu objetivo com clareza, segurança e uma leitura simples.");
    setCoverDetails(p.coverDetails ?? "Na próxima página estão os valores, prazos, taxa e demais condições calculadas para esta simulação.");
    setCoverImagePosition(p.coverImagePosition);
    setDescription(p.description);
    setShowTemplateTools(false);
    setEditing(false);
  }
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
          size: 210mm 297mm;
          margin: 0;
        }

        .proposal-container {
          width: 100%;
          max-width: 209mm;
        }
        .proposal-page {
          width: 100%;
          max-width: 209mm;
          height: 296mm;
          min-height: 296mm;
          max-height: 296mm;
          box-sizing: border-box;
          /* Âncora da marca d'água do ::before abaixo. */
          position: relative;
        }

        /* Marca d'água da seta Reobote, em TODA folha da proposta.
           ::before (não uma <img>) pra não entrar no fluxo nem precisar ser
           repetida em cada página no JSX — a regra vale pra .proposal-page,
           então toda página nova já nasce com ela.
           O arquivo tem espaço no nome, daí o %20: dentro de url() um espaço
           cru encerraria o valor e a imagem não carregaria. */
        .proposal-page::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: url("/images/seta%20reobote.svg");
          background-repeat: no-repeat;
          background-position: center;
          /* Largura cheia da folha, de borda a borda (sangra por cima das
             margens de 12mm do conteúdo, de propósito). A altura vem em
             "auto" pra seta não distorcer: o arquivo é ~2467x883, então
             ocupando 209mm de largura ela fica com ~75mm de altura, uma faixa
             no meio da página — não a folha inteira. Trocar por "cover"
             encheria tudo, mas cortaria as pontas da seta. */
          background-size: 100% auto;
          opacity: 0.15;
          /* Fica atrás do conteúdo e não intercepta clique/seleção de texto. */
          z-index: 0;
          pointer-events: none;
        }

        /* O conteúdo sobe pra cima da marca d'água. Sem isto, o ::before
           posicionado cobriria o texto da folha. */
        .proposal-page > * {
          position: relative;
          z-index: 1;
        }
        .proposal-page-inner {
          align-self: stretch;
          flex: 1 1 0;
          min-height: 0;
          box-sizing: border-box;
          padding: 12mm;
        }
        .proposal-page-inner--cover {
          padding-bottom: 10mm;
        }
        .proposal-cover-media {
          width: 100%;
          height: auto;
          aspect-ratio: 3 / 1;
        }
        .proposal-cover-media-wrap {
          -webkit-clip-path: polygon(0 0, 100% 0, 100% 82%, 50% 100%, 0 82%);
          clip-path: polygon(0 0, 100% 0, 100% 82%, 50% 100%, 0 82%);
        }
        .proposal-cover-copy {
          margin-top: 7mm;
        }
        .proposal-detail-header {
          padding: 12mm 12mm 5mm;
        }
        .proposal-detail-body {
          min-height: 0;
          box-sizing: border-box;
          padding: 7mm 12mm 10mm;
        }
        .proposal-footer {
          box-sizing: border-box;
        }

        html.proposal-pdf-export .proposal-container {
          width: 209mm !important;
          min-width: 209mm !important;
          max-width: 209mm !important;
        }
        html.proposal-pdf-export .proposal-page {
          width: 209mm !important;
          min-width: 209mm !important;
          max-width: 209mm !important;
          height: 296mm !important;
          min-height: 296mm !important;
          max-height: 296mm !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        html.proposal-pdf-export .no-print {
          display: none !important;
        }

        @media screen {
          .proposal-page {
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          }
        }

        @media print {
          html, body {
            width: auto !important;
            min-width: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .proposal-container {
            display: block !important;
            flex: none !important;
            align-self: flex-start !important;
            width: 209mm !important;
            min-width: 209mm !important;
            max-width: 209mm !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 auto !important;
          }
          .proposal-page {
            display: block !important;
            position: relative !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            width: 209mm !important;
            min-width: 209mm !important;
            max-width: 209mm !important;
            height: 296mm !important;
            min-height: 296mm !important;
            max-height: 296mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* A marca d'água precisa dizer por conta própria que quer ser
             impressa: o navegador descarta imagem de fundo por padrão ao
             imprimir, e a herança de print-color-adjust não é garantida em
             pseudo-elemento. Sem isto, ela aparece na tela e some no papel. */
          .proposal-page::before {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .proposal-page-inner {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            min-height: 0 !important;
            padding: 12mm !important;
            box-sizing: border-box !important;
          }
          .proposal-page-inner--cover {
            padding-bottom: 10mm !important;
          }
          .proposal-detail-header {
            padding: 12mm 12mm 5mm !important;
          }
          .proposal-detail-body {
            display: block !important;
            height: auto !important;
            padding: 7mm 12mm 24mm !important;
          }
          .proposal-footer {
            position: absolute !important;
            right: 12mm !important;
            bottom: 10mm !important;
            left: 12mm !important;
            width: auto !important;
            margin: 0 !important;
          }
          .proposal-page:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
        }
      `}</style>

      <div className="proposal-container flex flex-col gap-6 sm:gap-8 w-full max-w-[210mm] mx-auto print:block">
        {editable && (
          <div className="no-print flex flex-wrap items-center justify-end gap-2">
            {!editing ? (
              <button type="button" onClick={() => setEditing(true)} className="btn-secondary btn-sm shadow-sm"><Pencil className="h-3.5 w-3.5" /> Editar no preview</button>
            ) : (
              <>
                {saved && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Salvo</span>}
                <button type="button" onClick={cancelEditing} className="btn-ghost btn-sm"><X className="h-3.5 w-3.5" /> Cancelar</button>
                <button type="button" onClick={() => setShowTemplateTools((value) => !value)} className="btn-secondary btn-sm"><FileText className="h-3.5 w-3.5" /> Templates</button>
                <button type="button" onClick={saveContent} disabled={saving} className="btn-primary btn-sm">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar</button>
              </>
            )}
            {error && <span className="basis-full text-right text-xs text-red-600 dark:text-red-400">{error}</span>}
          </div>
        )}
        {editable && editing && showTemplateTools && (
          <div className="no-print flex flex-wrap items-end justify-end gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-950">
            <label className="min-w-[220px] flex-1 space-y-1"><span className="field-label">Usar template</span><select value={templateId} onChange={(e) => applyTemplate(e.target.value)} className="field-input"><option value="">Selecionar texto salvo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={80} placeholder="Nome do template" className="field-input min-w-[180px] flex-1" />
            <button type="button" onClick={saveTemplate} disabled={savingTemplate || !templateName.trim() || !description.trim()} className="btn-secondary btn-sm">{savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Salvar template</button>
          </div>
        )}
        {/* ── PÁGINA 1: capa objetiva e econômica ── */}
        <article className="proposal-page relative mx-auto flex w-full max-w-[210mm] min-h-[296mm] h-[296mm] flex-col justify-between overflow-hidden rounded-2xl sm:rounded-none bg-white text-neutral-950 select-none">
          <div className="proposal-page-inner proposal-page-inner--cover flex flex-1 flex-col justify-between p-[12mm] pb-[10mm]">
            <div className="flex flex-col">
              {/* Topo: Logo da Reobote em Destaque */}
              <header className="flex items-center justify-start border-b border-neutral-200 pb-5 sm:pb-6">
                <ReoboteLogo isLight className="shrink-0" style={{ height: "18mm", width: "calc(18mm * 3144 / 1784)" }} />
              </header>

              <section className={`max-w-2xl ${coverImagePosition === "before-copy" ? "order-2 mt-7" : "mt-8"}`}>
                <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-[#007fb4]">{categoryLabel}</p>
                <h1 className="mt-3 text-4xl sm:text-5xl font-black leading-tight tracking-tight text-neutral-950">
                  Olá, <InlineEditableText
                    as="span"
                    value={displayName}
                    editing={editing}
                    maxLength={120}
                    onChange={(value) => setDisplayName(value.replace(/\.$/, ""))}
                    className={editing ? "cursor-text rounded-md outline-none ring-2 ring-brand/30 ring-offset-4" : ""}
                  />.
                </h1>
                <div className="mt-5 h-1 w-20 rounded-full bg-[#00aeee]" />
              </section>

              {/* Foto de apoio: menor, clara e sem bloco escuro para economizar tinta. */}
              <div className={`proposal-cover-media-wrap relative w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xs [clip-path:polygon(0_0,100%_0,100%_82%,50%_100%,0_82%)] ${coverImagePosition === "before-copy" ? "order-1 mt-7" : "order-2 mt-7"}`}>
                <div className="proposal-cover-media relative aspect-[3/1] w-full overflow-hidden">
                  <Image
                    src={getCoverImage(category)}
                    alt={categoryLabel}
                    fill
                    priority
                    unoptimized
                    sizes="210mm"
                    className="h-full w-full object-cover object-center opacity-90"
                  />
                  {editing && (
                    <div className="no-print absolute right-3 top-3 flex items-center gap-1 rounded-md bg-white/95 p-1 shadow-sm">
                      <span className="px-1 text-[11px] font-semibold text-neutral-700">Mover foto</span>
                      {coverImagePosition === "after-title" ? (
                        <button type="button" onClick={() => setCoverImagePosition("before-copy")} className="icon-btn h-7 w-7" title="Mover foto para o início" aria-label="Mover foto para o início"><ArrowUp className="h-3.5 w-3.5" /></button>
                      ) : (
                        <button type="button" onClick={() => setCoverImagePosition("after-title")} className="icon-btn h-7 w-7" title="Mover foto para depois do título" aria-label="Mover foto para depois do título"><ArrowDown className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Saudação e apresentação com amplo espaçamento vertical */}
              <div className="proposal-cover-copy order-3 mt-[7mm] flex max-w-2xl flex-col items-start">
                <InlineEditableText
                  as="p"
                  value={coverIntro}
                  editing={editing}
                  maxLength={500}
                  onChange={setCoverIntro}
                  className={`max-w-xl text-base sm:text-lg font-semibold text-neutral-800 leading-relaxed ${editing ? "cursor-text rounded-md outline-none ring-2 ring-brand/30 ring-offset-4" : ""}`}
                />
                <InlineEditableText
                  as="p"
                  value={coverDetails}
                  editing={editing}
                  maxLength={500}
                  onChange={setCoverDetails}
                  className={`mt-4 max-w-lg text-sm sm:text-base font-medium leading-relaxed text-neutral-500 ${editing ? "cursor-text rounded-md outline-none ring-2 ring-brand/30 ring-offset-4" : ""}`}
                />
              </div>

            </div>

            {/* Rodapé da Página 1 */}
            <footer className="proposal-footer flex items-center justify-between gap-3 border-t-2 border-neutral-200 pt-4 text-xs font-bold text-neutral-800">
              <span className="font-extrabold text-neutral-950">{data.organizationName}</span>
              <ProposalSocialLinks />
              <span className="shrink-0 font-extrabold">Pág. 1 / 2</span>
            </footer>
          </div>
        </article>

        {/* ── PÁGINA 2: valores, condições e observações ── */}
        <article className="proposal-page relative mx-auto flex w-full max-w-[210mm] min-h-[296mm] h-[296mm] flex-col overflow-hidden rounded-2xl sm:rounded-none bg-white text-neutral-950">
          {/* Cabeçalho leve (filete fino, não bloco de tinta) */}
          <header className="proposal-detail-header flex items-start justify-between gap-4 border-b border-slate-200 px-[12mm] pb-[5mm] pt-[12mm]">
            <div className="flex items-center gap-3">
              <ReoboteLogo isLight className="shrink-0" style={{ height: "8mm", width: "calc(8mm * 3144 / 1784)" }} />
              <div className="my-auto h-6 w-px bg-slate-200" />
              <span className="my-auto text-xs font-semibold uppercase tracking-wider text-slate-500">{categoryLabel}</span>
            </div>
            <div className="text-right">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Cliente</span>
              <span className="text-sm font-semibold text-slate-900">{displayName}</span>
            </div>
          </header>

          <div className="proposal-detail-body flex flex-1 flex-col justify-between px-[12mm] pb-[10mm] pt-[7mm]">
            <div>
              {/* Tabela de condições */}
              <section className="w-full">
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Condições Planejadas</h2>
                  {data.creditType && (
                    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{data.creditType}</span>
                  )}
                </div>

                {/* O último filho é a parcela, que já tem fundo e barra
                    próprios — o traço do divide-y por cima dele brigaria com
                    a moldura do bloco. */}
                <dl className="w-full divide-y divide-slate-100 text-sm [&>*:last-child]:border-t-0">
                  <DetailRow label="Valor do crédito" value={formatCurrency(p.credit)} strong />
                  <DetailRow label="Prazo total" value={`${p.termMonths} ${p.termMonths === 1 ? "mês" : "meses"}`} />
                  <DetailRow label="Taxa" value={formatPercent(p.feePercent)} />
                  <DetailRow label="Cotas" value={p.quotaCount > 1 ? `${p.quotaCount} de ${formatCurrency(perQuota)}` : "1 cota"} />
                  <DetailRow
                    label="Valor da parcela"
                    value={formatCurrency(p.installment)}
                    hint="Condição mensal estimada"
                    highlight
                  />
                </dl>
              </section>

              {/* Observações */}
              {(description || editing) && (
                <section className="mt-8 w-full border-t border-slate-200 pt-6">
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-900">
                    Observações e Condições Gerais
                  </h3>
                  {/* A superfície é da div, o texto é do <p>. Antes o próprio
                      <p> carregava fundo e borda: com observação curta a caixa
                      fechava logo abaixo da primeira linha e aquele corte reto
                      ficava feio. O degradê some antes de chegar no fim, então
                      não existe mais "fim de caixa" pra ver. Degradê lateral,
                      na mesma direção do bloco da parcela. */}
                  <div className="rounded-l-md bg-gradient-to-r from-slate-100 from-0% via-slate-50/40 via-30% to-transparent to-60% p-4">
                    <InlineEditableText
                      as="p"
                      value={description}
                      editing={editing}
                      maxLength={4000}
                      onChange={setDescription}
                      className={`break-words whitespace-pre-wrap text-xs leading-relaxed text-slate-600 ${editing ? "cursor-text rounded-sm outline-none ring-2 ring-brand/30 ring-offset-2" : ""}`}
                    />
                  </div>
                </section>
              )}
            </div>

            {/* Rodapé */}
            <footer className="proposal-footer mt-12 flex items-center justify-between gap-3 border-t border-slate-200 pt-4 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{data.organizationName}</span>
              <span className="truncate">{data.consultantName} · {formattedDate}</span>
              <ProposalSocialLinks />
              <span className="shrink-0 font-medium text-slate-600">Pág. 2 / 2</span>
            </footer>
          </div>
        </article>
      </div>
    </>
  );
}

/**
 * Linha da tabela de condições — otimizada com alta legibilidade e peso bold para telas de celular.
 */
function InlineEditableText({
  as,
  value,
  editing,
  maxLength,
  onChange,
  className,
}: {
  as: "span" | "p";
  value: string;
  editing: boolean;
  maxLength: number;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // Não reescreve o DOM enquanto o cursor está dentro do elemento.
    if (!editing || !ref.current || document.activeElement === ref.current) return;
    ref.current.textContent = value;
  }, [editing, value]);

  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      contentEditable={editing}
      suppressContentEditableWarning
      onInput={(event) => onChange((event.currentTarget.textContent ?? "").slice(0, maxLength))}
      className={className}
    >
      {editing ? null : value}
    </Tag>
  );
}

function ProposalSocialLinks() {
  return (
    <div className="flex items-center gap-2.5 text-neutral-500">
      <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-neutral-400">Nossas redes</span>
      <a href="https://instagram.com/reoboteconsorcios" target="_blank" rel="noopener noreferrer" aria-label="Instagram da Reobote" className="text-neutral-500">
        <InstagramIcon className="h-3.5 w-3.5" />
      </a>
      <a href="https://reoboteconsorcios.com.br" target="_blank" rel="noopener noreferrer" aria-label="Site da Reobote" className="text-neutral-500">
        <WebsiteIcon className="h-3.5 w-3.5" />
      </a>
      <a href="https://www.youtube.com/@reoboteconsorcios" target="_blank" rel="noopener noreferrer" aria-label="YouTube da Reobote" className="text-neutral-500">
        <YoutubeIcon className="h-3.5 w-3.5" />
      </a>
    </div>
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
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
    </svg>
  );
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z" />
    </svg>
  );
}

/**
 * Linha da tabela de condições.
 *
 * Tipografia padronizada: UM tamanho de rótulo e UM de valor para todas as
 * linhas comuns. Antes havia três escalas (base/lg no rótulo, base/xl/2xl no
 * valor) combinadas com três pesos (bold/extrabold/black) — seis variações
 * numa tabela de cinco linhas, e o olho não conseguia dizer o que era mais
 * importante porque quase tudo estava em destaque.
 *
 * A hierarquia agora vem de peso e cor, não de tamanho:
 * - rótulo  — cinza médio, peso normal: é a pergunta, não a resposta
 * - valor   — quase preto, seminegrito: é o que a pessoa procura
 * - `strong` (valor do crédito) — só sobe meio passo de tamanho
 * - `highlight` (parcela) — único que muda de escala de verdade, porque é
 *   o número que o cliente leva da proposta; ganha bloco próprio com a
 *   barra e o degradê em ciano
 */
function DetailRow({
  label,
  value,
  hint,
  strong = false,
  highlight = false,
}: {
  label: string;
  value: string;
  /** Linha de apoio sob o rótulo — só o bloco de destaque usa. */
  hint?: string;
  strong?: boolean;
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <div className="my-2 border-t-0 py-4">
        <div className="flex items-center justify-between gap-6 rounded-l-md rounded-r-lg border-l-[5px] border-[#00a3e0] bg-gradient-to-r from-[#e0f2fe]/80 via-[#f0f9ff]/40 to-transparent p-4">
          <dt className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[#0284c7]">{label}</span>
            {hint && <span className="text-xs text-slate-500">{hint}</span>}
          </dt>
          <dd className="text-2xl font-extrabold tracking-tight tabular-nums text-[#0369a1]">{value}</dd>
        </div>
      </div>
    );
  }
  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-3">
      <dt className="min-w-0 whitespace-nowrap font-medium text-slate-500">{label}</dt>
      <dd className={`text-right font-semibold tabular-nums text-slate-900 ${strong ? "text-base" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function getCreditCategory(creditType: string | null): CreditCategory {
  const normalized = (creditType ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/(imovel|casa|apartamento|terreno)/.test(normalized)) return "IMOVEL";
  if (/(automovel|veiculo|carro|auto)/.test(normalized)) return "AUTOMOVEL";
  return "OUTRO";
}

/**
 * Foto de capa por categoria do crédito.
 *
 * IMOVEL cai em casas-modernas.jpg: antes TODAS as categorias devolviam a
 * foto do carro, então uma proposta de consórcio de imóveis abria com alguém
 * ao volante — era o que aparecia na tela, mesmo com o rótulo "Consórcio de
 * imóveis" logo abaixo.
 *
 * OUTRO fica com a foto de imóveis (e não com a do carro) porque é a
 * categoria genérica: imóvel é o produto mais vendido aqui e uma casa não
 * desmente a proposta como um carro desmentiria.
 */
function getCoverImage(category: CreditCategory): string {
  switch (category) {
    case "AUTOMOVEL":
      return "/images/Alegria ao volante no campo.png";
    case "IMOVEL":
    case "OUTRO":
    default:
      return "/images/casas-modernas.jpg";
  }
}
