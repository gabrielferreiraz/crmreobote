/**
 * Isola as LETRAS de uma foto de documento: o que é escuro e fino em cima de um fundo mais claro.
 * Fundos com desenho de segurança, textura, sombra ou foto do titular têm tons médios e áreas
 * grandes — não são "traços finos escuros" — e somem; o texto fica preto sobre branco.
 *
 * Técnica: black-hat morfológico (fechamento menos a imagem) + ganho pelo percentil alto.
 * Funções puras sobre números (sem DOM), para rodar no navegador e nos testes.
 */

/** Janela deslizante de máximo/mínimo (1D, O(n) por linha via deque) com raio `r`. */
function slideExtreme(src: Uint8ClampedArray, dst: Uint8ClampedArray, width: number, height: number, r: number, horizontal: boolean, max: boolean) {
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  const step = horizontal ? width : 1;
  const deque = new Int32Array(inner);
  for (let o = 0; o < outer; o++) {
    const base = o * step;
    let head = 0;
    let tail = 0;
    for (let i = 0; i < inner + r; i++) {
      if (i < inner) {
        const v = src[base + i * stride];
        while (tail > head) {
          const last = src[base + deque[tail - 1] * stride];
          if (max ? last <= v : last >= v) tail--;
          else break;
        }
        deque[tail++] = i;
      }
      const center = i - r;
      if (center >= 0) {
        while (deque[head] < center - r) head++;
        dst[base + center * stride] = src[base + deque[head] * stride];
      }
    }
  }
}

function dilate(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  slideExtreme(src, tmp, w, h, r, true, true);
  slideExtreme(tmp, out, w, h, r, false, true);
  return out;
}

function erode(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  slideExtreme(src, tmp, w, h, r, true, false);
  slideExtreme(tmp, out, w, h, r, false, false);
  return out;
}

/** Raio da janela: maior que a espessura de um traço de letra, menor que um bloco de fundo. */
export function strokeRadius(width: number, height: number): number {
  return Math.max(4, Math.round(Math.max(width, height) / 220));
}

/**
 * Devolve a imagem com as letras em preto e o resto em branco (tons de cinza, com anti-serrilhado).
 * `gain` < 1 afrouxa o corte (mantém traços fracos), > 1 endurece (limpa mais o fundo).
 */
export function isolateText(gray: Uint8ClampedArray, width: number, height: number, gain = 1, floorDiv = 6): Uint8ClampedArray {
  const r = strokeRadius(width, height);
  const closed = erode(dilate(gray, width, height, r), width, height, r);
  const hat = new Uint8ClampedArray(gray.length);
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = closed[i] - gray[i];
    hat[i] = v > 0 ? v : 0;
    hist[hat[i]]++;
  }
  // referência de "traço forte": percentil 99 do black-hat (o texto é uma fração pequena da imagem)
  const target = gray.length * 0.985;
  let acc = 0;
  let ref = 40;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) {
      ref = Math.max(40, v);
      break;
    }
  }
  const out = new Uint8ClampedArray(gray.length);
  const scale = (255 / ref) * gain;
  // abaixo de ~1/6 da referência é ruído de textura: vira branco puro
  const floor = ref / floorDiv;
  for (let i = 0; i < gray.length; i++) {
    const v = hat[i];
    out[i] = v <= floor ? 255 : 255 - Math.min(255, (v - floor) * scale);
  }
  return out;
}

/** Janela (em px, ímpar) do limiar local: maior que a letra, menor que o documento. */
export function localWindow(width: number, height: number): number {
  const w = Math.round(Math.max(width, height) / 35);
  return Math.min(81, Math.max(25, w % 2 === 0 ? w + 1 : w));
}

/**
 * Limiar LOCAL: cada ponto é comparado com a média do que está em volta (imagem integral, O(n)).
 * Mais escuro que `ratio` × a média vizinha vira preto, o resto branco. Pega texto FINO e CLARO
 * (cinza sobre verde-claro, como nos valores da CNH digital) que o isolamento de traços escuros
 * apaga — e continua funcionando com sombra e luz desigual, porque a referência é sempre a vizinhança.
 */
export function adaptiveThreshold(gray: Uint8ClampedArray, width: number, height: number, ratio = 0.9, window = localWindow(width, height)): Uint8ClampedArray {
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const half = window >> 1;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - half);
    const bottom = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - half);
      const right = Math.min(width, x + half + 1);
      const total = sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left];
      const mean = total / ((right - left) * (bottom - top));
      out[y * width + x] = gray[y * width + x] < mean * ratio ? 0 : 255;
    }
  }
  return out;
}

/**
 * Ângulo (em graus, −15…+15) que deixa as linhas de texto na horizontal: o que maximiza a
 * variação entre linhas do perfil de projeção. Trabalha numa versão reduzida para ser rápido.
 */
export function estimateSkew(isolated: Uint8ClampedArray, width: number, height: number): number {
  return estimateSkewDetailed(isolated, width, height).angle;
}

/**
 * Além do ângulo, devolve `peakiness`: quão "em linhas" está a tinta (melhor ângulo ÷ média dos ângulos).
 * Perto de 1 = sem estrutura de linhas de texto (ruído, fundo, ou texto na vertical); alto = linhas claras.
 * Serve para escolher qual versão da imagem (letras escuras ou letras claras) tem texto de verdade.
 */
export function estimateSkewDetailed(isolated: Uint8ClampedArray, width: number, height: number): { angle: number; peakiness: number } {
  const factor = Math.max(1, Math.floor(Math.max(width, height) / 500));
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const ink: { x: number; y: number; v: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 255 - isolated[y * factor * width + x * factor];
      if (v > 60) ink.push({ x: x - w / 2, y: y - h / 2, v });
    }
  }
  if (ink.length < 200) return { angle: 0, peakiness: 1 };
  const score = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const rows = new Float64Array(h * 2 + 4);
    for (const p of ink) {
      const y = Math.round(-p.x * sin + p.y * cos + h);
      if (y >= 0 && y < rows.length) rows[y] += p.v;
    }
    let sumSq = 0;
    for (let i = 1; i < rows.length; i++) sumSq += (rows[i] - rows[i - 1]) ** 2;
    return sumSq;
  };
  let best = 0;
  let bestScore = score(0);
  let total = bestScore;
  let count = 1;
  for (let deg = -15; deg <= 15; deg += 1) {
    const s = score(deg);
    total += s;
    count++;
    if (s > bestScore) {
      bestScore = s;
      best = deg;
    }
  }
  for (let deg = best - 0.9; deg <= best + 0.9; deg += 0.3) {
    const s = score(deg);
    if (s > bestScore) {
      bestScore = s;
      best = deg;
    }
  }
  return { angle: Math.abs(best) < 0.4 ? 0 : best, peakiness: bestScore / (total / count || 1) };
}
