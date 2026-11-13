/**
 * Leitores de valores usados pelos rótulos de vários tipos de documento (contracheque, boleto,
 * conta de luz, contrato do consórcio…). Funções puras.
 */

/** Valor em reais: "R$ 1.273,75", "R$1273,75" ou só "1.273,75". Devolve "R$ 1.273,75". */
export function parseMoney(text: string): string | null {
  const m = text.match(/(?:R\s?\$\s?)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?!\d)/);
  if (!m) return null;
  const [intPart, cents] = m[1].split(",");
  const digits = intPart.replace(/\./g, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${cents}`;
}

/**
 * Número com separadores (matrícula, contrato, unidade consumidora…): devolve como foi lido, se a
 * quantidade de dígitos estiver na faixa esperada.
 */
export function parseNumberRange(text: string, min: number, max: number): string | null {
  for (const m of text.matchAll(/(?<![\dA-Za-z])(\d[\d.\-/ ]*\d|\d)(?![\dA-Za-z])/g)) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= min && digits.length <= max) return m[1].replace(/\s+/g, "").trim();
  }
  return null;
}

const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Competência/referência: "10/2026", "OUT/2026", "Outubro de 2026" → "Outubro/2026". */
export function parseCompetence(text: string): string | null {
  const numeric = text.match(/(?<!\d)(0?[1-9]|1[0-2])\s*[/\-.]\s*(20\d{2})(?!\d)/);
  if (numeric) return `${MONTH_NAMES[Number(numeric[1]) - 1]}/${numeric[2]}`;
  const named = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\W{0,4}(?:DE\W{0,2})?(20\d{2})\b/);
  if (named) return `${MONTH_NAMES[MONTHS.indexOf(named[1])]}/${named[2]}`;
  return null;
}
