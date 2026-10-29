"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, FileText, Lightbulb, Loader2, Send } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { proposalApi } from "@/lib/proposals/client";
import { downloadProposalPdf } from "@/lib/proposals/export-pdf";
import { PROPOSAL_STATUS_LABEL, type ProposalDTO, type ProposalStatus } from "@/lib/proposals/types";
import { trackUse } from "@/lib/feature-usage/track";

/**
 * O que fazer agora, por situação da proposta.
 *
 * Conteúdo do modal aberto por "Abrir documento". A div estática que vivia no
 * painel só tratava quatro dos sete status — em ACCEPTED, DECLINED e
 * SUPERSEDED ela renderizava uma caixa roxa vazia, com o rótulo
 * "Próximo Passo:" e nada embaixo.
 */
const NEXT_STEP: Record<ProposalStatus, { title: string; lines: string[] }> = {
  DRAFT: {
    title: "Gere o documento oficial",
    lines: [
      "Confira os valores no documento ao lado — enquanto a proposta é um rascunho, tudo ainda pode ser editado.",
      "Clique em \"1. Gerar documento PDF\". A partir daí os valores ficam travados e a proposta ganha um número de revisão.",
    ],
  },
  GENERATED: {
    title: "Baixe o PDF e envie ao cliente",
    lines: [
      "Clique em \"2. Baixar / Salvar PDF\" para salvar o arquivo no celular ou no computador.",
      "Mande o arquivo ao cliente pelo WhatsApp ou e-mail — o envio é feito por você, fora do sistema.",
      "Depois de enviar de verdade, volte aqui e clique em \"3. Marcar como Enviada\" para registrar no histórico do negócio.",
    ],
  },
  SENT: {
    title: "Proposta enviada",
    lines: [
      "O envio já está registrado no histórico do negócio.",
      "Quando o cliente responder, marque \"Aceitou\" ou \"Não aceitou\" na lista de propostas do negócio.",
      "Se precisar mudar algum valor, use \"Refazer\": nasce uma nova revisão e esta fica guardada no histórico.",
    ],
  },
  ACCEPTED: {
    title: "O cliente aceitou",
    lines: [
      "Esta proposta está fechada e não muda mais.",
      "Toque o negócio para a próxima etapa do funil e registre a contemplação quando ela acontecer.",
    ],
  },
  DECLINED: {
    title: "O cliente não aceitou",
    lines: [
      "Registre no negócio o motivo da recusa: é ele que mostra depois o que costuma travar as vendas.",
      "Se quiser tentar outra condição, use \"Nova a partir desta\" para partir dos mesmos valores sem digitar tudo de novo.",
    ],
  },
  SUPERSEDED: {
    title: "Existe uma versão mais recente",
    lines: [
      "Esta revisão foi substituída e fica guardada apenas como histórico.",
      "Trabalhe pela revisão mais nova, na lista de propostas do negócio — é ela que vale para o cliente.",
    ],
  },
  CANCELLED: {
    title: "Proposta cancelada",
    lines: [
      "Uma proposta cancelada não volta atrás e não pode ser enviada.",
      "Para retomar a negociação, crie uma nova proposta a partir do negócio.",
    ],
  },
};

export function ProposalToolbar({
  proposal,
  showGuide = false,
}: {
  proposal: ProposalDTO;
  /** Chegou por "Abrir documento" (?guia=1) — ver page.tsx. */
  showGuide?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Estado do PDF em três tempos, não um booleano: além de "gerando" existe
  // o "deu errado", e os dois moram no MESMO modal. Com `printing` sozinho o
  // modal sumia no instante da falha e a mensagem de erro aparecia lá atrás
  // no painel, onde quem estava olhando o spinner não ia procurar.
  const [pdfState, setPdfState] = useState<null | "working" | "done" | "error">(null);
  const printing = pdfState === "working";
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [guide, setGuide] = useState(showGuide);

  const canPrint = proposal.status !== "DRAFT" && proposal.status !== "CANCELLED";
  const step = proposal.status === "DRAFT" ? 1 : proposal.status === "GENERATED" ? 2 : 3;
  const nextStep = NEXT_STEP[proposal.status];

  // Tira o ?guia=1 da URL depois que o modal já abriu (replaceState, sem
  // entrada nova no histórico). Sem isso ele sobreviveria ao F5 — a orientação
  // voltaria a cada recarga — e seria levado junto se a pessoa copiasse o
  // link. Não mexe em estado: `guide` já nasceu com o valor certo, vindo do
  // servidor.
  useEffect(() => {
    if (!showGuide) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("guia");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [showGuide]);

  async function downloadPdf() {
    if (printing) return;
    setPdfState("working");
    setError(null);
    trackUse("proposta.pdf");
    try {
      await downloadProposalPdf();
      setPdfState("done");
    } catch {
      setError("Não foi possível gerar o PDF. Tente novamente.");
      setPdfState("error");
    }
  }

  async function run(action: "generate" | "send") {
    setBusy(true);
    setError(null);
    const res = await proposalApi.action(proposal.id, action);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    trackUse(action === "generate" ? "proposta.gerar" : "proposta.enviada");
    router.refresh();
    return true;
  }

  const statusTone = proposal.status === "DRAFT" ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800" : proposal.status === "GENERATED" ? "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800" : proposal.status === "SENT" ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800" : "bg-neutral-100 text-neutral-800 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-300";

  return (
    // Fixo só a partir de lg, onde o layout vira duas colunas e o painel tem
    // um documento AO LADO pra acompanhar enquanto rola. Abaixo disso o layout
    // empilha (ver flex-col em page.tsx): o painel fica EM CIMA da proposta,
    // então grudá-lo no topo o fazia cobrir o documento o scroll inteiro. No
    // celular ele rola junto, como qualquer outro bloco. max-h/overflow seguem
    // a mesma regra — limitar altura só faz sentido pra algo que fica parado.
    <aside className="no-print z-40 w-full lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto">
      {/* Fundo OPACO por cima do .card: a classe pinta vidro
          (background rgba(255,255,255,.68) + backdrop-blur), que funciona
          apoiado num fundo liso mas não aqui — este painel é sticky e o
          documento da proposta corre por trás dele ao rolar, vazando texto
          através dos 32% de transparência. Mesmo recurso dos outros sticky do
          projeto (cabeçalho de tabela em contacts-table/deals-list): utilitária
          vence o .card porque @layer utilities vem depois de @layer components. */}
      <div className="card space-y-4 border border-neutral-200 bg-white p-4 shadow-md dark:border-neutral-800 dark:bg-neutral-900">
        {/* Topo com Título e Voltar ao Negócio */}
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-neutral-950 dark:text-white">
              Painel de Emissão
            </p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone}`}>
                {PROPOSAL_STATUS_LABEL[proposal.status]}
              </span>
              <span className="text-[11px] font-bold text-neutral-500">Rev. {proposal.revision}</span>
            </div>
          </div>
          <Link
            href={`/negocios/${proposal.dealId}`}
            className="icon-btn h-9 w-9 shrink-0 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            aria-label="Voltar ao negócio"
            title="Voltar ao negócio"
          >
            <ArrowLeft className="h-4 w-4 text-neutral-700 dark:text-neutral-200" strokeWidth={2.5} />
          </Link>
        </div>

        {/* O QUE FAZER AGORA — as ações, num bloco só. Separado da trilha de
            Progresso logo abaixo de propósito: aqui é o que a pessoa FAZ; lá
            é onde ela ESTÁ.

            Botões em UMA linha cada: ícone + rótulo, alinhados à esquerda.
            Antes eram empilhados em coluna, com subtítulo explicativo embaixo
            ("Salva o PDF no celular ou PC") — e como a coluna tem ~220px, o
            título ainda quebrava em duas linhas. Davam quatro linhas de texto
            por botão numa barra lateral que precisa caber ao lado da folha.
            A explicação que eles carregavam agora está no modal de passo a
            passo, que é onde alguém realmente lê; o `title` mantém o detalhe
            a um hover de distância. */}
        <div className="space-y-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
          {proposal.status === "DRAFT" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run("generate")}
              title="Cria o arquivo oficial para download"
              className="btn-primary w-full justify-start gap-2 px-3 py-2 text-sm font-extrabold shadow-sm"
            >
              {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2.5} /> : <FileText className="h-4 w-4 shrink-0" strokeWidth={2.5} />}
              <span className="truncate">1. Gerar PDF</span>
            </button>
          )}

          {canPrint && (
            // O download é submissão de formulário, não um onClick solto: o
            // Enter com o foco no botão dispara o mesmo caminho, e o estado de
            // "gerando" fica num lugar só (pdfState), consumido pelo botão e
            // pelo modal ao mesmo tempo.
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void downloadPdf();
              }}
            >
              <button
                type="submit"
                disabled={printing}
                title="Salva o PDF no celular ou PC"
                // Mesmo botão primário nos dois casos; o que muda é só o anel
                // de destaque quando ESTE é o passo da vez. Antes ele virava
                // azul sólido, uma cor que não existia em nenhum outro lugar do
                // fluxo e sugeria outro tipo de ação.
                className={`btn-primary w-full justify-start gap-2 px-3 py-2 text-sm font-extrabold ${
                  proposal.status === "GENERATED" ? "shadow-md ring-2 ring-brand/40" : ""
                }`}
              >
                {printing ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2.5} /> : <Download className="h-4 w-4 shrink-0" strokeWidth={2.5} />}
                <span className="truncate">{printing ? "Gerando PDF..." : proposal.status === "GENERATED" ? "2. Baixar PDF" : "Baixar PDF"}</span>
              </button>
            </form>
          )}

          {proposal.status === "GENERATED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmSend(true)}
              title="Confirma entrega ao cliente"
              // Secundário em roxo, não verde: é a ação de MENOR peso das
              // três (confirma algo que já aconteceu fora do sistema), e o
              // verde a fazia disputar atenção com o botão principal logo
              // acima — além de ser a terceira cor do painel.
              className="btn-secondary w-full justify-start gap-2 px-3 py-2 text-sm font-extrabold border-brand/30 bg-brand/5 text-brand hover:bg-brand/10 dark:border-brand/40 dark:bg-brand/10 dark:hover:bg-brand/20"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span className="truncate">3. Marcar como enviada</span>
            </button>
          )}
        </div>

        {/* ONDE VOCÊ ESTÁ — container próprio, irmão do bloco de ações acima.
            Era só um traço separando os dois assuntos; agora cada um tem sua
            moldura, então dá pra bater o olho e saber que ali embaixo não há
            nada pra clicar, é só leitura. */}
        <div className="space-y-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/40">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">Progresso:</p>
          {/* gap-0.5 em vez de gap-1.5: as setas já separam os passos, e o
              vão de antes somado a elas afastava demais os blocos, desfazendo
              a leitura de sequência. */}
          <div className="flex flex-col gap-0.5 text-xs">
            <StepBadge active={step >= 1} current={step === 1} label="1. Gerar" detail="Documento criado" icon={FileText} />
            <StepArrow done={step >= 2} />
            <StepBadge active={step >= 2} current={step === 2} label="2. Baixar PDF" detail="Arquivo salvo no aparelho" icon={Download} />
            <StepArrow done={step >= 3} />
            <StepBadge active={step >= 3} current={step === 3} label="3. Enviar ao Cliente" detail="Registrado no CRM" icon={Send} />
          </div>
        </div>

        {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {pdfState !== null && (
        <Modal
          // Enquanto gera, Esc e clique fora não fecham: o trabalho continua
          // acontecendo de qualquer jeito (html2canvas está varrendo a folha),
          // e sumir com o aviso faria parecer que o clique não deu em nada.
          onClose={() => {
            if (!printing) setPdfState(null);
          }}
          maxWidth="max-w-xs"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (printing) return;
              // Depois de uma falha o submit é "tentar de novo" — fechar e
              // obrigar a pessoa a caçar o botão lá atrás no painel seria pedir
              // trabalho por um erro que não foi dela.
              if (pdfState === "error") void downloadPdf();
              else setPdfState(null);
            }}
            className="flex flex-col items-center text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center">
              {printing ? (
                <Loader2 className="h-9 w-9 animate-spin text-brand" strokeWidth={2} />
              ) : pdfState === "done" ? (
                <CheckCircle2 className="h-9 w-9 text-brand" strokeWidth={2} />
              ) : (
                <AlertTriangle className="h-9 w-9 text-red-500" strokeWidth={2} />
              )}
            </div>
            <h2 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {printing ? "Gerando o PDF..." : pdfState === "done" ? "PDF baixado" : "Não deu certo"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {printing
                ? "Montando as duas folhas em um arquivo A4. Não feche esta aba."
                : pdfState === "done"
                  ? "O arquivo está na pasta de downloads do aparelho. Agora é só mandar ao cliente."
                  : (error ?? "Não foi possível gerar o PDF.")}
            </p>
            {!printing && (
              <button type="submit" autoFocus className="btn-primary btn-sm mt-4 w-full justify-center">
                {pdfState === "error" ? "Tentar de novo" : "Fechar"}
              </button>
            )}
          </form>
        </Modal>
      )}

      {guide && (
        <Modal onClose={() => setGuide(false)} maxWidth="max-w-md" mobileSheet>
          {/* <form> e não um punhado de divs: com onSubmit, o Enter em
              qualquer ponto do painel fecha o passo a passo, igual a qualquer
              diálogo do sistema — num conjunto de divs o Enter não faz nada e
              a pessoa precisa buscar o botão com o mouse. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setGuide(false);
            }}
          >
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 dark:bg-brand/20">
              <Lightbulb className="h-5 w-5 text-brand" strokeWidth={2} />
            </div>
            <div className="mt-0.5 flex-1">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{nextStep.title}</h2>
              <p className="mt-0.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {PROPOSAL_STATUS_LABEL[proposal.status]} · Rev. {proposal.revision}
              </p>
              {/* Uma <p> por instrução, numeradas: são passos em ordem, e num
                  parágrafo corrido a pessoa perde onde parou. */}
              <ol className="mt-3 space-y-2.5">
                {nextStep.lines.map((line, i) => (
                  <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-extrabold text-brand dark:bg-brand/20">
                      {i + 1}
                    </span>
                    <p className="min-w-0 flex-1">{line}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button type="submit" autoFocus className="btn-primary btn-sm">
              Entendi
            </button>
          </div>
          </form>
        </Modal>
      )}

      {confirmSend && (
        <ConfirmDialog
          title="Você já enviou esta proposta ao cliente?"
          description="Marque como enviada só depois de mandar o PDF de verdade. A partir daí os valores ficam travados; para mudar, use Refazer."
          confirmLabel="Sim, foi enviada"
          danger={false}
          onClose={() => setConfirmSend(false)}
          onConfirm={async () => {
            await run("send");
            setConfirmSend(false);
          }}
        />
      )}
    </aside>
  );
}

/**
 * Um passo da trilha de emissão. Três estados, numa escala só de roxo (a cor
 * de marca) — antes o passo atual era preto sólido e os demais cinza, o que
 * lia como três componentes diferentes empilhados em vez de uma sequência:
 *
 * - atual    — roxo sólido, o único bloco preenchido da coluna
 * - concluído — roxo apagado (só borda e fundo leve), com o ícone trocado
 *               pelo "check": o desenho do passo já cumpriu seu papel
 * - pendente  — neutro, sem cor nenhuma, pra não competir com o atual
 */
function StepBadge({
  active,
  current,
  label,
  detail,
  icon: Icon,
}: {
  active: boolean;
  current: boolean;
  label: string;
  detail: string;
  icon: typeof FileText;
}) {
  const done = active && !current;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
        current
          ? "border-brand bg-brand text-white"
          : done
            ? "border-brand/30 bg-brand/10 text-brand dark:border-brand/40 dark:bg-brand/15"
            : "border-neutral-200 bg-white text-neutral-400 dark:border-neutral-700/60 dark:bg-neutral-900/60 dark:text-neutral-500"
      }`}
    >
      {/* Ícone sempre presente, em caixa própria — é ele que dá o ritmo da
          coluna: sem isso, cada linha começava num ponto diferente conforme o
          tamanho do rótulo. No passo concluído vira o check. */}
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${
          current ? "bg-white/15" : done ? "bg-brand/10 dark:bg-brand/20" : "bg-neutral-100 dark:bg-neutral-800"
        }`}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-[11px] sm:text-xs">{label}</span>
        <span className="block truncate text-[10px] opacity-75">{detail}</span>
      </span>
    </div>
  );
}

/** Seta de ligação entre dois passos — acende em roxo quando o passo de cima
 * já foi cumprido, deixando o caminho percorrido visível de relance. */
function StepArrow({ done }: { done: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className={`mx-auto h-3.5 w-3.5 shrink-0 ${done ? "text-brand" : "text-neutral-300 dark:text-neutral-700"}`}
      strokeWidth={2.5}
    />
  );
}

