/**
 * Tipos de coluna das Planilhas: o que cada um aceita, como guarda e como
 * valida. É a ÚNICA porta de entrada de valor de célula (tela, importação e
 * API v1 passam todos por coerceCellValue) — validação só no navegador se burla.
 *
 * Convenções de armazenamento (em SheetRow.values, JSON):
 * - NUMBER/CURRENCY/PERCENT → number (PERCENT guarda 12.5 para 12,5%)
 * - DATE → "AAAA-MM-DD" (sem hora/fuso, mesma ideia de @db.Date)
 * - CHECKBOX → boolean · MULTI_SELECT → string[]
 * - CPF/CNPJ/PHONE → só dígitos (PHONE normalizado com DDI, ver lib/phone-normalize.ts)
 * - USER/CONTACT/DEAL → id do registro (existência conferida em lib/sheets/rows.ts)
 * - vazio → a chave simplesmente não existe no objeto (nunca null guardado)
 */

import { z } from "zod";
import type { $Enums } from "@/app/generated/prisma/client";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { SHEET_LIMITS } from "@/lib/sheets/limits";

export type SheetColumnType = $Enums.SheetColumnType;

export const SHEET_COLUMN_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "CURRENCY",
  "PERCENT",
  "DATE",
  "CHECKBOX",
  "SELECT",
  "MULTI_SELECT",
  "EMAIL",
  "PHONE",
  "CPF",
  "CNPJ",
  "URL",
  "USER",
  "CONTACT",
  "DEAL",
] as const satisfies readonly SheetColumnType[];

export const SHEET_COLUMN_TYPE_LABELS: Record<SheetColumnType, string> = {
  TEXT: "Texto",
  LONG_TEXT: "Texto longo",
  NUMBER: "Número",
  CURRENCY: "Moeda (R$)",
  PERCENT: "Porcentagem",
  DATE: "Data",
  CHECKBOX: "Caixa de seleção",
  SELECT: "Seleção única",
  MULTI_SELECT: "Seleção múltipla",
  EMAIL: "E-mail",
  PHONE: "Telefone",
  CPF: "CPF",
  CNPJ: "CNPJ",
  URL: "Link",
  USER: "Membro da equipe",
  CONTACT: "Cliente do CRM",
  DEAL: "Negócio do CRM",
};

/** Tipos que apontam para outro registro (precisam conferir existência + índice reverso). */
export const REFERENCE_TYPES = new Set<SheetColumnType>(["USER", "CONTACT", "DEAL"]);
/** Tipos com soma/média nos resumos. */
export const NUMERIC_TYPES = new Set<SheetColumnType>(["NUMBER", "CURRENCY", "PERCENT"]);

const optionSchema = z.string().trim().min(1).max(SHEET_LIMITS.optionChars);

/** Config por tipo — campos desconhecidos são descartados (strict demais quebraria colunas antigas). */
export const columnConfigSchema = z
  .object({
    options: z.array(optionSchema).max(SHEET_LIMITS.optionsPerColumn).optional(),
    decimals: z.number().int().min(0).max(6).optional(),
  })
  .default({});

export type SheetColumnConfig = z.infer<typeof columnConfigSchema>;

/** Valida a config contra o tipo. Devolve a config limpa (só o que o tipo usa) ou a mensagem de erro. */
export function normalizeColumnConfig(type: SheetColumnType, raw: unknown): { ok: true; config: SheetColumnConfig } | { ok: false; error: string } {
  const parsed = columnConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: "Configuração da coluna inválida" };
  const cfg = parsed.data;

  if (type === "SELECT" || type === "MULTI_SELECT") {
    const options = [...new Set(cfg.options ?? [])];
    return { ok: true, config: { options } };
  }
  if (type === "NUMBER" || type === "CURRENCY" || type === "PERCENT") {
    return { ok: true, config: cfg.decimals === undefined ? {} : { decimals: cfg.decimals } };
  }
  return { ok: true, config: {} };
}

export type CellValue = string | number | boolean | string[];

export type ColumnLike = {
  id: string;
  name: string;
  type: SheetColumnType;
  config: unknown;
  required: boolean;
};

export class CellValueError extends Error {
  readonly columnId: string;
  constructor(columnId: string, message: string) {
    super(message);
    this.name = "CellValueError";
    this.columnId = columnId;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_BR_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const CUID_LIKE_RE = /^[a-z0-9]{10,40}$/i;

function optionsOf(col: ColumnLike): string[] {
  const cfg = columnConfigSchema.safeParse(col.config);
  return cfg.success ? (cfg.data.options ?? []) : [];
}

/** Aceita "1.234,56", "1234.56", "R$ 1.234,56", "-R$ 1.234,56", "R$ -", "(1.234,56)", "12,5%" e number. */
export function parseLooseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^(?:R\$\s*)?[-–—]$/i.test(trimmed)) return 0;
  let s = trimmed
    .replace(/^([-+])?\s*R\$\s*/i, "$1")
    .replace(/^R\$\s*([-+])?\s*/i, "$1")
    .replace(/%$/, "")
    .replace(/\s/g, "");
  if (!s) return null;
  if (/^\(\d[\d.,]*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  // Formato brasileiro: vírgula decimal (com ou sem ponto de milhar).
  if (/,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Aceita "AAAA-MM-DD", "DD/MM/AAAA" e ISO completo; devolve "AAAA-MM-DD" ou null. */
export function parseLooseDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = DATE_ISO_RE.exec(s.slice(0, 10));
  const br = DATE_BR_RE.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [y, m, d] = [Number(br[3]), Number(br[2]), Number(br[1])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseLooseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (["true", "1", "sim", "s", "x", "yes", "verdadeiro", "ok"].includes(s)) return true;
  if (["false", "0", "não", "nao", "n", "no", "falso", ""].includes(s)) return false;
  return null;
}

/**
 * Reconhece uma coluna de marcadores lógicos sem confundir uma coluna numérica
 * de 0/1 com checkbox. Usado na importação e ao criar colunas por colagem.
 */
export function isCheckboxLikeColumn(values: unknown[]): boolean {
  const filled = values.filter((value) => value !== null && value !== undefined && !(typeof value === "string" && value.trim() === ""));
  if (!filled.length) return false;
  return filled.every((value) => {
    if (typeof value === "boolean") return true;
    if (typeof value !== "string") return false;
    const word = value
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return ["true", "false", "sim", "nao", "s", "n", "x", "yes", "no", "verdadeiro", "falso", "ok"].includes(word);
  });
}

/**
 * Converte um valor cru (JSON da tela/API ou texto de planilha importada) no
 * formato guardado. `undefined` = célula vazia (a chave é removida). Lança
 * CellValueError com mensagem pronta para mostrar ao usuário.
 */
export function coerceCellValue(col: ColumnLike, raw: unknown): CellValue | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "string" && raw.trim() === "" && col.type !== "CHECKBOX") return undefined;
  if (Array.isArray(raw) && raw.length === 0) return undefined;

  const fail = (msg: string): never => {
    throw new CellValueError(col.id, `"${col.name}": ${msg}`);
  };
  const text = (max: number) => {
    if (typeof raw !== "string" && typeof raw !== "number") fail("precisa ser texto");
    const s = String(raw).trim();
    if (s.length > max) fail(`texto maior que ${max} caracteres`);
    return s;
  };

  switch (col.type) {
    case "TEXT":
      return text(SHEET_LIMITS.textChars);
    case "LONG_TEXT":
      return text(SHEET_LIMITS.longTextChars);
    case "NUMBER":
    case "CURRENCY":
    case "PERCENT": {
      const n = parseLooseNumber(raw);
      if (n === null) fail("precisa ser um número");
      if (Math.abs(n!) > 1e15) fail("número grande demais");
      return n!;
    }
    case "DATE": {
      const d = parseLooseDate(raw);
      if (!d) fail("precisa ser uma data válida (DD/MM/AAAA)");
      return d!;
    }
    case "CHECKBOX": {
      const b = parseLooseBoolean(raw);
      if (b === null) fail("precisa ser sim ou não");
      return b!;
    }
    case "SELECT": {
      const s = text(SHEET_LIMITS.optionChars);
      if (!optionsOf(col).includes(s)) fail(`"${s}" não está entre as opções`);
      return s;
    }
    case "MULTI_SELECT": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;,]/) : fail("precisa ser uma lista");
      const options = optionsOf(col);
      const values = [...new Set((list as unknown[]).map((v) => String(v).trim()).filter(Boolean))];
      for (const v of values) if (!options.includes(v)) fail(`"${v}" não está entre as opções`);
      return values.length ? values : undefined;
    }
    case "EMAIL": {
      const s = text(254).toLowerCase();
      if (!EMAIL_RE.test(s)) fail("e-mail inválido");
      return s;
    }
    case "PHONE": {
      const n = normalizePhoneNumber(text(40));
      if (!n) fail("telefone inválido");
      return n!;
    }
    case "CPF": {
      const digits = normalizeCpf(text(20));
      if (!isValidCpf(digits)) fail("CPF inválido");
      return digits;
    }
    case "CNPJ": {
      const digits = normalizeCnpj(text(25));
      if (!isValidCnpj(digits)) fail("CNPJ inválido");
      return digits;
    }
    case "URL": {
      const s = text(2_000);
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
      } catch {
        return fail("link inválido");
      }
      // Só http(s): "javascript:" num link clicável é XSS esperando acontecer.
      if (url.protocol !== "http:" && url.protocol !== "https:") fail("link precisa começar com http ou https");
      return url.toString();
    }
    case "USER":
    case "CONTACT":
    case "DEAL": {
      if (typeof raw !== "string" || !CUID_LIKE_RE.test(raw)) fail("referência inválida");
      return raw as string;
    }
  }
}

/** Valores de uma linha inteira (patch parcial): coage cada chave conhecida, ignora/recusa as desconhecidas. */
export function coerceRowPatch(
  columns: ColumnLike[],
  patch: Record<string, unknown>,
): { set: Record<string, CellValue>; unset: string[] } {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const set: Record<string, CellValue> = {};
  const unset: string[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const col = byId.get(key);
    if (!col) throw new CellValueError(key, "Coluna inexistente ou arquivada");
    const v = coerceCellValue(col, raw);
    if (v === undefined) unset.push(key);
    else set[key] = v;
  }
  return { set, unset };
}

/** Obrigatórias preenchidas no estado FINAL da linha. */
export function missingRequired(columns: ColumnLike[], values: Record<string, unknown>): ColumnLike | null {
  return columns.find((c) => c.required && (values[c.id] === undefined || values[c.id] === "")) ?? null;
}
