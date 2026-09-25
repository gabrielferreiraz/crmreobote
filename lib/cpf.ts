/**
 * CPF: normalização, máscara e validação dos dígitos verificadores. Puro (sem
 * prisma/rede), então roda igual no servidor (fonte de verdade, ver
 * coerceCustomFieldValue em lib/custom-fields.ts) e no navegador (máscara e
 * mensagem enquanto digita, ver components/custom-fields-fieldset.tsx).
 *
 * Mesma convenção do CNPJ (lib/cnpj.ts): guarda-se SÓ OS DÍGITOS — é o que
 * deduplica, filtra e integra bem — e a pontuação 000.000.000-00 é só
 * apresentação. Achado M1 do relatório de QA: o campo "CPF" aceitava
 * "11111111111" e salvava sem máscara, enquanto o CNPJ já validava.
 */

/** Só os dígitos — é assim que o CPF é guardado e comparado. */
export function normalizeCpf(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Máscara progressiva (serve pra campo em digitação): "1234" → "123.4", "12345678901" → "123.456.789-01". Corta em 11 dígitos. */
export function maskCpf(raw: string): string {
  const d = normalizeCpf(raw).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** 000.000.000-00 — só pra exibir um CPF já guardado; se não tiver 11 dígitos devolve o texto como veio. */
export function formatCpf(raw: string): string {
  return normalizeCpf(raw).length === 11 ? maskCpf(raw) : raw;
}

/** Um dígito verificador: soma ponderada dos `count` primeiros dígitos (pesos count+1 … 2), ×10, resto por 11 (10 vira 0). */
function checkDigit(digits: string, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += Number(digits[i]) * (count + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/**
 * Confere tamanho e os dois dígitos verificadores. Recusa "11111111111" e
 * afins (dígitos todos iguais): passam na conta, mas não são CPF de ninguém —
 * é o placeholder clássico de formulário mal preenchido (mesma regra do CNPJ).
 */
export function isValidCpf(raw: string): boolean {
  const d = normalizeCpf(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  return checkDigit(d, 9) === Number(d[9]) && checkDigit(d, 10) === Number(d[10]);
}
