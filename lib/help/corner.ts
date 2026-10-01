/**
 * Em qual canto da tela o botão flutuante da Central de Ajuda está —
 * arrastável entre esquerda e direita (ver components/help/help-center.tsx),
 * nunca uma posição livre: "canto" é sempre um dos dois, por pedido
 * explícito ("apenas" mover pro outro canto, não um arraste livre).
 *
 * Funções puras, sem estado React — lidas também FORA do provider da ajuda
 * (ver components/cnpj-prompt.tsx), que evita o canto esquerdo quando o
 * usuário arrastou a ajuda pra lá, pra não sobrepor os dois elementos
 * flutuantes. Não vale a pena montar um Context só por causa disso; os dois
 * lados concordam só pela mesma chave de localStorage, lida uma vez por
 * montagem — suficiente pra evitar a sobreposição garantida, mesmo sem
 * sincronia ao vivo entre os dois componentes.
 */

export type HelpCorner = "left" | "right";

const HELP_CORNER_KEY = "help.corner";

export function readHelpCorner(): HelpCorner {
  try {
    return localStorage.getItem(HELP_CORNER_KEY) === "left" ? "left" : "right";
  } catch {
    // Aba anônima / storage bloqueado — cai no canto padrão de sempre.
    return "right";
  }
}

export function writeHelpCorner(corner: HelpCorner): void {
  try {
    localStorage.setItem(HELP_CORNER_KEY, corner);
  } catch {
    // A escolha só não sobrevive à sessão — nunca quebra o arraste em si.
  }
}
