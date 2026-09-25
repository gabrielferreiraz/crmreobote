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

/**
 * Devolve o CPF (11 dígitos) com os ZEROS À ESQUERDA restaurados, ou null se o
 * valor não dá pra recuperar com segurança. Existe porque planilha (Excel/CSV)
 * guarda CPF numérico e come o zero da frente: "03395004171" vira
 * "3395004171" (foi assim que ~230 clientes vindos da importação do Agendor
 * ficaram com CPF curto, ver scripts/agendor/xlsx-utils.ts → cellText).
 *
 * Regra: de 7 a 10 dígitos (até 4 zeros perdidos) E o número completado tem que
 * passar nos DOIS dígitos verificadores. A base empírica (medida em produção,
 * 09/2026): dos CPFs de 10 dígitos, 181/181 fecham os dígitos ao completar; de 9,
 * 39/41; de 8 e 7, 6/6 — um número inventado só passaria em ~1% dos casos. Já os
 * de 5 dígitos, 13/561 (2%): é acaso, não zero perdido (seriam 6 zeros, o que
 * acontece em ~1 a cada milhão de CPFs) — por isso ficam de fora.
 *
 * NÃO usar no formulário/API interativos: lá o CPF digitado é o que a pessoa
 * quis dizer, e completar em silêncio esconderia um erro de digitação. É pra
 * conserto de dado importado e pra importadores de planilha.
 */
export function restoreCpfLeadingZeros(raw: string): string | null {
  const digits = normalizeCpf(raw);
  if (digits.length < 7 || digits.length > 10) return null;
  const padded = digits.padStart(11, "0");
  return isValidCpf(padded) ? padded : null;
}
