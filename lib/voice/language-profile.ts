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
  questionOpeners: ["pode", "poderia", "tem como", "voce consegue", "sera que", "consegue"],
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
};

const EN_US: LanguageProfile = {
  locale: "en-US",
  speechLocale: "en-US",
  questionWords: ["who", "what", "which", "when", "where", "how", "why", "how much", "how many"],
  indirectQuestionMarkers: ["i dont know", "not sure", "no idea"],
  questionOpeners: ["can you", "could you", "would you", "is there a way"],
  sentenceConnectors: [
    { word: "but", punctuation: ",", scoreBonus: 3 },
    { word: "however", punctuation: ",", scoreBonus: 3 },
    { word: "so", punctuation: ",", scoreBonus: 2 },
    { word: "therefore", punctuation: ",", scoreBonus: 2 },
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
