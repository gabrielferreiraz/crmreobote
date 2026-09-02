import type { LanguageProfile } from "./types";
import { VOICE_CONFIG } from "./config";

/**
 * pt-BR é o idioma prioritário (todo o resto do sistema assume isso —
 * question-detector.ts, punctuation-engine.ts) — perfil completo. en-US
 * existe pra o sistema já nascer preparado pra outro idioma sem reescrever
 * o núcleo, mas deliberadamente mais enxuto: nenhum consumidor do CRM
 * passa `lang="en-US"` hoje (VoiceInputButton default é sempre "pt-BR"),
 * não vale investir o mesmo tanto de curadoria num perfil sem uso real
 * ainda. Novo idioma (es-ES, fr-FR...) = um objeto novo aqui + registrar em
 * PROFILES, sem tocar em nenhum outro arquivo do pipeline.
 *
 * Sem `capitalizationConnectors` (cogitado a princípio, tipo "de"/"da"/"do"
 * minúsculos em Title Case): o pipeline de prosa (punctuation-engine.ts) só
 * capitaliza a 1ª letra do INÍCIO da frase, nunca faz Title Case palavra a
 * palavra de nome próprio no meio do texto — essa outra necessidade já
 * existe, mas em outro sistema (lib/quick-register/format-dictated-lead-
 * text.ts's `titleCase`/`LOWERCASE_CONNECTORS`, pro Registro Rápido, que
 * NÃO passa por este pipeline). Declarar o campo aqui sem nada nunca ler
 * seria pior que não ter o campo.
 */
const PT_BR: LanguageProfile = {
  locale: "pt-BR",
  speechLocale: "pt-BR",
  questionWords: [
    "quem",
    "qual",
    "quais",
    "quando",
    "onde",
    "como",
    "por que",
    "porque",
    "quanto",
    "quantos",
    "quanta",
    "quantas",
  ],
  indirectQuestionMarkers: [
    "nao sei",
    "sei la",
    "duvido que",
    "nao faco ideia",
    "nao tenho certeza",
    "nao sabemos",
    "nao lembro",
  ],
  questionOpeners: [
    "pode",
    "poderia",
    "tem como",
    "voce consegue",
    "sera que",
    "consegue",
    // Abertura indireta de pergunta ("eu queria saber quando...") — sem
    // isso, a única forma da frase pontuar como pergunta era o peso por
    // POSIÇÃO da palavra interrogativa (ver question-detector.ts), que
    // decai rápido e não sobrava quase nada bem no padrão mais comum de
    // pergunta educada em português falado ("queria saber" empurra
    // "quando"/"onde"/"como" pra posição 3+, já quase zerada).
    "queria saber",
    "gostaria de saber",
    "queria perguntar",
    "gostaria de perguntar",
    "posso saber",
    "pode me dizer",
    "pode me falar",
    "me diz",
    "me fala",
    "da pra",
    "tem condicao de",
    "tem condicoes de",
  ],
  // Marcador de "tag question" — quem faz a frase soar como pergunta aqui é
  // a ENTONAÇÃO (que texto não carrega nenhuma), não uma palavra
  // interrogativa. É o jeito MAIS comum de perguntar sim/não em português
  // falado ("Fechou comigo, né?", "Combinado?", "Ou não?") e o detector
  // antigo (só quem/qual/quando + abertura modal) não pegava nenhum desses
  // — ver question-detector.ts pra como isso pesa (perto do FIM da frase,
  // não decai por posição do início).
  questionTagMarkers: [
    "ne",
    "nao e",
    "certo",
    "combinado",
    "pode ser",
    "beleza",
    "ta bom",
    "ta certo",
    "esta bem",
    "fechado",
    "concorda",
    "ou nao",
    "topa",
  ],
  // Verbo de confirmação com sujeito omitido logo no início — "Fechou o
  // negócio?", "Confirmou a reunião?", "Assinou o contrato?". Só pretérito
  // perfeito/particípio de verbo de ação/fechamento de venda (ver comentário
  // do campo em types.ts pra por que isso é confiável nesse registro, e pra
  // por que "vai"/"quer"/"pode" ficam de fora — esses já entram como
  // questionOpeners acima, com peso próprio). Ninguém em dictado de CRM
  // normalmente abre um RELATO direto por um desses sem sujeito antes
  // ("Assinou o contrato." soa estranho como afirmação; "Ele assinou o
  // contrato." é como se fala de verdade) — por isso decide sozinho.
  subjectlessQuestionVerbsStrong: [
    "fechou", "fechado", "confirmou", "confirmado", "assinou", "assinado",
    "pagou", "pago", "aceitou", "aceita", "topou",
  ],
  // Mesma ideia, mas verbo-RESULTADO que também abre frase declarativa
  // legítima sem sujeito ("Rolou uma reunião ontem", "Deu certo a
  // negociação", "Funcionou o desconto") — por isso só ajuda a cruzar o
  // threshold junto de outro sinal, nunca decide sozinho.
  subjectlessQuestionVerbsModerate: [
    "chegou", "ficou", "deu", "resolveu", "decidiu", "gostou", "conseguiu",
    "funcionou", "rolou",
  ],
  sentenceConnectors: [
    { word: "mas", punctuation: ",", scoreBonus: 3 },
    { word: "porem", punctuation: ",", scoreBonus: 3 },
    { word: "contudo", punctuation: ",", scoreBonus: 3 },
    { word: "entretanto", punctuation: ",", scoreBonus: 3 },
    { word: "entao", punctuation: ",", scoreBonus: 2 },
    { word: "portanto", punctuation: ",", scoreBonus: 2 },
    { word: "so que", punctuation: ",", scoreBonus: 2 },
    { word: "e ai", punctuation: ",", scoreBonus: 1 },
  ],
  // Discurso parentético que pede vírgula antes mesmo sem pausa nenhuma —
  // ver comentário do campo em types.ts. sentenceConnectors acima NÃO entra
  // aqui de novo (mid-sentence-comma.ts já reaproveita aquela lista pro
  // caso de aparecerem no MEIO do mesmo segmento, sem duplicar a palavra).
  midSentenceCommaMarkers: [
    "por exemplo",
    "ou seja",
    "na verdade",
    "inclusive",
    "alias",
    "enfim",
    "alem disso",
    "por outro lado",
    "de qualquer forma",
    "de qualquer jeito",
  ],
  // Preposição, artigo, contração ou conjunção subordinativa — nenhuma
  // dessas termina uma frase sozinha em português. Fora de propósito:
  // pronome/demonstrativo que PODE terminar frase sozinho ("isso", "aquilo",
  // "esse", "aquele"...) — ver comentário do campo em types.ts.
  danglingEndings: [
    // Preposição simples
    "de", "em", "por", "para", "com", "sem", "sobre", "sob", "entre", "ate",
    "apos", "ante", "contra", "desde", "durante", "mediante", "perante", "tras",
    // Contração preposição + artigo/pronome
    "do", "da", "dos", "das", "no", "na", "nos", "nas", "ao", "aos",
    "pelo", "pela", "pelos", "pelas", "num", "numa", "nuns", "numas", "dum", "duma",
    // Artigo
    "o", "a", "os", "as", "um", "uma", "uns", "umas",
    // Conjunção/subordinador
    "que", "se", "porque", "quando", "como", "embora", "caso", "e", "ou",
    "nem", "enquanto", "apesar", "pois",
    // Possessivo (sempre precisa de um substantivo depois)
    "meu", "minha", "meus", "minhas", "seu", "sua", "seus", "suas",
    "teu", "tua", "teus", "tuas", "nosso", "nossa", "nossos", "nossas",
  ],
};

const EN_US: LanguageProfile = {
  locale: "en-US",
  speechLocale: "en-US",
  questionWords: ["who", "what", "which", "when", "where", "how", "why", "how much", "how many"],
  indirectQuestionMarkers: ["i dont know", "not sure", "no idea"],
  questionOpeners: ["can you", "could you", "would you", "is there a way"],
  // Lista enxuta de propósito (mesmo raciocínio do PT_BR acima) — inglês
  // escrito já costuma inverter sujeito/verbo em pergunta ("Did he close
  // it?"), então tag questions/verbo-sem-sujeito pesam bem menos aqui do que
  // em português falado.
  questionTagMarkers: ["right", "correct", "isnt it", "dont you think"],
  subjectlessQuestionVerbsStrong: [],
  subjectlessQuestionVerbsModerate: [],
  sentenceConnectors: [
    { word: "but", punctuation: ",", scoreBonus: 3 },
    { word: "however", punctuation: ",", scoreBonus: 3 },
    { word: "so", punctuation: ",", scoreBonus: 2 },
    { word: "therefore", punctuation: ",", scoreBonus: 2 },
  ],
  midSentenceCommaMarkers: ["for example", "that is", "in fact", "besides", "anyway"],
  // Lista enxuta de propósito, mesmo raciocínio do PT_BR acima — ver
  // comentário lá no topo do arquivo pra por que en-US recebe menos curadoria.
  danglingEndings: [
    "the", "a", "an", "to", "of", "in", "on", "with", "for", "and", "or",
    "but", "that", "if", "my", "your", "his", "her", "our", "their",
  ],
};

const PROFILES: Record<string, LanguageProfile> = {
  "pt-br": PT_BR,
  "en-us": EN_US,
};

/** Resolve pelo prefixo do locale ("pt-BR"/"pt" → PT_BR) com fallback pro idioma padrão configurado — nunca lança, sempre devolve um perfil utilizável. */
export function getLanguageProfile(locale: string): LanguageProfile {
  const key = locale.toLowerCase();
  if (PROFILES[key]) return PROFILES[key];
  const byPrefix = Object.values(PROFILES).find((p) => key.startsWith(p.locale.split("-")[0].toLowerCase()));
  if (byPrefix) return byPrefix;
  return PROFILES[VOICE_CONFIG.defaultLanguage.toLowerCase()] ?? PT_BR;
}

export { PT_BR, EN_US };
