/**
 * Formatação de célula para a TELA (e para copiar/colar com o Excel) —
 * roda no navegador. O valor guardado segue as convenções de
 * lib/sheets/column-types.ts; aqui só se decide como mostrar e editar.
 */

import { formatCpf } from "@/lib/cpf";
import { formatCnpj } from "@/lib/cnpj";
import { displayPhone } from "@/lib/phone-normalize";
import { parseLooseNumber, type CellValue, type SheetColumnType } from "@/lib/sheets/column-types";
import type { RowFormats } from "@/lib/sheets/formats";

export type ClientColumn = { id: string; name: string; type: SheetColumnType; config: unknown; required: boolean; position: number };
export type ClientRow = {
  id: string;
  values: Record<string, CellValue>;
  formats?: RowFormats;
  /** Fórmulas no formato interno (lib/sheets/formula.ts). */
  formulas?: Record<string, string>;
  position: number;
  /** Posição real (1 = primeira linha de dados) — número de linha do Excel = rank + 1. */
  rank?: number;
  createdAt: string;
  updatedAt: string;
};

/** Geometria pura da virtualização quando algumas linhas têm altura variável. */
export function buildRowOffsets(rowCount: number, firstDataTop: number, heightAt: (row: number) => number): number[] {
  const offsets = new Array<number>(Math.max(1, rowCount + 1));
  offsets[0] = firstDataTop;
  if (rowCount >= 1) offsets[1] = firstDataTop;
  for (let row = 1; row < rowCount; row++) offsets[row + 1] = offsets[row] + heightAt(row);
  return offsets;
}

/** Linha visual sob uma coordenada vertical; `rowCount` é o limite exclusivo. */
export function rowAtOffset(offsets: readonly number[], y: number, rowCount: number): number {
  let lo = 1;
  let hi = Math.max(1, rowCount - 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((offsets[mid] ?? Infinity) <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(1, Math.min(lo, Math.max(1, rowCount - 1)));
}

const brNumber = (n: number, digits?: number) =>
  n.toLocaleString("pt-BR", digits === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function columnDecimals(col: ClientColumn): number | undefined {
  const d = (col.config as { decimals?: number } | null)?.decimals;
  return typeof d === "number" ? d : undefined;
}

export function columnOptions(col: ClientColumn): string[] {
  const o = (col.config as { options?: string[] } | null)?.options;
  return Array.isArray(o) ? o : [];
}

/** Texto exibido na célula. `refs` = { id: nome } de cliente/negócio/membro. */
export function displayCell(col: ClientColumn, v: CellValue | undefined, refs: Record<string, string>): string {
  if (v === undefined || v === null) return "";
  switch (col.type) {
    case "NUMBER":
      return brNumber(v as number, columnDecimals(col));
    case "CURRENCY":
      return `R$ ${brNumber(v as number, columnDecimals(col) ?? 2)}`;
    case "PERCENT":
      return `${brNumber(v as number, columnDecimals(col))}%`;
    case "DATE": {
      const [y, m, d] = String(v).split("-");
      return `${d}/${m}/${y}`;
    }
    case "CHECKBOX":
      return v ? "Sim" : "Não";
    case "MULTI_SELECT":
      return (v as string[]).join(", ");
    case "CPF":
      return formatCpf(String(v));
    case "CNPJ":
      return formatCnpj(String(v));
    case "PHONE":
      return displayPhone(String(v)) ?? String(v);
    case "USER":
    case "CONTACT":
    case "DEAL":
      return refs[String(v)] ?? "…";
    default:
      return String(v);
  }
}

/**
 * Texto inicial do editor (o que a pessoa vê ao dar F2/duplo clique) — sem
 * "R$" e com vírgula decimal, como digitaria no Excel. Referências não usam
 * texto (abrem o seletor).
 */
export function editText(col: ClientColumn, v: CellValue | undefined): string {
  if (v === undefined || v === null) return "";
  switch (col.type) {
    case "NUMBER":
    case "CURRENCY":
    case "PERCENT":
      return String(v).replace(".", ",");
    case "DATE":
    case "CPF":
    case "CNPJ":
    case "PHONE":
    case "CHECKBOX":
    case "MULTI_SELECT":
      return displayCell(col, v, {});
    default:
      return String(v);
  }
}

/** Valor para a área de transferência (Ctrl+C): o que o Excel entende ao colar. */
export function clipboardText(col: ClientColumn, v: CellValue | undefined, refs: Record<string, string>): string {
  if (v === undefined || v === null) return "";
  if (col.type === "NUMBER" || col.type === "CURRENCY" || col.type === "PERCENT") return String(v).replace(".", ",");
  // Tab/quebra de linha dentro da célula quebrariam a grade colada no Excel.
  return displayCell(col, v, refs).replace(/[\t\r\n]+/g, " ");
}

/** Lê o texto colado do Excel/Sheets (TSV; aspas para célula com quebra de linha). */
export function parseClipboardGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Letra de coluna estilo Excel (0 → A, 25 → Z, 26 → AA). */
export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function isNumericType(t: SheetColumnType) {
  return t === "NUMBER" || t === "CURRENCY" || t === "PERCENT";
}

export function isReferenceType(t: SheetColumnType) {
  return t === "USER" || t === "CONTACT" || t === "DEAL";
}

export type GridRange = { r1: number; r2: number; c1: number; c2: number };

export type NameBoxTarget =
  | { kind: "cells"; c1: number; r1: number; c2: number; r2: number }
  | { kind: "cols"; c1: number; c2: number }
  | { kind: "rows"; r1: number; r2: number };

function parseColLetters(letters: string): number {
  let c = 0;
  for (const ch of letters.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

/**
 * Interpreta a Caixa de Nome do Excel: aceita célula ("B12"), intervalo ("A2:D10"),
 * colunas inteiras ("A:C"), linhas inteiras ("2:5") e múltiplos intervalos
 * separados por ";" ou "," ("A2:B5; D2:D5").
 */
export function parseNameBoxInput(text: string): NameBoxTarget[] | null {
  const parts = text
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: NameBoxTarget[] = [];
  for (const part of parts) {
    const cellMatch = /^([a-z]{1,3})(\d{1,6})(?:\s*:\s*([a-z]{1,3})(\d{1,6}))?$/i.exec(part);
    if (cellMatch) {
      const ca = parseColLetters(cellMatch[1]);
      const ra = Number(cellMatch[2]);
      const cb = cellMatch[3] ? parseColLetters(cellMatch[3]) : ca;
      const rb = cellMatch[4] ? Number(cellMatch[4]) : ra;
      if (ra < 1 || rb < 1) return null;
      out.push({ kind: "cells", c1: Math.min(ca, cb), r1: Math.min(ra, rb), c2: Math.max(ca, cb), r2: Math.max(ra, rb) });
      continue;
    }
    const colMatch = /^([a-z]{1,3})\s*:\s*([a-z]{1,3})$/i.exec(part);
    if (colMatch) {
      const ca = parseColLetters(colMatch[1]);
      const cb = parseColLetters(colMatch[2]);
      out.push({ kind: "cols", c1: Math.min(ca, cb), c2: Math.max(ca, cb) });
      continue;
    }
    const rowMatch = /^(\d{1,6})\s*:\s*(\d{1,6})$/.exec(part);
    if (rowMatch) {
      const ra = Number(rowMatch[1]);
      const rb = Number(rowMatch[2]);
      if (ra < 1 || rb < 1) return null;
      out.push({ kind: "rows", r1: Math.min(ra, rb), r2: Math.max(ra, rb) });
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Ctrl+clique em célula, linha ou coluna já selecionada: desmarca apenas o alvo
 * (dividindo intervalos maiores quando necessário, igual ao Excel 365).
 * Retorna `null` se o alvo não estava selecionado ou se desmarcá-lo deixaria a seleção vazia.
 */
export function removeFromSelection(
  ranges: GridRange[],
  target: { mode: "cell"; r: number; c: number } | { mode: "col"; c: number; lastRow: number } | { mode: "row"; r: number; lastCol: number },
): GridRange[] | null {
  if (target.mode === "col") {
    const hit = ranges.some((rg) => rg.r1 === 0 && rg.r2 >= target.lastRow && target.c >= rg.c1 && target.c <= rg.c2);
    if (!hit) return null;
    const next: GridRange[] = [];
    for (const rg of ranges) {
      if (rg.r1 === 0 && rg.r2 >= target.lastRow && target.c >= rg.c1 && target.c <= rg.c2) {
        if (rg.c1 < target.c) next.push({ ...rg, c2: target.c - 1 });
        if (rg.c2 > target.c) next.push({ ...rg, c1: target.c + 1 });
      } else next.push(rg);
    }
    return next.length ? next : null;
  }
  if (target.mode === "row") {
    const hit = ranges.some((rg) => rg.c1 === 0 && rg.c2 >= target.lastCol && target.r >= rg.r1 && target.r <= rg.r2);
    if (!hit) return null;
    const next: GridRange[] = [];
    for (const rg of ranges) {
      if (rg.c1 === 0 && rg.c2 >= target.lastCol && target.r >= rg.r1 && target.r <= rg.r2) {
        if (rg.r1 < target.r) next.push({ ...rg, r2: target.r - 1 });
        if (rg.r2 > target.r) next.push({ ...rg, r1: target.r + 1 });
      } else next.push(rg);
    }
    return next.length ? next : null;
  }
  const hit = ranges.some((rg) => target.r >= rg.r1 && target.r <= rg.r2 && target.c >= rg.c1 && target.c <= rg.c2);
  if (!hit) return null;
  const next: GridRange[] = [];
  for (const rg of ranges) {
    if (target.r >= rg.r1 && target.r <= rg.r2 && target.c >= rg.c1 && target.c <= rg.c2) {
      if (rg.r1 < target.r) next.push({ r1: rg.r1, r2: target.r - 1, c1: rg.c1, c2: rg.c2 });
      if (rg.r2 > target.r) next.push({ r1: target.r + 1, r2: rg.r2, c1: rg.c1, c2: rg.c2 });
      if (rg.c1 < target.c) next.push({ r1: target.r, r2: target.r, c1: rg.c1, c2: target.c - 1 });
      if (rg.c2 > target.c) next.push({ r1: target.r, r2: target.r, c1: target.c + 1, c2: rg.c2 });
    } else next.push(rg);
  }
  return next.length ? next : null;
}

const NON_SUMMABLE_TYPES = new Set<SheetColumnType>(["CPF", "CNPJ", "PHONE", "DATE", "CONTACT", "DEAL", "USER", "CHECKBOX"]);

/**
 * Extrai valor numérico para os cálculos da barra de status (Quantidade, Soma e Média).
 * Funciona tanto em colunas numéricas (NUMBER, CURRENCY, PERCENT) quanto em colunas de
 * Texto/Fórmula onde foram colados valores do Excel ("R$ 1.500,00", "1.234,56", "250"),
 * ignorando CPFs, CNPJs, telefones e datas.
 */
export function extractStatNumber(
  col: Pick<ClientColumn, "type">,
  value: CellValue | undefined,
  shown?: { display: string; error?: boolean },
): { num: number; currency: boolean } | null {
  if (NON_SUMMABLE_TYPES.has(col.type)) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return { num: value, currency: col.type === "CURRENCY" };
  }
  // Fórmulas cujo resultado não cabe no tipo guardam a célula vazia e deixam
  // o resultado só em `shown`; string vazia não pode esconder esse resultado.
  const storedText = typeof value === "string" ? value.trim() : "";
  const text = (storedText || (shown && !shown.error ? shown.display : "")).trim();
  if (!text) return null;
  const n = parseLooseNumber(text);
  if (n === null) return null;
  const currency = col.type === "CURRENCY" || /R\$/i.test(text);
  return { num: n, currency };
}


/**
 * Nome para MOSTRAR de uma coluna em menus, filtros e avisos. Coluna sem título
 * (como no Excel, onde a coluna é só a letra) aparece como "Coluna C" — só na
 * exibição; o título guardado continua vazio.
 */
export function columnLabel(col: { name: string }, index: number): string {
  return col.name.trim() || (index >= 0 ? `Coluna ${columnLetter(index)}` : "Coluna sem título");
}
