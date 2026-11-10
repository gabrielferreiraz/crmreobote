"use client";

/**
 * Lê o texto de um documento (foto ou PDF) DENTRO do navegador de quem abriu —
 * nada é instalado no servidor e o arquivo não sai do CRM.
 *
 * - PDF com texto: usa o texto do próprio PDF (instantâneo, exato).
 * - Foto (PNG/JPG/WEBP) ou PDF escaneado: OCR com tesseract.js.
 *
 * Para acertar mais sem perder velocidade:
 *   1. a imagem é tratada antes (sombra, contraste) e lida em tamanho cheio;
 *   2. se a leitura sair fraca, tenta outro modo de leitura (texto esparso, melhor
 *      para campos soltos de CNH/RG), depois a imagem girada, depois a original —
 *      e fica com a que leu mais texto com confiança;
 *   3. o motor fica carregado e é reaproveitado entre documentos (e pode ser
 *      aquecido antes do clique); documentos do mesmo cadastro podem ser lidos
 *      em segundo plano.
 *
 * Os arquivos do OCR (motor, idioma, leitor de PDF) ficam em /public/ocr e saem
 * da própria origem do CRM; o navegador não baixa nada de sites de fora.
 */

import { enhanceCanvas, rotateCanvas } from "@/lib/ocr/enhance";
import {
  cleanReadLines,
  isGoodEnough,
  looksUnreadable,
  summarizePass,
  type PassSummary,
  type ReadLine,
  type ScoredWord,
} from "@/lib/ocr/quality";

export type { ReadLine } from "@/lib/ocr/quality";

const OCR_BASE = "/ocr";
const MAX_SIDE = 2400; // px — maior que isso só deixa a leitura lenta, sem ganho.
const MAX_PDF_PAGES = 4;
const MIN_PDF_TEXT_CHARS = 25; // abaixo disso o PDF é tratado como escaneado.
const ENGINE_IDLE_MS = 150_000; // sem uso por esse tempo, o motor é descarregado para liberar memória.

export type ReadProgress = { label: string; fraction: number | null };
type ProgressFn = (p: ReadProgress) => void;
type OcrWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

const isPdf = (fileName: string) => /\.pdf$/i.test(fileName);

// ---------------------------------------------------------------------------
// Motor de OCR: um só, reaproveitado, com fila (ele lê uma coisa por vez).
// ---------------------------------------------------------------------------

let workerPromise: Promise<OcrWorker> | null = null;
let activeLogger: ((m: { status?: string; progress?: number }) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();
let busy = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (busy > 0) return scheduleIdleShutdown();
    const current = workerPromise;
    workerPromise = null;
    void current?.then((w) => w.terminate()).catch(() => {});
  }, ENGINE_IDLE_MS);
}

function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    const created = import("tesseract.js").then(({ createWorker }) =>
      createWorker("por", 1, {
        workerPath: `${OCR_BASE}/worker.min.js`,
        corePath: `${OCR_BASE}/core`,
        langPath: `${OCR_BASE}/lang`,
        gzip: true,
        logger: (m: { status?: string; progress?: number }) => activeLogger?.(m),
      }),
    );
    workerPromise = created;
    created.catch(() => {
      if (workerPromise === created) workerPromise = null;
    });
  }
  scheduleIdleShutdown();
  return workerPromise;
}

/** Carrega o motor antes de alguém precisar (chame ao abrir a tela de cadastro). */
export function warmUpOcr(): void {
  void getWorker().catch(() => {});
}

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  busy++;
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    busy--;
    scheduleIdleShutdown();
  });
}

// ---------------------------------------------------------------------------
// Leitura de imagem
// ---------------------------------------------------------------------------

type Pass = { lines: ReadLine[]; words: ScoredWord[]; summary: PassSummary };

async function recognizePass(worker: OcrWorker, canvas: HTMLCanvasElement, psm: "3" | "11", label: string, onProgress: ProgressFn): Promise<Pass> {
  await worker.setParameters({ tessedit_pageseg_mode: psm } as never);
  activeLogger = (m) => {
    if (m.status === "recognizing text" && typeof m.progress === "number") onProgress({ label, fraction: m.progress });
  };
  onProgress({ label, fraction: 0 });
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  activeLogger = null;

  const lines: ReadLine[] = [];
  const words: ScoredWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        lines.push({ text: line.text, confidence: line.confidence });
        for (const w of line.words) words.push({ text: w.text, confidence: w.confidence });
      }
    }
  }
  if (lines.length === 0) {
    for (const text of data.text.split("\n")) lines.push({ text, confidence: data.confidence });
  }
  return { lines, words, summary: summarizePass(words) };
}

/** Lê uma imagem, tentando caminhos melhores só quando a primeira leitura sai fraca. */
async function readCanvas(canvas: HTMLCanvasElement, onProgress: ProgressFn): Promise<ReadLine[]> {
  const worker = await getWorker();
  const enhanced = enhanceCanvas(canvas);
  let best = await recognizePass(worker, enhanced, "3", "Lendo o texto…", onProgress);
  const consider = (candidate: Pass) => {
    if (candidate.summary.score > best.summary.score) best = candidate;
  };

  if (!isGoodEnough(best.summary)) {
    consider(await recognizePass(worker, enhanced, "11", "Conferindo com outro modo de leitura…", onProgress));
  }
  if (looksUnreadable(best.summary)) {
    for (const degrees of [90, 270, 180] as const) {
      consider(await recognizePass(worker, rotateCanvas(enhanced, degrees), "3", "Testando a imagem girada…", onProgress));
      if (isGoodEnough(best.summary)) break;
    }
  }
  if (!isGoodEnough(best.summary)) {
    consider(await recognizePass(worker, canvas, "3", "Conferindo com a imagem original…", onProgress));
  }
  return best.lines;
}

async function readCanvases(canvases: HTMLCanvasElement[], onProgress: ProgressFn): Promise<ReadLine[]> {
  return runExclusive(async () => {
    const lines: ReadLine[] = [];
    for (let i = 0; i < canvases.length; i++) {
      const pageLines = await readCanvas(canvases[i], (p) =>
        onProgress({ label: canvases.length > 1 ? `${p.label} (página ${i + 1} de ${canvases.length})` : p.label, fraction: p.fraction === null ? null : (i + p.fraction) / canvases.length }),
      );
      lines.push(...pageLines);
    }
    return lines;
  });
}

async function fetchBlob(src: string): Promise<Blob> {
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Não foi possível abrir o documento.");
  return res.blob();
}

/** Reduz fotos enormes e respeita a rotação gravada pela câmera. */
async function toCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

type PdfTextItem = { str?: string; transform?: number[] };

/** Junta os pedaços de texto do PDF em linhas, pela altura (y) e ordem (x). */
export function groupPdfItems(items: PdfTextItem[]): string[] {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    const s = it.str ?? "";
    if (!s.trim() || !it.transform) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (row) row.parts.push({ x, s });
    else rows.push({ y, parts: [{ x, s }] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) =>
    r.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.s)
      .join(" "),
  );
}

async function readPdf(blob: Blob, onProgress: ProgressFn): Promise<ReadLine[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `${OCR_BASE}/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const textLines: string[] = [];
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      textLines.push(...groupPdfItems(content.items as PdfTextItem[]));
    }
    if (textLines.join("").length >= MIN_PDF_TEXT_CHARS) return textLines.map((text) => ({ text, confidence: null }));

    // PDF escaneado (só imagem): desenha cada página e lê com OCR.
    onProgress({ label: "Preparando o PDF…", fraction: null });
    const canvases: HTMLCanvasElement[] = [];
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      canvases.push(canvas);
    }
    return readCanvases(canvases, onProgress);
  } finally {
    await task.destroy().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

const cache = new Map<string, ReadLine[]>();
const inflight = new Map<string, { promise: Promise<ReadLine[]>; listeners: Set<ProgressFn> }>();

/**
 * Devolve as linhas de texto do documento, já limpas, com a confiança de cada uma.
 * Chamadas repetidas para o mesmo documento dividem a mesma leitura; o resultado
 * fica em memória enquanto a aba estiver aberta.
 */
export function extractDocumentLines(src: string, fileName: string, onProgress: ProgressFn): Promise<ReadLine[]> {
  const cached = cache.get(src);
  if (cached) return Promise.resolve(cached);

  let job = inflight.get(src);
  if (!job) {
    const listeners = new Set<ProgressFn>();
    const broadcast: ProgressFn = (p) => listeners.forEach((l) => l(p));
    const promise = (async () => {
      broadcast({ label: "Abrindo o documento…", fraction: null });
      const blob = await fetchBlob(src);
      let raw: ReadLine[];
      if (isPdf(fileName)) {
        raw = await readPdf(blob, broadcast);
      } else {
        broadcast({ label: "Preparando a imagem…", fraction: null });
        raw = await readCanvases([await toCanvas(blob)], broadcast);
      }
      const lines = cleanReadLines(raw);
      cache.set(src, lines);
      return lines;
    })().finally(() => inflight.delete(src));
    job = { promise, listeners };
    inflight.set(src, job);
  }
  const current = job;
  current.listeners.add(onProgress);
  return current.promise.finally(() => current.listeners.delete(onProgress));
}

/** Lê em segundo plano os documentos de um cadastro, um por vez, para o texto já estar pronto no clique. */
export async function prefetchDocumentText(items: { src: string; fileName: string }[], signal: AbortSignal): Promise<void> {
  for (const item of items) {
    if (signal.aborted) return;
    await extractDocumentLines(item.src, item.fileName, () => {}).catch(() => {});
  }
}
