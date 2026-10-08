const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const EXPORT_VIEWPORT_WIDTH = 1200;
const EXPORT_VIEWPORT_HEIGHT = 1600;

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitForProposalAssets(pages: HTMLElement[]): Promise<void> {
  await document.fonts.ready;
  const images = pages.flatMap((page) => Array.from(page.querySelectorAll<HTMLImageElement>("img")));
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }
    await image.decode().catch(() => undefined);
  }));
}

function pdfFileName(): string {
  const title = document.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  return `${title || "Proposta"}.pdf`;
}

export async function downloadProposalPdf(): Promise<void> {
  const pages = Array.from(document.querySelectorAll<HTMLElement>(".proposal-page"));
  if (pages.length !== 2) throw new Error("A proposta precisa ter exatamente duas paginas.");

  await waitForProposalAssets(pages);
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  document.documentElement.classList.add("proposal-pdf-export");
  await nextPaint();

  try {
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
      putOnlyUsedFonts: true,
    });

    for (const [index, page] of pages.entries()) {
      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        imageTimeout: 20000,
        logging: false,
        removeContainer: true,
        scale: 3,
        useCORS: true,
        windowHeight: EXPORT_VIEWPORT_HEIGHT,
        windowWidth: EXPORT_VIEWPORT_WIDTH,
        onclone: (clonedDocument) => {
          clonedDocument.querySelectorAll<HTMLElement>(".no-print").forEach((element) => {
            element.style.setProperty("display", "none", "important");
          });
        },
      });

      if (index > 0) pdf.addPage("a4", "portrait");

      const scale = Math.min(A4_WIDTH_MM / canvas.width, A4_HEIGHT_MM / canvas.height);
      const width = canvas.width * scale;
      const height = canvas.height * scale;
      const x = (A4_WIDTH_MM - width) / 2;
      const y = (A4_HEIGHT_MM - height) / 2;
      const image = canvas.toDataURL("image/jpeg", 0.96);

      pdf.addImage(image, "JPEG", x, y, width, height, `proposal-page-${index + 1}`, "MEDIUM");
      canvas.width = 1;
      canvas.height = 1;
    }

    pdf.setProperties({ title: document.title || "Proposta" });
    pdf.save(pdfFileName());
  } finally {
    document.documentElement.classList.remove("proposal-pdf-export");
  }
}
