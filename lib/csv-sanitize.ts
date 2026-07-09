/**
 * Neutraliza CSV/Formula Injection (OWASP): células que começam com =, +, -, @,
 * tabulação ou retorno de carro são interpretadas como fórmula pelo Excel/Google
 * Sheets ao abrir o arquivo, podendo executar comandos no computador de quem abre.
 * Prefixar com aspas simples força a leitura como texto puro.
 */
const DANGEROUS_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function sanitizeCell<T>(value: T): T {
  if (typeof value !== "string" || value.length === 0) return value;
  return (DANGEROUS_PREFIXES.has(value[0]) ? `'${value}` : value) as T;
}
