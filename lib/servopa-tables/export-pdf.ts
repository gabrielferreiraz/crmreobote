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

export async function downloadServopaTablePdf(): Promise<void> {
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
  pdf.save(servopaPdfFileName(document.title));
}
