/**
 * Linha digitável de boleto bancário (47 dígitos): validada pelos dígitos verificadores dos três campos
 * (módulo 10). Quando fecha a conta, o valor e o vencimento embutidos na linha também são lidos —
 * são mais confiáveis que o texto impresso, porque vêm do próprio código.
 */

const DIGITISH = "\\dODQIl|!ZSsB";
const CONFUSED: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", "!": "1", Z: "2", S: "5", s: "5", B: "8" };

const toDigits = (raw: string) =>
  Array.from(raw)
    .map((c) => (/\d/.test(c) ? c : (CONFUSED[c] ?? "")))
    .join("");

/** Dígito verificador módulo 10 (pesos 2,1,2,1… da direita para a esquerda). */
function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    let product = Number(digits[i]) * weight;
    if (product > 9) product = Math.floor(product / 10) + (product % 10);
    sum += product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidBoletoLine(d: string): boolean {
  if (!/^\d{47}$/.test(d)) return false;
  return mod10(d.slice(0, 9)) === Number(d[9]) && mod10(d.slice(10, 20)) === Number(d[20]) && mod10(d.slice(21, 31)) === Number(d[31]);
}

export function formatBoletoLine(d: string): string {
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Fator de vencimento → data. O fator reiniciou em 22/02/2025 (valor 1000). */
export function dueDateFromFactor(factor: number): string | null {
  if (factor < 1000) return null;
  const first = new Date(Date.UTC(1997, 9, 7) + factor * DAY);
  const second = new Date(Date.UTC(2025, 1, 22) + (factor - 1000) * DAY);
  const chosen = first.getUTCFullYear() >= 2022 ? first : second;
  return `${pad(chosen.getUTCDate())}/${pad(chosen.getUTCMonth() + 1)}/${chosen.getUTCFullYear()}`;
}

export type BoletoInfo = { line: string; due: string | null; amount: string | null };

const LINE_RE = new RegExp(`(?:[${DIGITISH}][\\s.\\-]*){47}`, "g");

export function findBoleto(texts: string[]): BoletoInfo | null {
  // a linha costuma vir numa linha só; se vier quebrada, junta as vizinhas
  const candidates = [...texts, ...texts.slice(0, -1).map((t, i) => `${t} ${texts[i + 1]}`)];
  for (const text of candidates) {
    for (const m of text.matchAll(LINE_RE)) {
      const digits = toDigits(m[0]);
      if (digits.length !== 47 || !isValidBoletoLine(digits)) continue;
      const factor = Number(digits.slice(33, 37));
      const cents = Number(digits.slice(37));
      const amount = cents > 0 ? `R$ ${(cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : null;
      return { line: formatBoletoLine(digits), due: dueDateFromFactor(factor), amount };
    }
  }
  return null;
}
