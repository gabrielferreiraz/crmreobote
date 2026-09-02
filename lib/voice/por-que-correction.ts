import type { LanguageProfile } from "./types";
import { foldAccents } from "./number-normalizer";

/**
 * "por que" / "porque" / "por quê" / "porquê" — as 4 grafias mais confundidas
 * do português, e a Web Speech API não tem como escolher direito: as 4 soam
 * quase idêntico (a única diferença real de pronúncia é o acento tônico no
 * "quê", sutil demais pra confiar). Nenhuma das 4 formas é "mais comum" o
 * bastante pra virar padrão fixo — a escolha certa depende de ONDE a
 * palavra está e se a oração é pergunta, então resolve isso por regra
 * gramatical determinística, não por chute:
 *
 *  1. Precedida de artigo/demonstrativo/possessivo ("o", "esse", "meu"...)
 *     → é o SUBSTANTIVO "porquê" (junto, com acento) — "o porquê disso").
 *  2. Oração é pergunta E é a ÚLTIMA palavra dela → "por quê" (separado,
 *     com acento) — "por quê?" isolado no fim ("ele não foi, por quê?").
 *  3. Oração é pergunta e NÃO é a última palavra → "por que" (separado, sem
 *     acento) — pergunta direta ("por que ele não veio?") ou indireta
 *     ("sabe por que motivo ele saiu?").
 *  4. Não é pergunta → "porque" (junto, sem acento) — conjunção explicativa,
 *     o caso mais comum de longe ("não foi porque estava doente").
 *
 * Roda só sobre a oração que ACABOU de ser processada nesta chamada (nunca
 * reescreve frases antigas já assentadas) — ver applyPunctuation em
 * punctuation-engine.ts, que já sabe isolar essa oração (extractTrailingClause
 * sobre `extended`, antes do fechamento final).
 */
const DETERMINERS_BEFORE_PORQUE = new Set([
  "o", "os", "esse", "esses", "este", "estes", "aquele", "aqueles",
  "um", "uns", "meu", "meus", "seu", "seus", "nosso", "nossos", "teu", "teus", "qual", "cada",
]);

/** "por que motivo/razão" — determinante relativo ("for which reason"),
 * NUNCA a conjunção causal "porque" mesmo fora de pergunta ("porque motivo"
 * não é português válido). Diferente das outras 3 regras (que dependem de
 * isQuestion), esta olha pra FRENTE, pro substantivo logo depois, e vence
 * todas as outras condições quando bate — sempre separado, sem acento. */
const NOUNS_AFTER_POR_QUE = new Set(["motivo", "motivos", "razao", "razoes"]);

const PATTERN = /\bpor\s+qu[eê]\b|\bporqu[eê]\b/giu;

export function applyPorQueForm(clause: string, isQuestion: boolean, profile: LanguageProfile): string {
  if (profile.locale !== "pt-BR" || !clause) return clause;

  return clause.replace(PATTERN, (match, offset: number, full: string) => {
    const before = full.slice(0, offset);
    const after = full.slice(offset + match.length);
    const precedingWordMatch = before.match(/(\p{L}+)[^\p{L}]*$/u);
    const precedingWordFolded = precedingWordMatch ? foldAccents(precedingWordMatch[1]) : "";
    const followingWordMatch = after.match(/^[^\p{L}]*(\p{L}+)/u);
    const followingWordFolded = followingWordMatch ? foldAccents(followingWordMatch[1]) : "";
    const isLastToken = !/\p{L}/u.test(after);
    const capitalized = /^[A-ZÀ-Ý]/.test(match);

    let form: string;
    if (DETERMINERS_BEFORE_PORQUE.has(precedingWordFolded)) {
      form = "porquê";
    } else if (NOUNS_AFTER_POR_QUE.has(followingWordFolded)) {
      form = "por que";
    } else if (isQuestion) {
      form = isLastToken ? "por quê" : "por que";
    } else {
      form = "porque";
    }
    return capitalized ? form.charAt(0).toUpperCase() + form.slice(1) : form;
  });
}
