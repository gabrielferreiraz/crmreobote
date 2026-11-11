"use client";

/**
 * Lê o texto de um documento (foto ou PDF) DENTRO do navegador de quem abriu —
 * nada é instalado no servidor e o arquivo não sai do CRM.
 *
 * - PDF com texto: usa o texto do próprio PDF (instantâneo, exato).
 * - Foto (PNG/JPG/WEBP) ou PDF escaneado: OCR com tesseract.js.
 *
 * Como a leitura de foto acerta sem IA:
 *   1. ISOLA AS LETRAS: o que é escuro e fino sobre fundo mais claro (black-hat). Desenho de
 *      segurança, textura, sombra, mesa, mão e foto do titular somem; fica texto preto no branco.
 *   2. ENDIREITA a foto torta (inclinação medida pelas próprias linhas de texto).
 *   3. LÊ DE VÁRIOS JEITOS (tratamentos e modos de leitura diferentes) e, em cada região da
 *      imagem, fica com a palavra lida com mais confiança — um jeito que errou é corrigido por
 *      outro que acertou. Para cedo quando a leitura já está ótima.
 *   4. Se saiu ilegível, tenta a imagem girada (documento de lado / de cabeça para baixo).
 *   5. O motor fica carregado e é reaproveitado entre documentos (e pode ser aquecido antes
 *      do clique); documentos do mesmo cadastro podem ser lidos em segundo plano.
 *
 * Os arquivos do OCR (motor, idioma, leitor de PDF) ficam em /public/ocr e saem da própria
 * origem do CRM; o navegador não baixa nada de sites de fora.
 */

import { estimateSkewDetailed, isolateText } from "@/lib/ocr/binarize";
import { canvasToGray, flatFieldGray, grayToCanvas, rotateCanvas, rotateCanvasBy } from "@/lib/ocr/enhance";
import { findFields, isLikelyNoise, missingExpectedFields } from "@/lib/ocr/find-fields";
import { linesFromWords, mergePasses, pickBestWords, pickBestWordsGreedy } from "@/lib/ocr/merge";
import { cleanReadLines, summarizePass, type PassSummary, type ReadLine, type WordBox } from "@/lib/ocr/quality";

export type { ReadLine } from "@/lib/ocr/quality";

const OCR_BASE = "/ocr";
const TARGET_LONG_SIDE = 2400; // px — fotos maiores são reduzidas, menores são ampliadas (até MAX_UPSCALE).
const MAX_UPSCALE = 3;
const MAX_PDF_PAGES = 4;
const MIN_PDF_TEXT_CHARS = 25; // abaixo disso o PDF é tratado como escaneado.
const ENGINE_IDLE_MS = 150_000; // sem uso por esse tempo, o motor é descarregado para liberar memória.
const PAGE_Y_OFFSET = 100_000; // separa as páginas de um PDF escaneado para as posições não se misturarem.
const TIME_BUDGET_MS = 60_000; // depois disso não começa uma nova tentativa (se já houver leitura).

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

async function recognizeWords(worker: OcrWorker, canvas: HTMLCanvasElement, psm: "3" | "11", label: string, onProgress: (fraction: number, label: string) => void): Promise<WordBox[]> {
  await worker.setParameters({ tessedit_pageseg_mode: psm } as never);
  activeLogger = (m) => {
    if (m.status === "recognizing text" && typeof m.progress === "number") onProgress(m.progress, label);
  };
  onProgress(0, label);
  try {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const words: WordBox[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const w of line.words) {
            words.push({ text: w.text, confidence: w.confidence, box: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } });
          }
        }
      }
    }
    return words;
  } finally {
    activeLogger = null;
  }
}

type Variant = "P" | "S" | "B" | "G" | "C";
type PassPlan = { variant: Variant; psm: "3" | "11"; label: string };

// P = letras do tipo mais provável (escuras sobre claro, ou claras sobre escuro, o que tiver mais cara de texto);
// S = o outro tipo; B = P com corte mais firme; G = cinza puro (o próprio OCR inverte sozinho); C = luz corrigida.
const PLAN: PassPlan[] = [
  { variant: "P", psm: "11", label: "Lendo o texto…" },
  { variant: "P", psm: "3", label: "Conferindo com outro modo de leitura…" },
  { variant: "B", psm: "3", label: "Conferindo com outro tratamento da imagem…" },
  { variant: "B", psm: "11", label: "Conferindo com outro tratamento da imagem…" },
  { variant: "G", psm: "11", label: "Conferindo com outro tratamento da imagem…" },
  { variant: "C", psm: "3", label: "Conferindo com outro tratamento da imagem…" },
  { variant: "S", psm: "11", label: "Conferindo com outro tratamento da imagem…" },
];

const summarize = (words: WordBox[]): PassSummary => summarizePass(words);

/** A leitura já está ótima: muitas palavras confiáveis e média alta. Não precisa gastar mais tempo. */
function isExcellent(p: PassSummary): boolean {
  return p.goodWords >= 14 && p.meanConfidence >= 88;
}

/** "Plausível" = achou dados de verdade (nome, CPF, datas…) e/ou muito texto bem lido. */
const plausibility = (lines: ReadLine[], summary: PassSummary) => findFields(lines).length * 50 + summary.score;

/** Reduz o canvas para a leitura rápida de orientação (documento de lado / de cabeça para baixo). */
function shrinkCanvas(source: HTMLCanvasElement, longSide: number): HTMLCanvasElement {
  const scale = Math.min(1, longSide / Math.max(source.width, source.height));
  if (scale >= 1) return source;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/**
 * Lê uma imagem JÁ NA POSIÇÃO CERTA: tratamento (letras escuras ou claras) → endireita → várias
 * leituras → junta pela confiança. Se a posição estiver errada, `readCanvas` cuida disso depois.
 */
async function readUpright(worker: OcrWorker, canvas: HTMLCanvasElement, onProgress: ProgressFn, started: number): Promise<{ lines: ReadLine[]; summary: PassSummary }> {
  const { gray, width, height } = canvasToGray(canvas);
  const inverted = Uint8ClampedArray.from(gray, (v) => 255 - v);

  // As duas versões: letras escuras sobre fundo claro (a maioria dos documentos) e letras claras sobre escuro
  // (cartão azul do CPF, por exemplo). A inclinação vem da que tiver linhas de texto mais nítidas.
  const dark = isolateText(gray, width, height, 1.6, 2.2);
  const light = isolateText(inverted, width, height, 1.6, 2.2);
  const skewDark = estimateSkewDetailed(dark, width, height);
  const skewLight = estimateSkewDetailed(light, width, height);
  const angle = skewLight.peakiness > skewDark.peakiness ? skewLight.angle : skewDark.angle;

  // Qual versão serve de "principal" é decidido lendo (não adivinhando): começa pela escura; se a leitura sair
  // fraca, testa a clara e fica com a que rendeu mais texto bem lido.
  let lightIsPrimary = false;
  const cache = new Map<string, HTMLCanvasElement>();
  // Todas as variantes giram o mesmo tanto, então as posições das palavras continuam comparáveis entre as leituras.
  const make = (key: string, build: () => Uint8ClampedArray): HTMLCanvasElement => {
    const hit = cache.get(key);
    if (hit) return hit;
    const result = rotateCanvasBy(grayToCanvas(build(), width, height), -angle);
    cache.set(key, result);
    return result;
  };
  const variantCanvas = (variant: Variant): HTMLCanvasElement => {
    const primaryBase = lightIsPrimary ? inverted : gray;
    switch (variant) {
      case "P":
        return make(lightIsPrimary ? "L" : "D", () => (lightIsPrimary ? light : dark));
      case "S":
        return make(lightIsPrimary ? "D" : "L", () => (lightIsPrimary ? dark : light));
      case "B":
        return make(lightIsPrimary ? "BL" : "BD", () => isolateText(primaryBase, width, height, 1.3, 3));
      case "G":
        return make("G", () => gray);
      case "C":
        return make("C", () => flatFieldGray(gray, width, height));
    }
  };

  const passes: WordBox[][] = [];
  const total = PLAN.length;
  let previousSignature = "";
  for (let i = 0; i < total; i++) {
    if (i >= 2 && Date.now() - started > TIME_BUDGET_MS) break;
    const step = PLAN[i];
    const progress = (fraction: number, label: string) => onProgress({ label: i > 0 ? `${label} (${i + 1} de ${total})` : label, fraction: (i + fraction) / total });
    const words = await recognizeWords(worker, variantCanvas(step.variant), step.psm, step.label, progress);
    passes.push(words);

    // Depois da primeira leitura: se saiu fraca, vê se o texto é CLARO sobre fundo escuro.
    if (i === 0 && summarize(words).goodWords < 10) {
      const lightWords = await recognizeWords(worker, make("L", () => light), "11", "Testando letras claras sobre fundo escuro…", progress);
      passes.push(lightWords);
      lightIsPrimary = summarize(lightWords).score > summarize(words).score * 1.3;
    }

    const summary = summarize(pickBestWords(passes));
    // Para quando mais uma leitura não mudou nada nos dados achados (a leitura "convergiu"),
    // ou — em documento sem campos reconhecíveis — quando o texto já está ótimo. Sempre faz 2 leituras antes.
    const merged = mergePasses(passes);
    const fields = findFields(merged);
    const signature = fields.map((f) => `${f.key}=${f.value}`).join("|");
    // Reconheceu o documento mas falta um dado que ele sempre traz (ex.: o número no cartão do CPF): continua.
    const lacking = missingExpectedFields(merged);
    if (i >= 1 && !lacking && ((fields.length >= 2 && signature === previousSignature) || (fields.length < 2 && isExcellent(summary)))) break;
    previousSignature = signature;
  }
  const merged = mergePasses(passes);

  // CPF e CNPJ têm dígito verificador: se UMA leitura isolada trouxe um número que fecha a conta, ele é certo,
  // mesmo que a junção das leituras tenha partido o número. Entra como uma linha a mais.
  const have = new Set(findFields(merged).map((f) => f.key));
  const rescued: ReadLine[] = [];
  // Fontes de resgate: cada leitura sozinha e a junção palavra por palavra (que pode consertar um número partido).
  const readings = [...passes.map((words) => mergePasses([words])), linesFromWords(pickBestWordsGreedy(passes))];
  for (const reading of readings) {
    for (const f of findFields(reading)) {
      if (/^(cpf|cnpj)-/.test(f.key) && !have.has(f.key)) {
        have.add(f.key);
        rescued.push({ text: `${f.label} ${f.value}`, confidence: 80 });
      }
    }
  }
  return { lines: [...merged, ...rescued], summary: summarize(pickBestWords(passes)) };
}

/** Lê uma imagem; se a primeira leitura não achar nada, descobre se o documento está de lado ou de cabeça para baixo. */
async function readCanvas(canvas: HTMLCanvasElement, onProgress: ProgressFn): Promise<ReadLine[]> {
  const worker = await getWorker();
  const started = Date.now();
  let best = await readUpright(worker, canvas, onProgress, started);

  if (findFields(best.lines).length < 2 && !isExcellent(best.summary) && Date.now() - started < TIME_BUDGET_MS * 1.5) {
    // Leitura rápida (imagem reduzida, cinza puro) nas 4 posições; a certa rende muito mais texto bem lido.
    const small = shrinkCanvas(canvas, 1400);
    const probe = canvasToGray(small);
    const probeBase = grayToCanvas(probe.gray, probe.width, probe.height);
    let bestRotation: 0 | 90 | 180 | 270 = 0;
    let bestProbe = -1;
    for (const degrees of [0, 90, 180, 270] as const) {
      onProgress({ label: "Procurando a posição certa do documento…", fraction: null });
      const turned = degrees === 0 ? probeBase : rotateCanvas(probeBase, degrees);
      const words = await recognizeWords(worker, turned, "11", "Procurando a posição certa do documento…", (fraction, label) => onProgress({ label, fraction }));
      const lines = mergePasses([words]);
      const score = plausibility(lines, summarize(pickBestWords([words])));
      if (score > bestProbe) {
        bestProbe = score;
        bestRotation = degrees;
      }
    }
    if (bestRotation !== 0) {
      const turned = await readUpright(worker, rotateCanvas(canvas, bestRotation), onProgress, started);
      if (plausibility(turned.lines, turned.summary) > plausibility(best.lines, best.summary)) best = turned;
    }
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
      // Páginas ficam em faixas separadas para o achador de campos não ligar uma página à outra.
      for (const line of pageLines) {
        lines.push(line.box ? { ...line, box: { ...line.box, y0: line.box.y0 + i * PAGE_Y_OFFSET, y1: line.box.y1 + i * PAGE_Y_OFFSET } } : line);
      }
    }
    return lines;
  });
}

async function fetchBlob(src: string): Promise<Blob> {
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Não foi possível abrir o documento.");
  return res.blob();
}

/** Ajusta o tamanho (reduz fotos enormes, amplia as pequenas) e respeita a rotação gravada pela câmera. */
async function toCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(MAX_UPSCALE, TARGET_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
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
      const viewport = page.getViewport({ scale: Math.min(3, TARGET_LONG_SIDE / Math.max(base.width, base.height)) });
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
 * Devolve as linhas de texto do documento, já limpas, com a confiança e a posição de cada uma.
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
      const lines = cleanReadLines(raw).filter((l) => !isLikelyNoise(l));
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
