import test from "node:test";
import assert from "node:assert/strict";
import { imageRectsFromOps, largeImageRects, type OpCodes } from "@/lib/ocr/pdf-images";

const OP: OpCodes = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86 };
const ops = (list: [number, unknown][]) => ({ fnArray: list.map(([f]) => f), argsArray: list.map(([, a]) => a) });

test("a imagem ocupa o quadrado unitário transformado pela matriz corrente", () => {
  const rects = imageRectsFromOps(ops([[OP.save, null], [OP.transform, [300, 0, 0, 200, 100, 400]], [OP.paintImageXObject, ["img1", 1, 1]], [OP.restore, null]]), OP);
  assert.deepEqual(rects, [{ x0: 100, y0: 400, x1: 400, y1: 600, pixelWidth: 1 }]);
});

test("a largura original da imagem em pixels (nitidez real) acompanha o retângulo, mesmo depois do filtro de tamanho", () => {
  const rects = imageRectsFromOps(ops([[OP.transform, [330, 0, 0, 238, 40, 504]], [OP.paintImageXObject, ["img_p0_1", 610, 440]]]), OP);
  assert.equal(rects[0].pixelWidth, 610);
  const large = largeImageRects(rects, { x0: 0, y0: 0, x1: 595, y1: 842 });
  assert.equal(large[0].pixelWidth, 610);
  // imagem em linha: a largura vem do próprio objeto
  const inline = imageRectsFromOps(ops([[OP.transform, [100, 0, 0, 100, 0, 0]], [OP.paintInlineImageXObject, [{ width: 320, height: 200 }]]]), OP);
  assert.equal(inline[0].pixelWidth, 320);
});

test("matrizes acumulam dentro do save e são desfeitas no restore", () => {
  const rects = imageRectsFromOps(
    ops([
      [OP.save, null],
      [OP.transform, [1, 0, 0, 1, 50, 50]],
      [OP.save, null],
      [OP.transform, [100, 0, 0, 100, 0, 0]],
      [OP.paintImageXObject, ["a"]],
      [OP.restore, null],
      [OP.paintImageXObject, ["b"]], // volta à matriz só com o deslocamento: quadrado unitário em 50,50
      [OP.restore, null],
      [OP.paintImageXObject, ["c"]], // matriz de identidade
    ]),
    OP,
  );
  assert.deepEqual(rects[0], { x0: 50, y0: 50, x1: 150, y1: 150 });
  assert.deepEqual(rects[1], { x0: 50, y0: 50, x1: 51, y1: 51 });
  assert.deepEqual(rects[2], { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test("formulário aninhado (paintFormXObjectBegin) aplica a própria matriz e a desfaz no fim", () => {
  const rects = imageRectsFromOps(
    ops([
      [OP.paintFormXObjectBegin, [[2, 0, 0, 2, 10, 20], [0, 0, 1, 1]]],
      [OP.transform, [50, 0, 0, 50, 0, 0]],
      [OP.paintInlineImageXObject, [{}]],
      [OP.paintFormXObjectEnd, null],
      [OP.paintImageXObject, ["fora"]],
    ]),
    OP,
  );
  assert.deepEqual(rects[0], { x0: 10, y0: 20, x1: 110, y1: 120 });
  assert.deepEqual(rects[1], { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test("só imagens grandes o bastante contam (logotipo e QR pequeno não), da maior para a menor, recortadas à página", () => {
  const page = { x0: 0, y0: 0, x1: 595, y1: 842 };
  const found = largeImageRects(
    [
      { x0: 40, y0: 400, x1: 380, y1: 700 }, // cartão
      { x0: 450, y0: 700, x1: 520, y1: 770 }, // QR pequeno
      { x0: 0, y0: 0, x1: 30, y1: 15 }, // logotipo
      { x0: 300, y0: 100, x1: 900, y1: 500 }, // passa da borda da página
    ],
    page,
  );
  assert.equal(found.length, 2);
  // lidas de cima para baixo (y do PDF cresce para cima): o cartão (topo em 700) antes da outra (topo em 500)
  assert.deepEqual(found[0], { x0: 40, y0: 400, x1: 380, y1: 700 });
  assert.deepEqual(found[1], { x0: 300, y0: 100, x1: 595, y1: 500 });
});

test("CNH digital real: o QR code (quadrado, a maior imagem) é ignorado e as 3 partes do cartão são lidas de cima para baixo", () => {
  // medidas do PDF real: QR 220x220pt e três imagens de 242x178pt empilhadas
  const page = { x0: 0, y0: 0, x1: 595, y1: 842 };
  const found = largeImageRects(
    [
      { x0: 30, y0: 421, x1: 272, y1: 599, pixelWidth: 963 }, // verso
      { x0: 321, y0: 539, x1: 541, y1: 759, pixelWidth: 591 }, // QR
      { x0: 30, y0: 604, x1: 272, y1: 782, pixelWidth: 963 }, // frente
      { x0: 30, y0: 239, x1: 272, y1: 417, pixelWidth: 963 }, // faixa do MRZ
      { x0: 30, y0: 790, x1: 51, y1: 813, pixelWidth: 113 }, // brasão
    ],
    page,
  );
  assert.deepEqual(found.map((r) => r.y1), [782, 599, 417]);
  assert.ok(found.every((r) => r.pixelWidth === 963));
});

test("se a única imagem grande for quadrada (ex.: foto quadrada de um documento), ela ainda é lida", () => {
  const found = largeImageRects([{ x0: 50, y0: 100, x1: 450, y1: 500 }], { x0: 0, y0: 0, x1: 595, y1: 842 });
  assert.equal(found.length, 1);
});
