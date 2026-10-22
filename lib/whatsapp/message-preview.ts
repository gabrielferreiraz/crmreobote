/**
 * Texto curto de uma mensagem pra lista de conversas, citação, push e backup —
 * UM lugar só. Antes eram nove cópias (cinco mapas e quatro ternários) que já
 * tinham divergido: a Central listava "Vídeo/Documento" (tipos que nem existem
 * no enum) e o push dizia "Nova mensagem" pra contato, Pix e chamada.
 *
 * Puro (sem servidor) — roda no navegador e no servidor.
 */

const TYPE_LABEL: Record<string, string> = {
  IMAGE: "📷 Imagem",
  AUDIO: "🎵 Áudio",
  CONTACT: "👤 Contato",
  PIX: "💰 Pix",
  STICKER: "🧩 Figurinha",
  CALL: "📞 Chamada",
  BUTTONS: "🔘 Botões",
  LIST: "📋 Lista",
};

/** O texto da mensagem; sem texto, o rótulo do tipo ("📷 Imagem"); sem os dois, `fallback`. */
export function messagePreview(body: string | null | undefined, type: string | null | undefined, fallback: string): string {
  return body || (type ? TYPE_LABEL[type] : undefined) || fallback;
}
