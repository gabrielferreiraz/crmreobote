/**
 * Prepara a foto de um documento para o OCR: tons de cinza, remoção de sombra e
 * de iluminação desigual (comum em foto de celular) e contraste ampliado.
 *
 * `flatFieldGray` é pura (só números) para poder ser testada; `enhanceCanvas`
 * só liga ela ao canvas do navegador.
 */

const BG_FLOOR = 40; // evita dividir por um fundo quase preto
const BLOCK_PERCENTILE = 0.85; // "cor do papel" = tom claro típico do bloco, ignora as letras escuras

/** Converte RGBA em cinza (0–255). */
export function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return gray;
}

/**
 * Estima a cor do "papel" em cada bloco da imagem, divide a imagem por ela
 * (sombra some, papel fica branco, letras continuam escuras) e estica o
 * contraste. Em imagem já limpa, o efeito é quase nenhum.
 */
export function flatFieldGray(gray: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const block = Math.max(24, Math.round(Math.max(width, height) / 50));
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);

  // 1) tom claro típico de cada bloco (percentil do histograma)
  const paper = new Float32Array(cols * rows);
  const hist = new Uint32Array(256);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      hist.fill(0);
      const x0 = bx * block;
      const y0 = by * block;
      const x1 = Math.min(width, x0 + block);
      const y1 = Math.min(height, y0 + block);
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) hist[gray[row + x]]++;
      }
      const target = Math.floor((x1 - x0) * (y1 - y0) * BLOCK_PERCENTILE);
      let acc = 0;
      let level = 255;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= target) {
          level = v;
          break;
        }
      }
      paper[by * cols + bx] = Math.max(BG_FLOOR, level);
    }
  }

  // 2) suaviza os blocos (média 3×3) para a correção não deixar "degraus"
  const smooth = new Float32Array(paper.length);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy;
          const xx = bx + dx;
          if (yy < 0 || yy >= rows || xx < 0 || xx >= cols) continue;
          sum += paper[yy * cols + xx];
          n++;
        }
      }
      smooth[by * cols + bx] = sum / n;
    }
  }

  // 3) divide cada pixel pelo papel estimado (interpolação entre blocos)
  const out = new Uint8ClampedArray(gray.length);
  const outHist = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(rows - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(cols - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(cols - 1, x0 + 1);
      const tx = fx - x0;
      const top = smooth[y0 * cols + x0] * (1 - tx) + smooth[y0 * cols + x1] * tx;
      const bottom = smooth[y1 * cols + x0] * (1 - tx) + smooth[y1 * cols + x1] * tx;
      const bg = top * (1 - ty) + bottom * ty;
      const v = Math.min(255, (gray[y * width + x] / bg) * 255);
      out[y * width + x] = v;
      outHist[out[y * width + x]]++;
    }
  }

  // 4) preto de verdade nas letras: o 1% mais escuro vira 0
  const total = out.length;
  let acc = 0;
  let black = 0;
  for (let v = 0; v < 256; v++) {
    acc += outHist[v];
    if (acc >= total * 0.01) {
      black = v;
      break;
    }
  }
  if (black > 0 && black < 200) {
    const span = 255 - black;
    for (let i = 0; i < out.length; i++) out[i] = ((out[i] - black) / span) * 255;
  }
  return out;
}

export function enhanceCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d");
  if (!ctx) return source;
  const image = ctx.getImageData(0, 0, source.width, source.height);
  const gray = flatFieldGray(toGray(image.data), source.width, source.height);
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const octx = out.getContext("2d");
  if (!octx) return source;
  const result = octx.createImageData(source.width, source.height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    result.data[i] = result.data[i + 1] = result.data[i + 2] = gray[p];
    result.data[i + 3] = 255;
  }
  octx.putImageData(result, 0, 0);
  return out;
}

/** Gira a imagem em múltiplos de 90° (para documento fotografado de lado ou de cabeça para baixo). */
export function rotateCanvas(source: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const swap = degrees !== 180;
  out.width = swap ? source.height : source.width;
  out.height = swap ? source.width : source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

/** Lê os tons de cinza de um canvas. */
export function canvasToGray(source: HTMLCanvasElement): { gray: Uint8ClampedArray; width: number; height: number } {
  const ctx = source.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  const image = ctx.getImageData(0, 0, source.width, source.height);
  return { gray: toGray(image.data), width: source.width, height: source.height };
}

/** Desenha tons de cinza num canvas (para entregar ao OCR). */
export function grayToCanvas(gray: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  const image = ctx.createImageData(width, height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    image.data[i] = image.data[i + 1] = image.data[i + 2] = gray[p];
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Gira em qualquer ângulo (graus, horário), aumentando a tela e preenchendo de branco — para endireitar fotos tortas. */
export function rotateCanvasBy(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  if (Math.abs(degrees) < 0.05) return source;
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const out = document.createElement("canvas");
  out.width = Math.ceil(source.width * cos + source.height * sin);
  out.height = Math.ceil(source.width * sin + source.height * cos);
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}
