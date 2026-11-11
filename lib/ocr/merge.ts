import type { Box, ReadLine, WordBox } from "@/lib/ocr/quality";

/**
 * Junta várias leituras da MESMA imagem (variações de tratamento e de modo do OCR) numa só.
 * Cada região da imagem fica com a palavra lida com mais confiança entre todas as leituras —
 * uma leitura que errou um campo é corrigida por outra que acertou.
 *
 * Todas as leituras precisam estar nas mesmas coordenadas (mesma escala e mesma rotação).
 */

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Junta as leituras região por região: palavras de leituras diferentes que se sobrepõem formam uma
 * REGIÃO; em cada região fica a leitura (de uma única passada) que rendeu mais texto bem lido.
 * Assim um número lido inteiro numa passada ("095.402.999-26") não é trocado por pedaços de outra.
 */
export function pickBestWords(passes: WordBox[][], minConfidence = 45): WordBox[] {
  const items: { w: WordBox; pass: number }[] = [];
  passes.forEach((words, pass) => {
    for (const w of words) if (w.confidence >= minConfidence && w.text.trim() && area(w.box) > 0) items.push({ w, pass });
  });

  // regiões = componentes conexos de palavras que se sobrepõem
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].pass === items[j].pass) continue;
      const a = items[i].w.box;
      const b = items[j].w.box;
      if (intersection(a, b) / Math.min(area(a), area(b)) > 0.3) parent[find(i)] = find(j);
    }
  }
  const regions = new Map<number, { w: WordBox; pass: number }[]>();
  items.forEach((it, i) => {
    const root = find(i);
    (regions.get(root) ?? regions.set(root, []).get(root)!).push(it);
  });

  const kept: WordBox[] = [];
  for (const region of regions.values()) {
    const byPass = new Map<number, WordBox[]>();
    for (const { w, pass } of region) (byPass.get(pass) ?? byPass.set(pass, []).get(pass)!).push(w);
    let best: WordBox[] = [];
    let bestScore = -1;
    for (const words of byPass.values()) {
      const score = words.reduce((s, w) => s + (w.confidence / 100) * w.text.replace(/\s/g, "").length, 0);
      if (score > bestScore) {
        bestScore = score;
        best = words;
      }
    }
    kept.push(...best);
  }
  return kept;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Limpa sinais soltos que o OCR cola nas pontas ("| NOME", "“ MATO GROSSO”"). */
export function trimLineNoise(text: string): string {
  return text
    .replace(/^[\s|“”"'‘’`´·•—–\-_:;,.~*+=<>[\]{}()]+/, "")
    .replace(/[\s|“”"'‘’`´·•—–\-_:;,~*+=<>[\]{}]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Monta as linhas a partir das palavras: agrupa pela altura e, dentro da linha, separa em
 * trechos quando há um vão grande (colunas diferentes do documento viram linhas diferentes).
 */
export function linesFromWords(words: WordBox[]): ReadLine[] {
  if (words.length === 0) return [];
  // Altura típica das letras: só das palavras bem lidas (pedaços de ruído são pequenos e puxariam a mediana para baixo).
  const reliable = words.filter((w) => w.confidence >= 70);
  const medianH = median((reliable.length >= 5 ? reliable : words).map((w) => w.box.y1 - w.box.y0)) || 20;
  const byY = [...words].sort((a, b) => a.box.y0 + a.box.y1 - (b.box.y0 + b.box.y1));

  const rows: { cy: number; words: WordBox[] }[] = [];
  for (const w of byY) {
    const cy = (w.box.y0 + w.box.y1) / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) <= Math.max(medianH * 0.6, (w.box.y1 - w.box.y0) * 0.6));
    if (row) {
      row.words.push(w);
      row.cy = row.words.reduce((s, x) => s + (x.box.y0 + x.box.y1) / 2, 0) / row.words.length;
    } else rows.push({ cy, words: [w] });
  }

  const lines: ReadLine[] = [];
  for (const row of rows) {
    const sorted = row.words.sort((a, b) => a.box.x0 - b.box.x0);
    const segments: WordBox[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].box.x0 - sorted[i - 1].box.x1;
      // Espaço entre palavras da mesma linha é ~0,4× a altura da letra; coluna diferente é bem maior.
      const local = Math.max(sorted[i].box.y1 - sorted[i].box.y0, sorted[i - 1].box.y1 - sorted[i - 1].box.y0, medianH * 0.8);
      if (gap > local * 1.8) segments.push([sorted[i]]);
      else segments[segments.length - 1].push(sorted[i]);
    }
    for (const rawSeg of segments) {
      // Letras e sinais soltos nas pontas (o OCR "lê" pedaços do desenho de fundo) não fazem parte da linha.
      const seg = [...rawSeg];
      const isStray = (w: WordBox) => (w.text.match(/[\p{L}\p{N}]/gu) ?? []).length <= 2 && w.confidence < 85;
      while (seg.length > 1 && isStray(seg[0])) seg.shift();
      while (seg.length > 1 && isStray(seg[seg.length - 1])) seg.pop();
      const text = trimLineNoise(seg.map((w) => w.text.trim()).join(" "));
      if (!text) continue;
      const weight = seg.reduce((s, w) => s + w.text.length, 0) || 1;
      const confidence = seg.reduce((s, w) => s + w.confidence * w.text.length, 0) / weight;
      const box: Box = {
        x0: Math.min(...seg.map((w) => w.box.x0)),
        y0: Math.min(...seg.map((w) => w.box.y0)),
        x1: Math.max(...seg.map((w) => w.box.x1)),
        y1: Math.max(...seg.map((w) => w.box.y1)),
      };
      lines.push({ text, confidence, box });
    }
  }
  return lines.sort((a, b) => a.box!.y0 - b.box!.y0 || a.box!.x0 - b.box!.x0);
}

/** Atalho: várias leituras → melhores palavras → linhas. */
export function mergePasses(passes: WordBox[][]): ReadLine[] {
  return linesFromWords(pickBestWords(passes));
}

/**
 * Junção palavra por palavra (vence a palavra mais confiante em cada lugar). Pode misturar pedaços de
 * leituras diferentes — ruim para frases, mas às vezes é o que "conserta" um número que nenhuma leitura
 * acertou inteiro. Por isso só é usada para RESGATAR números que passam na conta dos dígitos verificadores.
 */
export function pickBestWordsGreedy(passes: WordBox[][], minConfidence = 45): WordBox[] {
  const all = passes.flat().filter((w) => w.confidence >= minConfidence && w.text.trim() && area(w.box) > 0);
  all.sort((a, b) => b.confidence - a.confidence);
  const kept: WordBox[] = [];
  for (const word of all) {
    const wa = area(word.box);
    const clash = kept.some((k) => intersection(k.box, word.box) / Math.min(wa, area(k.box)) > 0.4);
    if (!clash) kept.push(word);
  }
  return kept;
}
