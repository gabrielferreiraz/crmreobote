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

const LABEL_ALIASES: Record<string, TextField> = {};
function registerAliases(field: TextField, ...labels: string[]) {
  for (const label of labels) LABEL_ALIASES[normalizeLabel(label)] = field;
}

registerAliases("name", "nome", "nome completo", "cliente", "nome do cliente", "contato");
registerAliases("email", "email", "e mail");
// Telefone/whatsapp NÃO entram no dicionário genérico acima — ver
// WHATSAPP_LABELS/GENERIC_PHONE_LABELS abaixo, precisam de uma regra própria.
registerAliases("company", "empresa", "nome da empresa", "local de trabalho", "razao social");
registerAliases("jobTitle", "profissao", "cargo", "ocupacao", "funcao");
registerAliases("address", "endereco", "rua", "logradouro");
registerAliases("addressNumber", "numero", "n", "num", "nº");
registerAliases("addressComplement", "complemento", "compl");
registerAliases("neighborhood", "bairro");
registerAliases("city", "cidade", "municipio");
registerAliases("state", "estado", "uf");
registerAliases("zipCode", "cep");
registerAliases("creditTypeGuess", "tipo de credito", "categoria", "tipo do consorcio", "modalidade", "tipo");
registerAliases("description", "descricao", "obs", "observacao", "observacoes", "detalhes", "mensagem", "resumo");

// "Valor" precisa de parsing numérico (R$, "mil", "k"), por isso fica fora
// do dicionário genérico de string acima.
const VALUE_LABELS = new Set(
  ["valor", "valor do credito", "valor do bem", "valor desejado", "valor da carta", "credito"].map(normalizeLabel),
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
  for (const m of line.matchAll(PHONE_REGEX)) {
    const ddd = m[1];
    if (!VALID_BRAZILIAN_DDDS.has(ddd)) continue;
    const digits = ddd + m[2] + m[3];
    if (digits.length !== 10 && digits.length !== 11) continue;
    found.push({ text: m[0], ddd });
  }
  return found;
}

function parseBrazilianNumber(digitsAndSeparators: string): number | null {
  const n = parseFloat(digitsAndSeparators.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Valor vindo de um rótulo explícito ("Valor: 80000") — mais tolerante,
 * porque o rótulo já garante que é dinheiro (não precisa de R$/separador
 * de milhar pra confiar). */
function parseLabeledMoney(raw: string): number | null {
  const cleaned = raw.replace(/r\$/i, "").trim();
  const mil = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*mil$/i);
  if (mil) return parseFloat(mil[1].replace(",", ".")) * 1000;
  const k = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*k$/i);
  if (k) return parseFloat(k[1].replace(",", ".")) * 1000;
  if (!/\d/.test(cleaned)) return null;
  return parseBrazilianNumber(cleaned.replace(/[^\d.,]/g, ""));
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
    creditTypeGuess: null,
    description: null,
  };

  const rawLines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

  // Passo 1 — rótulo explícito ("Rótulo: valor") + endereço sem rótulo.
  let whatsappIsExplicit = false;
  for (let i = 0; i < rawLines.length; i++) {
    if (qaClaimed[i]) continue;
    const line = rawLines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx <= 40) {
      const value = cleanExtractedValue(line.slice(colonIdx + 1));
      const normalized = normalizeLabel(line.slice(0, colonIdx));
      if (value) {
        if (VALUE_LABELS.has(normalized) && fields.value === null) {
          const parsed = parseLabeledMoney(value);
          if (parsed !== null) {
            fields.value = parsed;
            residuals[i] = null;
            continue;
          }
        }

        if (WHATSAPP_LABELS.has(normalized)) {
          if (fields.whatsapp !== null && !whatsappIsExplicit && fields.phone === null) {
            fields.phone = fields.whatsapp;
          }
          fields.whatsapp = value;
          whatsappIsExplicit = true;
          residuals[i] = null;
          continue;
        }
        if (GENERIC_PHONE_LABELS.has(normalized)) {
          if (fields.whatsapp === null) fields.whatsapp = value;
          else if (fields.phone === null) fields.phone = value;
          residuals[i] = null;
          continue;
        }

        const field = LABEL_ALIASES[normalized];
        if (field && fields[field] === null) {
          fields[field] = value;
          residuals[i] = null;
          continue;
        }
      }
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

  const description = residuals.filter((r): r is string => !!r).join("\n").trim();
  fields.description = description || null;

  return fields;
}
