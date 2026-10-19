/**
 * Texto como a busca compara — minúsculo, sem acento, espaços extras
 * removidos. Puro (sem servidor): usado pela busca no banco
 * (lib/commissions/search.ts, com o mesmo par de letras no translate() do
 * Postgres) e pelas buscas que filtram na própria tela.
 */

// Mesma posição nas duas strings: "á" vira "a", "ç" vira "c"…
export const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüçñ";
export const PLAIN = "aaaaaeeeeiiiiooooouuuucn";

export function plainSearchText(value: string): string {
  let out = "";
  for (const ch of value.toLocaleLowerCase("pt-BR")) {
    const i = ACCENTED.indexOf(ch);
    out += i >= 0 ? PLAIN[i] : ch;
  }
  return out.trim().replace(/\s+/g, " ");
}
