import { isValidCnpj, formatCnpj } from "@/lib/cnpj";
import { isValidCpf, formatCpf } from "@/lib/cpf";

/**
 * Procura dados conhecidos (CPF, CNPJ, datas, CEP, nome) no texto lido.
 *
 * CPF e CNPJ só aparecem se passarem na conta dos dígitos verificadores — é isso
 * que dá segurança: uma leitura errada quase nunca fecha a conta. Quando falha,
 * tenta desfazer as trocas comuns do OCR (O↔0, I/l↔1, S↔5, B↔8…) só dentro do
 * trecho com cara de número, e mesmo assim só mostra se a conta fechar.
 */

export type FoundField = { key: string; label: string; value: string };

const CONFUSED: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", "!": "1", Z: "2", S: "5", s: "5", B: "8" };
const DIGITISH = "\\dODQIl|!ZSsB";
// Entre os grupos de um número o OCR costuma deixar ponto, vírgula e/ou espaço ("529.982 .247-25").
const SEP = "[\\s.,]{0,2}";

const toDigits = (raw: string) =>
  Array.from(raw)
    .map((c) => (/\d/.test(c) ? c : (CONFUSED[c] ?? "")))
    .join("");

const trueDigits = (raw: string) => (raw.match(/\d/g) ?? []).length;

const CPF_RE = new RegExp(`(?<![${DIGITISH}])[${DIGITISH}]{3}${SEP}[${DIGITISH}]{3}${SEP}[${DIGITISH}]{3}\\s?[-–—.]?\\s?[${DIGITISH}]{2}(?![${DIGITISH}])`, "g");
const CNPJ_RE = new RegExp(
  `(?<![${DIGITISH}])[${DIGITISH}]{2}${SEP}[${DIGITISH}]{3}${SEP}[${DIGITISH}]{3}\\s?[/\\\\]?\\s?[${DIGITISH}]{4}\\s?[-–—.]?\\s?[${DIGITISH}]{2}(?![${DIGITISH}])`,
  "g",
);

function findDocuments(lines: string[]): FoundField[] {
  const found: FoundField[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
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

const pad = (n: string) => n.padStart(2, "0");

function validDate(d: number, m: number, y: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function findDates(lines: string[]): FoundField[] {
  const found: FoundField[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<!\d)(\d{2})\s?[/.\-]\s?(\d{2})\s?[/.\-]\s?(\d{4})(?!\d)/g)) {
      const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!validDate(d, mo, y)) continue;
      const value = `${pad(m[1])}/${pad(m[2])}/${m[3]}`;
      if (seen.has(value)) continue;
      seen.add(value);
      const context = `${lines[i - 1] ?? ""} ${line}`.toUpperCase();
      const label = /NASC/.test(context)
        ? "Data de nascimento"
        : /VALID|VENC|VAL\b/.test(context)
          ? "Validade"
          : /EMISS|EXPED|1[ªA]?\s?HAB/.test(context)
            ? "Emissão"
            : "Data";
      found.push({ key: `date-${value}`, label, value });
    }
  });
  return found.slice(0, 6);
}

function findCep(lines: string[]): FoundField[] {
  const found: FoundField[] = [];
  for (const line of lines) {
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

const NAME_VALUE = /^[A-Za-zÀ-ÿ'’][A-Za-zÀ-ÿ'’ ]{4,}$/;

function looksLikeName(value: string): boolean {
  const v = value.trim();
  if (!NAME_VALUE.test(v)) return false;
  const words = v.split(/\s+/).filter((w) => w.length >= 2);
  return words.length >= 2 && !/\b(FILIA[ÇC][ÃA]O|MAE|MÃE|PAI|NASCIMENTO|REGISTRO|REP[ÚU]BLICA|FEDERATIVA|DOCUMENTO|IDENTIDADE|HABILITA[ÇC][ÃA]O)\b/i.test(v);
}

/** Nome: o texto depois de "NOME" na mesma linha ou na linha seguinte. É um palpite — vem marcado como "provável". */
function findName(lines: string[]): FoundField[] {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\W*(?:\d{1,2}\W+)?NOME(?:\s+E\s+SOBRENOME|\s+COMPLETO)?\s*[:\-]?\s*(.*)$/i);
    if (!m || /\b(DA|DO|DE)\s+(M[ÃA]E|PAI)\b/i.test(lines[i])) continue;
    for (const candidate of [m[1], lines[i + 1] ?? ""]) {
      if (looksLikeName(candidate)) return [{ key: "name", label: "Nome (provável)", value: candidate.trim().replace(/\s+/g, " ") }];
    }
  }
  return [];
}

export function findFields(lines: string[]): FoundField[] {
  return [...findName(lines), ...findDocuments(lines), ...findDates(lines), ...findCep(lines)];
}
