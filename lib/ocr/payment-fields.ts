import type { ReadLine } from "@/lib/ocr/quality";

/**
 * Comprovante de pagamento (Pix, transferência, TED…): valor, data e hora, quem pagou, quem recebeu,
 * banco, chave Pix, autenticação e ID da transação. Serve para o Administrativo conferir o pagamento
 * de uma venda sem digitar nada.
 *
 * O layout é quase sempre o mesmo: um bloco "De" (pagador) e um bloco "Para" (recebedor), cada um com
 * nome, CPF/CNPJ (em geral mascarado), instituição e, no recebedor, a chave Pix.
 */

export type PaymentField = { key: string; label: string; value: string };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9*]+/g, " ")
    .trim();

/** Texto depois do primeiro ":" (ou depois do rótulo, quando não há dois-pontos). */
function afterLabel(text: string, labelWords: number): string {
  const colon = text.indexOf(":");
  if (colon >= 0) return text.slice(colon + 1).trim();
  return text.split(/\s+/).slice(labelWords).join(" ").trim();
}

const startsWith = (text: string, ...words: string[]) => {
  const n = norm(text);
  return words.some((w) => n === w || n.startsWith(`${w} `));
};

const isDocLine = (text: string) => startsWith(text, "CPF", "CNPJ", "CPF CNPJ");
const isBankLine = (text: string) => startsWith(text, "INSTITUICAO", "BANCO");
const isKeyLine = (text: string) => startsWith(text, "CHAVE PIX", "CHAVE");
// "De" costuma ser lido como "DI"/"OE"/"D€": qualquer linha de 2 letras começando com D/O+E/I conta.
const isFromHeader = (text: string) => /^(DE|DI|OE|D3)$/.test(norm(text));
const isToHeader = (text: string) => norm(text) === "PARA";
const isSectionBreak = (text: string) => startsWith(text, "DADOS DA TRANSACAO", "AUTENTICACAO", "ID DA TRANSACAO", "CENTRAL DE ATENDIMENTO");

function amount(texts: string[]): string | null {
  for (const t of texts) {
    const m = t.match(/R\s?\$\s?(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (m) return `R$ ${m[1]}`;
  }
  return null;
}

function dateTime(texts: string[]): string | null {
  for (const t of texts) {
    const m = t.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:às|as|a|-|,)?\s*(\d{2}:\d{2}(?::\d{2})?))?/i);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const year = Number(m[3]);
      if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) continue;
      return `${m[1]}/${m[2]}/${m[3]}${m[4] ? ` ${m[4]}` : ""}`;
    }
  }
  return null;
}

/** Valor logo depois de um rótulo, na mesma linha ou na linha seguinte (que não pode ser outro rótulo). */
function valueAfter(texts: string[], index: number, labelWords: number, valid: (v: string) => boolean): string | null {
  const same = afterLabel(texts[index], labelWords);
  if (same && valid(same)) return same;
  for (const candidate of texts.slice(index + 1, index + 3)) {
    const v = candidate.trim();
    if (v && valid(v)) return v;
  }
  return null;
}

type Party = { name?: string; doc?: string; bank?: string; key?: string };

function parseParties(texts: string[]): { payer?: Party; payee?: Party } {
  const parties: { role: "payer" | "payee" | null; party: Party }[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (!isDocLine(texts[i])) continue;
    const party: Party = {};
    // nome: a linha logo acima do CPF/CNPJ (pulando o cabeçalho "De"/"Para")
    let n = i - 1;
    let role: "payer" | "payee" | null = null;
    if (n >= 0 && (isFromHeader(texts[n]) || isToHeader(texts[n]))) {
      role = isToHeader(texts[n]) ? "payee" : "payer";
      n = -1;
    }
    if (n >= 0 && !isBankLine(texts[n]) && !isKeyLine(texts[n]) && !isSectionBreak(texts[n])) {
      party.name = texts[n].replace(/\s+/g, " ").trim();
      if (n - 1 >= 0 && (isFromHeader(texts[n - 1]) || isToHeader(texts[n - 1]))) role = isToHeader(texts[n - 1]) ? "payee" : "payer";
    }
    const doc = afterLabel(texts[i], 1).replace(/\s+/g, "");
    if (doc) party.doc = doc;
    for (let j = i + 1; j < Math.min(texts.length, i + 4); j++) {
      if (isDocLine(texts[j]) || isFromHeader(texts[j]) || isToHeader(texts[j]) || isSectionBreak(texts[j])) break;
      if (isBankLine(texts[j]) && !party.bank) party.bank = afterLabel(texts[j], 1);
      else if (isKeyLine(texts[j]) && !party.key) party.key = afterLabel(texts[j], 2);
    }
    parties.push({ role, party });
  }
  // sem o cabeçalho "De"/"Para": o primeiro bloco é o pagador, o segundo o recebedor
  const result: { payer?: Party; payee?: Party } = {};
  for (const [idx, p] of parties.entries()) {
    const role = p.role ?? (idx === 0 ? "payer" : "payee");
    if (!result[role]) result[role] = p.party;
  }
  return result;
}

export function findPaymentFields(lines: ReadLine[]): PaymentField[] {
  const texts = lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const fields: PaymentField[] = [];
  const push = (key: string, label: string, value: string | null | undefined) => {
    if (value && value.trim()) fields.push({ key, label, value: value.trim() });
  };

  push("pay-value", "Valor", amount(texts));
  push("pay-datetime", "Data e hora", dateTime(texts));

  const { payer, payee } = parseParties(texts);
  push("payer-name", "Pagador", payer?.name);
  push("payer-doc", "CPF/CNPJ do pagador", payer?.doc);
  push("payer-bank", "Banco do pagador", payer?.bank);
  push("payee-name", "Recebedor", payee?.name);
  push("payee-doc", "CPF/CNPJ do recebedor", payee?.doc);
  push("payee-bank", "Banco do recebedor", payee?.bank);
  push("payee-key", "Chave Pix", payee?.key);

  texts.forEach((t, i) => {
    if (startsWith(t, "AUTENTICACAO")) push("pay-auth", "Autenticação", valueAfter(texts, i, 1, (v) => /^[A-Z0-9]{16,}$/i.test(v.replace(/\s+/g, ""))));
    if (startsWith(t, "ID DA TRANSACAO", "ID TRANSACAO")) push("pay-id", "ID da transação", valueAfter(texts, i, 3, (v) => /^[A-Z0-9]{16,}$/i.test(v.replace(/\s+/g, ""))));
  });
  return fields;
}
