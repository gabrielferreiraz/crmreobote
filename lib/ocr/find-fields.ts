import { isValidCnpj, formatCnpj } from "@/lib/cnpj";
import { isValidCpf, formatCpf } from "@/lib/cpf";
import { detectDocumentType, type DocumentTypeId } from "@/lib/ocr/document-type";
import { findBoleto } from "@/lib/ocr/boleto";
import { findPaymentFields } from "@/lib/ocr/payment-fields";
import { parseCompetence, parseMoney, parseNumberRange } from "@/lib/ocr/parsers";
import type { ReadLine } from "@/lib/ocr/quality";

/**
 * Procura dados conhecidos no texto lido de um documento (RG, CNH, carteiras profissionais,
 * comprovantes): nome, filiação, CPF, CNPJ, RG, datas, CRM/UF, CEP, e-mail…
 *
 * Como acerta sem IA:
 *  - CPF e CNPJ só aparecem se passarem na conta dos dígitos verificadores; quando falham,
 *    desfaz as trocas comuns do OCR (O↔0, I/l↔1, S↔5, B↔8…) só dentro do trecho com cara de número.
 *  - Datas só aparecem se forem datas reais.
 *  - Campos com rótulo ("NOME", "FILIAÇÃO", "DATA DE NASCIMENTO"…) são achados mesmo com letras
 *    erradas no rótulo (tolera 1–2 erros) e o valor é procurado ao lado ou logo abaixo, usando a
 *    posição das linhas na imagem. Cada valor passa por uma checagem do seu tipo (nome parece
 *    nome, data é data, RG parece RG).
 */

export type FoundField = { key: string; label: string; value: string };

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = up;
    }
  }
  return prev[b.length];
}

/** Número no meio de letras num rótulo é quase sempre letra lida errado ("N0ME", "DATA DE NASCIMENT0"). */
const lettersFromDigits = (token: string) => (/[A-Z]/.test(token) && /\d/.test(token) ? token.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B").replace(/2/g, "Z") : token);

function tokenEquals(rawToken: string, expected: string): boolean {
  const token = lettersFromDigits(rawToken);
  if (token === expected) return true;
  if (expected.length >= 8) return levenshtein(token, expected) <= 2;
  if (expected.length >= 5) return levenshtein(token, expected) <= 1;
  return false;
}

type Flat = { norm: string; rawIndex: number };

/** Se a linha COMEÇA com o rótulo (tolerando erros de OCR), devolve o que vem depois dele. */
function matchLabel(text: string, labels: string[]): { rest: string } | null {
  const raw = text.split(/\s+/).filter(Boolean);
  const flat: Flat[] = [];
  raw.forEach((token, rawIndex) => {
    for (const part of norm(token).split(" ").filter(Boolean)) flat.push({ norm: part, rawIndex });
  });
  for (const label of labels) {
    const want = label.split(" ");
    // tolera 1 sinal solto antes do rótulo ("| NOME", "O NOME")
    for (const skip of [0, 1]) {
      if (skip === 1 && !(flat[0] && flat[0].norm.length <= 2 && flat.length > want.length)) continue;
      if (flat.length < want.length + skip) continue;
      if (want.every((w, i) => tokenEquals(flat[i + skip].norm, w))) {
        const last = flat[want.length + skip - 1];
        return { rest: raw.slice(last.rawIndex + 1).join(" ").trim() };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validadores por tipo
// ---------------------------------------------------------------------------

const NOT_A_NAME = new Set(
  (
    "NOME FILIACAO CRM UF DATA VIA REPUBLICA FEDERATIVA BRASIL CONSELHO CEDULA IDENTIDADE ASSINATURA PORTADOR HABILITACAO REGISTRO NACIONAL CARTEIRA " +
    "MINISTERIO SECRETARIA VALIDADE NASCIMENTO NATURALIDADE EMISSAO EXPEDICAO ORGAO EMISSOR DOCUMENTO CPF RG CNH CATEGORIA OBSERVACOES LOCAL ESTADO " +
    "MEDICINA MEDICO REGIONAL FEDERAL INSCRICAO TRANSITO DEPARTAMENTO DETRAN PREFEITURA GOVERNO SEGURANCA PUBLICA POLICIA CIVIL VALIDA TERRITORIO " +
    "BENEFICIARIO PAGADOR VENCIMENTO VALOR TOTAL SALARIO LIQUIDO CONTRACHEQUE HOLERITE BOLETO CONSORCIO GRUPO COTA ASSEMBLEIA ADMINISTRADORA CLIENTE TITULAR ENDERECO LOGRADOURO BAIRRO CIDADE MUNICIPIO COMPETENCIA EMPRESA EMPREGADOR CARGO FUNCAO ADMISSAO MATRICULA " +
    "CADASTRO PESSOAS FISICAS JURIDICA RECEITA FAZENDA NUMERO SITUACAO CERTIDAO PASSAPORTE LUZ ENERGIA FATURA CONSUMIDORA " +
    "TITULO ELEITOR SECAO ZONA PROVA PRESIDENTE LEI EFEITO ACORDO QUALQUER GROSSO SUL NORTE LESTE OESTE MATO GOIAS PARANA MINAS GERAIS SESP SSP DETRAN CBM BOMBEIROS MILITAR EXERCITO MARINHA AERONAUTICA"
  ).split(" "),
);
const NAME_PARTICLES = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

/** Tira sinais e letras soltas das pontas e devolve o nome, ou null se não parece nome de pessoa. */
export function cleanName(raw: string): string | null {
  const tokens = raw
    .replace(/[|“”"‘’`´·•—–_:;,~*+=<>[\]{}()\\/]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length && tokens[0].replace(/[.'-]/g, "").length < 2 && !NAME_PARTICLES.has(norm(tokens[0]))) tokens.shift();
  while (tokens.length && tokens[tokens.length - 1].replace(/[.'-]/g, "").length < 2 && !NAME_PARTICLES.has(norm(tokens[tokens.length - 1]))) tokens.pop();
  if (tokens.length < 2 || tokens.length > 9) return null;
  const value = tokens.join(" ");
  if (/\d/.test(value) || !/^[\p{L}][\p{L}'’.\- ]+$/u.test(value)) return null;
  const real = tokens.filter((t) => !NAME_PARTICLES.has(norm(t)));
  if (real.length < 2 || real.some((t) => t.replace(/[.'-]/g, "").length < 2)) return null;
  if (tokens.some((t) => NOT_A_NAME.has(norm(t)))) return null;
  return value;
}

const CONFUSED: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", "!": "1", Z: "2", S: "5", s: "5", B: "8" };
const DIGITISH = "\\dODQIl|!ZSsB";
// Entre os grupos de um número o OCR costuma deixar ponto, vírgula e/ou espaço ("529.982 .247-25").
const SEP = "[\\s.,]{0,2}";

const toDigits = (raw: string) =>
  Array.from(raw)
    .map((c) => (/\d/.test(c) ? c : (CONFUSED[c] ?? "")))
    .join("");
const trueDigits = (raw: string) => (raw.match(/\d/g) ?? []).length;

const pad = (n: string | number) => String(n).padStart(2, "0");
function validDate(d: number, m: number, y: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const DATE_RE = new RegExp(`(?<![${DIGITISH}])([${DIGITISH}]{2})\\s?[/.\\-]\\s?([${DIGITISH}]{2})\\s?[/.\\-]\\s?([${DIGITISH}]{4})(?![${DIGITISH}])`, "g");

/** Primeira data real do texto, no formato DD/MM/AAAA (corrige O/S/B/l trocados por número). */
export function parseDate(text: string): string | null {
  for (const m of text.matchAll(DATE_RE)) {
    if (trueDigits(m[0]) < 4) continue;
    const d = Number(toDigits(m[1]));
    const mo = Number(toDigits(m[2]));
    const y = Number(toDigits(m[3]));
    if (validDate(d, mo, y)) return `${pad(d)}/${pad(mo)}/${y}`;
  }
  return null;
}

function parseCrm(text: string): string | null {
  const m = text.match(/([\dOo]{3,7})\s*[/\\-]\s*([A-Z]{2})\b/);
  if (!m) return null;
  const digits = toDigits(m[1]);
  return digits.length >= 3 ? `${digits}/${m[2]}` : null;
}

function parseRg(text: string): string | null {
  const m = text.match(/(?<![\dA-Za-z])(\d{1,2}\s?[.]?\s?\d{3}\s?[.]?\s?\d{3}\s?[-.]?\s?[\dXx]?|\d{6,10}[-.]?[\dXx]?)(?![\dA-Za-z])/);
  if (!m) return null;
  const digits = m[1].replace(/[^\dXx]/g, "");
  if (digits.length < 6 || digits.length > 11 || digits.length === 11) return null;
  return m[1].replace(/\s+/g, "").trim();
}

function parseCategory(text: string): string | null {
  const m = norm(text).match(/^([ABCDE]{1,2})(?: |$)/);
  return m ? m[1] : null;
}

function parseIssuer(text: string): string | null {
  const m = text.match(/\b([A-Z]{2,6})\s*[/-]\s*([A-Z]{2})\b/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Primeiro CPF válido do texto, formatado (corrige O/S/B/l trocados por número). */
function parseCpfValue(text: string): string | null {
  for (const m of text.matchAll(CPF_RE)) {
    if (trueDigits(m[0]) < 6) continue;
    const d = toDigits(m[0]);
    if (d.length === 11 && isValidCpf(d)) return formatCpf(d);
  }
  return null;
}

/** Número só de dígitos com o tamanho esperado (título de eleitor, zona, seção). */
function parseDigits(text: string, min: number, max: number): string | null {
  for (const m of text.matchAll(/(?<![\dA-Za-z])(\d[\d ]*\d|\d)(?![\dA-Za-z])/g)) {
    const digits = m[1].replace(/ /g, "");
    if (digits.length >= min && digits.length <= max) return digits;
  }
  return null;
}

function parseText(text: string): string | null {
  const v = text.replace(/[|]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length >= 2 && v.length <= 60 && /[\p{L}\p{N}]{2}/u.test(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

type Kind = "cpf" | "name" | "date" | "rg" | "crm" | "category" | "issuer" | "text" | "voter" | "zone" | "section" | "money" | "number" | "month";
/** `types`: o rótulo só vale nesses tipos de documento (evita "VALOR"/"GRUPO" soltos virarem campo em qualquer papel). `min`/`max`: nº de dígitos do tipo "number". */
type LabelSpec = { key: string; label: string; labels: string[]; kind: Kind; types?: DocumentTypeId[]; min?: number; max?: number; sameLine?: boolean };

const BILLS: DocumentTypeId[] = ["proof_address", "boleto", "consorcio", "payslip", "cnpj"];

// A ordem importa: rótulos mais específicos antes dos genéricos.
const LABEL_SPECS: LabelSpec[] = [
  // ---- por tipo de documento ----
  // contracheque
  { key: "competence", label: "Competência", labels: ["COMPETENCIA", "MES REFERENCIA", "REFERENCIA", "MES ANO"], kind: "month", types: ["payslip", "proof_address"] },
  { key: "role", label: "Cargo", labels: ["CARGO", "FUNCAO"], kind: "text", types: ["payslip"] },
  { key: "admission", label: "Admissão", labels: ["DATA DE ADMISSAO", "ADMISSAO"], kind: "date", types: ["payslip"] },
  { key: "employer", label: "Empresa", labels: ["EMPREGADOR", "EMPRESA", "RAZAO SOCIAL"], kind: "text", types: ["payslip"] },
  { key: "registry-no", label: "Matrícula", labels: ["MATRICULA"], kind: "number", min: 3, max: 12, types: ["payslip"] },
  { key: "gross", label: "Total de vencimentos", labels: ["TOTAL DE VENCIMENTOS", "TOTAL VENCIMENTOS", "SALARIO BRUTO", "TOTAL BRUTO"], kind: "money", types: ["payslip"] },
  { key: "deductions", label: "Total de descontos", labels: ["TOTAL DE DESCONTOS", "TOTAL DESCONTOS"], kind: "money", types: ["payslip"] },
  { key: "net", label: "Líquido a receber", labels: ["LIQUIDO A RECEBER", "VALOR LIQUIDO", "TOTAL LIQUIDO", "LIQUIDO"], kind: "money", types: ["payslip"] },
  { key: "base-salary", label: "Salário base", labels: ["SALARIO BASE"], kind: "money", types: ["payslip"] },
  // boleto, conta de consumo e parcela do consórcio
  { key: "due", label: "Vencimento", labels: ["DATA DE VENCIMENTO", "VENCIMENTO"], kind: "date", types: ["boleto", "proof_address", "consorcio"] },
  // "Valor do crédito" tem que vir ANTES do "Valor" genérico (que casaria com a primeira palavra)
  { key: "credit", label: "Valor do crédito", labels: ["VALOR DO CREDITO", "CREDITO", "VALOR DO BEM"], kind: "money", types: ["consorcio"] },
  { key: "amount", label: "Valor", labels: ["VALOR DO DOCUMENTO", "VALOR COBRADO", "VALOR DA PARCELA", "VALOR A PAGAR", "TOTAL A PAGAR", "VALOR TOTAL", "PARCELA", "VALOR"], kind: "money", types: ["boleto", "proof_address", "consorcio"] },
  { key: "beneficiary", label: "Beneficiário", labels: ["BENEFICIARIO", "CEDENTE"], kind: "text", types: ["boleto"] },
  { key: "payer", label: "Pagador", labels: ["PAGADOR", "SACADO"], kind: "text", types: ["boleto"] },
  { key: "our-number", label: "Nosso número", labels: ["NOSSO NUMERO"], kind: "number", min: 5, max: 20, types: ["boleto"] },
  // consórcio
  { key: "group", label: "Grupo", labels: ["GRUPO"], kind: "number", min: 2, max: 5, types: ["consorcio"] },
  { key: "quota", label: "Cota", labels: ["COTA"], kind: "number", min: 1, max: 6, types: ["consorcio"] },
  { key: "contract", label: "Contrato", labels: ["NUMERO DO CONTRATO", "N DO CONTRATO"], kind: "number", min: 4, max: 15, types: ["consorcio"] },
  // "CONTRATO" sozinho costuma ser o TÍTULO do documento ("Contrato de Participação…"): o número tem que estar na mesma linha
  { key: "contract", label: "Contrato", labels: ["CONTRATO", "PROPOSTA"], kind: "number", min: 4, max: 15, types: ["consorcio"], sameLine: true },
  { key: "term", label: "Prazo (meses)", labels: ["PRAZO"], kind: "number", min: 1, max: 3, types: ["consorcio"] },
  { key: "administrator", label: "Administradora", labels: ["ADMINISTRADORA"], kind: "text", types: ["consorcio"] },
  // conta de luz/água/telefone e cartão CNPJ: titular, endereço
  { key: "name", label: "Nome", labels: ["NOME DO CLIENTE", "CLIENTE", "TITULAR"], kind: "name", types: ["proof_address", "boleto", "consorcio"] },
  { key: "consumer-unit", label: "Unidade consumidora", labels: ["UNIDADE CONSUMIDORA", "NUMERO DA INSTALACAO", "INSTALACAO", "CODIGO DO CLIENTE", "CODIGO DA INSTALACAO", "CONTA CONTRATO"], kind: "number", min: 5, max: 15, types: ["proof_address"] },
  { key: "company-name", label: "Razão social", labels: ["NOME EMPRESARIAL", "RAZAO SOCIAL"], kind: "text", types: ["cnpj"] },
  { key: "fantasy-name", label: "Nome fantasia", labels: ["TITULO DO ESTABELECIMENTO NOME DE FANTASIA", "NOME DE FANTASIA", "NOME FANTASIA"], kind: "text", types: ["cnpj"] },
  { key: "opening", label: "Data de abertura", labels: ["DATA DE ABERTURA"], kind: "date", types: ["cnpj"] },
  { key: "situation", label: "Situação cadastral", labels: ["SITUACAO CADASTRAL"], kind: "text", types: ["cnpj"] },
  { key: "address", label: "Endereço", labels: ["LOGRADOURO", "ENDERECO"], kind: "text", types: BILLS },
  { key: "district", label: "Bairro", labels: ["BAIRRO DISTRITO", "BAIRRO"], kind: "text", types: BILLS },
  { key: "city", label: "Cidade", labels: ["MUNICIPIO", "CIDADE"], kind: "text", types: BILLS },
  // CNH e certidões
  { key: "cnh-registry", label: "Nº de registro (CNH)", labels: ["N REGISTRO", "NO REGISTRO", "REGISTRO"], kind: "number", min: 11, max: 11, types: ["cnh"] },
  { key: "marriage", label: "Data do casamento", labels: ["DATA DO CASAMENTO", "DATA DE CELEBRACAO", "CASAMENTO"], kind: "date", types: ["marriage_cert"] },
  { key: "cert-registry", label: "Matrícula da certidão", labels: ["MATRICULA"], kind: "number", min: 28, max: 32, types: ["birth_cert", "marriage_cert"] },
  { key: "name", label: "Nome", labels: ["NOME DO REGISTRADO", "NOME DO NUBENTE", "NOME"], kind: "name", types: ["birth_cert", "marriage_cert"] },
  // ---- gerais ----
  { key: "mother", label: "Nome da mãe", labels: ["NOME DA MAE", "MAE"], kind: "name" },
  { key: "father", label: "Nome do pai", labels: ["NOME DO PAI", "PAI"], kind: "name" },
  { key: "birth", label: "Data de nascimento", labels: ["DATA DE NASCIMENTO", "DATA NASCIMENTO", "DATA NASC", "NASCIMENTO", "NASC"], kind: "date" },
  { key: "issue", label: "Data de emissão", labels: ["LOCAL E DATA DE EXPEDICAO", "LOCAL E DATA DE EMISSAO", "DATA DE EMISSAO", "DATA EMISSAO", "EMISSAO", "DATA DE EXPEDICAO", "EXPEDICAO", "DATA DE INSCRICAO", "INSCRICAO", "PRIMEIRA HABILITACAO", "1A HABILITACAO"], kind: "date" },
  { key: "validity", label: "Validade", labels: ["DATA DE VALIDADE", "VALIDADE", "VALIDO ATE"], kind: "date" },
  { key: "rg", label: "RG", labels: ["REGISTRO GERAL", "DOC IDENTIDADE", "DOCUMENTO DE IDENTIDADE", "IDENTIDADE", "RG"], kind: "rg" },
  { key: "issuer", label: "Órgão emissor", labels: ["ORGAO EMISSOR", "ORG EMISSOR", "ORGAO EXPEDIDOR", "EMISSOR"], kind: "issuer" },
  { key: "cpf-label", label: "CPF", labels: ["NUMERO DE INSCRICAO", "N DE INSCRICAO", "CPF"], kind: "cpf" },
  { key: "voter", label: "Título de eleitor", labels: ["TITULO DE ELEITOR", "TITULO ELEITOR"], kind: "voter" },
  { key: "zone", label: "Zona", labels: ["ZONA"], kind: "zone" },
  { key: "section", label: "Seção", labels: ["SECAO"], kind: "section" },
  { key: "naturalness", label: "Naturalidade", labels: ["NATURALIDADE"], kind: "text" },
  { key: "category", label: "Categoria", labels: ["CATEGORIA", "CAT HAB"], kind: "category" },
  { key: "crm", label: "CRM/UF", labels: ["CRM UF", "CRM"], kind: "crm" },
  { key: "name", label: "Nome", labels: ["NOME COMPLETO", "NOME E SOBRENOME", "NOME"], kind: "name" },
];
const FILIATION_LABELS = ["FILIACAO"];

const ALL_LABEL_FIRST_WORDS = new Set([
  "NOME", "DATA", "VIA", "CRM", "FILIACAO", "RG", "CPF", "VALIDADE", "CATEGORIA", "NATURALIDADE", "MAE", "PAI", "REGISTRO", "ORGAO", "DOC",
  "VALOR", "VENCIMENTO", "GRUPO", "COTA", "CONTRATO", "CLIENTE", "TITULAR", "ENDERECO", "BAIRRO", "CIDADE", "MUNICIPIO", "COMPETENCIA", "CARGO",
  "LIQUIDO", "TOTAL", "BENEFICIARIO", "PAGADOR", "MATRICULA", "SALARIO", "INSTALACAO", "UNIDADE", "LOGRADOURO", "ADMISSAO", "PRAZO", "PARCELA",
]);

function parseByKind(kind: Kind, text: string, spec?: LabelSpec): string | null {
  switch (kind) {
    case "money":
      return parseMoney(text);
    case "number":
      return parseNumberRange(text, spec?.min ?? 1, spec?.max ?? 20);
    case "month":
      return parseCompetence(text);
    case "name":
      return cleanName(text);
    case "date":
      return parseDate(text);
    case "rg":
      return parseRg(text);
    case "crm":
      return parseCrm(text);
    case "category":
      return parseCategory(text);
    case "issuer":
      return parseIssuer(text);
    case "text":
      return parseText(text);
    case "cpf":
      return parseCpfValue(text);
    case "voter":
      return parseDigits(text, 10, 13);
    case "zone":
      return parseDigits(text, 2, 4);
    case "section":
      return parseDigits(text, 2, 5);
  }
}

const yMid = (l: ReadLine) => (l.box ? (l.box.y0 + l.box.y1) / 2 : 0);
const height = (l: ReadLine) => (l.box ? l.box.y1 - l.box.y0 : 0);

/** Linhas onde o valor de um rótulo costuma estar: à direita na mesma linha e logo abaixo (ou as seguintes, sem posição). */
function candidatesFor(lines: ReadLine[], index: number): ReadLine[] {
  const label = lines[index];
  // Sem posição (texto de PDF): rótulos de uma fileira vêm juntos e os valores depois ("TÍTULO / SEÇÃO / ZONA / 0220…"), então olha mais adiante.
  if (!label.box) return lines.slice(index + 1, index + 5);
  const h = Math.max(height(label), 10);
  const sameRow = lines
    .filter((c, i) => i !== index && c.box && Math.abs(yMid(c) - yMid(label)) < h * 0.6 && c.box.x0 >= label.box!.x1 - 2 && c.box.x0 - label.box!.x1 < h * 14)
    .sort((a, b) => a.box!.x0 - b.box!.x0)
    .slice(0, 1);
  const below = lines
    .filter((c, i) => i !== index && c.box && c.box.y0 >= label.box!.y1 - h * 0.3 && c.box.y0 - label.box!.y1 < h * 2.6 && Math.abs(c.box.x0 - label.box!.x0) < h * 4.5)
    .sort((a, b) => a.box!.y0 - b.box!.y0 || Math.abs(a.box!.x0 - label.box!.x0) - Math.abs(b.box!.x0 - label.box!.x0));
  return [...sameRow, ...below];
}

/** Pedaço de lixo da foto (letras soltas, texto minúsculo de baixa confiança) — rótulos conhecidos nunca são lixo. */
export function isLikelyNoise(line: ReadLine): boolean {
  if (line.confidence === null || line.confidence >= 70) return false;
  const alnum = (line.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return alnum <= 6 && !startsWithLabelWord(line.text);
}

function startsWithLabelWord(text: string): boolean {
  const first = norm(text).split(" ")[0] ?? "";
  return !!first && [...ALL_LABEL_FIRST_WORDS].some((w) => tokenEquals(first, w));
}

function findLabeled(lines: ReadLine[], typeId?: DocumentTypeId): FoundField[] {
  const found: FoundField[] = [];
  const used = new Set<string>();
  const taken = new Set<number>();

  lines.forEach((line, i) => {
    // FILIAÇÃO: os nomes logo abaixo (até 2), um por linha
    const filiation = matchLabel(line.text, FILIATION_LABELS);
    if (filiation) {
      const names: string[] = [];
      const inline = cleanName(filiation.rest);
      if (inline) names.push(inline);
      // Cada nome é procurado a partir da linha anterior (rótulo, depois o 1º nome), pois o 2º fica abaixo do 1º.
      let current = i;
      while (names.length < 2) {
        const next = candidatesFor(lines, current).find((c) => !startsWithLabelWord(c.text) && cleanName(c.text) && !(c.box && lines[current].box && c.box.y0 < lines[current].box!.y0));
        if (!next) break;
        names.push(cleanName(next.text)!);
        current = lines.indexOf(next);
      }
      names.forEach((name, n) => {
        if (!used.has(`filiation-${name}`)) {
          used.add(`filiation-${name}`);
          found.push({ key: `filiation-${n}`, label: "Filiação", value: name });
        }
      });
      return;
    }

    for (const spec of LABEL_SPECS) {
      if (spec.types && !(typeId && spec.types.includes(typeId))) continue;
      if (used.has(spec.key)) continue;
      const m = matchLabel(line.text, spec.labels);
      if (!m) continue;
      let value = m.rest ? parseByKind(spec.kind, m.rest, spec) : null;
      let source = m.rest;
      if (!value && !spec.sameLine) {
        for (const c of candidatesFor(lines, i)) {
          const idx = lines.indexOf(c);
          if (taken.has(idx) && spec.kind === "name") continue;
          if (spec.kind !== "text" && startsWithLabelWord(c.text) && !parseByKind(spec.kind, c.text, spec)) continue;
          const parsed = spec.kind === "name" && startsWithLabelWord(c.text) ? null : parseByKind(spec.kind, c.text, spec);
          if (parsed) {
            value = parsed;
            source = c.text;
            taken.add(idx);
            break;
          }
        }
      }
      if (value) {
        used.add(spec.key);
        // CPF achado pelo rótulo tem a mesma chave do CPF achado solto (o mesmo número não aparece duas vezes)
        found.push({ key: spec.kind === "cpf" ? `cpf-${value.replace(/\D/g, "")}` : spec.key, label: spec.label, value });
        // "RG/ÓRGÃO EMISSOR" traz o número e o órgão na mesma linha ("01285792 / SESP-MS")
        const issuer = spec.key === "rg" && !used.has("issuer") ? parseIssuer(source) : null;
        if (issuer) {
          used.add("issuer");
          found.push({ key: "issuer", label: "Órgão emissor", value: issuer });
        }
      }
      break;
    }
  });
  return found;
}

// ---------------------------------------------------------------------------
// Números e padrões soltos (sem rótulo)
// ---------------------------------------------------------------------------

const CPF_RE = new RegExp(`(?<![${DIGITISH}])[${DIGITISH}]{3}${SEP}[${DIGITISH}]{3}${SEP}[${DIGITISH}]{3}\\s?[-–—.]?\\s?[${DIGITISH}]{2}(?![${DIGITISH}])`, "g");
const CNPJ_RE = new RegExp(
  `(?<![${DIGITISH}])[${DIGITISH}]{2}${SEP}[${DIGITISH}]{3}${SEP}[${DIGITISH}]{3}\\s?[/\\\\]?\\s?[${DIGITISH}]{4}\\s?[-–—.]?\\s?[${DIGITISH}]{2}(?![${DIGITISH}])`,
  "g",
);

function findDocuments(texts: string[]): FoundField[] {
  const found: FoundField[] = [];
  const seen = new Set<string>();
  for (const line of texts) {
    // CNPJ primeiro: um CNPJ contém trechos que parecem CPF.
    const cnpjSpans: [number, number][] = [];
    for (const m of line.matchAll(CNPJ_RE)) {
      if (trueDigits(m[0]) < 8) continue;
      const d = toDigits(m[0]);
      if (d.length === 14 && isValidCnpj(d)) {
        cnpjSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
        if (!seen.has(d)) {
          seen.add(d);
          found.push({ key: `cnpj-${d}`, label: "CNPJ", value: formatCnpj(d) });
        }
      }
    }
    for (const m of line.matchAll(CPF_RE)) {
      const start = m.index ?? 0;
      if (cnpjSpans.some(([a, b]) => start >= a && start < b)) continue;
      if (trueDigits(m[0]) < 6) continue;
      const d = toDigits(m[0]);
      if (d.length === 11 && isValidCpf(d) && !seen.has(d)) {
        seen.add(d);
        found.push({ key: `cpf-${d}`, label: "CPF", value: formatCpf(d) });
      }
    }
  }
  return found;
}

function findLooseDates(texts: string[], already: Set<string>): FoundField[] {
  const found: FoundField[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(DATE_RE)) {
      if (trueDigits(m[0]) < 4) continue;
      const value = parseDate(m[0]);
      if (!value || already.has(value)) continue;
      already.add(value);
      found.push({ key: `date-${value}`, label: "Data", value });
    }
  }
  return found.slice(0, 4);
}

function findCep(texts: string[]): FoundField[] {
  const found: FoundField[] = [];
  for (const line of texts) {
    const hasWord = /\bCEP\b/i.test(line);
    for (const m of line.matchAll(/(?<!\d)(\d{5})\s?-\s?(\d{3})(?!\d)|(?<!\d)(\d{8})(?!\d)/g)) {
      const digits = m[3] ?? `${m[1]}${m[2]}`;
      if (!m[3] || hasWord) {
        const value = `${digits.slice(0, 5)}-${digits.slice(5)}`;
        if (!found.some((f) => f.value === value)) found.push({ key: `cep-${digits}`, label: "CEP", value });
      }
    }
  }
  return found.slice(0, 2);
}

function findEmail(texts: string[]): FoundField[] {
  for (const line of texts) {
    const m = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (m) return [{ key: "email", label: "E-mail", value: m[0].toLowerCase() }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const ORDER = ["type", "competence", "name", "company-name", "fantasy-name", "payer", "beneficiary", "group", "quota", "contract", "credit", "term", "administrator", "amount", "due", "boleto-line", "boleto-due", "boleto-amount", "our-number", "role", "admission", "employer", "registry-no", "base-salary", "gross", "deductions", "net", "consumer-unit", "address", "district", "city", "opening", "situation", "cnh-registry", "cert-registry", "marriage", "pay-value", "pay-datetime", "payer-name", "payer-doc", "payer-bank", "payee-name", "payee-doc", "payee-bank", "payee-key", "pay-auth", "pay-id", "name", "filiation-0", "filiation-1", "mother", "father", "birth", "cpf", "cnpj", "rg", "issuer", "voter", "zone", "section", "naturalness", "category", "crm", "issue", "validity", "date", "cep", "email"];
const orderOf = (key: string) => {
  const i = ORDER.findIndex((o) => key === o || key.startsWith(`${o}-`));
  return i === -1 ? ORDER.length : i;
};

/** Para PALPITES (sem rótulo): só vale texto com jeito de nome completo — 3+ palavras ou 14+ letras. Cabeçalhos curtos ("GROSSO DO SUL") não. */
function looksLikeFullName(name: string): boolean {
  const words = name.split(/\s+/).filter((w) => !NAME_PARTICLES.has(norm(w)));
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  return words.length >= 3 || letters >= 14;
}

/**
 * Plano B quando o OCR não leu o rótulo ("NOME", "FILIAÇÃO"): o primeiro texto com cara de nome de
 * pessoa, na ordem em que aparece, é o titular; os nomes logo abaixo, na mesma coluna, são a filiação.
 * Vêm marcados como "provável" — quem confere é a pessoa.
 */
const NO_FILIATION: DocumentTypeId[] = ["cpf", "cnpj", "voter", "proof_address", "work", "passport", "payslip", "boleto", "consorcio"];
/** Nesses tipos o texto com cara de nome costuma ser empresa, banco ou título — não se adivinha o titular. */
const NO_NAME_GUESS: DocumentTypeId[] = ["cnpj", "proof_address", "payslip", "boleto", "consorcio", "payment"];

function guessNames(lines: ReadLine[], found: FoundField[], typeId?: DocumentTypeId): FoundField[] {
  const labeledName = found.find((f) => f.key === "name")?.value;
  const hasFiliation = found.some((f) => f.key.startsWith("filiation") || f.key === "mother" || f.key === "father");
  if (typeId && NO_NAME_GUESS.includes(typeId)) return [];
  if (labeledName && hasFiliation) return [];
  const taken = new Set(found.map((f) => f.value));
  const people: { name: string; line: ReadLine }[] = [];
  for (const line of lines) {
    if (startsWithLabelWord(line.text)) continue;
    const name = cleanName(line.text);
    if (name && !taken.has(name) && looksLikeFullName(name) && (line.confidence === null || line.confidence >= 65)) people.push({ name, line });
  }
  const guesses: FoundField[] = [];
  let rest = people;
  let holderLine: ReadLine | undefined;
  if (labeledName) {
    holderLine = lines.find((l) => cleanName(l.text) === labeledName);
  } else if (people.length > 0) {
    guesses.push({ key: "name", label: "Nome (provável)", value: people[0].name });
    holderLine = people[0].line;
    rest = people.slice(1);
  }
  // Filiação provável: só com posição na imagem — os nomes logo abaixo do titular, na mesma coluna.
  if (!hasFiliation && holderLine?.box && !(typeId && NO_FILIATION.includes(typeId))) {
    let anchor: ReadLine = holderLine;
    let count = 0;
    for (const p of rest) {
      if (count >= 2) break;
      const box = p.line.box;
      if (!box || !anchor.box) continue;
      const h = Math.max(anchor.box.y1 - anchor.box.y0, 10);
      const below = box.y0 - anchor.box.y1;
      if (below < 0 || below > h * (count === 0 ? 9 : 4) || Math.abs(box.x0 - anchor.box.x0) > h * 6) continue;
      guesses.push({ key: `filiation-${count}`, label: "Filiação (provável)", value: p.name });
      anchor = p.line;
      count++;
    }
  }
  return guesses;
}

/** Dados que se espera achar em cada tipo de documento: enquanto faltarem, vale a pena tentar mais uma leitura. */
const EXPECTED: Partial<Record<DocumentTypeId, string[]>> = {
  cpf: ["cpf-"],
  cnh: ["cpf-", "birth"],
  rg: ["birth"],
  voter: ["voter"],
  proof_address: ["cep"],
};

/** Reconheceu o tipo do documento, mas ainda não achou algo que ele sempre traz (ex.: o número do CPF no cartão do CPF). */
export function missingExpectedFields(input: (string | ReadLine)[]): boolean {
  const texts = input.map((l) => (typeof l === "string" ? l : l.text));
  const fields = findFields(input);
  const has = (key: string) => fields.some((f) => f.key === key || f.key.startsWith(key));
  // O rótulo "CPF" / "Número de inscrição" apareceu, mas nenhum número que feche a conta: falta ler o número.
  if (texts.some((t) => matchLabel(t, ["CPF", "NUMERO DE INSCRICAO"])) && !has("cpf-")) return true;
  const type = detectDocumentType(texts);
  const expected = type ? EXPECTED[type.id] : undefined;
  return !!expected && expected.some((key) => !has(key));
}

const STREET_RE = /^(?:RUA|R\.|AV\.?|AVENIDA|TRAVESSA|TV\.|ALAMEDA|AL\.|RODOVIA|ROD\.|ESTRADA|ESTR\.|PRA[CÇ]A|PC\.|QUADRA|QD\.?|VIA|LOTEAMENTO)\s+\S.{3,}/i;

/** Conta de consumo sem o rótulo "Endereço": a linha que começa com Rua/Avenida/Travessa… é o endereço (palpite). */
function findAddressLine(texts: string[]): FoundField[] {
  const line = texts.find((t) => STREET_RE.test(t.trim()) && /\d/.test(t));
  return line ? [{ key: "address", label: "Endereço (provável)", value: line.replace(/\s+/g, " ").trim() }] : [];
}

export function findFields(input: (string | ReadLine)[]): FoundField[] {
  const lines: ReadLine[] = input.map((l) => (typeof l === "string" ? { text: l, confidence: null } : l));
  const texts = lines.map((l) => l.text);

  const type = detectDocumentType(texts);

  // Comprovante de pagamento: tem layout próprio (De/Para, valor, chave Pix). Não procura nome/filiação de pessoa.
  if (type?.id === "payment") {
    const payment = [{ key: "type", label: "Documento", value: type.label }, ...findPaymentFields(lines), ...findDocuments(texts), ...findEmail(texts)];
    const seenPayment = new Set<string>();
    return payment
      .sort((a, b) => orderOf(a.key) - orderOf(b.key))
      .filter((f) => {
        const id = `${f.label}|${f.value}`;
        if (seenPayment.has(id)) return false;
        seenPayment.add(id);
        return true;
      });
  }

  const labeledOnly = findLabeled(lines, type?.id);
  const labeled = [...labeledOnly, ...guessNames(lines, labeledOnly, type?.id)];
  const dateValues = new Set(labeled.filter((f) => /^(birth|issue|validity)$/.test(f.key)).map((f) => f.value));
  const boleto = findBoleto(texts);
  const boletoFields: FoundField[] = boleto
    ? [
        { key: "boleto-line", label: "Linha digitável", value: boleto.line },
        ...(boleto.due ? [{ key: "boleto-due", label: "Vencimento (pelo código)", value: boleto.due }] : []),
        ...(boleto.amount ? [{ key: "boleto-amount", label: "Valor (pelo código)", value: boleto.amount }] : []),
      ]
    : [];
  const addressGuess = type && ["proof_address", "cnpj"].includes(type.id) && !labeled.some((f) => f.key === "address") ? findAddressLine(texts) : [];
  const all = [...(type ? [{ key: "type", label: "Documento", value: type.label }] : []), ...labeled, ...boletoFields, ...addressGuess, ...findDocuments(texts), ...findLooseDates(texts, dateValues), ...findCep(texts), ...findEmail(texts)];

  // um nome só (o rótulo "NOME" ganha das tentativas soltas) e sem valores repetidos
  const seen = new Set<string>();
  const result: FoundField[] = [];
  for (const f of all.sort((a, b) => orderOf(a.key) - orderOf(b.key))) {
    const id = `${f.label}|${f.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(f);
  }
  return result;
}
