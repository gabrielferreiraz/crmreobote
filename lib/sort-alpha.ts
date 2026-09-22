/**
 * Ordem alfabética pt-BR (ignora acento e caixa: "Água" antes de "Banco") pra
 * listas de opções de FILTRO/seleção — funis, responsáveis, origens, cargos,
 * tags, equipes. Nunca use em listas com ordem própria (etapas do funil,
 * status, períodos): a ordem delas carrega significado.
 *
 * Não muta a lista original. `keepFirst` mantém no topo, na ordem em que
 * vieram, os itens fixos (ex.: "Todos", "Eu", "Ninguém") — só o resto é
 * ordenado.
 */
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function sortAlpha<T>(items: T[], getLabel: (item: T) => string, keepFirst?: (item: T) => boolean): T[] {
  const pinned = keepFirst ? items.filter(keepFirst) : [];
  const rest = keepFirst ? items.filter((i) => !keepFirst(i)) : items.slice();
  rest.sort((a, b) => collator.compare(getLabel(a), getLabel(b)));
  return [...pinned, ...rest];
}

/** Atalho pra `{ value, label }` — o formato de opção de <Select>/<ColumnFilter>. */
export function sortOptionsAlpha<T extends { label: string }>(options: T[], keepFirst?: (o: T) => boolean): T[] {
  return sortAlpha(options, (o) => o.label, keepFirst);
}
