/**
 * Detecta pedido de opt-out numa mensagem INBOUND — palavra-chave simples,
 * de propósito conservadora (só frases isoladas/curtas, não qualquer menção
 * no meio de uma frase longa) pra não marcar opt-out por engano numa
 * conversa de venda normal. Não substitui bom senso: é só um gatilho
 * automático a mais além do vendedor poder marcar manualmente.
 */

const OPT_OUT_PATTERNS = [
  /^\s*(pare|parar|para)( de (mandar|enviar))?\s*$/i,
  /^\s*sair\s*$/i,
  /^\s*stop\s*$/i,
  /^\s*cancelar\s*$/i,
  /^\s*descadastrar\s*$/i,
  /não quero mais receber/i,
  /nao quero mais receber/i,
  /remover meu (numero|número)/i,
  /tirar meu (numero|número)/i,
  /me tira da (lista|campanha)/i,
];

export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(trimmed));
}
