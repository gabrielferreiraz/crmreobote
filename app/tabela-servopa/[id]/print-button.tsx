"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Loader2, Printer, Settings2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { downloadServopaTablePdf, printServopaTablePdf, ServopaPdfError } from "@/lib/servopa-tables/export-pdf";

/** Guardado só neste navegador: a escala do diálogo de impressão também é por navegador. */
const GUIDE_SEEN_KEY = "servopa-print-guide-ok";

function guideAlreadySeen() {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberGuide() {
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, "1");
  } catch {}
}

type Notice = { tone: "info" | "error"; text: string } | null;

/**
 * Os dois botões usam o MESMO arquivo (uma página A4): "Baixar PDF" salva —
 * é o caminho principal para mandar ao cliente — e "Imprimir" manda esse
 * arquivo para a impressora. O navegador reaplica a ESCALA da última impressão
 * daquele computador (não há como a página mudar isso), então antes da
 * primeira impressão — e sempre pelo link "Saiu cortado?" — a tela mostra onde
 * conferir a escala.
 */
export function PrintButton() {
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [guide, setGuide] = useState<"before-print" | "help" | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  async function download() {
    setBusy("download");
    setNotice(null);
    try {
      await downloadServopaTablePdf();
    } catch {
      setNotice({ tone: "error", text: "Não foi possível gerar o PDF. Recarregue a página e tente de novo." });
    } finally {
      setBusy(null);
    }
  }

  async function print() {
    setGuide(null);
    setBusy("print");
    setNotice({ tone: "info", text: "Preparando a impressão…" });
    try {
      const result = await printServopaTablePdf();
      setNotice(result === "tab"
        ? { tone: "info", text: "O PDF abriu numa nova aba: imprima por lá (Ctrl+P)." }
        : null);
    } catch (error) {
      if (error instanceof ServopaPdfError && error.code === "POPUP_BLOCKED") {
        setNotice({ tone: "error", text: "O navegador bloqueou a nova aba. Permita pop-ups deste site ou use \"Baixar PDF\" e imprima o arquivo." });
      } else {
        // Último recurso: o diálogo de impressão da própria página.
        setNotice({ tone: "error", text: "Não deu para preparar o PDF; abrimos a impressão da página. Se sair diferente, use \"Baixar PDF\"." });
        window.print();
      }
    } finally {
      setBusy(null);
    }
  }

  function requestPrint() {
    if (guideAlreadySeen()) void print();
    else setGuide("before-print");
  }

  function confirmGuide() {
    if (dontShowAgain) rememberGuide();
    void print();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button type="button" onClick={requestPrint} disabled={busy !== null} className="btn-secondary">
          {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" strokeWidth={2} />}
          Imprimir
        </button>
        <button type="button" onClick={() => void download()} disabled={busy !== null} className="btn-primary">
          {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" strokeWidth={2} />}
          Baixar PDF
        </button>
      </div>
      <button type="button" onClick={() => setGuide("help")} className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline">
        Saiu cortado ou grande demais na impressão?
      </button>
      {notice && (
        <p className={`max-w-sm text-right text-xs ${notice.tone === "error" ? "text-red-600" : "text-neutral-500"}`} role="status">
          {notice.text}
        </p>
      )}

      {guide && <PrintGuide mode={guide} dontShowAgain={dontShowAgain} onDontShowAgainChange={setDontShowAgain} onClose={() => setGuide(null)} onPrint={confirmGuide} />}
    </div>
  );
}

function PrintGuide({
  mode,
  dontShowAgain,
  onDontShowAgainChange,
  onClose,
  onPrint,
}: {
  mode: "before-print" | "help";
  dontShowAgain: boolean;
  onDontShowAgainChange: (value: boolean) => void;
  onClose: () => void;
  onPrint: () => void;
}) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
          {mode === "help" ? <AlertTriangle className="h-5 w-5" /> : <Printer className="h-5 w-5" />}
        </span>
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {mode === "help" ? "A folha saiu cortada ou ampliada?" : "Antes de imprimir, confira a escala"}
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            O navegador lembra a escala da última impressão feita neste computador. Se ela estiver diferente, a tabela sai grande e cortada. É só ajustar uma vez:
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-3 text-sm text-neutral-700 dark:text-neutral-200">
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">1</span>
          <span>Na janela de impressão, clique em <strong>Mais definições</strong>.</span>
        </li>
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">2</span>
          <span>Em <strong>Escala</strong>, escolha <strong>Ajustar à área de impressão</strong> (ou <strong>Padrão</strong>). Não use &ldquo;Personalizado&rdquo;.</span>
        </li>
        <li className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">3</span>
          <span>Confira a prévia: <strong>1 folha</strong> com a tabela inteira, incluindo a coluna Seguro.</span>
        </li>
      </ol>

      {/* Miniatura do trecho do diálogo do Chrome/Edge que precisa ser conferido. */}
      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-900 p-3 text-xs text-neutral-200 dark:border-neutral-700" aria-hidden="true">
        <div className="flex items-center justify-between border-b border-neutral-700 pb-2">
          <span className="flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" />Mais definições</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>Escala</span>
          <span className="flex items-center gap-1.5 rounded border border-emerald-500/70 bg-neutral-800 px-2 py-1 text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />Ajustar à área de impressão
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Prefere não mexer? Use <strong>Baixar PDF</strong>: o arquivo já sai certo e pode ser enviado ao cliente ou impresso depois.
      </p>

      {mode === "before-print" ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <input type="checkbox" checked={dontShowAgain} onChange={(event) => onDontShowAgainChange(event.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Não mostrar de novo neste computador
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="button" onClick={onPrint} className="btn-primary"><Printer className="h-4 w-4" />Abrir impressão</button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Fechar</button>
          <button type="button" onClick={onPrint} className="btn-primary"><Printer className="h-4 w-4" />Imprimir de novo</button>
        </div>
      )}
    </Modal>
  );
}
