import { HELP_TOPICS } from "./topics";
import type { HelpRole, HelpTopic } from "./types";

/** Remove acento e caixa — "campanha", "CAMPANHA" e "campánha" batem igual. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Palavras que não dizem nada sobre O QUE a pessoa procura.
 *
 * Existe porque aqui, diferente da busca de Configurações, a pessoa escreve
 * PERGUNTA, não termo: "como faço pra criar uma campanha". Exigindo que toda
 * palavra aparecesse, "como", "faço" e "pra" derrubavam o resultado a zero —
 * a busca parecia quebrada justamente pra quem mais precisa dela.
 */
const STOPWORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na",
  "nos", "nas", "por", "pra", "para", "pro", "com", "sem", "e", "ou", "que", "se", "ao", "aos",
  "eu", "meu", "minha", "meus", "minhas", "como", "onde", "quando", "qual", "quais", "quero",
  "queria", "preciso", "posso", "faco", "fazer", "faz", "fiz", "sao", "ser", "esta", "isso",
  "aqui", "tem", "ter", "mais", "muito", "nao", "sobre", "num", "numa", "sei", "vejo", "ver",
]);

function terms(query: string): string[] {
  const all = normalize(query).trim().split(/\s+/).filter(Boolean);
  const meaningful = all.filter((word) => word.length > 1 && !STOPWORDS.has(word));
  // Digitou SÓ palavra vazia ("como faço"): usa o que veio, porque devolver
  // algo largo é melhor do que fingir que não entendeu nada.
  return meaningful.length > 0 ? meaningful : all;
}

/**
 * Índice montado uma vez (o catálogo é estático) — sem isso, cada tecla
 * digitada renormalizaria título, resumo, passos e palavras-chave dos 35
 * verbetes.
 */
type Indexed = { title: string; keywords: string[]; summary: string; body: string };
const INDEX = new Map<string, Indexed>();

function indexOf(topic: HelpTopic): Indexed {
  const cached = INDEX.get(topic.id);
  if (cached) return cached;
  const entry: Indexed = {
    title: normalize(topic.title),
    keywords: (topic.keywords ?? []).map(normalize),
    summary: normalize(topic.summary),
    body: normalize(
      [
        ...(topic.steps ?? []),
        topic.note?.text ?? "",
        ...(topic.reference ?? []).map((row) => `${row.code} ${row.meaning}`),
      ].join(" "),
    ),
  };
  INDEX.set(topic.id, entry);
  return entry;
}

/**
 * Peso por ONDE o termo bate, não só se bateu.
 *
 * Sem isso, "criar campanha" empatava Campanhas com qualquer verbete que
 * mencionasse "criar" num passo, e o desempate acabava sendo a ordem do
 * arquivo — a resposta certa saía em sexto. Palavra-chave exata vale mais que
 * título, porque `keywords` é justamente onde ficam os termos que a pessoa
 * digita mas que não aparecem escritos na tela ("disparo" → Campanhas).
 */
function weightOf(topic: HelpTopic, word: string): number {
  const entry = indexOf(topic);
  // Só o plural precisa de ajuda: o singular digitado já acha o plural do
  // texto por ser pedaço dele ("cliente" está dentro de "clientes"), mas o
  // contrário não — e "onde vejo meus clientes" é exatamente como a pergunta
  // chega.
  const forms = word.endsWith("s") ? [word, word.slice(0, -1)] : [word];
  const hit = (haystack: string) => forms.some((form) => haystack.includes(form));

  if (entry.keywords.some((keyword) => forms.includes(keyword))) return 10;
  if (hit(entry.title)) return 8;
  if (entry.keywords.some((keyword) => hit(keyword))) return 6;
  if (hit(entry.summary)) return 4;
  if (hit(entry.body)) return 1;
  return 0;
}

export type HelpAudience = { role: HelpRole; isAdministrativo: boolean };

/**
 * Esconde o que a pessoa não pode fazer. Ajuda que ensina a usar uma tela
 * onde ela vai tomar 403 é pior que não ter ajuda: ensina e frustra.
 */
export function isVisibleTo(topic: HelpTopic, audience: HelpAudience): boolean {
  if (topic.roles && !topic.roles.includes(audience.role)) return false;
  if (topic.salesOnly && audience.isAdministrativo) return false;
  return true;
}

export function visibleTopics(audience: HelpAudience): HelpTopic[] {
  return HELP_TOPICS.filter((topic) => isVisibleTo(topic, audience));
}

/**
 * Duas passadas, nesta ordem:
 *  1. Verbetes que atendem TODOS os termos — quando existem, são os únicos que
 *     interessam, ordenados pelo peso de onde bateram.
 *  2. Não havendo nenhum, cai pros que atendem ALGUM, do que atende mais
 *     termos pro que atende menos. "Resposta mais ou menos" vale muito mais
 *     que "nada encontrado" pra quem travou no meio de um atendimento.
 */
export function searchTopics(query: string, audience: HelpAudience): HelpTopic[] {
  if (!query.trim()) return [];
  const words = terms(query);
  if (words.length === 0) return [];

  const pool = visibleTopics(audience);
  const weightsByTopic = pool.map((topic) => ({ topic, weights: words.map((word) => weightOf(topic, word)) }));

  /**
   * Termo que aparece em POUCOS verbetes identifica o assunto; termo que
   * aparece em muitos, não. Sem isso, "criar campanha" empatava Campanhas com
   * "Cadastrar um cliente" e "Criar um negócio" (os três batem um termo só) e
   * o desempate virava a ordem do arquivo — a resposta certa saía em terceiro.
   * É o mesmo princípio do IDF de busca textual, na versão mínima que um
   * catálogo de algumas dezenas de verbetes pede.
   */
  const rarity = words.map((_, i) => {
    const matches = weightsByTopic.filter((entry) => entry.weights[i] > 0).length;
    return pool.length / (1 + matches);
  });

  const scored = weightsByTopic
    .map(({ topic, weights }) => ({
      topic,
      hits: weights.filter((weight) => weight > 0).length,
      total: weights.reduce((sum, weight, i) => sum + weight * rarity[i], 0),
    }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.total - a.total);

  const complete = scored.filter((entry) => entry.hits === words.length);
  return (complete.length > 0 ? complete : scored).map((entry) => entry.topic);
}
