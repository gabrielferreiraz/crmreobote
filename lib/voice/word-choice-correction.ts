import type { LanguageProfile } from "./types";
import { foldAccents } from "./number-normalizer";

/**
 * "esta"/"está" — mesmo som em fala corrida, escolha errada muda o sentido
 * (demonstrativo "this" vs. verbo "estar"/"is"). Corrige SEM risco de falso
 * positivo porque não é ambíguo de verdade: o demonstrativo "esta" em
 * português SEMPRE precede um SUBSTANTIVO ("esta proposta", "esta
 * reunião") — nunca um predicado de estado (adjetivo típico de "estar" ou
 * verbo no gerúndio) direto. Se a palavra seguinte é claramente um
 * predicado desses, só pode ser o verbo — não existe leitura alternativa
 * gramatical válida.
 */
const STATE_PREDICATES = new Set([
  "interessado", "interessada",
  "decidido", "decidida",
  "confirmado", "confirmada",
  "pronto", "pronta",
  "disponivel",
  "satisfeito", "satisfeita",
  "certo", "certa",
  "resolvido", "resolvida",
  "fechado", "fechada",
  "ciente",
  "indeciso", "indecisa",
  "receoso", "receosa",
  "animado", "animada",
  "preocupado", "preocupada",
  "em", // "está em dúvida/análise/negociação..." — preposição abrindo predicado
  "com", // "está com receio/pressa..."
  "sem", // "está sem tempo/interesse..."
]);

function isGerund(word: string): boolean {
  return /^[a-z]+(ando|endo|indo)$/.test(word);
}

export function correctEstaEsta(text: string): string {
  return text.replace(/\besta\b/gi, (match, offset: number, full: string) => {
    const after = full.slice(offset + match.length);
    const nextWordMatch = after.match(/^\s+(\S+)/);
    if (!nextWordMatch) return match;
    const nextWordFolded = foldAccents(nextWordMatch[1]).replace(/[^a-z]/g, "");
    if (!STATE_PREDICATES.has(nextWordFolded) && !isGerund(nextWordFolded)) return match;
    const capitalized = /^[A-Z]/.test(match);
    return capitalized ? "Está" : "está";
  });
}

/**
 * "a"/"há" — preposição vs. verbo haver indicando tempo decorrido ("há dois
 * anos", "há uma semana"). Escopo deliberadamente estreito: só corrige o
 * padrão "a NÚMERO UNIDADE-DE-TEMPO" (dia/semana/mês/ano/hora/minuto...),
 * que é praticamente sempre tempo decorrido nesse registro — fora desse
 * padrão específico, "a"/"há" tem regras de crase/regência complexas demais
 * pra arriscar corrigir sem gramática de verdade (ver comentário mais
 * completo na resposta ao usuário/histórico de decisão).
 */
const NUMBER_WORDS = new Set([
  "um", "uma", "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "catorze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
  "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa",
  "cem", "cento", "duzentos", "trezentos", "mil", "poucos", "poucas", "alguns", "algumas", "varios", "varias",
]);
const TIME_UNIT_WORDS = new Set([
  "dia", "dias", "semana", "semanas", "mes", "mês", "meses",
  "ano", "anos", "hora", "horas", "minuto", "minutos", "segundo", "segundos",
]);

export function correctHaTemporal(text: string): string {
  return text.replace(/\ba\b(\s+)(\S+)(\s+)(\S+)/gi, (match, sp1: string, w1: string, sp2: string, w2: string) => {
    const num = foldAccents(w1).replace(/[^a-z]/g, "");
    const unit = foldAccents(w2).replace(/[^a-z]/g, "");
    const isNumber = /^\d+$/.test(w1) || NUMBER_WORDS.has(num);
    if (!isNumber || !TIME_UNIT_WORDS.has(unit)) return match;
    const capitalized = /^[A-Z]/.test(match.charAt(0));
    return `${capitalized ? "Há" : "há"}${sp1}${w1}${sp2}${w2}`;
  });
}

/** Ambas as correções acima são regras de ortografia ESPECÍFICAS do
 * português (esta/está e a/há não têm equivalente nem sentido em outro
 * idioma) — roda só quando o perfil ativo é pt-BR, mesma cautela de
 * por-que-correction.ts. */
export function applyWordChoiceCorrections(text: string, profile: LanguageProfile): string {
  if (profile.locale !== "pt-BR") return text;
  return correctHaTemporal(correctEstaEsta(text));
}
