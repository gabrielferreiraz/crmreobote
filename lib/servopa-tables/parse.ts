/**
 * Transforma o que o robô leu do painel da Servopa (texto) no formato
 * normalizado do CRM. Regra de ouro: o que o site mostra é a verdade — aqui
 * só se converte texto em número/data, NUNCA se corrige valor. Se algo não
 * for reconhecível, lança ServopaParseError (melhor recusar do que gravar lixo).
 */

import { createHash } from "node:crypto";
import type {
  NormalizedGroup,
  NormalizedRow,
  NormalizedTable,
  ScrapedGroup,
  ScrapedListRow,
  ScrapedTab,
} from "@/lib/servopa-tables/types";

export class ServopaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServopaParseError";
  }
}

/** "R$ 1.075,69" → "1075.69". */
export function parseMoney(text: string): string {
  const clean = text.replace(/R\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new ServopaParseError(`Valor em reais inválido: "${text}"`);
  const [int, dec = ""] = clean.split(".");
  return `${int}.${dec.padEnd(2, "0")}`;
}

/** "13,00%" → "13.0000" (4 casas, como o site mostra o % mensal). */
export function parsePercent(text: string): string {
  const clean = text.replace(/%/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(clean)) throw new ServopaParseError(`Percentual inválido: "${text}"`);
  const [int, dec = ""] = clean.split(".");
  return `${int}.${dec.padEnd(4, "0")}`;
}

/** "5.040" → 5040. */
export function parseCount(text: string): number {
  const clean = text.replace(/\./g, "").trim();
  if (!/^\d+$/.test(clean)) throw new ServopaParseError(`Número inválido: "${text}"`);
  return Number(clean);
}

/**
 * "012 - 23/11/2026 - 16:00 HORAS" → { number: "012", at }. A Servopa é de
 * Curitiba: horário de Brasília (UTC-3, sem horário de verão desde 2019).
 */
export function parseAssembly(text: string): { number: string; at: Date } | null {
  const m = text.match(/^(\d+)\s*-\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, number, dd, mm, yyyy, hh, min] = m;
  return { number, at: new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00-03:00`) };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function info(raw: Record<string, string>, label: RegExp): string | null {
  for (const [k, v] of Object.entries(raw)) if (label.test(k) && v.trim()) return v.trim();
  return null;
}

function optional<T>(v: string | null, fn: (s: string) => T | null): T | null {
  if (v === null) return null;
  try {
    return fn(v);
  } catch {
    return null; // campo acessório ilegível não derruba a coleta; o texto original fica em rawInfo
  }
}

export function normalizeTab(tab: ScrapedTab, where: string): NormalizedTable {
  const m = tab.aba?.match(/Taxa de Adm\s*-\s*([\d.,]+\s*%)/i);
  if (!m) throw new ServopaParseError(`${where}: aba sem taxa de ADM ("${tab.aba}")`);
  const admRatePercent = parsePercent(m[1]);
  if (!tab.linhas.length) throw new ServopaParseError(`${where} (ADM ${admRatePercent}): tabela sem linhas`);

  const rows: NormalizedRow[] = tab.linhas.map((c, position) => {
    if (c.length < 9) throw new ServopaParseError(`${where}: linha ${position + 1} com ${c.length} colunas (esperado 9)`);
    const [category, description, credit, term, monthly, installment, insurance, observation, total] = c;
    return {
      position,
      category: category.trim(),
      description: description.trim(),
      creditValue: parseMoney(credit),
      termMonths: parseCount(term),
      monthlyPercent: parsePercent(monthly),
      installment: parseMoney(installment),
      insurance: parseMoney(insurance),
      observation: observation.trim() || null,
      total: parseMoney(total),
    };
  });

  const terms = new Set(rows.map((r) => r.termMonths));
  if (terms.size !== 1) throw new ServopaParseError(`${where} (ADM ${admRatePercent}): prazos diferentes na mesma tabela (${[...terms].join(", ")})`);
  if (new Set(rows.map((r) => r.category)).size !== rows.length) throw new ServopaParseError(`${where} (ADM ${admRatePercent}): categoria repetida`);

  const termMonths = rows[0].termMonths;
  return { admRatePercent, termMonths, rows, contentHash: stableHash({ admRatePercent, termMonths, rows }) };
}

export function normalizeGroup(scraped: ScrapedGroup, list?: ScrapedListRow | null): NormalizedGroup {
  const where = `Grupo ${scraped.grupo}`;
  if (!/^\d+$/.test(scraped.grupo)) throw new ServopaParseError(`Número de grupo inválido: "${scraped.grupo}"`);
  const segment = scraped.segmento === "I" ? "REAL_ESTATE" : scraped.segmento === "M" ? "MOVABLE" : null;
  if (!segment) throw new ServopaParseError(`${where}: segmento desconhecido "${scraped.segmento}"`);
  if (!scraped.tabs.length) throw new ServopaParseError(`${where}: sem nenhuma tabela de taxa`);

  const tables = scraped.tabs.map((t) => normalizeTab(t, where));
  const rates = tables.map((t) => t.admRatePercent);
  if (new Set(rates).size !== rates.length) throw new ServopaParseError(`${where}: duas abas com a mesma taxa de ADM`);

  const raw = scraped.info;
  const assembly = optional(info(raw, /pr.xima assemb/i), parseAssembly);

  const body: Omit<NormalizedGroup, "tables" | "contentHash"> = {
    number: scraped.grupo,
    segment,
    totalMonths: list ? optional(list.meses, parseCount) : null,
    vacancies: list ? optional(list.vagas, parseCount) : null,
    dueDay: optional(info(raw, /vencimento/i), parseCount),
    nextAssemblyNumber: assembly?.number ?? null,
    nextAssemblyAt: assembly?.at ?? null,
    reserveFundPercent: optional(info(raw, /fundo reserva/i), parsePercent),
    insuranceRatePercent: optional(info(raw, /taxa de seguro/i), parsePercent),
    insuranceType: info(raw, /tipo de seguro/i),
    groupType: info(raw, /tipo de grupo/i),
    drawType: info(raw, /tipo de sorteio/i),
    embeddedBidMaxPercent: optional(info(raw, /lance embutido/i), parsePercent),
    membersCount: optional(info(raw, /n.mero de consorciados/i), parseCount),
    contemplationText: scraped.preMessage.trim(),
    rawInfo: raw,
  };
  return { ...body, tables, contentHash: stableHash({ ...body, tables: tables.map((t) => t.contentHash) }) };
}
