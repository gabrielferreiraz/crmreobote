/**
 * Número por extenso em português falado — movido de
 * lib/quick-register/parse-lead-text.ts pra cá sem mudar comportamento
 * (mesmas funções, mesmos dicionários), porque o pipeline de prosa do
 * ditado também precisa reconhecer número falado (ex.: pra proteger "CRM"
 * de virar "cê erre eme", ou pra uma normalização futura mais agressiva
 * que hoje é deliberadamente conservadora — ver pipeline.ts). parse-lead-
 * text.ts importa e reexporta `foldAccents` daqui em vez de manter sua
 * própria cópia.
 *
 * Cobre só a faixa que interessa pra valor de consórcio/telefone (unidades
 * até centenas de milhão) — não tenta ser um conversor de número por
 * extenso genérico e completo.
 */

/**
 * Minúsculo + acento removido SEM mudar o comprimento da string (cada
 * caractere vira exatamente um outro, nunca some) — importante pra quem
 * recorta a string ORIGINAL usando índice calculado em cima da versão
 * dobrada (ver matchLabelPrefix em parse-lead-text.ts).
 */
export function foldAccents(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áàãâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòõôö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/ç/g, "c");
}

const SPOKEN_NUMBER_UNITS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  trezentos: 300,
  quatrocentos: 400,
  quinhentos: 500,
  seiscentos: 600,
  setecentos: 700,
  oitocentos: 800,
  novecentos: 900,
};
const SPOKEN_NUMBER_SCALES: Record<string, number> = { mil: 1_000, milhao: 1_000_000, milhoes: 1_000_000 };
// Palavras que só conectam ("trezentos E cinquenta mil", "valor DE trezentos
// mil") — ignoradas na soma, nunca interrompem o reconhecimento.
const SPOKEN_NUMBER_CONNECTORS = new Set(["e", "de"]);

/**
 * "trezentos mil" → 300000, "um milhão e duzentos mil" → 1200000. Para no
 * primeiro token desconhecido DEPOIS de já ter reconhecido algo (ex.: "oitenta
 * mil reais" — "reais" encerra sem quebrar o que já foi lido); devolve null
 * se a primeira palavra já não for número nenhum.
 */
export function parseSpokenAmount(text: string): number | null {
  const words = foldAccents(text)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !SPOKEN_NUMBER_CONNECTORS.has(w));
  if (words.length === 0) return null;

  let total = 0;
  let current = 0;
  let matchedAny = false;
  for (const word of words) {
    if (word in SPOKEN_NUMBER_UNITS) {
      current += SPOKEN_NUMBER_UNITS[word];
      matchedAny = true;
    } else if (word in SPOKEN_NUMBER_SCALES) {
      total += (current === 0 ? 1 : current) * SPOKEN_NUMBER_SCALES[word];
      current = 0;
      matchedAny = true;
    } else if (matchedAny) {
      break; // palavra desconhecida depois de já ter achado número (ex. "reais") — só encerra, não invalida.
    } else {
      return null; // nem a 1ª palavra é número — não é um valor por extenso.
    }
  }
  total += current;
  return total > 0 ? total : null;
}

/**
 * Converte número por extenso em português pra dígito, palavra a palavra —
 * ao contrário de parseSpokenAmount acima (que SOMA tudo numa magnitude só,
 * pra dinheiro), aqui cada trecho vira o(s) DÍGITO(s) dele mesmo,
 * concatenados: telefone é uma SEQUÊNCIA de dígitos, nunca uma soma
 * ("sessenta e sete" no DDD são os dígitos "6" e "7", não o número 67
 * somado a mais nada). Só entende 0-99, faixa que aparece de verdade lendo
 * telefone em voz alta ("mil"/"milhão"/centena nunca aparecem lendo dígito
 * a dígito, por isso ficam de fora aqui). Palavra não reconhecida passa
 * direto, sem quebrar o resto do texto.
 */
export function spokenNumberWordsToDigits(text: string): string {
  const words = foldAccents(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let buffer = "";
  const flushBuffer = () => {
    if (buffer) {
      out.push(buffer);
      buffer = "";
    }
  };

  let i = 0;
  while (i < words.length) {
    const raw = words[i].replace(/[^a-z]/g, "");
    const value = SPOKEN_NUMBER_UNITS[raw];
    if (value === undefined || value >= 100) {
      flushBuffer();
      out.push(words[i]);
      i += 1;
      continue;
    }
    if (value >= 20 && value <= 90 && value % 10 === 0) {
      // Dezena "redonda" (vinte, trinta... noventa) — tenta juntar com "E
      // unidade" seguinte (ex.: "sessenta e sete" -> 67); senão fica só ela.
      const conn = words[i + 1]?.replace(/[^a-z]/g, "");
      const nextRaw = words[i + 2]?.replace(/[^a-z]/g, "");
      const nextValue = nextRaw !== undefined ? SPOKEN_NUMBER_UNITS[nextRaw] : undefined;
      if (conn === "e" && nextValue !== undefined && nextValue < 10) {
        buffer += String(value + nextValue);
        i += 3;
        continue;
      }
      buffer += String(value);
      i += 1;
      continue;
    }
    // Unidade (0-9) ou dezena "irregular" já com 2 dígitos próprios (10-19).
    buffer += String(value);
    i += 1;
  }
  flushBuffer();
  return out.join(" ");
}

/** Sobra de telefone por extenso não convertido não devia virar nome/
 * conteúdo por acidente — se a maior parte das palavras do texto é número
 * por extenso reconhecido (ou o conectivo "e" entre elas), não é candidato
 * a texto de verdade. */
export function isMostlySpokenNumbers(text: string): boolean {
  const words = foldAccents(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const numberish = words.filter((w) => {
    const raw = w.replace(/[^a-z]/g, "");
    return raw === "e" || raw in SPOKEN_NUMBER_UNITS;
  }).length;
  return numberish / words.length >= 0.6;
}
