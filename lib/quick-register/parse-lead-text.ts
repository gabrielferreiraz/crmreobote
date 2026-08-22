import { ESTADOS_BR } from "@/lib/contacts/constants";
import { VALID_BRAZILIAN_DDDS } from "@/lib/phone-normalize";

/**
 * Parser de "cadastro rápido" — o consultor cola um lead em texto livre
 * (mensagem de WhatsApp encaminhada, resposta de formulário de anúncio,
 * anotação própria) e isto separa em campos de Contato/Negócio sem depender
 * de nenhum serviço externo (sem custo por chamada, sem latência de rede,
 * funciona idêntico em qualquer ambiente).
 *
 * Estratégia em 3 passos, sempre por LINHA (nunca por regex solta em cima do
 * texto inteiro) — mais fácil de acertar e de nunca perder dado:
 *
 *  1. Rótulo explícito — linha no formato "Rótulo: valor" (ex.: "Cargo:
 *     Advogado"). Reconhecido contra um dicionário fixo de sinônimos
 *     (acentuação/caixa não importam). É o caminho de maior confiança —
 *     ganha de qualquer heurística cega dos passos seguintes.
 *  2. Extração cega, só no que sobrou linha a linha — e-mail, telefone
 *     (validado por DDD real), CEP, valor em R$/"X mil"/"Xk", e
 *     cidade/estado. Cada acerto remove só o trecho casado da linha,
 *     nunca a linha inteira — o resto continua disponível pro passo 3 ou
 *     vira descrição.
 *  3. Nome, se ainda vazio — primeira linha curta que sobrou sem sinal de
 *     ser outra coisa (sem ":", sem "@", sem sequência longa de dígitos).
 *
 * Tudo que nenhum passo reivindicou vira `description` — nunca é
 * descartado. Nenhum campo é preenchido com um PALPITE arriscado: quando a
 * confiança é baixa (ex.: tipo de crédito sem rótulo explícito), o valor
 * vai em `creditTypeGuess` como sugestão, e a tela que usa isto deve deixar
 * claro que é só um chute pra revisão, nunca um valor final sem edição.
 */
export type ParsedLeadFields = {
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  value: number | null;
  /** "Valor bruto" — independente de `value` ("Valor líquido"), nunca derivado dele. Ver GROSS_VALUE_LABELS abaixo. */
  grossValue: number | null;
  /** Sugestão por palavra-chave (ex.: "carro" → "Automóvel") — a tela deve
   * casar isto contra a lista de tipos de crédito de verdade da organização
   * antes de aceitar, nunca gravar direto. */
  creditTypeGuess: string | null;
  description: string | null;
};

type TextField =
  | "name"
  | "email"
  | "whatsapp"
  | "phone"
  | "company"
  | "jobTitle"
  | "address"
  | "addressNumber"
  | "addressComplement"
  | "neighborhood"
  | "city"
  | "state"
  | "zipCode"
  | "creditTypeGuess"
  | "description";

/** Exportado pra quem for casar `creditTypeGuess`/`jobTitle` extraído contra
 * as listas reais da organização (tipos de crédito, cargos) usar o mesmo
 * critério de "é a mesma coisa" (sem acento, sem caixa) — ver
 * new-deal-dialog.tsx. */
export function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Minúsculo + acento removido SEM mudar o comprimento da string (cada
 * caractere vira exatamente um outro, nunca some) — ao contrário de
 * `normalizeLabel` (que colapsa espaço e remove pontuação, útil pra
 * comparar rótulos, mas destrói a correspondência de posição com o texto
 * original). Usado pra reconhecer um rótulo NO INÍCIO de uma linha sem
 * dois-pontos (ver matchLabelPrefix) e ainda saber exatamente onde ele
 * termina no texto de verdade, com acento/caixa originais, pra recortar o
 * valor certo.
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LABEL_ALIASES: Record<string, TextField> = {};
function registerAliases(field: TextField, ...labels: string[]) {
  for (const label of labels) LABEL_ALIASES[normalizeLabel(label)] = field;
}

// Além dos rótulos "de formulário" (nome, cargo, cidade...), registra frases
// de CONEXÃO naturais de fala — quem dita descrevendo um lead em voz alta
// não fala "Cidade:", fala "ele mora em Campo Grande". Só entram frases
// específicas o bastante pro domínio (2+ palavras, quase nunca aparecem por
// acaso numa frase qualquer) — um conectivo solto tipo "é"/"de" sozinho
// nunca vira rótulo (baixa demais a precisão, um "é"/"de" qualquer no meio
// do texto ia disparar em cima de qualquer coisa).
registerAliases("name", "nome", "nome completo", "cliente", "nome do cliente", "contato", "se chama", "chama se", "lead", "nome do lead");
registerAliases("email", "email", "e mail");
// Telefone/whatsapp NÃO entram no dicionário genérico acima — ver
// WHATSAPP_LABELS/GENERIC_PHONE_LABELS abaixo, precisam de uma regra própria.
registerAliases("company", "empresa", "nome da empresa", "local de trabalho", "razao social", "trabalha na", "trabalha na empresa");
registerAliases("jobTitle", "profissao", "cargo", "ocupacao", "funcao", "trabalha como", "atua como");
registerAliases("address", "endereco", "rua", "logradouro");
registerAliases("addressNumber", "numero", "n", "num", "nº");
registerAliases("addressComplement", "complemento", "compl");
registerAliases("neighborhood", "bairro");
registerAliases("city", "cidade", "municipio", "mora em", "reside em", "mora na cidade de");
registerAliases("state", "estado", "uf");
registerAliases("zipCode", "cep");
registerAliases(
  "creditTypeGuess",
  "tipo de credito",
  "categoria",
  "tipo do consorcio",
  "modalidade",
  "tipo",
  "quer um consorcio de",
  "consorcio de",
  "interessado em",
);
registerAliases("description", "descricao", "obs", "observacao", "observacoes", "detalhes", "mensagem", "resumo");

// "Valor" precisa de parsing numérico (R$, "mil", "k", ou por extenso — ver
// parseSpokenAmount abaixo), por isso fica fora do dicionário genérico de
// string acima. "Valor de"/"orçamento de" cobrem a frase natural de quem
// está ditando ("o valor de trezentos mil"), não só o rótulo seco.
const VALUE_LABELS = new Set(
  [
    "valor",
    "valor do credito",
    "valor do bem",
    "valor desejado",
    "valor da carta",
    "credito",
    "valor de",
    "orcamento de",
    "quer investir",
    "pretende investir",
    // "líquido" sozinho não entra — sem "valor" na frente é ambíguo demais
    // (não é palavra específica de dinheiro), diferente de "bruto" abaixo.
    "valor liquido",
  ].map(normalizeLabel),
);

// "Valor bruto" — independente de VALUE_LABELS acima (que é o líquido,
// ver Deal.grossValue no schema). Mesma extração de dinheiro
// (parseLabeledMoney, já entende "300 mil"/"R$ 300.000"/número por
// extenso), só aponta pro campo separado quando o rótulo tiver "bruto".
const GROSS_VALUE_LABELS = new Set(
  ["valor bruto", "valor bruto do credito", "valor bruto da carta", "bruto"].map(normalizeLabel),
);

// A maioria dos leads só tem UM número, e quase sempre rotulado como
// "Telefone"/"Celular" (não "WhatsApp") — mas na prática esse número quase
// sempre É o WhatsApp do cliente (mesma regra de negócio de
// lib/phone-normalize.ts's fallbackWhatsappToPhone). Por isso um rótulo
// genérico preenche `whatsapp` primeiro, e só cai pra `phone` (2º número)
// se `whatsapp` já estiver ocupado. Um rótulo EXPLICITAMENTE "WhatsApp"
// sempre garante a vaga de `whatsapp`, mesmo que um genérico tenha chegado
// primeiro — nesse caso o que já estava lá desce pra `phone`.
const WHATSAPP_LABELS = new Set(["whatsapp", "whats", "zap", "numero whatsapp", "wpp"].map(normalizeLabel));
const GENERIC_PHONE_LABELS = new Set(
  ["telefone", "tel", "fone", "celular", "cel", "telefone fixo", "fixo", "outro telefone", "telefone 2"].map(
    normalizeLabel,
  ),
);

// Junta os 4 dicionários acima numa lista só, do rótulo mais
// específico/comprido pro mais genérico (importa a ORDEM: "numero
// whatsapp" precisa ser tentado antes de "numero" sozinho, senão o mais
// curto "vence" primeiro e sobra "whatsapp" como se fosse valor). Reaproveitada
// por matchLabelPrefix logo abaixo (rótulo sem dois-pontos, ex.: texto colado
// sem formatação) e exportada pra format-dictated-lead-text.ts (que marca
// esses mesmos rótulos com ":" no texto ditado por voz) — as duas pontas
// nunca podem reconhecer rótulos diferentes um do outro.
const ALL_LABEL_ENTRIES: { normalized: string }[] = [
  ...Array.from(VALUE_LABELS, (normalized) => ({ normalized })),
  ...Array.from(GROSS_VALUE_LABELS, (normalized) => ({ normalized })),
  ...Array.from(WHATSAPP_LABELS, (normalized) => ({ normalized })),
  ...Array.from(GENERIC_PHONE_LABELS, (normalized) => ({ normalized })),
  ...Object.keys(LABEL_ALIASES).map((normalized) => ({ normalized })),
].sort((a, b) => b.normalized.length - a.normalized.length);

/** Só os textos normalizados, pro formatador de ditado (não precisa saber o campo, só onde o rótulo começa/termina). */
export const ALL_LEAD_LABELS: string[] = ALL_LABEL_ENTRIES.map((e) => e.normalized);

// Rótulo de UMA palavra só ambíguo demais pra reconhecer no MEIO de uma
// linha (só no início dela, ver matchLabelPrefix mais abaixo) — no meio de
// uma frase qualquer vira substantivo comum e fragmentaria o texto à toa
// ("o cliente quer..." não deveria virar um rótulo "cliente" solto). Mesma
// lista de format-dictated-lead-text.ts (ditado por voz corre o mesmíssimo
// risco, texto contínuo sem pontuação) — as duas pontas nunca podem
// reconhecer palavras diferentes uma da outra.
const AMBIGUOUS_MIDLINE_LABELS = new Set(
  ["cliente", "contato", "lead", "bruto", "tipo", "categoria", "credito", "fixo", "tel", "cel", "n", "num", "compl", "uf", "obs"].map(
    normalizeLabel,
  ),
);
const MIDLINE_LABEL_ENTRIES = ALL_LABEL_ENTRIES.filter((e) => !AMBIGUOUS_MIDLINE_LABELS.has(e.normalized));
const MIDLINE_LABEL_REGEX = new RegExp(
  `\\b(?:${MIDLINE_LABEL_ENTRIES.map((e) => labelToWordPattern(e.normalized)).join("|")})\\b`,
  "g",
);

/**
 * "nome gabriel ferreira celular 67981783902 valor 300k" (vários rótulos
 * colados numa linha só, sem pontuação nenhuma separando um do outro) →
 * ["nome: gabriel ferreira", "celular: 67981783902", "valor: 300k"] — o
 * Passo 1 (mais abaixo) já sabe separar rótulo:valor quando é UM por linha,
 * mas nunca soube achar um 2º/3º rótulo espremido na MESMA linha (tomava "o
 * resto da linha inteira" como valor do 1º rótulo, derrubando tudo dentro
 * de um campo só). Só entra em ação com 2+ rótulos encontrados na mesma
 * linha — uma linha com só um rótulo (a esmagadora maioria dos casos, ex.:
 * "Nome: Gabriel Medeiros" já bem formatado) sai daqui idêntica ao que
 * entrou, nunca arrisca dobrar um ":" que já existisse.
 */
function expandInlineLabels(line: string): string[] {
  const folded = foldAccents(line);
  const matches = [...folded.matchAll(MIDLINE_LABEL_REGEX)].filter((m) => m.index !== undefined);
  if (matches.length < 2) return [line];

  const result: string[] = [];
  const preamble = line.slice(0, matches[0].index!).trim();
  if (preamble) result.push(preamble);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const labelStart = m.index!;
    const labelEnd = labelStart + m[0].length;
    const segmentEnd = i + 1 < matches.length ? matches[i + 1].index! : line.length;
    const rawLabel = line.slice(labelStart, labelEnd);
    // Pula um ":" que já existisse logo depois do rótulo — sem isso, um
    // trecho já pontuado no meio de uma linha maior dobrava o ":" quando
    // reconstruído logo abaixo.
    let valueStart = labelEnd;
    const colonMatch = line.slice(labelEnd, segmentEnd).match(/^\s*:\s*/);
    if (colonMatch) valueStart += colonMatch[0].length;
    const value = line.slice(valueStart, segmentEnd).trim();
    result.push(value ? `${rawLabel}: ${value}` : `${rawLabel}:`);
  }
  return result;
}

// Campos de texto "nome próprio" — o ditado por voz sempre chega em
// minúsculo (a Web Speech API nunca devolve maiúscula/pontuação sozinha),
// então vale capitalizar antes de exibir. De propósito NÃO inclui telefone/
// whatsapp/e-mail/CEP/valor/descrição (número e frase livre não deveriam
// virar Title Case) nem estado (sigla já vem tratada à parte).
const TITLE_CASE_FIELDS = new Set<TextField>(["name", "company", "jobTitle", "address", "addressComplement", "neighborhood", "city"]);

/** Usado só por format-dictated-lead-text.ts, que precisa saber quais rótulos valem a pena capitalizar. */
export function shouldTitleCaseLabelValue(normalized: string): boolean {
  const field = LABEL_ALIASES[normalized];
  return !!field && TITLE_CASE_FIELDS.has(field);
}

function labelToWordPattern(normalized: string): string {
  return normalized.split(" ").map(escapeRegExp).join("\\s+");
}

const LABEL_PREFIX_ENTRIES = ALL_LABEL_ENTRIES.map((entry) => ({
  normalized: entry.normalized,
  regex: new RegExp(`^${labelToWordPattern(entry.normalized)}(?=\\s|$)`),
}));

/**
 * Reconhece um rótulo conhecido logo no INÍCIO da linha, mesmo sem
 * dois-pontos depois (ex.: "Nome Gabriel Medeiros", "Cidade Campo Grande
 * MS") — texto colado sem formatação, ou já reformatado pelo ditado por voz
 * (ver format-dictated-lead-text.ts), costuma vir assim. `foldedLine` já
 * precisa vir passada por `foldAccents` (preserva o comprimento, então o
 * `length` devolvido aqui recorta certo a linha ORIGINAL). Testa do rótulo
 * mais específico pro mais genérico (ver ALL_LABEL_ENTRIES).
 */
function matchLabelPrefix(foldedLine: string): { normalized: string; length: number } | null {
  for (const entry of LABEL_PREFIX_ENTRIES) {
    const m = foldedLine.match(entry.regex);
    if (m) return { normalized: entry.normalized, length: m[0].length };
  }
  return null;
}

// Pronome/artigo/conectivo que a fala natural cola nas bordas do valor de
// verdade ("ele mora em Campo Grande ELE trabalha..." — o 2º "ele" já é do
// próximo trecho, não faz parte da cidade). "lead"/"cliente" entram aqui
// (não só em AMBIGUOUS_MIDLINE_LABELS/DICTATION_SCAN_DENYLIST) porque um
// valor de campo nunca É de verdade a palavra "lead"/"cliente" sozinha —
// só sobra ali quando o qualificador de posse ("telefone DO LEAD é...")
// não foi reconhecido como rótulo composto e vazou pro início do valor.
// Removidos só das PONTAS do valor (começo/fim), nunca do meio — "Casa do
// Construtor" continua intacto. Exportado porque format-dictated-lead-text.ts
// (ditado por voz, escaneia o texto inteiro) precisa da MESMA lista — as
// duas pontas nunca podem divergir uma da outra.
const EDGE_FILLER_WORDS = new Set(["ele", "ela", "dele", "dela", "o", "a", "e", "de", "do", "da", "na", "no", "lead", "cliente"]);

export function stripEdgeFillers(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  let start = 0;
  let end = words.length;
  while (start < end && EDGE_FILLER_WORDS.has(foldAccents(words[start]))) start++;
  while (end > start && EDGE_FILLER_WORDS.has(foldAccents(words[end - 1]))) end--;
  return words.slice(start, end).join(" ");
}

/**
 * "Telefone do lead", "Cidade da lead", "Nome do cliente" — dito ou digitado
 * com esse qualificador de posse, o rótulo de verdade continua sendo só a
 * palavra da frente (telefone/cidade/nome); sem isso, cada rótulo do
 * dicionário precisaria de uma entrada duplicada só pra essa variação. Só
 * usado na COMPARAÇÃO contra o dicionário (rótulo com ":", onde o texto
 * antes dos dois-pontos já vem inteiro, sem ambiguidade de onde ele começa/
 * termina) — nunca no valor em si.
 */
function stripLeadOwnerSuffix(normalized: string): string {
  const stripped = normalized.replace(/\s+(?:d[oa]\s+)?(?:lead|cliente)\s*$/, "").trim();
  return stripped || normalized;
}

/** Texto de lead encaminhado do WhatsApp costuma vir com marcação
 * (*negrito*, _itálico_) — sem isso, "*Nome:* Erani" virava valor "* Erani"
 * (o "*" de fechamento do negrito gruda no valor, não no rótulo). */
function cleanExtractedValue(raw: string): string {
  return raw.replace(/^[*_`"'\s]+/, "").replace(/[*_`"'\s]+$/, "").trim();
}

// Formulário de Lead Ads (Meta/Facebook/Instagram) encaminhado do WhatsApp
// tem um padrão bem definido: marcador de lista + pergunta em negrito
// terminando em "?", resposta na linha logo abaixo. Reconhecer isso
// separa pergunta de resposta (em vez de as duas virarem uma linha só de
// "descrição" cheia de "•"/"*" soltos) e permite ligar a resposta de uma
// pergunta sobre valor direto ao campo `value`.
function tryParseQuestionLine(line: string): string | null {
  let text = line;
  text = text.replace(/^([•▪●]|\d+[.)]|-)\s*/, "");
  text = text.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  if (!text.endsWith("?")) return null;
  if (text.length < 4 || text.length > 150) return null;
  return text;
}

function isValueQuestion(question: string): boolean {
  const normalized = normalizeLabel(question);
  return /\b(valor|credito|quanto|orcamento)\b/.test(normalized);
}

const STREET_PREFIX_REGEX =
  /^(rua|av\.?|avenida|alameda|al\.|travessa|rodovia|rod\.|estrada|pra[cç]a)\s+\S/i;

const EMAIL_REGEX = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/i;
const CEP_REGEX = /\b\d{5}-\d{3}\b/;

// DDD (2 dígitos válidos) + celular/fixo (8 ou 9 dígitos) — separadores
// opcionais (espaço, ponto, traço), "+55"/"55" opcional na frente. A
// validação de DDD real (VALID_BRAZILIAN_DDDS) é o que evita casar CEP,
// datas ou qualquer sequência de dígitos que só por acaso tenha esse formato.
const PHONE_REGEX = /(?:\+?55[\s.-]?)?\(?(\d{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/g;

function findPhones(line: string): { text: string; ddd: string }[] {
  const found: { text: string; ddd: string }[] = [];
  const collect = (source: string) => {
    for (const m of source.matchAll(PHONE_REGEX)) {
      const ddd = m[1];
      if (!VALID_BRAZILIAN_DDDS.has(ddd)) continue;
      const digits = ddd + m[2] + m[3];
      if (digits.length !== 10 && digits.length !== 11) continue;
      found.push({ text: m[0], ddd });
    }
  };
  collect(line);
  if (found.length === 0) {
    // Nenhum dígito já escrito — tenta número por extenso (ditado de voz às
    // vezes sai "sessenta e sete..." em vez de "67...", ver
    // spokenNumberWordsToDigits mais abaixo). Só como último recurso: o
    // texto convertido não existe literalmente na linha original, então o
    // trecho aqui não é removido do residual depois em parseLeadText — pode
    // sobrar (inofensivo) em `description`, mesmo raciocínio de "nunca
    // descarta, só nem sempre reivindica com 100% de precisão" que o resto
    // deste arquivo já usa.
    const digitized = spokenNumberWordsToDigits(line);
    if (digitized !== line) collect(digitized);
  }
  return found;
}

function parseBrazilianNumber(digitsAndSeparators: string): number | null {
  const n = parseFloat(digitsAndSeparators.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Número por EXTENSO em português ("trezentos mil", "um milhão e duzentos
// mil") — ditado por voz descrevendo um valor quase nunca sai em dígito
// ("trezentos mil", não "300000" nem "300 mil"), diferente de texto
// digitado/colado. Cobre só a faixa que interessa pra valor de consórcio
// (unidades até centenas de milhão) — não tenta ser um conversor de número
// por extenso genérico e completo.
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
function parseSpokenAmount(text: string): number | null {
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
 * somado a mais nada). Reaproveita SPOKEN_NUMBER_UNITS (mesmo dicionário do
 * dinheiro) — só entende 0-99, faixa que aparece de verdade lendo telefone
 * em voz alta ("mil"/"milhão"/centena nunca aparecem lendo dígito a dígito,
 * por isso ficam de fora aqui). Palavra não reconhecida passa direto, sem
 * quebrar o resto do texto — usado só como pré-processamento antes de
 * rodar PHONE_REGEX (ver findPhones).
 */
function spokenNumberWordsToDigits(text: string): string {
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

/** Sobra de telefone por extenso não convertido (ver findPhones) não devia
 * virar nome por acidente no Passo 3 — se a maior parte das palavras da
 * linha é número por extenso reconhecido (ou o conectivo "e" entre elas),
 * não é candidato a nome de pessoa. */
function isMostlySpokenNumbers(text: string): boolean {
  const words = foldAccents(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const numberish = words.filter((w) => {
    const raw = w.replace(/[^a-z]/g, "");
    return raw === "e" || raw in SPOKEN_NUMBER_UNITS;
  }).length;
  return numberish / words.length >= 0.6;
}

/** Valor vindo de um rótulo explícito ("Valor: 80000") — mais tolerante,
 * porque o rótulo já garante que é dinheiro (não precisa de R$/separador
 * de milhar pra confiar). */
function parseLabeledMoney(raw: string): number | null {
  const cleaned = raw.replace(/r\$/i, "").trim();
  // Sem "^...$" (não exige que "mil"/"k" seja a string INTEIRA) — "crédito"
  // é ambíguo demais pra contar como rótulo no meio de uma linha (ver
  // AMBIGUOUS_MIDLINE_LABELS), então "valor crédito 300mil" chega aqui
  // ainda com "crédito " grudado na frente; exigir o número bem no início
  // fazia o padrão nunca casar, cair no fallback de dígitos crus e perder o
  // "mil" junto (virava 300, não 300000). Mesmo padrão (sem âncora) que
  // tryExtractMoney já usa pro valor SEM rótulo nenhum.
  const mil = cleaned.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if (mil) return parseFloat(mil[1].replace(",", ".")) * 1000;
  const k = cleaned.match(/(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (k) return parseFloat(k[1].replace(",", ".")) * 1000;
  if (/\d/.test(cleaned)) {
    const parsed = parseBrazilianNumber(cleaned.replace(/[^\d.,]/g, ""));
    if (parsed !== null) return parsed;
  }
  // Sem dígito nenhum — tenta por extenso (ditado por voz).
  return parseSpokenAmount(cleaned);
}

/** Valor "solto" no meio de uma frase sem rótulo nenhum — aqui sim precisa
 * de um marcador forte (R$, "mil", "k", ou separador de milhar) pra não
 * confundir um número qualquer (telefone, data, quantidade) com dinheiro. */
function tryExtractMoney(line: string): { text: string; amount: number } | null {
  let m = line.match(/\b(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if (m) return { text: m[0], amount: parseFloat(m[1].replace(",", ".")) * 1000 };

  m = line.match(/\b(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (m) return { text: m[0], amount: parseFloat(m[1].replace(",", ".")) * 1000 };

  m = line.match(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/i);
  if (m) {
    const amount = parseBrazilianNumber(m[1]);
    if (amount !== null) return { text: m[0], amount };
  }

  m = line.match(/\b\d{1,3}(?:\.\d{3})+(?:,\d{2})?\b/);
  if (m) {
    const amount = parseBrazilianNumber(m[0]);
    if (amount !== null) return { text: m[0], amount };
  }

  return null;
}

const UF_CODES = new Set<string>(ESTADOS_BR.map((s) => s.value));

/**
 * "Campo Grande MS", "Campo Grande/MS", "Campo Grande - MS" → { city:
 * "Campo Grande", state: "MS" } — pro valor de um campo já rotulado como
 * Cidade (rótulo explícito com/sem dois-pontos, ou vindo do ditado por voz),
 * que pode trazer a UF grudada de qualquer um desses jeitos (ditado por voz
 * só separa por espaço; texto colado às vezes usa "/", "-" ou ","). Exige
 * pelo menos um separador de verdade antes da sigla (espaço OU pontuação) —
 * nunca as duas letras finais coladas sem nada no meio, senão qualquer nome
 * de cidade terminado por acaso em duas letras maiúsculas arriscaria virar
 * "cidade cortada + UF" à toa. Case-insensitive porque ditado por voz vem
 * tudo em minúsculo ("campo grande ms").
 */
function splitTrailingState(value: string): { city: string; state: string | null } {
  const m = value.match(/^(.*\S)[\s/,-]+([A-Za-z]{2})$/);
  if (m) {
    const uf = m[2].toUpperCase();
    if (UF_CODES.has(uf)) return { city: m[1].trim(), state: uf };
  }
  return { city: value, state: null };
}

// Construído a partir do nome ACENTUADO de cada estado, casado contra a
// linha original (não contra uma versão sem acento) — de propósito: "Pará"
// sem o acento vira "para", uma preposição comum demais pra arriscar casar
// às cegas. Só reconhece o nome do estado quando escrito com o acento
// certo; sem acento, ainda dá pra pegar pela sigla (UF_TOKEN_REGEX abaixo).
const STATE_NAME_REGEXES = ESTADOS_BR.map((s) => ({
  uf: s.value,
  regex: new RegExp(`\\b${s.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
}));

// "Cidade/UF", "Cidade - UF", "Cidade, UF" — o formato mais comum de
// escrever cidade+estado junto numa linha só. Casa os dois de uma vez pra
// poder remover o trecho inteiro sem matemática de posição.
// Cada "palavra" da cidade precisa começar com maiúscula (nome próprio de
// verdade) — sem essa exigência, o grupo greedy engolia a frase inteira
// antes da cidade (ex.: "moro em Campo Grande/MS" virava cidade "moro em
// Campo Grande" em vez de só "Campo Grande", já que palavras de ligação em
// minúsculo também cabem numa classe [A-Za-z\s] genérica).
const CITY_STATE_REGEX = /((?:[A-ZÀ-Ö][a-zà-ÿ]*\s?){1,4})\s*[/,-]\s*([A-Z]{2})\b/;

// Sigla solta (ex.: "SP" no fim da linha) — exige caixa alta exata e
// fronteira de separador/espaço dos dois lados, senão qualquer palavra de
// 2 letras maiúsculas por acaso (sigla de outra coisa) viraria estado.
const UF_TOKEN_REGEX = /(^|[\s,/-])([A-Z]{2})(?=$|[\s,/-])/g;

const CREDIT_TYPE_KEYWORDS: { guess: string; words: string[] }[] = [
  { guess: "Imóvel", words: ["imovel", "imoveis", "casa", "apartamento", "terreno"] },
  { guess: "Automóvel", words: ["carro", "automovel", "veiculo", "auto"] },
  { guess: "Moto", words: ["moto", "motocicleta"] },
  { guess: "Caminhão", words: ["caminhao", "pesados", "trator", "maquinario"] },
  { guess: "Serviços", words: ["servico", "servicos", "viagem", "curso"] },
];

/**
 * Aplica um rótulo já reconhecido (com dois-pontos OU pelo prefixo sem
 * dois-pontos, ver matchLabelPrefix) — mesma lógica pros dois casos,
 * extraída pra nunca desalinhar um do outro. `whatsappState` é mutável
 * (objeto, não booleano solto) porque precisa persistir entre chamadas do
 * Passo 1 pra várias linhas da mesma tarefa. Devolve `true` quando o valor
 * foi de fato aceito (a linha pode ser anulada pra não sobrar na descrição).
 */
function applyLabel(
  normalized: string,
  value: string,
  fields: ParsedLeadFields,
  whatsappState: { explicit: boolean },
): boolean {
  if (VALUE_LABELS.has(normalized) && fields.value === null) {
    const parsed = parseLabeledMoney(value);
    if (parsed !== null) {
      fields.value = parsed;
      return true;
    }
  }

  if (GROSS_VALUE_LABELS.has(normalized) && fields.grossValue === null) {
    const parsed = parseLabeledMoney(value);
    if (parsed !== null) {
      fields.grossValue = parsed;
      return true;
    }
  }

  if (WHATSAPP_LABELS.has(normalized)) {
    // Número por extenso ("sessenta e sete nove nove...") vira dígito antes
    // de gravar — sem isso, um rótulo explícito ("WhatsApp: sessenta e
    // sete...") gravava o texto por extenso cru no campo, sem chance
    // nenhuma de virar telefone de verdade depois (esse caminho não passa
    // por findPhones/PHONE_REGEX, confia direto no rótulo).
    const digitizedValue = spokenNumberWordsToDigits(value);
    if (fields.whatsapp !== null && !whatsappState.explicit && fields.phone === null) {
      fields.phone = fields.whatsapp;
    }
    fields.whatsapp = digitizedValue;
    whatsappState.explicit = true;
    return true;
  }
  if (GENERIC_PHONE_LABELS.has(normalized)) {
    const digitizedValue = spokenNumberWordsToDigits(value);
    if (fields.whatsapp === null) fields.whatsapp = digitizedValue;
    else if (fields.phone === null) fields.phone = digitizedValue;
    return true;
  }

  const field = LABEL_ALIASES[normalized];
  if (field && fields[field] === null) {
    // Cidade rotulada às vezes vem com a UF grudada só por espaço ("Cidade
    // Campo Grande MS") — sem separador de pontuação, CITY_STATE_REGEX (Passo
    // 2, pra texto sem rótulo) não pega; aqui já se sabe que é cidade, então
    // vale a pena tentar separar antes de aceitar o valor cru.
    if (field === "city") {
      const split = splitTrailingState(value);
      fields.city = split.city;
      if (split.state && fields.state === null) fields.state = split.state;
    } else {
      fields[field] = value;
    }
    return true;
  }

  return false;
}

export function parseLeadText(raw: string): ParsedLeadFields {
  const fields: ParsedLeadFields = {
    name: null,
    email: null,
    whatsapp: null,
    phone: null,
    company: null,
    jobTitle: null,
    address: null,
    addressNumber: null,
    addressComplement: null,
    neighborhood: null,
    city: null,
    state: null,
    zipCode: null,
    value: null,
    grossValue: null,
    creditTypeGuess: null,
    description: null,
  };

  const rawLines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap(expandInlineLabels);
  // `null` = linha inteira já reivindicada por um campo estruturado (some da
  // descrição); string = o que sobrou dela até agora, disputado pelos
  // passos seguintes.
  const residuals: (string | null)[] = [...rawLines];
  // Linhas que o Passo 0 (pergunta/resposta) já tratou — o Passo 1 nunca
  // reprocessa (a linha pode já ter sido reescrita/limpa em `residuals`).
  const qaClaimed = new Array<boolean>(rawLines.length).fill(false);

  // Passo 0 — pergunta/resposta de formulário de Lead Ads (marcador de
  // lista + "Pergunta em negrito?" seguida da resposta na linha de baixo).
  for (let i = 0; i < rawLines.length; i++) {
    const question = tryParseQuestionLine(rawLines[i]);
    if (!question) continue;
    const answerLine = rawLines[i + 1];
    if (!answerLine) continue;
    const answer = cleanExtractedValue(answerLine);
    if (!answer) continue;

    if (fields.value === null && isValueQuestion(question)) {
      const money = tryExtractMoney(answer);
      if (money) fields.value = money.amount;
    }

    residuals[i] = question;
    residuals[i + 1] = answer;
    qaClaimed[i] = true;
    qaClaimed[i + 1] = true;
    i++; // a linha de resposta já foi consumida, não é outra pergunta
  }

  // Passo 1 — rótulo explícito, COM dois-pontos ("Rótulo: valor") ou SEM
  // (ex.: "Nome Gabriel Medeiros" — texto colado sem formatação, ou já
  // reescrito pelo ditado por voz, ver format-dictated-lead-text.ts) + endereço
  // sem rótulo.
  const whatsappState = { explicit: false };
  for (let i = 0; i < rawLines.length; i++) {
    if (qaClaimed[i]) continue;
    const line = rawLines[i];
    let consumed = false;

    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx <= 40) {
      const value = stripEdgeFillers(cleanExtractedValue(line.slice(colonIdx + 1)));
      const normalized = stripLeadOwnerSuffix(normalizeLabel(line.slice(0, colonIdx)));
      if (value) consumed = applyLabel(normalized, value, fields, whatsappState);
    }

    if (!consumed) {
      const prefix = matchLabelPrefix(foldAccents(line));
      if (prefix) {
        // stripEdgeFillers aqui é o que evita "Lead é Fulano de Tal" (rótulo
        // "lead" reconhecido só pelo PREFIXO da linha, não pelo escaneamento
        // de format-dictated-lead-text.ts) virar valor "e Fulano de Tal" —
        // o "é"/"e" que sobra logo depois do rótulo nunca é o dado de
        // verdade.
        const value = stripEdgeFillers(cleanExtractedValue(line.slice(prefix.length)));
        if (value) consumed = applyLabel(prefix.normalized, value, fields, whatsappState);
      }
    }

    if (consumed) {
      residuals[i] = null;
      continue;
    }

    if (fields.address === null && STREET_PREFIX_REGEX.test(line)) {
      fields.address = cleanExtractedValue(line);
      residuals[i] = null;
    }
  }

  // Passo 2 — extração cega, só no que sobrou de cada linha.
  let phonesFound = 0;
  for (let i = 0; i < residuals.length; i++) {
    let text = residuals[i];
    if (text === null) continue;

    if (fields.email === null) {
      const m = text.match(EMAIL_REGEX);
      if (m) {
        fields.email = m[0];
        text = text.replace(m[0], " ");
      }
    }

    if (fields.zipCode === null) {
      const m = text.match(CEP_REGEX);
      if (m) {
        fields.zipCode = m[0];
        text = text.replace(m[0], " ");
      }
    }

    for (const phone of findPhones(text)) {
      if (phonesFound === 0 && fields.whatsapp === null) {
        fields.whatsapp = phone.text.trim();
        text = text.replace(phone.text, " ");
        phonesFound++;
      } else if (phonesFound === 1 && fields.phone === null) {
        fields.phone = phone.text.trim();
        text = text.replace(phone.text, " ");
        phonesFound++;
      }
    }

    if (fields.value === null) {
      const money = tryExtractMoney(text);
      if (money) {
        fields.value = money.amount;
        text = text.replace(money.text, " ");
      }
    }

    if (fields.state === null) {
      const textAtThisPoint = text;
      const cityState = textAtThisPoint.match(CITY_STATE_REGEX);
      if (cityState && UF_CODES.has(cityState[2])) {
        fields.state = cityState[2];
        if (fields.city === null) fields.city = cityState[1].trim();
        text = textAtThisPoint.replace(cityState[0], " ");
      } else {
        const byName = STATE_NAME_REGEXES.find(({ regex }) => regex.test(textAtThisPoint));
        if (byName) {
          fields.state = byName.uf;
          text = textAtThisPoint.replace(byName.regex, " ");
        } else {
          const byToken = [...textAtThisPoint.matchAll(UF_TOKEN_REGEX)].find((m) => UF_CODES.has(m[2]));
          if (byToken) {
            fields.state = byToken[2];
            text = textAtThisPoint.replace(byToken[0], byToken[1]);
          }
        }
      }
    }

    residuals[i] =
      text
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;])/g, "$1")
        .replace(/[,;]\s*$/, "")
        .trim() || null;
  }

  // Passo 3 — nome, só se ainda vazio: primeira linha curta sem sinal de
  // ser outra coisa (rótulo não reconhecido ainda tem ":", por exemplo).
  if (fields.name === null) {
    for (let i = 0; i < residuals.length; i++) {
      const text = residuals[i];
      if (!text) continue;
      if (text.length < 2 || text.length > 60) continue;
      if (/[@:]/.test(text)) continue;
      if (/\d{4,}/.test(text)) continue;
      // Sobra de telefone por extenso não convertido (ver findPhones/
      // spokenNumberWordsToDigits) não é nome de pessoa — se quase toda
      // palavra da linha é número por extenso reconhecido, não é candidato.
      if (isMostlySpokenNumbers(text)) continue;
      fields.name = text;
      residuals[i] = null;
      break;
    }
  }

  if (fields.creditTypeGuess === null) {
    const haystack = normalizeLabel(residuals.filter((r): r is string => !!r).join(" "));
    const match = CREDIT_TYPE_KEYWORDS.find(({ words }) => words.some((w) => haystack.includes(w)));
    if (match) fields.creditTypeGuess = match.guess;
  }

  // Junta ao que sobrou de tudo que ninguém reivindicou — NUNCA substitui um
  // valor que o Passo 1 já tiver posto aqui via rótulo explícito ("Descrição:
  // ..."/"Obs: ..."/ditado). Sem essa checagem, uma descrição rotulada corretamente
  // era descartada em silêncio sempre que todas as outras linhas também
  // tivessem sido reivindicadas por outro campo (residuals ficava vazio, e o
  // valor já certo em fields.description virava null de novo).
  const leftover = residuals.filter((r): r is string => !!r).join("\n").trim();
  if (leftover) {
    fields.description = fields.description ? `${fields.description}\n${leftover}` : leftover;
  }

  return fields;
}
