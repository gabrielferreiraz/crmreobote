/**
 * Reconhece QUE documento é a partir das frases impressas nele ("CADASTRO DE PESSOAS FÍSICAS",
 * "CARTEIRA NACIONAL DE HABILITAÇÃO"…), tolerando letras erradas do OCR. Saber o tipo deixa a
 * leitura mais inteligente: o que procurar, o que NÃO inventar (ex.: filiação num cartão do CPF).
 */

export type DocumentTypeId = "cpf" | "cnh" | "rg" | "voter" | "work" | "professional" | "proof_address" | "birth_cert" | "marriage_cert" | "cnpj" | "passport" | "payment" | "payslip" | "boleto" | "consorcio" | "vehicle";

export type DocumentType = { id: DocumentTypeId; label: string };

type Phrase = { words: string; weight: number };
const TYPES: { id: DocumentTypeId; label: string; min: number; phrases: Phrase[] }[] = [
  {
    id: "cpf",
    label: "Cartão do CPF",
    min: 3,
    phrases: [
      { words: "CADASTRO DE PESSOAS FISICAS", weight: 2 },
      { words: "NUMERO DE INSCRICAO", weight: 2 },
      { words: "RECEITA FEDERAL", weight: 1 },
      { words: "MINISTERIO DA FAZENDA", weight: 1 },
      { words: "CPF", weight: 1 },
    ],
  },
  {
    id: "cnpj",
    label: "Cartão do CNPJ",
    min: 3,
    phrases: [
      { words: "CADASTRO NACIONAL DA PESSOA JURIDICA", weight: 3 },
      { words: "COMPROVANTE DE INSCRICAO E DE SITUACAO CADASTRAL", weight: 3 },
      { words: "CNPJ", weight: 1 },
    ],
  },
  {
    id: "cnh",
    label: "CNH (carteira de habilitação)",
    min: 3,
    phrases: [
      { words: "CARTEIRA NACIONAL DE HABILITACAO", weight: 3 },
      { words: "HABILITACAO", weight: 1 },
      { words: "CAT HAB", weight: 2 },
      { words: "PERMISSAO", weight: 1 },
      { words: "DENATRAN", weight: 1 },
      { words: "DETRAN", weight: 1 },
      // CNH digital (PDF do app "Carteira Digital de Trânsito"): o cartão é uma IMAGEM e o texto do PDF traz só o cabeçalho e o rodapé de assinatura.
      { words: "SENATRAN", weight: 2 },
      { words: "MINISTERIO DOS TRANSPORTES", weight: 1 },
      { words: "SECRETARIA NACIONAL DE TRANSITO", weight: 1 },
      { words: "CNH DIGITAL", weight: 2 },
    ],
  },
  {
    // O CRLV-e também é emitido pela SENATRAN: sem este tipo ele seria confundido com a CNH digital.
    id: "vehicle",
    label: "Documento do veículo (CRLV)",
    min: 3,
    phrases: [
      { words: "CERTIFICADO DE REGISTRO E LICENCIAMENTO DE VEICULO", weight: 4 },
      { words: "LICENCIAMENTO DE VEICULO", weight: 3 },
      { words: "CRLV", weight: 3 },
      { words: "RENAVAM", weight: 2 },
      { words: "PLACA", weight: 1 },
    ],
  },
  {
    id: "voter",
    label: "Título de eleitor",
    min: 3,
    phrases: [
      { words: "JUSTICA ELEITORAL", weight: 3 },
      { words: "TITULO ELEITORAL", weight: 3 },
      // "TÍTULO DE ELEITOR" também é só um CAMPO de outras carteiras: sozinho não basta.
      { words: "TITULO DE ELEITOR", weight: 1 },
    ],
  },
  {
    id: "work",
    label: "Carteira de trabalho",
    min: 3,
    phrases: [
      { words: "CARTEIRA DE TRABALHO", weight: 3 },
      { words: "PREVIDENCIA SOCIAL", weight: 1 },
    ],
  },
  {
    id: "professional",
    label: "Carteira profissional",
    min: 3,
    phrases: [
      { words: "CEDULA DE IDENTIDADE PROFISSIONAL", weight: 3 },
      { words: "CONSELHO FEDERAL", weight: 2 },
      { words: "CONSELHO REGIONAL", weight: 2 },
      { words: "ORDEM DOS ADVOGADOS", weight: 3 },
      { words: "CEDULA DE IDENTIDADE", weight: 1 },
    ],
  },
  {
    id: "rg",
    label: "Documento de identidade",
    min: 3,
    phrases: [
      { words: "REGISTRO GERAL", weight: 2 },
      { words: "CARTEIRA DE IDENTIDADE", weight: 2 },
      { words: "INSTITUTO DE IDENTIFICACAO", weight: 2 },
      { words: "SECRETARIA DE SEGURANCA PUBLICA", weight: 1 },
      { words: "ORGAO EMISSOR", weight: 1 },
      { words: "FILIACAO", weight: 1 },
      { words: "NATURALIDADE", weight: 1 },
      { words: "PROVA DE IDENTIDADE", weight: 2 },
    ],
  },
  {
    id: "birth_cert",
    label: "Certidão de nascimento",
    min: 3,
    phrases: [
      { words: "CERTIDAO DE NASCIMENTO", weight: 3 },
      { words: "REGISTRO CIVIL", weight: 1 },
    ],
  },
  {
    id: "marriage_cert",
    label: "Certidão de casamento",
    min: 3,
    phrases: [
      { words: "CERTIDAO DE CASAMENTO", weight: 3 },
      { words: "REGISTRO CIVIL", weight: 1 },
    ],
  },
  {
    id: "passport",
    label: "Passaporte",
    min: 3,
    phrases: [{ words: "PASSAPORTE", weight: 3 }],
  },
  {
    id: "payment",
    label: "Comprovante de pagamento",
    min: 3,
    phrases: [
      { words: "COMPROVANTE DE PIX", weight: 3 },
      { words: "COMPROVANTE DE TRANSFERENCIA", weight: 3 },
      { words: "COMPROVANTE DE PAGAMENTO", weight: 3 },
      { words: "COMPROVANTE DE DEPOSITO", weight: 3 },
      { words: "CHAVE PIX", weight: 2 },
      { words: "ID DA TRANSACAO", weight: 2 },
      { words: "AUTENTICACAO", weight: 1 },
      { words: "INSTITUICAO", weight: 1 },
      { words: "REALIZADO EM", weight: 1 },
    ],
  },
  {
    id: "payslip",
    label: "Contracheque (comprovante de renda)",
    min: 3,
    phrases: [
      { words: "CONTRACHEQUE", weight: 3 },
      { words: "HOLERITE", weight: 3 },
      { words: "RECIBO DE PAGAMENTO DE SALARIO", weight: 3 },
      { words: "DEMONSTRATIVO DE PAGAMENTO", weight: 3 },
      { words: "TOTAL DE VENCIMENTOS", weight: 2 },
      { words: "LIQUIDO A RECEBER", weight: 2 },
      { words: "SALARIO BASE", weight: 1 },
      { words: "TOTAL DE DESCONTOS", weight: 1 },
    ],
  },
  {
    id: "boleto",
    label: "Boleto bancário",
    min: 3,
    phrases: [
      { words: "LINHA DIGITAVEL", weight: 3 },
      { words: "FICHA DE COMPENSACAO", weight: 3 },
      { words: "RECIBO DO PAGADOR", weight: 2 },
      { words: "NOSSO NUMERO", weight: 2 },
      { words: "CODIGO DE BARRAS", weight: 2 },
      { words: "BOLETO", weight: 1 },
      { words: "BENEFICIARIO", weight: 1 },
      { words: "PAGADOR", weight: 1 },
    ],
  },
  {
    id: "consorcio",
    label: "Documento do consórcio",
    min: 3,
    phrases: [
      { words: "CONTRATO DE PARTICIPACAO EM GRUPO DE CONSORCIO", weight: 3 },
      { words: "CONSORCIO", weight: 2 },
      { words: "ASSEMBLEIA", weight: 1 },
      { words: "ADMINISTRADORA", weight: 1 },
      { words: "GRUPO", weight: 1 },
      { words: "COTA", weight: 1 },
      { words: "CARTA DE CREDITO", weight: 1 },
    ],
  },
  {
    id: "proof_address",
    label: "Comprovante de endereço",
    min: 3,
    phrases: [
      { words: "COMPROVANTE DE RESIDENCIA", weight: 3 },
      { words: "FATURA", weight: 1 },
      { words: "ENERGIA ELETRICA", weight: 1 },
      { words: "SANEAMENTO", weight: 1 },
      { words: "VENCIMENTO", weight: 1 },
      { words: "CEP", weight: 1 },
      { words: "UNIDADE CONSUMIDORA", weight: 2 },
      { words: "NOTA FISCAL FATURA", weight: 3 },
      { words: "DISTRIBUIDORA", weight: 1 },
      { words: "CONCESSIONARIA", weight: 1 },
      { words: "INSTALACAO", weight: 1 },
    ],
  },
];

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

function tokenMatches(token: string, word: string): boolean {
  if (token === word) return true;
  if (word.length >= 12) return levenshtein(token, word) <= 2;
  if (word.length >= 5) return levenshtein(token, word) <= 1;
  return false;
}

/** Todas as palavras da frase aparecem no texto (mesmo com 1–2 letras erradas nas palavras longas). */
function hasPhrase(tokens: string[], phrase: string): boolean {
  return phrase.split(" ").every((word) => tokens.some((t) => tokenMatches(t, word)));
}

export function detectDocumentType(texts: string[]): DocumentType | null {
  const tokens = Array.from(new Set(norm(texts.join(" ")).split(" ").filter(Boolean)));
  let best: { type: DocumentType; score: number } | null = null;
  for (const t of TYPES) {
    const score = t.phrases.reduce((sum, p) => sum + (hasPhrase(tokens, p.words) ? p.weight : 0), 0);
    if (score >= t.min && (!best || score > best.score)) best = { type: { id: t.id, label: t.label }, score };
  }
  return best?.type ?? null;
}
