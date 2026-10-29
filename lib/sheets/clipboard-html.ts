/**
 * Copiar/colar COM formatação entre o Excel/Google Sheets e as Planilhas.
 *
 * Engenharia reversa do que o Excel põe na área de transferência: além do
 * texto (TSV), ele grava um HTML "text/html" com uma <table>, onde cada <td>
 * aponta para uma classe (.xl65 { font-weight:700; background:yellow; … })
 * definida num <style> no topo, às vezes com estilo inline e tags <b>/<i>/
 * <u>/<s>/<font color>. O Google Sheets usa estilo inline. Aqui:
 * - `parseClipboardHtml`: HTML colado → grade de { texto, marcação };
 * - `buildClipboardHtml`: nossa seleção → HTML no mesmo formato, para o Excel
 *   receber negrito, cores e alinhamento ao colar.
 * Roda só no navegador (DOMParser / canvas para normalizar cores).
 */

import { cleanFormat, type CellBorder, type CellFormat } from "@/lib/sheets/formats";

export type PastedCell = { text: string; format?: CellFormat };

let colorCtx: CanvasRenderingContext2D | null = null;
/** Nomes de cor que o Excel escreve no HTML (os 16 do HTML 4 + laranja); o resto passa pelo canvas do navegador. */
const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  lime: "#00FF00",
  blue: "#0000FF",
  yellow: "#FFFF00",
  aqua: "#00FFFF",
  cyan: "#00FFFF",
  fuchsia: "#FF00FF",
  magenta: "#FF00FF",
  silver: "#C0C0C0",
  gray: "#808080",
  grey: "#808080",
  maroon: "#800000",
  olive: "#808000",
  green: "#008000",
  purple: "#800080",
  teal: "#008080",
  navy: "#000080",
  orange: "#FFA500",
};
/** Qualquer cor CSS ("yellow", "rgb(…)", "#ff0", "windowtext") → "#RRGGBB" (ou undefined). */
export function normalizeColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === "transparent" || v === "none" || v === "inherit" || v === "initial" || v.startsWith("window") || v === "auto") return undefined;
  if (/^#[0-9a-f]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  const rgb = /^rgba?\((\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(v);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return undefined;
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  if (NAMED[v]) return NAMED[v];
  if (typeof document === "undefined") return undefined;
  try {
    colorCtx ??= document.createElement("canvas").getContext("2d");
  } catch {
    return undefined;
  }
  if (!colorCtx) return undefined;
  colorCtx.fillStyle = "#010203";
  colorCtx.fillStyle = v;
  const out = String(colorCtx.fillStyle);
  return out === "#010203" ? undefined : normalizeColor(out);
}

/** Declarações "a:b; c:d" → mapa (último vence, como no CSS). */
function parseDecls(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim().replace(/\s*!important$/, ""));
  }
  return out;
}

/** Regras ".classe { … }" e "td { … }" do <style> que o Excel gera. */
function parseStyleSheet(css: string): { classes: Map<string, Map<string, string>>; td: Map<string, string> } {
  const classes = new Map<string, Map<string, string>>();
  const td = new Map<string, string>();
  const clean = css.replace(/<!--|-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = parseDecls(m[2]);
    for (const selector of m[1].split(",").map((s) => s.trim())) {
      const cls = /^(?:td)?\.([\w-]+)$/i.exec(selector);
      if (cls) classes.set(cls[1], new Map([...(classes.get(cls[1]) ?? []), ...decls]));
      else if (/^td$/i.test(selector)) for (const [k, v] of decls) td.set(k, v);
    }
  }
  return { classes, td };
}

/** Linha CSS do Excel (`.5pt solid windowtext`) → borda validada da célula. */
function parseBorder(raw: string | undefined): CellBorder | undefined {
  if (!raw || /\b(?:none|hidden)\b/i.test(raw)) return undefined;
  const lower = raw.toLowerCase();
  let style: CellBorder["style"] = /double/.test(lower) ? "double" : /dotted/.test(lower) ? "dotted" : /dashed/.test(lower) ? "dashed" : "thin";
  const width = /([\d.]+)\s*(px|pt)/i.exec(raw);
  const pixels = width ? Number(width[1]) * (width[2].toLowerCase() === "pt" ? 4 / 3 : 1) : /\bthick\b/.test(lower) ? 3 : /\bmedium\b/.test(lower) ? 2 : 1;
  if (style === "dashed" && pixels >= 1.5) style = "mediumDashed";
  else if (style === "thin" && pixels >= 2.5) style = "thick";
  else if (style === "thin" && pixels >= 1.5) style = "medium";
  const colorToken = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)\s*$/i.exec(raw)?.[1];
  const color = normalizeColor(colorToken);
  return { style, ...(color ? { color } : {}) };
}

function formatFromDecls(d: Map<string, string>, defaults: Map<string, string>): CellFormat {
  const get = (k: string) => d.get(k);
  const f: CellFormat = {};
  const weight = get("font-weight");
  if (weight && (weight === "bold" || weight === "bolder" || Number(weight) >= 600)) f.b = true;
  if (get("font-style") === "italic") f.i = true;
  const deco = `${get("text-decoration") ?? ""} ${get("text-decoration-line") ?? ""} ${get("text-underline-style") ?? ""}`;
  if (/underline|single|double/.test(deco) && !/none/.test(get("text-underline-style") ?? "")) f.u = true;
  if (/line-through/.test(deco)) f.s = true;
  const color = normalizeColor(get("color"));
  // Preto/automático é o padrão: não vira marcação.
  if (color && color !== "#000000" && color !== normalizeColor(defaults.get("color"))) f.color = color;
  const bg = normalizeColor(get("background-color") ?? get("background")?.split(/\s+/)[0]);
  // O Excel escreve "mso-pattern:black none" junto do fundo — o fundo é a cor.
  if (bg && bg !== "#FFFFFF") f.fill = bg;
  const align = (get("text-align") ?? "").toLowerCase();
  if (align === "center" || align === "right" || align === "left") f.align = align;
  f.borderTop = parseBorder(get("border-top") ?? get("border"));
  f.borderRight = parseBorder(get("border-right") ?? get("border"));
  f.borderBottom = parseBorder(get("border-bottom") ?? get("border"));
  f.borderLeft = parseBorder(get("border-left") ?? get("border"));
  return f;
}

/**
 * HTML da área de transferência → grade. `null` = não é tabela (o chamador
 * usa o texto puro). Células mescladas (colspan/rowspan) viram células vazias
 * ao lado, como o Excel faz ao colar em outro lugar.
 */
export function parseClipboardHtml(html: string): PastedCell[][] | null {
  if (typeof DOMParser === "undefined" || !/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const { classes, td: tdDefaults } = parseStyleSheet([...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n"));

  const grid: PastedCell[][] = [];
  const taken = new Set<string>();
  [...table.querySelectorAll("tr")].forEach((tr, ri) => {
    const line = (grid[ri] ??= []);
    let ci = 0;
    for (const cell of [...tr.children].filter((el) => /^(td|th)$/i.test(el.tagName))) {
      while (taken.has(`${ri}:${ci}`)) ci++;
      const decls = new Map(tdDefaults);
      for (const cls of (cell.getAttribute("class") ?? "").split(/\s+/)) for (const [k, v] of classes.get(cls) ?? []) decls.set(k, v);
      for (const [k, v] of parseDecls(cell.getAttribute("style") ?? "")) decls.set(k, v);
      if (cell.getAttribute("bgcolor")) decls.set("background-color", cell.getAttribute("bgcolor")!);
      if (cell.getAttribute("align")) decls.set("text-align", cell.getAttribute("align")!);
      if (cell.tagName.toLowerCase() === "th") decls.set("font-weight", "700");
      // Estilos de tags internas (<b>, <i>, <u>, <s>, <font>, <span style>), comuns no Google Sheets e no Word.
      for (const el of cell.querySelectorAll("*")) {
        const tag = el.tagName.toLowerCase();
        if (tag === "b" || tag === "strong") decls.set("font-weight", "700");
        if (tag === "i" || tag === "em") decls.set("font-style", "italic");
        if (tag === "u") decls.set("text-decoration", "underline");
        if (tag === "s" || tag === "strike" || tag === "del") decls.set("text-decoration", "line-through");
        if (tag === "font" && el.getAttribute("color")) decls.set("color", el.getAttribute("color")!);
        for (const [k, v] of parseDecls(el.getAttribute("style") ?? "")) if (k !== "background" || !decls.has("background-color")) decls.set(k, v);
      }
      // Texto como o usuário vê: <br> vira quebra de linha; espaços não separáveis viram espaço.
      const clone = cell.cloneNode(true) as HTMLElement;
      for (const br of clone.querySelectorAll("br")) br.replaceWith("\n");
      const text = (clone.textContent ?? "").replace(/ /g, " ").replace(/[ \t]*\r?\n[ \t]*/g, "\n").trim();
      line[ci] = { text, format: cleanFormat(formatFromDecls(decls, tdDefaults)) };
      const colspan = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
      const rowspan = Math.max(1, Number(cell.getAttribute("rowspan")) || 1);
      for (let dr = 0; dr < rowspan; dr++)
        for (let dc = 0; dc < colspan; dc++) {
          if (dr === 0 && dc === 0) continue;
          taken.add(`${ri + dr}:${ci + dc}`);
          (grid[ri + dr] ??= [])[ci + dc] = { text: "" };
        }
      ci += colspan;
    }
  });
  const width = Math.max(0, ...grid.map((l) => l.length));
  return grid.map((l) => Array.from({ length: width }, (_, i) => l[i] ?? { text: "" }));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nossa seleção → HTML no formato que o Excel/Sheets entendem (estilo inline por célula). */
export function buildClipboardHtml(grid: PastedCell[][], opts: { numeric?: boolean[][] } = {}): string {
  const rows = grid
    .map((line, ri) => {
      const cells = line
        .map((cell, ci) => {
          const f = cell.format;
          const borderCss = (border: CellBorder | undefined) => {
            if (!border) return "";
            const width = border.style === "hair" || border.style === "thin" ? "1px" : border.style === "medium" || border.style.startsWith("medium") ? "2px" : "3px";
            const style = border.style === "double" ? "double" : border.style === "dotted" || border.style === "hair" ? "dotted" : border.style.toLowerCase().includes("dash") ? "dashed" : "solid";
            return `${width} ${style} ${border.color ?? "#000000"}`;
          };
          const style = [
            "mso-number-format:\\@",
            f?.b ? "font-weight:700" : "",
            f?.i ? "font-style:italic" : "",
            f?.u || f?.s ? `text-decoration:${[f.u && "underline", f.s && "line-through"].filter(Boolean).join(" ")}` : "",
            f?.color ? `color:${f.color}` : "",
            f?.fill ? `background:${f.fill}` : "",
            f?.align ? `text-align:${f.align}` : "",
            f?.borderTop ? `border-top:${borderCss(f.borderTop)}` : "",
            f?.borderRight ? `border-right:${borderCss(f.borderRight)}` : "",
            f?.borderBottom ? `border-bottom:${borderCss(f.borderBottom)}` : "",
            f?.borderLeft ? `border-left:${borderCss(f.borderLeft)}` : "",
          ]
            .filter(Boolean)
            .filter((d) => !(opts.numeric?.[ri]?.[ci] && d.startsWith("mso-number-format")))
            .join(";");
          return `<td style="${style}">${esc(cell.text).replace(/\n/g, "<br>")}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<html><head><meta charset="utf-8"></head><body><table style="border-collapse:collapse;font-family:Calibri,Aptos,sans-serif;font-size:11pt">${rows}</table></body></html>`;
}
