/**
 * Texto de regras/contemplação do grupo, como a Servopa publica, organizado
 * para o PDF. As PALAVRAS nunca mudam (regra de ouro); só a quebra de linha:
 * o site quebra as frases em ~55 caracteres ("...ESTAO\nAPTOS A CONCORRER..."),
 * o que no PDF vira linhas cortadas no meio.
 *
 * - Bloco começa numa linha "- ...".
 * - Bloco cujo título termina em ":" ou é uma "ORDEM DE CONTEMPLACAO" (alguns
 *   grupos vêm sem os dois-pontos) é uma lista: cada linha seguinte é um item
 *   ("- ORDEM DE CONTEMPLACAO:" → "SORTEIO", "LANCE LIVRE"...).
 * - Os demais são uma frase só: as linhas seguintes continuam a mesma frase.
 */

export type ContemplationBlock =
  | { kind: "list"; title: string; items: string[] }
  | { kind: "note"; text: string };

export function splitContemplationText(text: string): ContemplationBlock[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const blocks: ContemplationBlock[] = [];
  let current: ContemplationBlock | null = null;

  for (const line of lines) {
    const startsBlock = line.startsWith("- ") || line === "-";
    if (startsBlock || !current) {
      const body = startsBlock ? line.replace(/^-\s*/, "") : line;
      const isList = body.endsWith(":") || /^ORDEM DE CONTEMPLA/i.test(body);
      current = isList ? { kind: "list", title: body, items: [] } : { kind: "note", text: body };
      blocks.push(current);
    } else if (current.kind === "list") {
      // Item longo sem pontuação no fim é uma frase que o site quebrou
      // ("NESTA MODALIDADE, ESTAO APTOS A CONCORRER OS" + "CONSORCIADOS ...");
      // itens de verdade são curtos ("SORTEIO", "LANCE LIVRE SEM EMBUTIDO").
      const last = current.items.length - 1;
      if (last >= 0 && current.items[last].length >= 35 && !/[;.:!?]$/.test(current.items[last])) {
        current.items[last] = `${current.items[last]} ${line}`;
      } else {
        current.items.push(line);
      }
    } else {
      current.text = `${current.text} ${line}`;
    }
  }
  return blocks;
}

/** Todas as palavras, na mesma ordem — usado para garantir que nada foi perdido nem inventado. */
export function contemplationWords(blocks: ContemplationBlock[]): string[] {
  return blocks
    .flatMap((block) => (block.kind === "list" ? [block.title, ...block.items] : [block.text]))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}
