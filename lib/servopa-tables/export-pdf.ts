/**
 * "Baixar PDF" da tabela Servopa: o mesmo método das propostas
 * (lib/proposals/export-pdf.ts) — fotografa a folha em alta resolução e monta
 * um A4 de uma página. Sai igual em qualquer computador ou celular, sem
 * depender das opções do diálogo de impressão (escala, margens, cabeçalho do
 * navegador, gráficos de fundo).
 */

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitForAssets(sheet: HTMLElement): Promise<void> {
  await document.fonts.ready;
  await Promise.all(Array.from(sheet.querySelectorAll("img")).map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }
    await image.decode().catch(() => undefined);
  }));
}

/** "GRUPO 1568 - 120 MESES - ADM 13%" → "GRUPO 1568 - 120 MESES - ADM 13%.pdf" (sem acentos nem caracteres proibidos). */
export function servopaPdfFileName(title: string): string {
  const clean = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  return `${clean || "Tabela Servopa"}.pdf`;
}

async function renderServopaTablePdf() {
  const sheet = document.querySelector<HTMLElement>(".servopa-sheet");
  if (!sheet) throw new Error("Folha da tabela não encontrada.");

  await waitForAssets(sheet);
  await nextPaint();
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);

  const canvas = await html2canvas(sheet, {
    backgroundColor: "#ffffff",
    imageTimeout: 20000,
    logging: false,
    scale: 3,
    useCORS: true,
    windowWidth: 1200,
    onclone: (clonedDocument) => {
      // A redução de visualização do celular (zoom) não pode ir para o arquivo.
      const clone = clonedDocument.querySelector<HTMLElement>(".servopa-sheet");
      clone?.style.removeProperty("--servopa-preview-zoom");
      clone?.style.setProperty("zoom", "1");
      clone?.style.setProperty("box-shadow", "none");
    },
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, "servopa-table", "MEDIUM");
  canvas.width = 1;
  canvas.height = 1;
  pdf.setProperties({ title: document.title || "Tabela Servopa" });
  return pdf;
}

export async function downloadServopaTablePdf(): Promise<void> {
  const pdf = await renderServopaTablePdf().catch((cause: unknown) => {
    throw new ServopaPdfError("PDF_FAILED", cause);
  });
  pdf.save(servopaPdfFileName(document.title));
}

/** Falhas com tratamento próprio na tela (mensagem e plano B diferentes). */
export class ServopaPdfError extends Error {
  readonly code: "PDF_FAILED" | "POPUP_BLOCKED";
  constructor(code: "PDF_FAILED" | "POPUP_BLOCKED", cause?: unknown) {
    super(code, { cause });
    this.name = "ServopaPdfError";
    this.code = code;
  }
}

const PRINT_FRAME_ID = "servopa-print-frame";

/**
 * "Imprimir": imprime o MESMO PDF do "Baixar PDF", não a página HTML (com HTML,
 * as margens físicas da impressora cortavam a coluna Seguro).
 *
 * Limite que nenhuma página consegue contornar: o Chrome/Edge reaplica a ESCALA
 * escolhida na última impressão daquele computador (configuração "grudenta" do
 * navegador, também para PDF). Se alguém usou "Personalizado 160%", a folha sai
 * ampliada e cortada — por isso a tela mostra o guia "Escala → Ajustar à área
 * de impressão" antes da primeira impressão e no link "Saiu cortado?".
 *
 * Caminho: PDF num quadro invisível → diálogo de impressão. Se o navegador não
 * tiver visualizador de PDF embutido (alguns celulares/Safari) ou o quadro não
 * abrir, abre o PDF numa aba para imprimir de lá; se a aba for bloqueada,
 * lança POPUP_BLOCKED para a tela orientar.
 */
export async function printServopaTablePdf(): Promise<"dialog" | "tab"> {
  const pdf = await renderServopaTablePdf().catch((cause: unknown) => {
    throw new ServopaPdfError("PDF_FAILED", cause);
  });
  const url = URL.createObjectURL(pdf.output("blob"));
  const cleanupLater = () => window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);

  document.getElementById(PRINT_FRAME_ID)?.remove();
  const frame = document.createElement("iframe");
  frame.id = PRINT_FRAME_ID;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("O PDF demorou para abrir.")), 15_000);
      frame.addEventListener("load", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
    // O visualizador de PDF termina de montar a página um instante depois do load.
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const viewer = frame.contentWindow;
    if (!viewer) throw new Error("Visualizador de PDF indisponível.");
    viewer.focus();
    viewer.print();
    // O diálogo de impressão segura o quadro enquanto está aberto; limpa bem depois.
    window.setTimeout(() => frame.remove(), 10 * 60_000);
    cleanupLater();
    return "dialog";
  } catch {
    frame.remove();
    const opened = window.open(url, "_blank");
    cleanupLater();
    if (!opened) throw new ServopaPdfError("POPUP_BLOCKED");
    return "tab";
  }
}
