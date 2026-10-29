/**
 * Formatação no estilo Excel — usado pela tela e pelo servidor (sem
 * dependência de servidor). Duas coisas:
 *
 * 1. Marcações de célula (negrito, itálico, sublinhado, tachado, cor de
 *    preenchimento, cor da fonte, alinhamento), guardadas em SheetRow.formats.
 * 2. "Formatar como Tabela": estilos Claro/Médio/Escuro × 7 cores, faixas,
 *    primeira coluna, linha de totais — guardado em Sheet.settings.table.
 *
 * Engenharia reversa do Excel (comportamento, não código): as cores vêm do
 * tema "Office" (2013–2022), documentado no padrão aberto do .xlsx
 * (ECMA-376 / Office Open XML) — accent1..6, "texto 2", "plano de fundo 2" —
 * e a grade de tons da paleta segue a regra do próprio Excel (clarear 80/60/40%,
 * escurecer 25/50%). Os estilos de tabela seguem os presets TableStyleLight1–7,
 * TableStyleMedium1–7 e TableStyleDark1–7: o nome do preset vai junto na
 * exportação (lib/sheets/io.ts), então o arquivo abre no Excel como tabela de
 * verdade, com o mesmo visual.
 */

import type { CSSProperties } from "react";
import { z } from "zod";

// ─── Paleta (a do botão "Cor de Preenchimento" do Excel) ─────────────

/** Cores do tema Office: Branco, Preto, Cinza (fundo 2), Azul-escuro (texto 2), Ênfases 1–6. */
export const THEME_COLORS = ["#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"] as const;
export const THEME_COLOR_NAMES = ["Branco", "Preto", "Cinza", "Azul-Escuro", "Azul", "Laranja", "Cinza", "Ouro", "Azul", "Verde"];
/** "Cores Padrão" da última linha da paleta. */
export const STANDARD_COLORS = ["#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0"] as const;
export const STANDARD_COLOR_NAMES = ["Vermelho-Escuro", "Vermelho", "Laranja", "Amarelo", "Verde-Claro", "Verde", "Azul-Claro", "Azul", "Azul-Escuro", "Roxo"];

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
/** "Mais claro X%" do Excel: mistura com branco. */
export function tint(hex: string, amount: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
/** "Mais escuro X%" do Excel: mistura com preto. */
export function shade(hex: string, amount: number) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/**
 * Grade de 6 linhas × 10 colunas da paleta de tema, igual à do Excel:
 * cor pura e depois 4 variações (preto/branco têm regra própria de tons).
 */
export function themePaletteGrid(): { hex: string; label: string }[][] {
  return THEME_COLORS.map((base, i) => {
    const name = THEME_COLOR_NAMES[i];
    let variants: [string, string][];
    if (base === "#FFFFFF") variants = [[shade(base, 0.05), "Mais Escuro 5%"], [shade(base, 0.15), "Mais Escuro 15%"], [shade(base, 0.25), "Mais Escuro 25%"], [shade(base, 0.35), "Mais Escuro 35%"], [shade(base, 0.5), "Mais Escuro 50%"]];
    else if (base === "#000000") variants = [[tint(base, 0.5), "Mais Claro 50%"], [tint(base, 0.35), "Mais Claro 35%"], [tint(base, 0.25), "Mais Claro 25%"], [tint(base, 0.15), "Mais Claro 15%"], [tint(base, 0.05), "Mais Claro 5%"]];
    else variants = [[tint(base, 0.8), "Mais Claro 80%"], [tint(base, 0.6), "Mais Claro 60%"], [tint(base, 0.4), "Mais Claro 40%"], [shade(base, 0.25), "Mais Escuro 25%"], [shade(base, 0.5), "Mais Escuro 50%"]];
    return [{ hex: base, label: name }, ...variants.map(([hex, v]) => ({ hex, label: `${name}, ${v}` }))];
  });
}

// ─── Marcações de célula ─────────────────────────────────────────────

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor inválida").transform((s) => s.toUpperCase());
const borderStyle = z.enum(["hair", "thin", "medium", "thick", "double", "dotted", "dashed", "dashDot", "dashDotDot", "mediumDashed", "mediumDashDot", "mediumDashDotDot", "slantDashDot"]);
const borderLineSchema = z.object({ style: borderStyle, color: hex.optional() }).strict();

export const cellFormatSchema = z
  .object({
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    u: z.boolean().optional(),
    s: z.boolean().optional(),
    fill: hex.optional(),
    color: hex.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    borderTop: borderLineSchema.optional(),
    borderRight: borderLineSchema.optional(),
    borderBottom: borderLineSchema.optional(),
    borderLeft: borderLineSchema.optional(),
  })
  .strict();

export type CellFormat = z.infer<typeof cellFormatSchema>;
export type CellBorder = z.infer<typeof borderLineSchema>;
export type RowFormats = Record<string, CellFormat>;

/** Tira chaves "desligadas" (false/vazio) — formato vazio = sem formato (a chave some do JSON). */
export function cleanFormat(f: CellFormat | null | undefined): CellFormat | undefined {
  if (!f) return undefined;
  const out: CellFormat = {};
  if (f.b) out.b = true;
  if (f.i) out.i = true;
  if (f.u) out.u = true;
  if (f.s) out.s = true;
  if (f.fill) out.fill = f.fill;
  if (f.color) out.color = f.color;
  if (f.align) out.align = f.align;
  if (f.borderTop) out.borderTop = { ...f.borderTop };
  if (f.borderRight) out.borderRight = { ...f.borderRight };
  if (f.borderBottom) out.borderBottom = { ...f.borderBottom };
  if (f.borderLeft) out.borderLeft = { ...f.borderLeft };
  return Object.keys(out).length ? out : undefined;
}

/** Estilo CSS de uma célula formatada (a tela usa; a exportação traduz para ExcelJS). */
export function formatCss(f: CellFormat | undefined): CSSProperties | undefined {
  if (!f) return undefined;
  const deco = [f.u && "underline", f.s && "line-through"].filter(Boolean).join(" ");
  const border = (line: CellBorder | undefined) => {
    if (!line) return undefined;
    const width = line.style === "hair" || line.style === "thin" ? 1 : line.style === "medium" || line.style.startsWith("medium") ? 2 : 3;
    const style = line.style === "double" ? "double" : line.style === "dotted" || line.style === "hair" ? "dotted" : line.style.toLowerCase().includes("dash") ? "dashed" : "solid";
    return `${width}px ${style} ${line.color ?? "var(--xl-border-auto, #000000)"}`;
  };
  return {
    fontWeight: f.b ? 700 : undefined,
    fontStyle: f.i ? "italic" : undefined,
    textDecoration: deco || undefined,
    color: f.color,
    backgroundColor: f.fill,
    justifyContent: f.align === "left" ? "flex-start" : f.align === "center" ? "center" : f.align === "right" ? "flex-end" : undefined,
    borderTop: border(f.borderTop),
    borderRight: border(f.borderRight),
    borderBottom: border(f.borderBottom),
    borderLeft: border(f.borderLeft),
  };
}

// ─── Formatar como Tabela ────────────────────────────────────────────

export type TableFamily = "light" | "medium" | "dark";
/** Cor-base de cada um dos 7 estilos de uma família: 0 = neutro (preto/cinza), 1–6 = Ênfases 1–6. */
const TABLE_ACCENTS = ["#000000", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];

export type TableStyleSpec = {
  id: string;
  /** Nome do preset no .xlsx (ex.: TableStyleMedium2) — vai na exportação. */
  excelName: string;
  label: string;
  family: TableFamily;
  header: { fill?: string; color: string; borderBottom?: string };
  band: [string | undefined, string | undefined];
  text: string;
  line?: string;
  totals: { fill?: string; color: string; borderTop: string };
};

function buildStyle(family: TableFamily, idx: number): TableStyleSpec {
  const accent = TABLE_ACCENTS[idx];
  const neutral = idx === 0;
  const n = idx + 1;
  const label = `${family === "light" ? "Claro" : family === "medium" ? "Médio" : "Escuro"} ${n}`;
  const excelName = `TableStyle${family[0].toUpperCase()}${family.slice(1)}${n}`;
  if (family === "light") {
    const band = neutral ? "#D9D9D9" : tint(accent, 0.8);
    return {
      id: `light-${n}`,
      excelName,
      label,
      family,
      header: { color: neutral ? "#000000" : shade(accent, 0.25), borderBottom: accent },
      band: [band, undefined],
      text: neutral ? "#000000" : shade(accent, 0.25),
      totals: { color: neutral ? "#000000" : shade(accent, 0.25), borderTop: accent },
    };
  }
  if (family === "medium") {
    return {
      id: `medium-${n}`,
      excelName,
      label,
      family,
      header: { fill: accent, color: "#FFFFFF" },
      band: [neutral ? "#D9D9D9" : tint(accent, 0.8), undefined],
      text: "#000000",
      line: neutral ? "#BFBFBF" : tint(accent, 0.4),
      totals: { color: "#000000", borderTop: accent },
    };
  }
  return {
    id: `dark-${n}`,
    excelName,
    label,
    family,
    header: { fill: "#000000", color: "#FFFFFF" },
    band: neutral ? ["#737373", "#595959"] : [accent, shade(accent, 0.25)],
    text: "#FFFFFF",
    totals: { fill: neutral ? "#404040" : shade(accent, 0.5), color: "#FFFFFF", borderTop: "#000000" },
  };
}

export const TABLE_STYLES: TableStyleSpec[] = (["light", "medium", "dark"] as const).flatMap((family) =>
  TABLE_ACCENTS.map((_, i) => buildStyle(family, i)),
);
export const TABLE_STYLE_BY_ID = new Map(TABLE_STYLES.map((s) => [s.id, s]));
/** O padrão do Excel ao apertar Ctrl+T: Médio 2 (azul). */
export const DEFAULT_TABLE_STYLE = "medium-2";

export const TOTAL_FNS = ["none", "sum", "avg", "count", "countFilled", "min", "max"] as const;
export type TotalFn = (typeof TOTAL_FNS)[number];
export const TOTAL_FN_LABELS: Record<TotalFn, string> = {
  none: "Nenhum",
  avg: "Média",
  count: "Contagem",
  countFilled: "Contar Números",
  max: "Máx",
  min: "Mín",
  sum: "Soma",
};

export const tableSettingsSchema = z
  .object({
    style: z.string().refine((s) => TABLE_STYLE_BY_ID.has(s), "estilo de tabela inválido"),
    header: z.boolean().default(true),
    banded: z.boolean().default(true),
    firstColumn: z.boolean().default(false),
    totals: z.boolean().default(false),
    totalsFns: z.record(z.string().max(64), z.enum(TOTAL_FNS)).default({}),
    /**
     * Onde a tabela está (Formatar como Tabela sobre uma seleção, como no Excel).
     * Colunas pelas pontas (id; vale tudo entre elas na ordem atual) e linhas pelo
     * número real do Excel (1 = linha dos nomes das colunas). `r2: null` = até o fim
     * dos dados (a tabela cresce com linhas novas). Sem `range` = planilha inteira.
     * Se `r1` > 1, a 1ª linha do intervalo é o cabeçalho da tabela.
     */
    range: z
      .object({
        c1: z.string().min(1).max(64),
        c2: z.string().min(1).max(64),
        r1: z.number().int().min(1),
        r2: z.number().int().min(1).nullable(),
      })
      .optional(),
  })
  .strict();

export type TableRange = { c1: string; c2: string; r1: number; r2: number | null };

/**
 * Onde a tabela cai na grade atual: índices de coluna e linhas reais. Coluna da
 * ponta que foi excluída = a tabela encolhe até a vizinha; as duas fora = sem tabela.
 */
export function resolveTableRange(range: TableRange | undefined, columnIds: string[]): { c1: number; c2: number; r1: number; r2: number } | null {
  if (!columnIds.length) return null;
  if (!range) return { c1: 0, c2: columnIds.length - 1, r1: 1, r2: Number.POSITIVE_INFINITY };
  const a = columnIds.indexOf(range.c1);
  const b = columnIds.indexOf(range.c2);
  if (a < 0 && b < 0) return null;
  const c1 = Math.min(a < 0 ? b : a, b < 0 ? a : b);
  const c2 = Math.max(a < 0 ? b : a, b < 0 ? a : b);
  return { c1, c2, r1: range.r1, r2: range.r2 ?? Number.POSITIVE_INFINITY };
}

export const sheetSettingsSchema = z
  .object({
    table: tableSettingsSchema.nullable().optional(),
  })
  .strict();

export type TableSettings = z.infer<typeof tableSettingsSchema>;
export type SheetSettings = z.infer<typeof sheetSettingsSchema>;

/** Lê settings guardados (tolerante: algo inválido vira "sem tabela", nunca quebra a tela). */
export function readSheetSettings(raw: unknown): SheetSettings {
  const parsed = sheetSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
