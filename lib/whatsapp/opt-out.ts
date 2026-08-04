/**
 * Detecta pedido de opt-out numa mensagem INBOUND — palavra-chave simples,
 * de propósito conservadora (não qualquer menção solta no meio de uma frase
 * longa, tipo "para" usado como preposição) pra não marcar opt-out por
 * engano numa conversa de venda normal. Não substitui bom senso: é só um
 * gatilho automático a mais além do vendedor poder marcar manualmente.
 *
 * Duas categorias de padrão:
 *  1. Comando isolado — a mensagem inteira é só a palavra (ex.: "Parar.").
 *  2. Frase de pedido — verbo de parar/sair/cancelar junto do objeto certo
 *     (mandar/enviar mensagem, lista, cadastro, número), em qualquer lugar
 *     da frase — cobre "Por favor pare de me mandar mensagem" e "quero sair
 *     da lista", que a versão só-frase-isolada não pegava.
 */

const OPT_OUT_PATTERNS = [
  // Comando isolado, com ou sem pontuação final.
  /^\s*(pare|parar|para|sair|stop|cancelar|descadastrar|descadastre|descadastra)\s*[.!]?\s*$/i,

  // Pedido de parar de mandar/enviar mensagem — "pare/pode parar/para" perto
  // de "mandar/enviar", com "de"/"me" opcionais no meio.
  /\b(pare|parar|para)\s+(de\s+)?(me\s+)?(mandar|enviar|mand[ae]|envi[ae])\b/i,
  /\bn[ãa]o\s+(me\s+)?manda(m)?\s+mais\b/i,
  /n[ãa]o quero mais receber/i,

  // Pedido de sair/remover/cancelar de lista, campanha ou cadastro.
  /\bsair\s+da\s+(lista|campanha)\b/i,
  /\bcancela(r)?\s+(meu\s+)?(cadastro|inscri[çc][ãa]o)\b/i,
  /\bdescadastr(ar|e|a)(-me)?\b/i,
  /remov(er|e|a) meu (numero|número)/i,
  /tirar meu (numero|número)/i,
  /me tira da (lista|campanha)/i,
  /\bremov(e|a)(-me)?\s+da\s+(lista|campanha)\b/i,
];

export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(trimmed));
}
