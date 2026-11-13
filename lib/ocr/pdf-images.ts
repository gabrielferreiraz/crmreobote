/**
 * Onde ficam as IMAGENS dentro de uma página de PDF.
 *
 * Alguns PDFs (CNH digital, documentos "impressos" de aplicativos) têm texto só no cabeçalho/rodapé; o
 * documento em si é uma figura. Para ler essa figura com OCR em boa resolução, descobrimos o retângulo
 * de cada imagem acompanhando as matrizes de transformação da lista de operações do pdf.js
 * (save/restore/transform e os "formulários" aninhados) — a imagem sempre ocupa o quadrado unitário
 * transformado pela matriz corrente. Tudo em coordenadas do PDF (y para cima).
 *
 * Função pura (sem pdf.js nem canvas): testada em scripts/test-pdf-images.ts.
 */

export type Rect = { x0: number; y0: number; x1: number; y1: number };
/** `pixelWidth`: largura original da imagem em pixels (o que o PDF guarda), quando informada — mostra quanta nitidez ela realmente tem. */
export type ImageRect = Rect & { pixelWidth?: number };

/** Códigos das operações (`pdfjs.OPS`) que interessam. */
export type OpCodes = {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
};

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `first` aplicada primeiro, depois `then` (convenção de matrizes do PDF). */
function multiply(first: Matrix, then: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = then;
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
}

const isMatrix = (v: unknown): v is ArrayLike<number> => !!v && typeof v === "object" && (v as ArrayLike<number>).length >= 6 && Array.from(v as ArrayLike<number>).slice(0, 6).every((n) => Number.isFinite(n));
const toMatrix = (v: ArrayLike<number>): Matrix => [v[0], v[1], v[2], v[3], v[4], v[5]];

/** Largura em pixels da imagem: `[id, largura, altura]` (imagem do PDF) ou o próprio objeto da imagem em linha. */
function pixelWidthOf(args: unknown): number | undefined {
  if (Array.isArray(args)) {
    if (typeof args[1] === "number" && args[1] > 0) return args[1];
    const first = args[0] as { width?: unknown } | undefined;
    if (first && typeof first === "object" && typeof first.width === "number" && first.width > 0) return first.width;
  }
  return undefined;
}

export function imageRectsFromOps(ops: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }, op: OpCodes): ImageRect[] {
  const rects: ImageRect[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === op.save || fn === op.paintFormXObjectBegin) {
      stack.push(ctm);
      if (fn === op.paintFormXObjectBegin && Array.isArray(args) && isMatrix(args[0])) ctm = multiply(toMatrix(args[0]), ctm);
    } else if (fn === op.restore || fn === op.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === op.transform) {
      if (isMatrix(args)) ctm = multiply(toMatrix(args), ctm);
    } else if (fn === op.paintImageXObject || fn === op.paintInlineImageXObject) {
      const [a, b, c, d, e, f] = ctm;
      const xs = [e, a + e, c + e, a + c + e];
      const ys = [f, b + f, d + f, b + d + f];
      const pixelWidth = pixelWidthOf(args);
      rects.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), ...(pixelWidth ? { pixelWidth } : {}) });
    }
  }
  return rects;
}

/**
 * Imagens grandes o bastante para serem o próprio documento (não logotipo nem ícone): ocupam pelo menos
 * `minFraction` da página. Recortadas à página, da maior para a menor, no máximo `limit`.
 */
export function largeImageRects(rects: ImageRect[], page: Rect, minFraction = 0.06, limit = 3): ImageRect[] {
  const pageArea = Math.max(1, (page.x1 - page.x0) * (page.y1 - page.y0));
  const area = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const big = rects
    .map((r) => ({ ...r, x0: Math.max(r.x0, page.x0), y0: Math.max(r.y0, page.y0), x1: Math.min(r.x1, page.x1), y1: Math.min(r.y1, page.y1) }))
    .filter((r) => r.x1 - r.x0 > 20 && r.y1 - r.y0 > 20 && area(r) / pageArea >= minFraction);
  // Imagem QUADRADA é QR code ou carimbo, não o documento (cartões, fotos e certidões são retangulares).
  // Só entra se não houver nenhuma retangular.
  const squareish = (r: Rect) => {
    const ratio = (r.x1 - r.x0) / (r.y1 - r.y0);
    return ratio > 0.92 && ratio < 1.08;
  };
  const rectangular = big.filter((r) => !squareish(r));
  const pool = rectangular.length > 0 ? rectangular : big;
  // As `limit` maiores, lidas de cima para baixo (y do PDF cresce para cima): a frente do documento vem antes do verso.
  return pool
    .sort((a, b) => area(b) - area(a))
    .slice(0, limit)
    .sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0);
}
