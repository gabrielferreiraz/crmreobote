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

/**
 * Extrai a parte "usuário" de um JID do WhatsApp — ex.:
 * "5511999998888:14@s.whatsapp.net" → "5511999998888". O ":14" é o id do
 * aparelho (multi-device); mensagens normalmente chegam sem ele, mas
 * eventos de CHAMADA do Baileys/Evolution costumam incluir, e passar isso
 * direto pra normalizePhoneNumber (que só remove caractere não-dígito, sem
 * saber o que é sufixo de aparelho) funde o id do aparelho no número —
 * gerava uma conversa nova e mal formatada em vez de casar com a já
 * existente. Sempre usar isso antes de normalizar um JID cru.
 */
export function extractJidUser(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

/**
 * O JID que o WhatsApp manda numa mensagem recebida às vezes vem sem o 9º
 * dígito do celular (ex.: "6781783902", 10 dígitos), mesmo quando o número
 * de verdade — e o que está salvo no contato — tem os 11 (o 9 que virou
 * obrigatório em todos os DDDs do Brasil). Isso é um comportamento conhecido
 * do WhatsApp/Baileys, não um erro de digitação. Sem considerar as duas
 * formas na hora de casar com um contato, mensagem recebida de um número
 * salvo com o 9 nunca encontra o contato.
 */
export function brazilianMobileVariants(normalized: string): string[] {
  const variants = new Set([normalized]);
  if (normalized.length === 11 && normalized[2] === "9") {
    variants.add(normalized.slice(0, 2) + normalized.slice(3));
  } else if (normalized.length === 10) {
    variants.add(normalized.slice(0, 2) + "9" + normalized.slice(2));
  }
  return Array.from(variants);
}

/** Forma legível pra exibir na UI (ex.: "+55 (67) 99178-3902") — nunca usar isso pra comparar/buscar, só pra mostrar. */
export function formatBrazilianPhone(normalized: string | null | undefined): string | null {
  if (!normalized) return null;
  const ddd = normalized.slice(0, 2);
  const rest = normalized.slice(2);
  if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `+55 ${normalized}`;
}
