/**
 * Regras puras (sem navegador) para julgar a qualidade de uma leitura de OCR e
 * limpar o resultado. Ficam separadas para poderem ser testadas.
 */

/** Retângulo em pixels da imagem lida. */
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** Uma linha lida. `confidence` vai de 0 a 100; null = texto vindo direto do PDF (sem dúvida). `box` só existe em OCR. */
export type ReadLine = { text: string; confidence: number | null; box?: Box };
export type ScoredWord = { text: string; confidence: number };
export type WordBox = ScoredWord & { box: Box };

/** Abaixo disso a linha é marcada como "leitura incerta" na tela. */
export const LOW_CONFIDENCE = 70;
/** Palavra só conta como "bem lida" a partir deste valor. */
const WORD_OK = 60;

const alnumCount = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** Quanto texto bem lido a passada produziu: soma da confiança das palavras confiáveis (0–1 cada). */
export function scoreWords(words: ScoredWord[]): number {
  let total = 0;
  for (const w of words) {
    if (alnumCount(w.text) < 2 || w.confidence < WORD_OK) continue;
    total += w.confidence / 100;
  }
  return total;
}

export type PassSummary = { score: number; goodWords: number; meanConfidence: number };

export function summarizePass(words: ScoredWord[]): PassSummary {
  const good = words.filter((w) => alnumCount(w.text) >= 2 && w.confidence >= WORD_OK);
  const meanConfidence = good.length ? good.reduce((s, w) => s + w.confidence, 0) / good.length : 0;
  return { score: scoreWords(words), goodWords: good.length, meanConfidence };
}

/** A leitura é boa o bastante para não gastar tempo tentando outro modo. */
export function isGoodEnough(p: PassSummary): boolean {
  return p.goodWords >= 8 && p.meanConfidence >= 82;
}

/** A leitura saiu tão ruim que vale tentar a imagem girada. */
export function looksUnreadable(p: PassSummary): boolean {
  return p.goodWords < 6 || p.meanConfidence < 60;
}

/** Tira o lixo típico do OCR em foto (linhas quase sem letra/número) e normaliza os espaços. */
export function cleanReadLines(raw: ReadLine[]): ReadLine[] {
  const out: ReadLine[] = [];
  for (const line of raw) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (alnumCount(text) < 2) continue;
    if (alnumCount(text) / text.length < 0.4) continue;
    // Faixa curta e com confiança muito baixa é quase sempre borda/sujeira da foto, não texto.
    if (line.confidence !== null && line.confidence < 40 && alnumCount(text) < 10) continue;
    // Pedaço minúsculo ("fo", "ua", "PAX") com confiança só razoável: ruído do fundo da foto.
    if (line.confidence !== null && line.confidence < 80 && alnumCount(text) <= 3) continue;
    out.push({ text, confidence: line.confidence, ...(line.box ? { box: line.box } : {}) });
  }
  return out;
}
