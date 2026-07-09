/**
 * Normaliza um número de telefone/WhatsApp brasileiro para uma forma canônica
 * comparável, removendo toda a formatação (espaços, parênteses, traços, +),
 * o código do país (55) e um eventual zero de tronco à esquerda — assim
 * "+55 (11) 98765-4321", "011 98765-4321" e "11987654321" são reconhecidos
 * como o mesmo número.
 *
 * Retorna `null` quando não sobra nenhum dígito (campo vazio/whitespace).
 */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Código do país (55) só é removido se, depois de tirado, ainda sobrar um
  // número plausível de DDD+telefone (10 ou 11 dígitos) — evita confundir um
  // número local que por acaso comece com "55".
  if (digits.length > 11 && digits.startsWith("55") && digits.length - 2 <= 11) {
    digits = digits.slice(2);
  }

  // Zero de tronco (ex.: "0 11 98765-4321"), mesma lógica de segurança.
  if (digits.length > 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits || null;
}
