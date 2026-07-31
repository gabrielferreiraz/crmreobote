/**
 * Troca de estado (abrir/fechar conversa, entrar/sair do modo foco) usando a
 * View Transitions API nativa do navegador quando disponível — dá um
 * fade/morph suave de graça, sem framer-motion e sem precisar animar
 * `position: fixed` (que não é animável via transition/keyframe comuns).
 * Em navegadores sem suporte, cai de volta pra troca instantânea normal.
 *
 * Vive fora de components/whatsapp-chat.tsx (que só re-exporta, pra não
 * quebrar quem já importava de lá) de propósito: components/
 * whatsapp-panel-trigger.tsx (botão sempre visível na página do negócio)
 * também precisa dela, e importar de whatsapp-chat.tsx traria o módulo
 * inteiro (~2k linhas de chat/mídia/QR code) pro bundle só por causa de uma
 * função de 5 linhas.
 */
export function withViewTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(update);
  } else {
    update();
  }
}
