"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, ChevronDown, ExternalLink, Filter } from "lucide-react";
import { isCheckboxLikeColumn, SHEET_COLUMN_TYPE_LABELS, type CellValue, type SheetColumnType } from "@/lib/sheets/column-types";
import {
  clipboardText,
  buildRowOffsets,
  columnLetter,
  displayCell,
  editText,
  extractStatNumber,
  isNumericType,
  isReferenceType,
  parseClipboardGrid,
  removeFromSelection,
  rowAtOffset,
  type ClientColumn,
  type ClientRow,
  type GridRange,
  type NameBoxTarget,
} from "@/lib/sheets/format";
import { formatCss, resolveTableRange, TABLE_STYLE_BY_ID, type CellFormat, type TableSettings } from "@/lib/sheets/formats";
import { buildClipboardHtml, parseClipboardHtml, type PastedCell } from "@/lib/sheets/clipboard-html";
import { SHEET_LIMITS } from "@/lib/sheets/limits";
import { CellEditor, optionColor, type CommitMove } from "./cell-editor";

/** Medidas do Excel em 100% de zoom (linha 20–21px, coluna padrão ~64px; aqui um pouco mais larga para nomes). */
const BASE_ROW = 21;
const BASE_LETTER = 20;
export const DEFAULT_COL_W = 120;
const BASE_FILLER_W = 80;
const MIN_COL_W = 30;
const MAX_AUTO_W = 520;
const OVERSCAN = 12;
const BASE_FONT = 14.5;

/**
 * Coordenadas VISUAIS, como no Excel: linha 0 da grade = linha "1" = os
 * nomes das colunas (cabeçalho da tabela); dados começam na linha "2".
 * Colunas além das existentes são "colunas novas": digitar nelas cria a coluna.
 */
export type Pos = { r: number; c: number };
/**
 * rowIndex = índice nos dados (linha visual − 1); >= rows.length = linha nova.
 * `raw` texto começando com "=" é fórmula digitada (A1). `formula` = fórmula já no
 * formato interno (copiar/arrastar). `format` = marcação colada (null = tirar).
 */
export type CellChange = {
  rowIndex: number;
  colId: string;
  raw: unknown;
  /** Nome do cliente/negócio/membro escolhido (vários membros: { id: nome }). */
  refLabel?: string | Record<string, string>;
  formula?: string;
  format?: CellFormat | null;
};

/** Área de transferência interna: o que foi copiado DAQUI (fórmulas e marcações vão junto ao colar aqui). */
type InternalClip = { text: string; cells: { formula?: string; format?: CellFormat }[][] };
export type PasteSpecialMode = "all" | "values" | "formulas" | "formats" | "transpose";
// Guardada na sessão do navegador (com fallback em memória para cópias maiores que os ~5 MB do sessionStorage).
const CLIP_KEY = "sheets-internal-clip";
let memoryClip: InternalClip | null = null;
function writeInternalClip(clip: InternalClip) {
  memoryClip = clip;
  try {
    sessionStorage.setItem(CLIP_KEY, JSON.stringify(clip));
  } catch {
    /* acima da cota do sessionStorage (~5 MB): fica em memoryClip na aba */
  }
}
function readInternalClip(): InternalClip | null {
  try {
    const raw = sessionStorage.getItem(CLIP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<InternalClip>;
      if (typeof parsed.text === "string" && Array.isArray(parsed.cells) && parsed.cells.every(Array.isArray)) {
        return parsed as InternalClip;
      }
    }
  } catch {
    /* ignora e usa memoryClip */
  }
  return memoryClip;
}

/** Resultado de fórmula que não virou valor guardado (erro, texto em coluna de número…). */
export type FormulaShown = { display: string; error?: boolean };
/** Digitação/colagem à direita da tabela: cria as colunas e grava as células nelas. */
export type NewColumnsRequest = {
  names: Record<number, string>;
  types?: Record<number, SheetColumnType>;
  cells: { rowIndex: number; offset: number; raw: unknown; format?: CellFormat | null; formula?: string }[];
  /** Células das colunas que já existem, do MESMO colar: gravadas junto, numa escrita só (senão as linhas novas saíam em dobro). */
  changes?: CellChange[];
};

export type GridController = {
  moveTo: (p: Pos, extend?: boolean) => void;
  edit: (p?: Pos, initialText?: string | null) => void;
  editNewRow: () => void;
  focus: () => void;
  /** Vai até uma célula pelo número de linha do Excel (Caixa de Nome). false = linha escondida pelo filtro. */
  goTo: (colIndex: number, rowNumber: number) => boolean;
  /** Seleciona células, linhas, colunas ou múltiplos intervalos vindos da Caixa de Nome. */
  selectByNameBox: (targets: NameBoxTarget[]) => boolean;
  selectedRowIds: () => string[];
  selectedColumnIds: () => string[];
  /** Página Inicial → Excluir → Excluir Linhas da Planilha (com o aviso da linha 1). */
  deleteRows: () => void;
  copy: () => void;
  cut: () => void;
  paste: (text: string) => void;
  pasteSpecial: (mode: PasteSpecialMode) => boolean;
  hasInternalClip: () => boolean;
  clear: () => void;
  fillDown: () => void;
  autoFit: (colId?: string) => void;
};

export type ActiveKind = "header" | "cell" | "newColumnHeader" | "newColumnCell";
export type { GridRange };
export type ActiveInfo = {
  pos: Pos;
  range: GridRange;
  ranges: GridRange[];
  selectedColIds: string[];
  rangeLabel: string;
  kind: ActiveKind;
  rowIndex: number;
  isNewRow: boolean;
  isTotals: boolean;
};
export type SelectionStats = { filled: number; sum: number; nums: number; currency: boolean; multi: boolean };

type Props = {
  sheetId: string;
  columns: ClientColumn[];
  rows: ClientRow[];
  refs: Record<string, string>;
  readOnly: boolean;
  widths: Record<string, number>;
  zoom: number;
  showGridlines: boolean;
  showHeadings: boolean;
  showFilterButtons: boolean;
  /** "Formatar como Tabela" ligado (estilo, faixas, totais) — null = intervalo comum. */
  table: TableSettings | null;
  /** Linhas da planilha sem filtro (as linhas novas continuam a numeração daqui). */
  allTotal: number;
  /** Linhas que existem no servidor mas a tela ainda não carregou (vêm logo abaixo das carregadas). */
  pendingRows: number;
  /** Visão filtrada/ordenada: números de linha em azul, como no Excel. */
  filteredView: boolean;
  /** Fórmula da célula em A1 (para editar) — undefined = célula sem fórmula. */
  formulaText: (row: ClientRow, col: ClientColumn) => string | undefined;
  /** Resultado de fórmula a mostrar no lugar do valor guardado. */
  formulaShown: (rowId: string, colId: string) => FormulaShown | undefined;
  /** Exibir > Mostrar Fórmulas (Ctrl+`). */
  showFormulas: boolean;
  /** Texto já formatado de cada célula da Linha de Totais (por id de coluna). */
  totals: Record<string, string>;
  sort: { columnId: string; dir: "asc" | "desc" } | null;
  filteredColumnIds: Set<string>;
  controllerRef: React.Ref<GridController>;
  onActiveChange: (info: ActiveInfo) => void;
  onStats: (stats: SelectionStats) => void;
  onModeChange: (mode: "ready" | "edit" | "enter") => void;
  onResize: (colId: string, width: number) => void;
  onResizeMany?: (colIds: string[], width: number) => void;
  onChanges: (changes: CellChange[]) => void;
  onRenameColumn: (column: ClientColumn, name: string) => void;
  /** Delete com colunas inteiras selecionadas: o editor limpa no servidor as linhas ainda não carregadas. */
  onClearColumns: (columnIds: string[]) => void;
  onCreateColumns: (req: NewColumnsRequest) => void;
  onDeleteRows: (rowIds: string[]) => void;
  /** Excluir colunas inteiras (o editor confirma e arquiva). */
  onDeleteColumns: (columnIds: string[]) => void;
  /** Ctrl+- com células comuns selecionadas: o editor pergunta "linha inteira ou coluna inteira?", como o Excel. */
  onDeleteDialog: (target: { rowIds: string[]; columnIds: string[]; headerOnly: boolean }) => void;
  onRestoreRows: (rowIds: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onLoadMore: () => void;
  onColumnMenu: (column: ClientColumn, at: { x: number; y: number }) => void;
  onAutoFilter: (column: ClientColumn, at: { x: number; y: number }) => void;
  onSortColumn: (column: ClientColumn, dir: "asc" | "desc") => void;
  onFilterByValue: (column: ClientColumn, value: CellValue) => void;
  onRowHistory: (rowId: string) => void;
  onAddOption: (colId: string, option: string) => Promise<boolean>;
  onImport: () => void;
  onTotalsPick: (column: ClientColumn, at: { x: number; y: number }) => void;
  /** Aviso curto ao usuário (atalho que não cabe no tipo da coluna etc.). */
  onNotice: (message: string) => void;
  onShortcut: (action: "bold" | "italic" | "underline" | "strike" | "table" | "filterButtons") => void;
  onSelectionCommit: (range: GridRange) => void;
  formatPainterActive: boolean;
  onPasteSpecial: () => void;
};

type Range = { r1: number; r2: number; c1: number; c2: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function rangeOf(a: Pos, b: Pos): Range {
  return { r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
}

export function cellLabel(p: Pos, rowNumber: (r: number) => number = (r) => r + 1) {
  return `${columnLetter(p.c)}${rowNumber(p.r)}`;
}

const NEW_COLUMN: ClientColumn = { id: "__new", name: "Nova coluna", type: "TEXT", config: {}, required: false, position: 0 };

let measureCtx: CanvasRenderingContext2D | null = null;
/** Largura real do texto na fonte da grade — para o "AutoAjuste" (duplo clique na borda), igual ao Excel. */
function textWidth(text: string, px: number, bold = false) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * px * 0.55;
  measureCtx.font = `${bold ? 700 : 400} ${px}px Aptos, Calibri, "Segoe UI", sans-serif`;
  return measureCtx.measureText(text).width;
}

/**
 * A planilha propriamente dita, no jeito do Excel: letras A, B, C… e números
 * de linha, linha 1 com os nomes das colunas (congelada, com o botão ▾ do
 * AutoFiltro), linhas e colunas vazias até o fim da tela (digitar nelas cria
 * linha/coluna), seleção com borda verde e alça de preenchimento, "formigas
 * marchando" no que foi copiado, teclado e copiar/colar do Excel. Não grava
 * nada sozinha: tudo sai como evento para o editor.
 */
export function SheetGrid(props: Props) {
  const { columns, rows, refs, readOnly, widths, zoom: z, showGridlines, showHeadings } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600, width: 1200 });
  const [sel, setSel] = useState<{ anchor: Pos; focus: Pos }>({ anchor: { r: 1, c: 0 }, focus: { r: 1, c: 0 } });
  const [extraRanges, setExtraRanges] = useState<Range[]>([]);
  const [editing, setEditing] = useState<{ r: number; c: number; initialText: string | null } | null>(null);
  const [headerEdit, setHeaderEdit] = useState<{ c: number; initialText: string | null } | null>(null);
  const [fill, setFill] = useState<{ toRow: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<Range[] | null>(null);
  // Alturas são preferência visual local, como as larguras das colunas.
  // A chave usa o id real da linha para acompanhar filtro/ordenação.
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  // Durante o arraste da borda da coluna, uma camada por cima mantém o cursor ↔ em qualquer lugar da tela.
  const [resizing, setResizing] = useState(false);
  // Modo "apontar": enquanto a fórmula em edição espera referência, clicar numa célula a insere.
  const pointInsert = useRef<((ref: string, extend: boolean) => void) | null>(null);
  const setPointInsert = useCallback((fn: ((ref: string, extend: boolean) => void) | null) => {
    pointInsert.current = fn;
  }, []);
  const dragging = useRef<"select" | "col" | "row" | "fill" | "move" | null>(null);
  const dragPointer = useRef<{ x: number; y: number } | null>(null);
  const moveOrigin = useRef<Pos | null>(null);
  const moveRange = useRef<Range | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ src: Range; dst: Range } | null>(null);
  const moveTargetRef = useRef<{ src: Range; dst: Range } | null>(null);
  // Enter + perda de foco do editor podem disparar juntos: só a primeira saída vale.
  const editSession = useRef(0);
  const closedSession = useRef(-1);

  // ─── Geometria (tudo escala com o zoom) ────────────────────────────
  const ROW = Math.round(BASE_ROW * z);
  const LETTER = showHeadings ? Math.round(BASE_LETTER * z) : 0;
  const HEADER_H = LETTER + ROW; // letras + linha 1 (nomes), ambas congeladas
  const FILLER_W = Math.round(BASE_FILLER_W * z);
  const fontPx = Math.round(BASE_FONT * z * 10) / 10;
  const colCount = columns.length;
  const colW = useCallback((c: ClientColumn) => Math.round((widths[c.id] ?? DEFAULT_COL_W) * z), [widths, z]);
  const offsets = useMemo(() => {
    const out: number[] = [];
    let x = 0;
    for (const c of columns) {
      out.push(x);
      x += colW(c);
    }
    out.push(x);
    return out;
  }, [columns, colW]);
  const dataWidth = offsets[offsets.length - 1];

  const screenRows = Math.ceil((viewport.height - HEADER_H) / ROW) + 2;
  const maxExtraRow = extraRanges.reduce((m, rg) => Math.max(m, rg.r2), 0);
  // Linhas visuais: 0 = cabeçalho; dados; e linhas vazias até encher a tela (andar além estica a grade).
  const rowCount = readOnly ? rows.length + 1 : Math.max(rows.length + 2, screenRows, sel.focus.r + 2, sel.anchor.r + 2, maxExtraRow + 2);
  const RN_W = showHeadings ? Math.round(Math.max(36, String(rowCount).length * 8 + 14) * z) : 0;
  // Como no Excel, as colunas não acabam: sempre pelo menos A…Z na tela, mais o que couber na largura.
  const fillerCols = readOnly ? 0 : Math.max(3, 26 - colCount, Math.ceil((viewport.width - RN_W - dataWidth) / FILLER_W) + 1);
  const visualCols = colCount + fillerCols;
  const totalWidth = RN_W + dataWidth + fillerCols * FILLER_W;
  const xOf = (c: number) => RN_W + (c < colCount ? offsets[c] : dataWidth + (c - colCount) * FILLER_W);
  const wOf = (c: number) => (c < colCount ? colW(columns[c]) : FILLER_W);
  const maxRow = readOnly ? rows.length : Math.max(screenRows, rows.length + 500);
  const maxCol = Math.max(0, (readOnly ? colCount : visualCols) - 1);

  const tableSpec = props.table ? TABLE_STYLE_BY_ID.get(props.table.style) : undefined;
  // Onde a tabela está (Formatar como Tabela sobre uma seleção). Sem intervalo = planilha inteira.
  const tableAt = useMemo(() => (props.table ? resolveTableRange(props.table.range, columns.map((c) => c.id)) : null), [props.table, columns]);
  const inTableCol = (c: number) => !!tableAt && c >= tableAt.c1 && c <= tableAt.c2;
  // Linha de Totais logo abaixo dos dados, como no Excel — só quando a tabela vai até o fim dos dados.
  const totalsRow = props.table?.totals && (!props.table.range || props.table.range.r2 === null) ? rows.length + 1 : -1;

  const rowHeightKey = `sheet-row-heights:${props.sheetId}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(rowHeightKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência só existe no navegador
      if (saved) setRowHeights(JSON.parse(saved));
    } catch {
      /* sem armazenamento local: altura padrão */
    }
  }, [rowHeightKey]);

  const rowKey = useCallback((r: number) => rows[r - 1]?.id ?? `visual:${r}`, [rows]);
  const hOf = useCallback((r: number) => Math.round((rowHeights[rowKey(r)] ?? BASE_ROW) * z), [rowHeights, rowKey, z]);
  const rowOffsets = useMemo(() => buildRowOffsets(rowCount, HEADER_H, hOf), [rowCount, HEADER_H, hOf]);
  const yOf = useCallback((r: number) => (r <= 0 ? LETTER : rowOffsets[Math.min(r, rowCount)]), [LETTER, rowOffsets, rowCount]);
  const rowAtY = useCallback((y: number) => rowAtOffset(rowOffsets, y, rowCount), [rowOffsets, rowCount]);

  /** Número de linha do Excel: posição real da linha (não muda com filtro/ordenação); linhas novas continuam do fim. */
  const rowNumber = (r: number) => {
    if (r === 0) return 1;
    const row = rows[r - 1];
    if (row) return (row.rank ?? r) + 1;
    const k = r - rows.length - (totalsRow > 0 && r > totalsRow ? 1 : 0);
    if (k <= props.pendingRows) {
      // Ainda carregando: sem filtro a numeração é contínua; com filtro, aproximada até carregar.
      const last = rows.length ? (rows[rows.length - 1].rank ?? rows.length) : 0;
      return props.filteredView ? last + k + 1 : rows.length + k + 1;
    }
    return props.allTotal + 1 + (k - props.pendingRows);
  };

  const range = useMemo(() => rangeOf(sel.anchor, sel.focus), [sel.anchor, sel.focus]);
  const allRanges = useMemo(() => [...extraRanges, range], [extraRanges, range]);
  const multiCell = extraRanges.length > 0 || range.r1 !== range.r2 || range.c1 !== range.c2;
  const inRange = (r: number, c: number) => allRanges.some((rg) => r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2);
  const lastDataRow = Math.max(rows.length, 1);
  const lastDataCol = Math.max(colCount - 1, 0);
  const isColInSelection = (c: number) => allRanges.some((rg) => c >= rg.c1 && c <= rg.c2);
  const isFullColSelected = (c: number) => allRanges.some((rg) => c >= rg.c1 && c <= rg.c2 && rg.r1 <= 1 && rg.r2 >= lastDataRow);
  const isRowInSelection = (r: number) => allRanges.some((rg) => r >= rg.r1 && r <= rg.r2);
  const isFullRowSelected = (r: number) => allRanges.some((rg) => r >= rg.r1 && r <= rg.r2 && rg.c1 === 0 && rg.c2 >= lastDataCol);
  const fullColsSelected = useMemo(() => {
    const out: number[] = [];
    for (let c = 0; c < colCount; c++) {
      if (allRanges.some((rg) => c >= rg.c1 && c <= rg.c2 && rg.r1 <= 1 && rg.r2 >= lastDataRow)) out.push(c);
    }
    return out;
  }, [allRanges, colCount, lastDataRow]);
  const selectedColIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<number>();
    for (const rg of allRanges) {
      for (let c = rg.c1; c <= Math.min(rg.c2, colCount - 1); c++) {
        if (!seen.has(c)) {
          seen.add(c);
          ids.push(columns[c].id);
        }
      }
    }
    return ids;
  }, [allRanges, colCount, columns]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = clamp(rowAtY(Math.max(HEADER_H, viewport.top)) - OVERSCAN, 1, rowCount);
  const last = clamp(rowAtY(viewport.top + viewport.height) + OVERSCAN + 1, 1, rowCount);

  function onScroll() {
    const el = scrollRef.current!;
    setViewport({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    setMenu(null);
    if (el.scrollTop + el.clientHeight > yOf(Math.max(1, rows.length - 40))) props.onLoadMore();
  }

  const focusGrid = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);

  function scrollIntoView(p: Pos, opts?: { skipVertical?: boolean; skipHorizontal?: boolean; smooth?: boolean }) {
    const el = scrollRef.current;
    if (!el) return;
    let nextTop = el.scrollTop;
    let nextLeft = el.scrollLeft;
    if (!opts?.skipVertical && p.r >= 1) {
      const top = yOf(p.r);
      const height = hOf(p.r);
      if (top - HEADER_H < el.scrollTop) nextTop = top - HEADER_H;
      else if (top + height > el.scrollTop + el.clientHeight) nextTop = top + height - el.clientHeight + 2;
    }
    if (!opts?.skipHorizontal) {
      const left = xOf(p.c);
      const right = left + wOf(p.c);
      if (left - RN_W < el.scrollLeft) nextLeft = left - RN_W;
      else if (right > el.scrollLeft + el.clientWidth) nextLeft = right - el.clientWidth + 2;
    }
    if (nextTop !== el.scrollTop || nextLeft !== el.scrollLeft) {
      const dist = Math.hypot(nextLeft - el.scrollLeft, nextTop - el.scrollTop);
      if (opts?.smooth || dist > ROW * 2.5) {
        el.scrollTo({ top: nextTop, left: nextLeft, behavior: "smooth" });
      } else {
        el.scrollTop = nextTop;
        el.scrollLeft = nextLeft;
      }
    }
  }

  function moveTo(p: Pos, extend = false) {
    const np = { r: clamp(p.r, 0, maxRow), c: clamp(p.c, 0, maxCol) };
    const extendingFullCol = extend && sel.anchor.r === 0 && sel.focus.r >= lastDataRow && np.r === sel.focus.r;
    const extendingFullRow = extend && sel.anchor.c === 0 && sel.focus.c >= lastDataCol && np.c === sel.focus.c;
    const bigJump = Math.abs(np.r - sel.focus.r) > 2 || Math.abs(np.c - sel.focus.c) > 2;
    if (!extend) setExtraRanges([]);
    setSel((s) => (extend ? { anchor: s.anchor, focus: np } : { anchor: np, focus: np }));
    scrollIntoView(np, { skipVertical: extendingFullCol, skipHorizontal: extendingFullRow, smooth: bigJump });
  }

  // Grade encolheu (filtro, exclusão, coluna arquivada): seleção não pode apontar para fora.
  useEffect(() => {
    const fix = (p: Pos) => ({ r: clamp(p.r, 0, maxRow), c: clamp(p.c, 0, maxCol) });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- corrige a seleção quando a grade encolhe
    setSel((s) => {
      const a = fix(s.anchor);
      const f = fix(s.focus);
      return a.r === s.anchor.r && a.c === s.anchor.c && f.r === s.focus.r && f.c === s.focus.c ? s : { anchor: a, focus: f };
    });
    setExtraRanges((list) =>
      list.length
        ? list.map((rg) => ({
            r1: clamp(rg.r1, 0, maxRow),
            r2: clamp(rg.r2, 0, maxRow),
            c1: clamp(rg.c1, 0, maxCol),
            c2: clamp(rg.c2, 0, maxCol),
          }))
        : list,
    );
  }, [maxRow, maxCol]);

  const prevLastDataRow = useRef(lastDataRow);
  useEffect(() => {
    const prev = prevLastDataRow.current;
    prevLastDataRow.current = lastDataRow;
    if (lastDataRow > prev) {
      setSel((s) => (s.anchor.r === 0 && s.focus.r === prev ? { anchor: s.anchor, focus: { r: lastDataRow, c: s.focus.c } } : s));
      setExtraRanges((list) =>
        list.some((rg) => rg.r1 === 0 && rg.r2 === prev)
          ? list.map((rg) => (rg.r1 === 0 && rg.r2 === prev ? { ...rg, r2: lastDataRow } : rg))
          : list,
      );
    }
  }, [lastDataRow]);

  const { onLoadMore } = props;
  useEffect(() => {
    if (fullColsSelected.length > 0) onLoadMore();
  }, [fullColsSelected.length, rows.length, onLoadMore]);

  const valueAt = (r: number, c: number): CellValue | undefined => (r >= 1 && c < colCount ? rows[r - 1]?.values[columns[c].id] : undefined);

  // ─── Avisos para a barra de fórmulas / barra de status ─────────────
  const { onActiveChange, onStats, onModeChange, formulaShown } = props;
  useEffect(() => {
    const f = sel.focus;
    const kind: ActiveKind = f.r === 0 ? (f.c < colCount ? "header" : "newColumnHeader") : f.c < colCount ? "cell" : "newColumnCell";
    const formatOne = (rg: Range) => {
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return cellLabel({ r: rg.r1, c: rg.c1 }, rowNumber);
      return `${cellLabel({ r: rg.r1, c: rg.c1 }, rowNumber)}:${cellLabel({ r: rg.r2, c: rg.c2 }, rowNumber)}`;
    };
    onActiveChange({
      pos: f,
      range: { r1: range.r1, r2: range.r2, c1: range.c1, c2: range.c2 },
      ranges: allRanges,
      selectedColIds,
      isTotals: f.r === totalsRow,
      rangeLabel: allRanges.length > 1 ? allRanges.map(formatOne).join("; ") : multiCell ? formatOne(range) : cellLabel(f, rowNumber),
      kind,
      rowIndex: f.r - 1,
      isNewRow: f.r - 1 >= rows.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowNumber deriva de rows/allTotal, já listados
  }, [sel.focus, range, allRanges, selectedColIds, multiCell, rows, props.allTotal, colCount, totalsRow, onActiveChange]);

  useEffect(() => {
    let filled = 0;
    let sum = 0;
    let nums = 0;
    let currencyCount = 0;
    const seen = new Set<string>();
    const seenHeaderCols = new Set<number>();
    const hasDataRowInSel = allRanges.some((rg) => rg.r2 >= 1);
    for (const rg of allRanges) {
      for (let r = Math.max(rg.r1, 1); r <= Math.min(rg.r2, rows.length); r++) {
        const row = rows[r - 1];
        if (!row) continue;
        for (let c = rg.c1; c <= Math.min(rg.c2, colCount - 1); c++) {
          const key = `${r}:${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const col = columns[c];
          const v = row.values[col.id];
          const shown = row.formulas?.[col.id] ? formulaShown(row.id, col.id) : undefined;
          const isFilled =
            (v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) ||
            (shown !== undefined && shown.display !== "");
          if (!isFilled) continue;
          filled++;
          const extracted = extractStatNumber(col, v, shown);
          if (extracted !== null) {
            sum += extracted.num;
            nums++;
            if (extracted.currency) currencyCount++;
          }
        }
      }
      // Só conta cabeçalhos da linha 1 quando a seleção inteira está na linha 1.
      if (!hasDataRowInSel && rg.r1 === 0) {
        for (let c = rg.c1; c <= Math.min(rg.c2, colCount - 1); c++) seenHeaderCols.add(c);
      }
    }
    filled += seenHeaderCols.size;
    onStats({ filled, sum, nums, currency: nums > 0 && currencyCount === nums, multi: multiCell });
  }, [allRanges, rows, columns, colCount, multiCell, formulaShown, onStats]);

  useEffect(() => {
    onModeChange(editing || headerEdit ? (editing?.initialText !== null || headerEdit?.initialText !== null ? "enter" : "edit") : "ready");
  }, [editing, headerEdit, onModeChange]);

  // ─── Edição ────────────────────────────────────────────────────────
  function startEdit(r: number, c: number, initialText: string | null) {
    if (readOnly || c > maxCol) return;
    setCopied(null);
    scrollIntoView({ r, c });
    // Ao digitar com várias células selecionadas, o Excel conserva a seleção
    // para que Ctrl+Enter consiga confirmar a entrada em todo o bloco.
    if (!inRange(r, c)) {
      setExtraRanges([]);
      setSel({ anchor: { r, c }, focus: { r, c } });
    }
    if (r === 0) {
      setHeaderEdit({ c, initialText });
      return;
    }
    if (r === totalsRow) return;
    const row = rows[r - 1];
    // Linha que existe no servidor mas a tela ainda não trouxe (rolagem rápida): carrega antes —
    // digitar ali gravaria por cima de um dado que a pessoa nem viu.
    if (!row && r - 1 < rows.length + props.pendingRows) {
      props.onLoadMore();
      props.onNotice("Carregando esta parte da planilha — tente de novo em instantes");
      return;
    }
    const hasFormula = !!(row && c < colCount && row.formulas?.[columns[c].id]);
    if (c < colCount && columns[c].type === "CHECKBOX" && !hasFormula && !initialText?.startsWith("=")) {
      props.onChanges([{ rowIndex: r - 1, colId: columns[c].id, raw: !valueAt(r, c) }]);
      return;
    }
    editSession.current++;
    setEditing({ r, c, initialText });
  }

  const moveDelta = (move: CommitMove): [number, number] => ({ down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1], none: [0, 0], selection: [0, 0] })[move] as [number, number];

  function commitEdit(raw: unknown, move: CommitMove, refLabel?: string | Record<string, string>) {
    if (!editing || closedSession.current === editSession.current) return;
    closedSession.current = editSession.current;
    const { r, c } = editing;
    const rowIndex = r - 1;
    setEditing(null);
    const blank = raw === null || raw === "" || (Array.isArray(raw) && !raw.length);
    if (move === "selection" && c < colCount) {
      const changes: CellChange[] = [];
      const seen = new Set<string>();
      for (const rg of allRanges) {
        for (let rr = Math.max(rg.r1, 1); rr <= rg.r2; rr++) {
          for (let cc = rg.c1; cc <= Math.min(rg.c2, colCount - 1); cc++) {
            const key = `${rr}:${cc}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!(rr - 1 >= rows.length && blank)) changes.push({ rowIndex: rr - 1, colId: columns[cc].id, raw, refLabel });
          }
        }
      }
      if (changes.length) props.onChanges(changes);
      requestAnimationFrame(focusGrid);
      return;
    }
    if (c >= colCount) {
      if (!blank) props.onCreateColumns({ names: {}, cells: [{ rowIndex, offset: c - colCount, raw }] });
    } else {
      const col = columns[c];
      const current = valueAt(r, c);
      const row = rows[rowIndex];
      const currentFormula = row ? props.formulaText(row, col) : undefined;
      const same = currentFormula !== undefined ? raw === currentFormula :
        (raw === null && current === undefined) ||
        (typeof raw === "string" && raw === editText(col, current)) ||
        (Array.isArray(raw) && JSON.stringify(raw) === JSON.stringify(current ?? [])) ||
        (isReferenceType(col.type) && raw === current);
      if (!same && !(rowIndex >= rows.length && blank)) props.onChanges([{ rowIndex, colId: col.id, raw, refLabel }]);
    }
    const [dr, dc] = moveDelta(move);
    if (move !== "none") moveTo({ r: r + dr, c: c + dc });
    requestAnimationFrame(focusGrid);
  }

  function commitHeader(c: number, text: string, move: CommitMove) {
    setHeaderEdit(null);
    const name = text.trim();
    if (c < colCount) {
      if (name && name !== columns[c].name) props.onRenameColumn(columns[c], name);
    } else if (name) {
      props.onCreateColumns({ names: { [c - colCount]: name }, cells: [] });
    }
    const [dr, dc] = moveDelta(move);
    if (move !== "none") moveTo({ r: dr, c: c + dc });
    requestAnimationFrame(focusGrid);
  }

  function clearRange() {
    if (readOnly) return;
    setCopied(null);
    const changes: CellChange[] = [];
    const seen = new Set<string>();
    for (const rg of allRanges) {
      for (let r = Math.max(rg.r1, 1); r <= Math.min(rg.r2, rows.length); r++)
        for (let c = rg.c1; c <= Math.min(rg.c2, colCount - 1); c++) {
          const key = `${r}:${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (valueAt(r, c) !== undefined || rows[r - 1]?.formulas?.[columns[c].id]) changes.push({ rowIndex: r - 1, colId: columns[c].id, raw: null });
        }
      // Linha 1 dentro da seleção: o título da coluna também é conteúdo e sai (a coluna fica, sem título).
      if (rg.r1 === 0) {
        for (let c = rg.c1; c <= Math.min(rg.c2, colCount - 1); c++) {
          const key = `0:${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (columns[c].name.trim()) props.onRenameColumn(columns[c], "");
        }
      }
    }
    if (changes.length) props.onChanges(changes);
    // Coluna inteira selecionada (pela letra): limpa também as linhas que a tela ainda não carregou.
    if (fullColsSelected.length) props.onClearColumns(fullColsSelected.map((c) => columns[c].id));
  }

  /**
   * Linhas e colunas efetivas da seleção (suporta múltiplos intervalos: ex. linhas
   * ou colunas não-adjacentes selecionadas com Ctrl+clique, igual ao Ctrl+C do Excel).
   */
  function selectionAxes(): { rs: number[]; cs: number[] } {
    const rSet = new Set<number>();
    const cSet = new Set<number>();
    for (const rg of allRanges) {
      for (let r = rg.r1; r <= Math.min(rg.r2, rows.length); r++) rSet.add(r);
      for (let c = rg.c1; c <= rg.c2; c++) cSet.add(c);
    }
    return {
      rs: [...rSet].sort((a, b) => a - b),
      cs: [...cSet].sort((a, b) => a - b),
    };
  }

  function rangeTsv() {
    const { rs, cs } = selectionAxes();
    const lines: string[] = [];
    for (const r of rs) {
      const cells: string[] = [];
      for (const c of cs) {
        if (!inRange(r, c) || c >= colCount) cells.push("");
        else if (r === 0) cells.push(columns[c].name);
        else cells.push(clipboardText(columns[c], valueAt(r, c), refs));
      }
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  }

  /** Seleção como grade de { texto, marcação } + o que vai na área de transferência interna. */
  function rangeClip(): { text: string; html: string } {
    const text = rangeTsv();
    const { rs, cs } = selectionAxes();
    const html: PastedCell[][] = [];
    const cells: InternalClip["cells"] = [];
    for (const r of rs) {
      const hl: PastedCell[] = [];
      const cl: InternalClip["cells"][number] = [];
      for (const c of cs) {
        if (!inRange(r, c)) {
          hl.push({ text: "", format: undefined });
          cl.push({});
          continue;
        }
        const col = columns[c];
        const row = rows[r - 1];
        const shown = row && col ? props.formulaShown(row.id, col.id) : undefined;
        const cellText = !col ? "" : r === 0 ? col.name : (shown?.display ?? clipboardText(col, valueAt(r, c), refs));
        const format = r === 0 ? { b: true } : row?.formats?.[col?.id ?? ""];
        hl.push({ text: cellText, format });
        cl.push({ formula: row && col ? row.formulas?.[col.id] : undefined, format: r === 0 ? undefined : format });
      }
      html.push(hl);
      cells.push(cl);
    }
    writeInternalClip({ text, cells });
    return { text, html: buildClipboardHtml(html) };
  }

  function copyRange(cut = false) {
    const { text, html } = rangeClip();
    // Texto + HTML (o Excel pega negrito/cores do HTML). Navegador sem ClipboardItem: só texto.
    try {
      const item = new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) });
      navigator.clipboard?.write([item]).catch(() => navigator.clipboard?.writeText(text));
    } catch {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
    setCopied(allRanges);
    if (cut) clearRange();
    return text;
  }

  /**
   * Cola uma grade de texto a partir da célula ativa. Um valor só numa seleção
   * maior preenche a seleção inteira. Colar na linha 1 renomeia colunas; colar
   * à direita da tabela cria as colunas que faltarem (como a tabela do Excel).
   */
  /**
   * Cola a partir da célula ativa. `rich` = marcações (do HTML do Excel ou da
   * cópia interna) e fórmulas (só da cópia interna — o Excel não manda fórmula
   * no HTML, manda o valor, igual a colar de outro programa).
   */
  function pasteGrid(grid: string[][], rich?: { format?: CellFormat; formula?: string }[][], mode: PasteSpecialMode = "all") {
    if (readOnly || !grid.length) return;
    if (mode === "transpose") {
      const width = grid.reduce((m, line) => Math.max(m, line.length), 0);
      const transposed = Array.from({ length: width }, (_, c) => grid.map((line) => line[c] ?? ""));
      const richTransposed = rich ? Array.from({ length: width }, (_, c) => rich.map((line) => line[c] ?? {})) : undefined;
      pasteGrid(transposed, richTransposed, "all");
      return;
    }
    setCopied(null);
    const changes: CellChange[] = [];
    const newCols: NewColumnsRequest = { names: {}, types: {}, cells: [] };
    const pasteMaxCol = SHEET_LIMITS.columnsPerSheet - 1;
    const put = (r: number, c: number, text: string, extra?: { format?: CellFormat; formula?: string }) => {
      if (c > pasteMaxCol) return;
      const t = text.trim();
      const pasteFormat = mode === "all" || mode === "formats";
      const pasteContent = mode !== "formats";
      const pasteFormula = mode === "all" || mode === "formulas";
      const format = pasteFormat && rich ? (extra?.format ?? null) : undefined;
      const formula = pasteFormula ? extra?.formula : undefined;
      if (r === 0) {
        if (mode === "formats") return;
        if (c < colCount) {
          if (t && t !== columns[c].name) props.onRenameColumn(columns[c], t);
        } else if (t) newCols.names[c - colCount] = t;
        return;
      }
      if (r === totalsRow) return;
      if (c >= colCount) {
        if ((pasteContent && t) || formula || extra?.format) {
          newCols.cells.push({
            rowIndex: r - 1,
            offset: c - colCount,
            raw: pasteContent ? (t === "" ? null : t) : undefined,
            format,
            ...(formula ? { formula } : {}),
          });
        }
        return;
      }
      const col = columns[c];
      const raw = t === "" ? null : col.type === "MULTI_SELECT" ? t.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : t;
      if (!(r - 1 >= rows.length && (!pasteContent || raw === null) && !formula && !extra?.format)) {
        changes.push({ rowIndex: r - 1, colId: col.id, raw: pasteContent ? raw : undefined, format, ...(formula ? { formula } : {}) });
      }
    };
    if (grid.length === 1 && grid[0].length === 1 && multiCell) {
      const seen = new Set<string>();
      for (const rg of allRanges) {
        for (let r = rg.r1; r <= rg.r2; r++) {
          for (let c = rg.c1; c <= rg.c2; c++) {
            const key = `${r}:${c}`;
            if (seen.has(key)) continue;
            seen.add(key);
            put(r, c, grid[0][0], rich?.[0]?.[0]);
          }
        }
      }
    } else {
      // Como no Excel: cola a partir do canto superior esquerdo da seleção. Se a seleção for
      // múltipla exata do que foi copiado (ex.: 2 linhas copiadas, 6 selecionadas), repete
      // até preencher; senão cola só o tamanho copiado.
      const h = grid.length;
      const width = grid.reduce((m, l) => Math.max(m, l.length), 0);
      const selH = range.r2 - range.r1 + 1;
      const selW = range.c2 - range.c1 + 1;
      const tile = extraRanges.length === 0 && multiCell && selH % h === 0 && selW % width === 0;
      const repR = tile ? selH / h : 1;
      const repC = tile ? selW / width : 1;
      for (let tr = 0; tr < repR; tr++)
        for (let tc = 0; tc < repC; tc++)
          grid.forEach((line, i) => line.forEach((text, j) => put(range.r1 + tr * h + i, range.c1 + tc * width + j, text, rich?.[i]?.[j])));
      setExtraRanges([]);
      setSel({ anchor: { r: range.r1, c: range.c1 }, focus: { r: Math.min(range.r1 + h * repR - 1, maxRow), c: Math.min(range.c1 + width * repC - 1, maxCol) } });
    }
    const newOffsets = new Set(newCols.cells.map((cell) => cell.offset));
    for (const offset of newOffsets) {
      const cells = newCols.cells.filter((cell) => cell.offset === offset);
      if (!cells.some((cell) => cell.formula) && isCheckboxLikeColumn(cells.map((cell) => cell.raw))) {
        newCols.types![offset] = "CHECKBOX";
      }
    }
    // Uma escrita só: colunas novas primeiro e, junto, as células das colunas existentes.
    if (Object.keys(newCols.names).length || newCols.cells.length) props.onCreateColumns({ ...newCols, changes });
    else if (changes.length) props.onChanges(changes);
  }

  /** Lê texto + HTML da área de transferência (menu "Colar"); sem permissão, só texto. */
  async function pasteFromSystemClipboard() {
    try {
      let text = "";
      let html = "";
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
        if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
      }
      if (text || html) return pasteFromClipboard(text, html);
    } catch {
      /* navegador sem clipboard.read: cai no texto puro */
    }
    const text = await navigator.clipboard?.readText().catch(() => "");
    if (text) pasteFromClipboard(text, "");
  }

  /** Linhas inteiras (clique no número) da seleção. */
  function fullRowsInSelection() {
    return allRanges.some((rg) => rg.c1 === 0 && rg.c2 >= lastDataCol && rg.r2 >= 1);
  }

  /** Excluir linhas: só linhas com dados; a linha 1 são os títulos e não sai (Delete limpa). */
  function deleteSelectedRows() {
    if (readOnly) return;
    const ids = selectedRowIds();
    if (!ids.length) {
      props.onNotice(
        allRanges.some((rg) => rg.r1 === 0)
          ? "A linha 1 guarda os títulos das colunas e não é excluída — use Delete para limpar os títulos"
          : "Não há linhas com dados na seleção",
      );
      return;
    }
    props.onDeleteRows(ids);
  }

  function deleteSelectedColumns() {
    if (readOnly) return;
    if (!selectedColIds.length) {
      props.onNotice("Não há colunas com dados na seleção");
      return;
    }
    props.onDeleteColumns(selectedColIds);
  }

  /** Ctrl+- (Excluir): linhas inteiras → exclui linhas; colunas inteiras → exclui colunas; senão pergunta. */
  function deleteShortcut() {
    if (readOnly) return;
    const rowsFull = fullRowsInSelection();
    const colsFull = fullColsSelected.length > 0;
    if (rowsFull && !colsFull) return deleteSelectedRows();
    if (colsFull && !rowsFull) return deleteSelectedColumns();
    props.onDeleteDialog({ rowIds: selectedRowIds(), columnIds: selectedColIds, headerOnly: allRanges.every((rg) => rg.r2 === 0) });
  }

  /** Decide a origem do que foi colado: cópia daqui (fórmulas + marcações), HTML do Excel/Sheets (marcações) ou texto puro. */
  function pasteFromClipboard(text: string, html: string, mode: PasteSpecialMode = "all") {
    const internal = readInternalClip();
    if (internal && text.replace(/\r\n/g, "\n") === internal.text) {
      pasteGrid(parseClipboardGrid(text), internal.cells, mode);
      return;
    }
    const parsed = html ? parseClipboardHtml(html) : null;
    if (parsed && parsed.length) {
      pasteGrid(
        parsed.map((line) => line.map((c) => c.text)),
        parsed.map((line) => line.map((c) => ({ format: c.format }))),
      );
      return;
    }
    pasteGrid(parseClipboardGrid(text));
  }

  function pasteSpecial(mode: PasteSpecialMode) {
    const internal = readInternalClip();
    if (!internal) return false;
    pasteGrid(parseClipboardGrid(internal.text), internal.cells, mode);
    return true;
  }

  function selectedRowIds() {
    const ids: string[] = [];
    const seen = new Set<number>();
    for (const rg of allRanges) {
      for (let r = Math.max(rg.r1, 1); r <= Math.min(rg.r2, rows.length); r++) {
        if (!seen.has(r)) {
          seen.add(r);
          ids.push(rows[r - 1].id);
        }
      }
    }
    return ids;
  }

  function selectedColumnIds() {
    return selectedColIds;
  }

  /** Ctrl+seta: pula até a borda do bloco preenchido (como no Excel). */
  function jump(f: Pos, dr: number, dc: number): Pos {
    const lastData = rows.length;
    const lastCol = Math.max(colCount - 1, 0);
    const inside = (q: Pos) => q.r >= 0 && q.c >= 0 && q.c <= lastCol && q.r <= lastData;
    const filled = (q: Pos) => (q.r === 0 ? q.c < colCount : valueAt(q.r, q.c) !== undefined);
    const next = (q: Pos) => ({ r: q.r + dr, c: q.c + dc });
    let p = { ...f };
    if (!inside(next(p))) return dr > 0 ? { r: lastData, c: f.c } : dc > 0 ? { r: f.r, c: lastCol } : p;
    if (filled(p) && filled(next(p))) {
      while (inside(next(p)) && filled(next(p))) p = next(p);
    } else {
      p = next(p);
      while (inside(next(p)) && !filled(p)) p = next(p);
    }
    return p;
  }

  /**
   * Alça de preenchimento / Ctrl+D: repete o bloco para baixo; números em
   * sequência (1, 2…) continuam a sequência. `fromFirstRow` = Ctrl+D.
   */
  function applyFill(toRow: number, fromFirstRow = false) {
    if (readOnly) return;
    const targets = fromFirstRow ? allRanges : [range];
    const changes: CellChange[] = [];
    const seen = new Set<string>();
    for (const rg of targets) {
      const r1 = Math.max(rg.r1, 1);
      const endRow = fromFirstRow ? rg.r2 : toRow;
      const srcEnd = fromFirstRow ? r1 : rg.r2;
      if (endRow <= srcEnd || srcEnd < 1) continue;
      const h = srcEnd - r1 + 1;
      for (let c = rg.c1; c <= Math.min(rg.c2, colCount - 1); c++) {
        const col = columns[c];
        const src = Array.from({ length: h }, (_, i) => valueAt(r1 + i, c));
        const nums = src.every((v) => typeof v === "number") ? (src as number[]) : null;
        const step = nums && nums.length >= 2 ? nums[1] - nums[0] : null;
        const isSeries = step !== null && nums!.every((v, i) => i === 0 || Math.abs(v - nums![i - 1] - step) < 1e-9);
        const srcFormulas = Array.from({ length: h }, (_, i) => rows[r1 + i - 1]?.formulas?.[col.id]);
        const srcFormats = Array.from({ length: h }, (_, i) => rows[r1 + i - 1]?.formats?.[col.id]);
        for (let r = srcEnd + 1; r <= endRow; r++) {
          const key = `${r}:${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const k = r - r1;
          const f = srcFormulas[k % h];
          const fmt = srcFormats[k % h] ?? null;
          // Fórmula: o texto interno é relativo, então arrastar já ajusta as referências (B2 → B3…), como no Excel.
          if (f) {
            changes.push({ rowIndex: r - 1, colId: col.id, raw: null, formula: f, format: fmt });
            continue;
          }
          const v = isSeries && !srcFormulas.some(Boolean) ? nums![h - 1] + step! * (k - h + 1) : src[k % h];
          if (!(r - 1 >= rows.length && v === undefined)) changes.push({ rowIndex: r - 1, colId: col.id, raw: v === undefined ? null : v, format: fmt });
        }
      }
    }
    if (changes.length) props.onChanges(changes);
    if (!fromFirstRow) {
      const r1 = Math.max(range.r1, 1);
      setSel({ anchor: { r: r1, c: range.c1 }, focus: { r: toRow, c: range.c2 } });
    }
  }

  /** Mover células arrastando a borda da seleção (igual ao Excel). */
  function applyMove(src: Range, dst: Range) {
    if (readOnly) return;
    if (src.r1 === dst.r1 && src.c1 === dst.c1) return;
    const dr = dst.r1 - src.r1;
    const dc = dst.c1 - src.c1;

    type MovedCell = {
      dstR: number;
      dstC: number;
      value: CellValue | undefined;
      format: CellFormat | null;
      formula?: string;
    };
    const movedCells: MovedCell[] = [];

    // 1. Coleta todas as células do intervalo de origem
    for (let r = src.r1; r <= src.r2; r++) {
      for (let c = src.c1; c <= Math.min(src.c2, colCount - 1); c++) {
        const col = columns[c];
        if (!col) continue;
        const val = valueAt(r, c);
        const fmt = rows[r - 1]?.formats?.[col.id] ?? null;
        const fml = rows[r - 1]?.formulas?.[col.id];
        movedCells.push({
          dstR: r + dr,
          dstC: c + dc,
          value: val,
          format: fmt,
          formula: fml,
        });
      }
    }

    const changes: CellChange[] = [];

    // 2. Limpa as células de origem que não serão sobrescritas pelo destino
    for (let r = src.r1; r <= src.r2; r++) {
      for (let c = src.c1; c <= Math.min(src.c2, colCount - 1); c++) {
        const col = columns[c];
        if (!col) continue;
        const inDst = r >= dst.r1 && r <= dst.r2 && c >= dst.c1 && c <= dst.c2;
        if (!inDst) {
          changes.push({
            rowIndex: r - 1,
            colId: col.id,
            raw: null,
            format: null,
            formula: undefined,
          });
        }
      }
    }

    // 3. Aplica os valores, formatos e fórmulas nas células de destino
    for (const m of movedCells) {
      if (m.dstC >= colCount || m.dstR < 1) continue;
      const dstCol = columns[m.dstC];
      if (!dstCol) continue;
      changes.push({
        rowIndex: m.dstR - 1,
        colId: dstCol.id,
        raw: m.value === undefined ? null : m.value,
        format: m.format,
        formula: m.formula,
      });
    }

    if (changes.length) props.onChanges(changes);
    setSel({ anchor: { r: dst.r1, c: dst.c1 }, focus: { r: dst.r2, c: dst.c2 } });
    props.onSelectionCommit(dst);
  }

  /** Duplo clique na borda: ajusta a largura ao conteúdo (AutoAjuste do Excel). */
  function autoFitOne(col: ClientColumn) {
    const px = BASE_FONT;
    let w = textWidth(col.name, px, true) + 34;
    const pill = col.type === "SELECT" || col.type === "MULTI_SELECT" || col.type === "CONTACT" || col.type === "DEAL";
    for (const r of rows) {
      const v = r.values[col.id];
      if (v === undefined) continue;
      w = Math.max(w, textWidth(displayCell(col, v, refs), px) + (pill ? 34 : 14));
      if (w >= MAX_AUTO_W) break;
    }
    props.onResize(col.id, clamp(Math.ceil(w), MIN_COL_W, MAX_AUTO_W));
  }

  function autoFit(col: ClientColumn) {
    const idx = columns.findIndex((c) => c.id === col.id);
    if (fullColsSelected.length > 1 && fullColsSelected.includes(idx)) {
      for (const cIdx of fullColsSelected) {
        if (columns[cIdx]) autoFitOne(columns[cIdx]);
      }
      return;
    }
    autoFitOne(col);
  }

  /** Duplo clique na divisória da linha: mostra o maior conteúdo quebrado daquela linha. */
  function autoFitRow(r: number) {
    const row = rows[r - 1];
    let height = BASE_ROW;
    for (const col of columns) {
      let text = "";
      if (r === totalsRow) text = props.totals[col.id] ?? (col === columns[0] ? "Total" : "");
      else if (row) {
        if (props.showFormulas && row.formulas?.[col.id]) text = props.formulaText(row, col) ?? "";
        else if (row.formulas?.[col.id]) text = props.formulaShown(row.id, col.id)?.display ?? displayCell(col, row.values[col.id], refs);
        else text = displayCell(col, row.values[col.id], refs);
      }
      if (!text) continue;
      const usable = Math.max(20, (widths[col.id] ?? DEFAULT_COL_W) - 12);
      const lines = text.split(/\r?\n/).reduce((sum, part) => sum + Math.max(1, Math.ceil(textWidth(part || " ", BASE_FONT, !!row?.formats?.[col.id]?.b) / usable)), 0);
      height = Math.max(height, Math.ceil(lines * BASE_FONT * 1.25 + 7));
    }
    const key = rowKey(r);
    const nextHeight = clamp(height, BASE_ROW, 400);
    setRowHeights((current) => {
      const next = { ...current, [key]: nextHeight };
      try {
        localStorage.setItem(rowHeightKey, JSON.stringify(next));
      } catch {
        /* sem armazenamento local: vale enquanto a tela estiver aberta */
      }
      return next;
    });
  }

  function visualRowForExcelRow(n: number): number | null {
    if (n === 1) return 0;
    const idx = rows.findIndex((row) => (row.rank ?? -1) + 1 === n);
    if (idx >= 0) return idx + 1;
    if (!props.filteredView && n - 1 <= rows.length + props.pendingRows) return n - 1;
    if (n > props.allTotal + 1) return rows.length + props.pendingRows + (n - props.allTotal - 1);
    return null;
  }

  useImperativeHandle(props.controllerRef, () => ({
    moveTo: (p, extend) => {
      moveTo(p, extend);
      focusGrid();
    },
    edit: (p, initialText = null) => {
      const at = p ?? sel.focus;
      startEdit(at.r, at.c, initialText);
    },
    editNewRow: () => {
      const r = rows.length + 1;
      moveTo({ r, c: 0 });
      requestAnimationFrame(() => startEdit(r, 0, null));
    },
    focus: focusGrid,
    selectedRowIds,
    selectedColumnIds,
    copy: () => copyRange(false),
    cut: () => copyRange(true),
    paste: (text) => pasteFromClipboard(text, ""),
    pasteSpecial,
    hasInternalClip: () => !!readInternalClip(),
    goTo: (c, n) => {
      const vr = visualRowForExcelRow(n);
      if (vr !== null) {
        moveTo({ r: vr, c });
        focusGrid();
        return true;
      }
      return false;
    },
    selectByNameBox: (targets) => {
      const built: Range[] = [];
      const lastCol = Math.max(colCount - 1, 0);
      const lastRow = Math.max(rows.length, 1);
      for (const t of targets) {
        if (t.kind === "cols") {
          built.push({ r1: 0, r2: lastRow, c1: clamp(t.c1, 0, maxCol), c2: clamp(t.c2, 0, maxCol) });
        } else if (t.kind === "rows") {
          const r1 = visualRowForExcelRow(t.r1);
          const r2 = visualRowForExcelRow(t.r2);
          if (r1 === null || r2 === null) return false;
          built.push({ r1: clamp(Math.min(r1, r2), 0, maxRow), r2: clamp(Math.max(r1, r2), 0, maxRow), c1: 0, c2: lastCol });
        } else {
          const r1 = visualRowForExcelRow(t.r1);
          const r2 = visualRowForExcelRow(t.r2);
          if (r1 === null || r2 === null) return false;
          built.push({
            r1: clamp(Math.min(r1, r2), 0, maxRow),
            r2: clamp(Math.max(r1, r2), 0, maxRow),
            c1: clamp(t.c1, 0, maxCol),
            c2: clamp(t.c2, 0, maxCol),
          });
        }
      }
      if (!built.length) return false;
      const last = built[built.length - 1];
      setExtraRanges(built.slice(0, -1));
      setSel({ anchor: { r: last.r1, c: last.c1 }, focus: { r: last.r2, c: last.c2 } });
      scrollIntoView({ r: last.r1, c: last.c1 }, { smooth: true });
      focusGrid();
      return true;
    },
    clear: clearRange,
    deleteRows: deleteSelectedRows,
    fillDown: () => allRanges.some((rg) => rg.r2 > rg.r1) && applyFill(range.r2, true),
    autoFit: (colId) => {
      if (colId) {
        const target = columns.find((c) => c.id === colId);
        if (target) autoFit(target);
        return;
      }
      if (selectedColIds.length > 0) {
        for (const id of selectedColIds) {
          const col = columns.find((c) => c.id === id);
          if (col) autoFitOne(col);
        }
      } else if (columns[sel.focus.c]) {
        autoFitOne(columns[sel.focus.c]);
      }
    },
  }));

  // ─── Teclado ───────────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || headerEdit || e.target !== scrollRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const f = sel.focus;
    const key = e.key;
    const lower = key.toLowerCase();

    if (mod && lower === "z") {
      e.preventDefault();
      return e.shiftKey ? props.onRedo() : props.onUndo();
    }
    if (mod && lower === "y") {
      e.preventDefault();
      return props.onRedo();
    }
    if (mod && lower === "a") {
      e.preventDefault();
      setExtraRanges([]);
      return setSel({ anchor: { r: 0, c: 0 }, focus: { r: Math.max(rows.length, 0), c: Math.max(colCount - 1, 0) } });
    }
    if (mod && lower === "d") {
      e.preventDefault();
      if (!readOnly && allRanges.some((rg) => rg.r2 > rg.r1)) applyFill(range.r2, true);
      return;
    }
    if (mod && !e.altKey && (key === "-" || e.code === "NumpadSubtract")) {
      e.preventDefault();
      return deleteShortcut();
    }
    if (mod && e.altKey && lower === "v") {
      e.preventDefault();
      if (!readOnly) props.onPasteSpecial();
      return;
    }
    if (mod && e.code === "Semicolon") {
      e.preventDefault();
      if (readOnly || f.r < 1 || f.c >= colCount) return;
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const raw = e.shiftKey
        ? `${pad(now.getHours())}:${pad(now.getMinutes())}`
        : `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
      // Colunas tipadas: data só cabe em Data/Texto, hora só em Texto (não há coluna de hora).
      const type = columns[f.c].type;
      const textual = type === "TEXT" || type === "LONG_TEXT";
      if (e.shiftKey ? !textual : !(textual || type === "DATE")) {
        props.onNotice(
          e.shiftKey
            ? `A hora atual só cabe em coluna de Texto — "${columns[f.c].name}" é ${SHEET_COLUMN_TYPE_LABELS[type]}`
            : `A data de hoje só cabe em coluna de Data ou Texto — "${columns[f.c].name}" é ${SHEET_COLUMN_TYPE_LABELS[type]}`,
        );
        return;
      }
      props.onChanges([{ rowIndex: f.r - 1, colId: columns[f.c].id, raw }]);
      return;
    }
    if (mod && !e.shiftKey && (key === "'" || e.code === "Quote")) {
      e.preventDefault();
      if (readOnly || f.r <= 1 || f.c >= colCount) return;
      const above = rows[f.r - 2];
      const formula = above ? props.formulaText(above, columns[f.c]) : undefined;
      if (formula) props.onChanges([{ rowIndex: f.r - 1, colId: columns[f.c].id, raw: formula }]);
      return;
    }
    if (mod && e.shiftKey && lower === "l") {
      e.preventDefault();
      return props.onShortcut("filterButtons");
    }
    // Atalhos de formatação do Excel: Ctrl+B, Ctrl+I, Ctrl+U (ou Ctrl+S, como no Excel em português), Ctrl+5; Ctrl+L = Formatar como Tabela.
    if (mod && !e.shiftKey && lower === "b") {
      e.preventDefault();
      if (!readOnly) props.onShortcut("bold");
      return;
    }
    if (mod && !e.shiftKey && lower === "i") {
      e.preventDefault();
      if (!readOnly) props.onShortcut("italic");
      return;
    }
    if (mod && !e.shiftKey && (lower === "u" || lower === "s")) {
      e.preventDefault();
      if (!readOnly) props.onShortcut("underline");
      return;
    }
    if (mod && key === "5") {
      e.preventDefault();
      if (!readOnly) props.onShortcut("strike");
      return;
    }
    if (mod && !e.shiftKey && lower === "l") {
      e.preventDefault();
      if (!readOnly) props.onShortcut("table");
      return;
    }
    if (mod && e.shiftKey && key === " ") {
      e.preventDefault();
      setExtraRanges([]);
      return setSel({ anchor: { r: 0, c: 0 }, focus: { r: Math.max(rows.length, 0), c: Math.max(colCount - 1, 0) } });
    }
    if (e.shiftKey && key === " ") {
      e.preventDefault();
      const lastCol = Math.max(colCount - 1, 0);
      setExtraRanges((list) => (list.length ? list.map((rg) => ({ r1: rg.r1, r2: rg.r2, c1: 0, c2: lastCol })) : list));
      return setSel((s) => ({ anchor: { r: s.anchor.r, c: 0 }, focus: { r: s.focus.r, c: lastCol } }));
    }
    if (mod && key === " ") {
      e.preventDefault();
      const lastRow = Math.max(rows.length, 1);
      setExtraRanges((list) => (list.length ? list.map((rg) => ({ r1: 0, r2: lastRow, c1: rg.c1, c2: rg.c2 })) : list));
      return setSel((s) => ({ anchor: { r: 0, c: s.anchor.c }, focus: { r: lastRow, c: s.focus.c } }));
    }
    const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    if (moves[key]) {
      e.preventDefault();
      const [dr, dc] = moves[key];
      return moveTo(mod ? jump(f, dr, dc) : { r: f.r + dr, c: f.c + dc }, e.shiftKey);
    }
    if (key === "Tab") {
      e.preventDefault();
      return moveTo({ r: f.r, c: f.c + (e.shiftKey ? -1 : 1) });
    }
    if (key === "Home") {
      e.preventDefault();
      return moveTo(mod ? { r: 0, c: 0 } : { r: f.r, c: 0 }, e.shiftKey);
    }
    if (key === "End") {
      e.preventDefault();
      return moveTo(mod ? { r: rows.length, c: Math.max(colCount - 1, 0) } : { r: f.r, c: Math.max(colCount - 1, 0) }, e.shiftKey);
    }
    if (key === "PageDown" || key === "PageUp") {
      e.preventDefault();
      const page = Math.max(1, Math.floor(viewport.height / ROW) - 2);
      return moveTo({ r: f.r + (key === "PageDown" ? page : -page), c: f.c }, e.shiftKey);
    }
    if (key === "Escape") {
      setMenu(null);
      setCopied(null);
      setExtraRanges([]);
      return setSel({ anchor: f, focus: f });
    }
    if (readOnly) return;
    if (key === "F2") {
      e.preventDefault();
      return startEdit(f.r, f.c, null);
    }
    if (key === "Enter") {
      // Como no Excel: Enter não edita — confirma e desce (Shift+Enter sobe). Para editar: F2,
      // duplo clique ou começar a digitar.
      e.preventDefault();
      return moveTo({ r: f.r + (e.shiftKey ? -1 : 1), c: f.c });
    }
    if (key === " " && f.r >= 1 && f.c < colCount && columns[f.c].type === "CHECKBOX") {
      e.preventDefault();
      if (multiCell) {
        const nextVal = !valueAt(f.r, f.c);
        const changes: CellChange[] = [];
        const seen = new Set<string>();
        for (const rg of allRanges) {
          for (let rr = Math.max(rg.r1, 1); rr <= Math.min(rg.r2, rows.length); rr++) {
            for (let cc = rg.c1; cc <= Math.min(rg.c2, colCount - 1); cc++) {
              const k = `${rr}:${cc}`;
              if (seen.has(k) || columns[cc].type !== "CHECKBOX" || rows[rr - 1]?.formulas?.[columns[cc].id]) continue;
              seen.add(k);
              if (Boolean(valueAt(rr, cc)) !== nextVal) changes.push({ rowIndex: rr - 1, colId: columns[cc].id, raw: nextVal });
            }
          }
        }
        if (changes.length) props.onChanges(changes);
        return;
      }
      return startEdit(f.r, f.c, null);
    }
    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      // Excel: Backspace numa célula só limpa e já entra em edição (caixa de seleção: só limpa).
      if (key === "Backspace" && !multiCell && !(f.c < colCount && columns[f.c].type === "CHECKBOX")) return startEdit(f.r, f.c, "");
      return clearRange();
    }
    if (key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(f.r, f.c, key);
    }
  }

  // ─── Coordenadas do ponteiro e rolagem automática ao arrastar ──────
  function posAtClient(clientX: number, clientY: number): Pos | null {
    const el = scrollRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const relY = clientY - box.top;
    const contentY = relY + el.scrollTop;
    const r = relY < HEADER_H ? 0 : clamp(rowAtY(contentY), 1, maxRow);

    const contentX = clientX - box.left + el.scrollLeft - RN_W;
    let c = 0;
    if (contentX <= 0) c = 0;
    else if (contentX < dataWidth) {
      c = colCount - 1;
      for (let i = 0; i < colCount; i++) {
        if (contentX < offsets[i + 1]) {
          c = i;
          break;
        }
      }
    } else {
      c = clamp(colCount + Math.floor((contentX - dataWidth) / FILLER_W), 0, maxCol);
    }
    return { r, c };
  }

  function applyDragAt(clientX: number, clientY: number) {
    const action = dragging.current;
    if (!action) return;
    const p = posAtClient(clientX, clientY);
    if (!p) return;
    if (action === "select") {
      setSel((s) => (s.focus.r === p.r && s.focus.c === p.c ? s : { anchor: s.anchor, focus: p }));
    } else if (action === "col") {
      const lastRow = Math.max(rows.length, 1);
      setSel((s) => (s.focus.c === p.c && s.focus.r === lastRow ? s : { anchor: { r: 0, c: s.anchor.c }, focus: { r: lastRow, c: p.c } }));
    } else if (action === "row") {
      const lastCol = Math.max(colCount - 1, 0);
      setSel((s) => (s.focus.r === p.r && s.focus.c === lastCol ? s : { anchor: { r: s.anchor.r, c: 0 }, focus: { r: p.r, c: lastCol } }));
    } else if (action === "fill") {
      setFill({ toRow: Math.max(p.r, range.r2) });
    } else if (action === "move" && moveOrigin.current && moveRange.current) {
      const src = moveRange.current;
      const orig = moveOrigin.current;
      const dr = p.r - orig.r;
      const dc = p.c - orig.c;
      const h = src.r2 - src.r1;
      const w = src.c2 - src.c1;
      const dstR1 = Math.max(1, src.r1 + dr);
      let dstC1 = Math.max(0, src.c1 + dc);
      if (dstC1 + w >= colCount) {
        dstC1 = Math.max(0, colCount - 1 - w);
      }
      const dst: Range = {
        r1: dstR1,
        r2: dstR1 + h,
        c1: dstC1,
        c2: dstC1 + w,
      };
      const nextTarget = { src, dst };
      moveTargetRef.current = nextTarget;
      setMoveTarget((prev) => (prev && prev.dst.r1 === dst.r1 && prev.dst.c1 === dst.c1 ? prev : nextTarget));
    }
  }

  // Acompanha arraste de seleção (células, colunas, linhas ou alça) e rola perto da borda em 60/120fps.
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let carryX = 0;
    let carryY = 0;

    function tick(now: number) {
      const dt = Math.min(50, Math.max(4, now - lastTime));
      lastTime = now;
      const action = dragging.current;
      const ptr = dragPointer.current;
      const el = scrollRef.current;
      if (action && ptr && el) {
        const box = el.getBoundingClientRect();
        const zone = 46;
        // Dentro da grade, acelera suavemente ao se aproximar da borda. Depois
        // que o ponteiro passa da borda, a distância continua aumentando a
        // velocidade (antes ela travava no mesmo máximo, mesmo longe da tela).
        const easeSpeed = (dist: number, edgeSpeed: number, farSpeed: number) => {
          const inEdge = clamp(dist / zone, 0, 1);
          const outside = Math.max(0, dist - zone);
          const far = clamp(outside / 240, 0, 1);
          const pixelsPerFrame = 2.2 + edgeSpeed * inEdge * inEdge + (farSpeed - edgeSpeed) * Math.pow(far, 1.35);
          return pixelsPerFrame * (dt / 16.67);
        };
        let vx = 0;
        let vy = 0;
        if (action !== "row") {
          const leftEdge = box.left + RN_W + zone;
          const rightEdge = box.right - zone;
          if (ptr.x < leftEdge) vx = -easeSpeed(leftEdge - ptr.x, 26, 72);
          else if (ptr.x > rightEdge) vx = easeSpeed(ptr.x - rightEdge, 26, 72);
        }
        if (action !== "col") {
          const topEdge = box.top + HEADER_H + zone;
          const bottomEdge = box.bottom - zone;
          if (ptr.y < topEdge) vy = -easeSpeed(topEdge - ptr.y, 22, 104);
          else if (ptr.y > bottomEdge) vy = easeSpeed(ptr.y - bottomEdge, 22, 104);
        }
        if (vx !== 0 || vy !== 0) {
          carryX += vx;
          carryY += vy;
          const stepX = Math.trunc(carryX);
          const stepY = Math.trunc(carryY);
          if (stepX !== 0 || stepY !== 0) {
            carryX -= stepX;
            carryY -= stepY;
            if (stepX !== 0) el.scrollLeft += stepX;
            if (stepY !== 0) el.scrollTop += stepY;
            applyDragAt(ptr.x, ptr.y);
          }
        } else {
          carryX = 0;
          carryY = 0;
        }
      }
      if (dragging.current) rafId = window.requestAnimationFrame(tick);
      else rafId = 0;
    }

    function ensureLoop() {
      if (!rafId && dragging.current) {
        lastTime = performance.now();
        rafId = window.requestAnimationFrame(tick);
      }
    }

    function move(ev: MouseEvent) {
      if (!dragging.current) return;
      dragPointer.current = { x: ev.clientX, y: ev.clientY };
      applyDragAt(ev.clientX, ev.clientY);
      ensureLoop();
    }
    function up() {
      const action = dragging.current;
      if (action === "fill" && fill) applyFill(fill.toRow);
      if (action === "select" || action === "col" || action === "row") props.onSelectionCommit(range);
      if (action === "move" && moveTargetRef.current) {
        const { src, dst } = moveTargetRef.current;
        if (src.r1 !== dst.r1 || src.c1 !== dst.c1) {
          applyMove(src, dst);
        }
      }
      dragging.current = null;
      dragPointer.current = null;
      moveOrigin.current = null;
      moveRange.current = null;
      moveTargetRef.current = null;
      setMoveTarget(null);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      setFill(null);
    }
    ensureLoop();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  // ─── Mouse ─────────────────────────────────────────────────────────
  function cellFromEvent(e: React.MouseEvent): Pos | null {
    const t = (e.target as HTMLElement).closest("[data-cell]") as HTMLElement | null;
    if (!t) return null;
    return { r: Number(t.dataset.r), c: Number(t.dataset.c) };
  }

  function openMenuAt(e: React.MouseEvent) {
    const el = scrollRef.current!;
    const box = el.getBoundingClientRect();
    // Coordenadas no espaço do conteúdo rolável (o menu rola junto com a grade).
    setMenu({ x: e.clientX - box.left + el.scrollLeft, y: e.clientY - box.top + el.scrollTop });
  }

  function startMove(e: React.MouseEvent) {
    if (e.button !== 0 || readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    focusGrid();
    const p = posAtClient(e.clientX, e.clientY) ?? { r: range.r1, c: range.c1 };
    moveOrigin.current = p;
    moveRange.current = range;
    const initialTarget = { src: range, dst: range };
    moveTargetRef.current = initialTarget;
    setMoveTarget(initialTarget);
    dragging.current = "move";
    dragPointer.current = { x: e.clientX, y: e.clientY };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const p = cellFromEvent(e);
    if (!p) return;
    // Editando fórmula e ela espera uma referência: clicar insere a célula (Shift = intervalo), sem sair da edição.
    if (editing && pointInsert.current && p.c < colCount) {
      e.preventDefault();
      pointInsert.current(cellLabel(p, rowNumber), e.shiftKey);
      return;
    }
    setMenu(null);
    if (editing) setEditing(null);
    if (headerEdit) setHeaderEdit(null);
    e.preventDefault();
    focusGrid();
    dragPointer.current = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) {
      setSel((s) => ({ anchor: s.anchor, focus: p }));
      dragging.current = "select";
    } else if (e.ctrlKey || e.metaKey) {
      const reduced = removeFromSelection(allRanges, { mode: "cell", r: p.r, c: p.c });
      if (reduced) {
        const last = reduced[reduced.length - 1];
        setExtraRanges(reduced.slice(0, -1));
        setSel({ anchor: { r: last.r1, c: last.c1 }, focus: { r: last.r2, c: last.c2 } });
        dragging.current = null;
      } else {
        setExtraRanges(allRanges);
        setSel({ anchor: p, focus: p });
        dragging.current = "select";
      }
    } else {
      setExtraRanges([]);
      setSel({ anchor: p, focus: p });
      dragging.current = "select";
    }
  }

  function onMouseOver(e: React.MouseEvent) {
    if (!dragging.current) return;
    dragPointer.current = { x: e.clientX, y: e.clientY };
    const p = cellFromEvent(e);
    if (!p) return;
    if (dragging.current === "select") setSel((s) => (s.focus.r === p.r && s.focus.c === p.c ? s : { anchor: s.anchor, focus: p }));
    else if (dragging.current === "col") {
      const lastRow = Math.max(rows.length, 1);
      setSel((s) => (s.focus.c === p.c && s.focus.r === lastRow ? s : { anchor: { r: 0, c: s.anchor.c }, focus: { r: lastRow, c: p.c } }));
    } else if (dragging.current === "row") {
      const lastCol = Math.max(colCount - 1, 0);
      setSel((s) => (s.focus.r === p.r && s.focus.c === lastCol ? s : { anchor: { r: s.anchor.r, c: 0 }, focus: { r: p.r, c: lastCol } }));
    } else setFill({ toRow: Math.max(p.r, range.r2) });
  }

  function onContextMenu(e: React.MouseEvent) {
    const p = cellFromEvent(e);
    if (!p) return;
    e.preventDefault();
    if (!inRange(p.r, p.c)) {
      setExtraRanges([]);
      setSel({ anchor: p, focus: p });
    }
    openMenuAt(e);
  }

  function startResize(e: React.MouseEvent, col: ClientColumn) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col.id] ?? DEFAULT_COL_W;
    const idx = columns.findIndex((c) => c.id === col.id);
    const batchIds = fullColsSelected.length > 1 && fullColsSelected.includes(idx) ? fullColsSelected.map((i) => columns[i].id) : null;
    setResizing(true);
    let raf = 0;
    let latestX = startX;
    const flush = () => {
      raf = 0;
      const nextW = Math.max(MIN_COL_W, startW + (latestX - startX) / z);
      if (batchIds && props.onResizeMany) props.onResizeMany(batchIds, nextW);
      else if (batchIds) for (const id of batchIds) props.onResize(id, nextW);
      else props.onResize(col.id, nextW);
    };
    const move = (ev: MouseEvent) => {
      latestX = ev.clientX;
      if (!raf) raf = window.requestAnimationFrame(flush);
    };
    const up = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        flush();
      }
      setResizing(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /**
   * `detail === 2` chega no segundo pressionamento antes do `dblclick`.
   * Isso evita que a camada do redimensionamento manual engula o AutoAjuste.
   */
  function onColumnDividerMouseDown(e: React.MouseEvent, col: ClientColumn) {
    if (e.detail >= 2) {
      e.preventDefault();
      e.stopPropagation();
      autoFit(col);
      return;
    }
    startResize(e, col);
  }

  function onColumnDividerDoubleClick(e: React.MouseEvent, col: ClientColumn) {
    e.preventDefault();
    e.stopPropagation();
    autoFit(col);
  }

  const selectWholeColumn = (c: number, opts: { shift?: boolean; ctrl?: boolean }) => {
    const lastRow = Math.max(rows.length, 1);
    if (opts.shift) {
      setSel((s) => ({ anchor: { r: 0, c: s.anchor.c }, focus: { r: lastRow, c } }));
      dragging.current = "col";
      return;
    }
    if (opts.ctrl) {
      const reduced = removeFromSelection(allRanges, { mode: "col", c, lastRow });
      if (reduced) {
        const last = reduced[reduced.length - 1];
        setExtraRanges(reduced.slice(0, -1));
        setSel({ anchor: { r: last.r1, c: last.c1 }, focus: { r: last.r2, c: last.c2 } });
        dragging.current = null;
        return;
      }
      setExtraRanges(allRanges);
      setSel({ anchor: { r: 0, c }, focus: { r: lastRow, c } });
      dragging.current = "col";
      return;
    }
    setExtraRanges([]);
    setSel({ anchor: { r: 0, c }, focus: { r: lastRow, c } });
    dragging.current = "col";
  };

  const selectWholeRow = (r: number, opts: { shift?: boolean; ctrl?: boolean }) => {
    const lastCol = Math.max(colCount - 1, 0);
    if (opts.shift) {
      setSel((s) => ({ anchor: { r: s.anchor.r, c: 0 }, focus: { r, c: lastCol } }));
      dragging.current = "row";
      return;
    }
    if (opts.ctrl) {
      const reduced = removeFromSelection(allRanges, { mode: "row", r, lastCol });
      if (reduced) {
        const last = reduced[reduced.length - 1];
        setExtraRanges(reduced.slice(0, -1));
        setSel({ anchor: { r: last.r1, c: last.c1 }, focus: { r: last.r2, c: last.c2 } });
        dragging.current = null;
        return;
      }
      setExtraRanges(allRanges);
      setSel({ anchor: { r, c: 0 }, focus: { r, c: lastCol } });
      dragging.current = "row";
      return;
    }
    setExtraRanges([]);
    setSel({ anchor: { r, c: 0 }, focus: { r, c: lastCol } });
    dragging.current = "row";
  };

  // ─── Retângulos de seleção ─────────────────────────────────────────
  const rectOf = (rg: Range) => {
    const r1 = Math.max(rg.r1, 1);
    const r2 = Math.max(rg.r2, r1);
    return {
      top: yOf(r1),
      left: xOf(rg.c1),
      width: xOf(rg.c2) + wOf(rg.c2) - xOf(rg.c1),
      height: yOf(r2) + hOf(r2) - yOf(r1),
    };
  };
  const showDataSel = range.r2 >= 1;
  const selRect = rectOf(range);
  const focusRect = sel.focus.r >= 1 ? { top: yOf(sel.focus.r), left: xOf(sel.focus.c), width: wOf(sel.focus.c), height: hOf(sel.focus.r) } : null;
  const fillRect = fill && fill.toRow > range.r2 ? { top: yOf(range.r2 + 1), height: yOf(fill.toRow) + hOf(fill.toRow) - yOf(range.r2 + 1) } : null;
  const editRect = editing ? { top: yOf(editing.r), left: xOf(editing.c), width: wOf(editing.c), height: hOf(editing.r) } : null;
  const gridLine = showGridlines ? "border-[var(--xl-grid)]" : "border-transparent";
  const headCell = "xl-head-item border-r border-b border-[var(--xl-head-line)] bg-[var(--xl-head)] text-[var(--xl-head-text)] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a]";
  const headSel = "xl-head-item border-r border-b border-[var(--xl-head-line)] bg-[var(--xl-head-sel)] font-bold text-[var(--xl)]";
  const headFull = "xl-head-item border-r border-b border-[var(--xl-head-line)] bg-[var(--xl-soft)] font-bold text-[var(--xl)]";

  return (
    <div
      className={`relative min-h-0 flex-1 overflow-hidden bg-[var(--xl-sheet)] [font-family:var(--xl-font)] ${resizing ? "xl-resizing" : ""}`}
      style={{ ["--xl-fs" as string]: `${fontPx}px` }}
    >
      {resizing && <div className="fixed inset-0 z-[100] cursor-col-resize" />}
      <div
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={colCount}
        aria-label="Planilha"
        style={props.formatPainterActive ? { cursor: "copy" } : undefined}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onMouseOver={onMouseOver}
        onDoubleClick={(e) => {
          const p = cellFromEvent(e);
          if (p) startEdit(p.r, p.c, null);
        }}
        onContextMenu={onContextMenu}
        onCopy={(e) => {
          if (editing || headerEdit) return;
          e.preventDefault();
          const { text, html } = rangeClip();
          e.clipboardData.setData("text/plain", text);
          e.clipboardData.setData("text/html", html);
          setCopied(allRanges);
        }}
        onCut={(e) => {
          if (editing || headerEdit || readOnly) return;
          e.preventDefault();
          const { text, html } = rangeClip();
          e.clipboardData.setData("text/plain", text);
          e.clipboardData.setData("text/html", html);
          setCopied(allRanges);
          clearRange();
        }}
        onPaste={(e) => {
          if (editing || headerEdit) return;
          e.preventDefault();
          pasteFromClipboard(e.clipboardData.getData("text/plain"), e.clipboardData.getData("text/html"));
        }}
        className="absolute inset-0 overflow-auto outline-none select-none"
      >
        <div style={{ width: totalWidth, height: rowOffsets[rowCount] }} className="relative">
          {/* ── Área congelada: letras + linha 1 (nomes das colunas) ── */}
          <div className="sticky top-0 z-20" style={{ height: HEADER_H, width: totalWidth }}>
            {showHeadings && (
              <div className="flex" style={{ height: LETTER }}>
                <button
                  type="button"
                  title="Selecionar tudo (Ctrl+A)"
                  aria-label="Selecionar tudo"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    focusGrid();
                    setExtraRanges([]);
                    setSel({ anchor: { r: 0, c: 0 }, focus: { r: rows.length, c: Math.max(colCount - 1, 0) } });
                  }}
                  className={`group sticky left-0 z-10 flex items-end justify-end p-[3px] ${headCell}`}
                  style={{ width: RN_W, height: LETTER }}
                >
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-[#b9b9b9] group-hover:fill-[var(--xl)]" aria-hidden="true">
                    <path d="M10 0 L10 10 L0 10 Z" />
                  </svg>
                </button>
                {Array.from({ length: visualCols }, (_, c) => {
                  const col = columns[c];
                  const active = isColInSelection(c);
                  const fullCol = isFullColSelected(c);
                  return (
                    <div
                      key={col?.id ?? `l-${c}`}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        focusGrid();
                        dragPointer.current = { x: e.clientX, y: e.clientY };
                        selectWholeColumn(c, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
                      }}
                      onMouseOver={() => {
                        if (dragging.current === "col") {
                          const lastRow = Math.max(rows.length, 1);
                          setSel((s) => (s.focus.c === c && s.focus.r === lastRow ? s : { anchor: { r: 0, c: s.anchor.c }, focus: { r: lastRow, c } }));
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!col) return;
                        if (!isColInSelection(c)) {
                          setExtraRanges([]);
                          selectWholeColumn(c, {});
                          dragging.current = null;
                        }
                        props.onColumnMenu(col, { x: e.clientX, y: e.clientY });
                      }}
                      className={`relative flex shrink-0 cursor-pointer items-center justify-center text-[length:calc(var(--xl-fs)*0.8)] ${
                        active ? `${fullCol ? headFull : headSel} shadow-[inset_0_-2px_0_var(--xl)]` : headCell
                      }`}
                      style={{ width: wOf(c), height: LETTER }}
                      title="Clique ou arraste para selecionar colunas · Ctrl+clique: seleção múltipla"
                    >
                      {columnLetter(c)}
                      {col && (
                        <div
                          onMouseDown={(e) => onColumnDividerMouseDown(e, col)}
                          onDoubleClick={(e) => onColumnDividerDoubleClick(e, col)}
                          title="Arraste para ajustar a largura · duplo clique: AutoAjuste"
                          className="absolute top-0 -right-[4px] z-30 h-full w-[8px] cursor-col-resize transition-colors duration-150 hover:bg-[var(--xl)]/60"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex shadow-[0_1px_0_#9b9b9b] dark:shadow-[0_1px_0_#555]" style={{ height: ROW }}>
              {showHeadings && (
                <div
                  className={`sticky left-0 z-10 flex cursor-pointer items-center justify-center text-[length:calc(var(--xl-fs)*0.8)] tabular-nums ${
                    isRowInSelection(0) ? `${isFullRowSelected(0) ? headFull : headSel} shadow-[inset_-2px_0_0_var(--xl)]` : headCell
                  }`}
                  style={{ width: RN_W, height: ROW }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    focusGrid();
                    dragPointer.current = { x: e.clientX, y: e.clientY };
                    selectWholeRow(0, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
                  }}
                  onMouseOver={() => {
                    if (dragging.current === "row") {
                      const lastCol = Math.max(colCount - 1, 0);
                      setSel((s) => (s.focus.r === 0 && s.focus.c === lastCol ? s : { anchor: { r: s.anchor.r, c: 0 }, focus: { r: 0, c: lastCol } }));
                    }
                  }}
                >
                  1
                </div>
              )}
              {Array.from({ length: visualCols }, (_, c) => {
                const col = columns[c];
                const isActive = sel.focus.r === 0 && sel.focus.c === c;
                const inSel = inRange(0, c);
                const sorted = col && props.sort?.columnId === col.id ? props.sort.dir : null;
                const filtered = col ? props.filteredColumnIds.has(col.id) : false;
                return (
                  <div
                    key={col?.id ?? `h-${c}`}
                    data-cell=""
                    data-r={0}
                    data-c={c}
                    onContextMenu={(e) => {
                      if (!col) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isColInSelection(c)) {
                        setExtraRanges([]);
                        setSel({ anchor: { r: 0, c }, focus: { r: 0, c } });
                      }
                      props.onColumnMenu(col, { x: e.clientX, y: e.clientY });
                    }}
                    className={`xl-cell relative flex shrink-0 items-center gap-1 overflow-hidden border-r border-b bg-[var(--xl-sheet)] px-[5px] text-[length:var(--xl-fs)] font-bold text-[var(--xl-cell-text)] ${gridLine} ${
                      isActive && !headerEdit ? "outline-2 -outline-offset-2 outline-[var(--xl)]" : ""
                    }`}
                    style={{
                      width: wOf(c),
                      height: ROW,
                      ...(col && tableSpec && props.table?.header && inTableCol(c) && tableAt!.r1 === 1
                        ? {
                            backgroundColor: tableSpec.header.fill,
                            color: tableSpec.header.fill ? tableSpec.header.color : undefined,
                            borderBottomColor: tableSpec.header.borderBottom ?? tableSpec.header.fill,
                            borderRightColor: tableSpec.header.fill,
                          }
                        : {}),
                      boxShadow: inSel && multiCell && !isActive ? "inset 0 0 0 9999px var(--xl-range)" : undefined,
                    }}
                    title={col ? `${col.name.trim() || `Coluna ${columnLetter(c)}`} — digite ou F2 para renomear` : "Digite aqui para criar uma coluna"}
                  >
                    {headerEdit?.c === c ? (
                      <input
                        autoFocus
                        defaultValue={headerEdit.initialText ?? col?.name ?? ""}
                        maxLength={120}
                        onMouseDown={(e) => e.stopPropagation()}
                        onFocus={(e) => {
                          if (headerEdit.initialText === null) e.currentTarget.select();
                          else e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length);
                        }}
                        onBlur={(e) => headerEdit && commitHeader(c, e.target.value, "none")}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const v = e.currentTarget.value;
                            commitHeader(c, v, "down");
                          } else if (e.key === "Tab") {
                            e.preventDefault();
                            commitHeader(c, e.currentTarget.value, e.shiftKey ? "left" : "right");
                          } else if (e.key === "Escape") {
                            setHeaderEdit(null);
                            focusGrid();
                          }
                        }}
                        className="absolute inset-0 z-10 border-2 border-[var(--xl)] bg-[var(--xl-sheet)] px-[4px] text-[length:var(--xl-fs)] font-bold text-[var(--xl-cell-text)] outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{col?.name ?? ""}</span>
                    )}
                    {col?.required && <span className="text-red-500">*</span>}
                    {col && props.showFilterButtons && (
                      <button
                        type="button"
                        aria-label={`Filtrar e classificar ${col.name.trim() || `Coluna ${columnLetter(c)}`}`}
                        title={filtered ? "Filtro aplicado" : sorted ? "Classificado" : "Filtrar e classificar"}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setExtraRanges([]);
                          setSel({ anchor: { r: 0, c }, focus: { r: 0, c } });
                          props.onAutoFilter(col, { x: r.right - 288, y: r.bottom + 2 });
                        }}
                        className={`flex shrink-0 items-center justify-center rounded-[2px] border bg-white shadow-sm hover:border-[var(--xl)] dark:bg-neutral-800 ${
                          filtered || sorted ? "border-[var(--xl)] text-[var(--xl)]" : "border-[#bdbdbd] text-[#555] dark:border-neutral-600 dark:text-neutral-300"
                        }`}
                        style={{ width: Math.round(16 * z), height: Math.round(16 * z) }}
                      >
                        {filtered ? (
                          <Filter style={{ width: 10 * z, height: 10 * z }} />
                        ) : sorted === "asc" ? (
                          <ArrowUp style={{ width: 10 * z, height: 10 * z }} />
                        ) : sorted === "desc" ? (
                          <ArrowDown style={{ width: 10 * z, height: 10 * z }} />
                        ) : (
                          <ChevronDown style={{ width: 11 * z, height: 11 * z }} />
                        )}
                      </button>
                    )}
                    {col && (
                      <div
                        onMouseDown={(e) => onColumnDividerMouseDown(e, col)}
                        onDoubleClick={(e) => onColumnDividerDoubleClick(e, col)}
                        title="Arraste para ajustar a largura · duplo clique: AutoAjuste"
                        className="absolute top-0 -right-[4px] z-30 h-full w-[8px] cursor-col-resize transition-colors duration-150 hover:bg-[var(--xl)]/60"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Linhas de dados visíveis (virtualizadas) ── */}
          {Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i).map((r) => {
            const row = rows[r - 1];
            const isNew = !row;
            const activeRow = isRowInSelection(r);
            const fullRow = isFullRowSelected(r);
            const rowHeight = hOf(r);
            return (
              <div key={row?.id ?? `new-${r}`} className="xl-grid-row absolute left-0 flex" style={{ top: yOf(r), height: rowHeight, width: totalWidth }}>
                {showHeadings && (
                  <div
                    className={`sticky left-0 z-10 flex shrink-0 cursor-pointer items-center justify-center text-[length:calc(var(--xl-fs)*0.8)] tabular-nums ${
                      activeRow ? `${fullRow ? headFull : headSel} shadow-[inset_-2px_0_0_var(--xl)]` : headCell
                    }`}
                    style={{ width: RN_W }}
                    title="Clique ou arraste para selecionar linhas · Ctrl+clique: seleção múltipla"
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      focusGrid();
                      dragPointer.current = { x: e.clientX, y: e.clientY };
                      selectWholeRow(r, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
                    }}
                    onMouseOver={() => {
                      if (dragging.current === "row") {
                        const lastCol = Math.max(colCount - 1, 0);
                        setSel((s) => (s.focus.r === r && s.focus.c === lastCol ? s : { anchor: { r: s.anchor.r, c: 0 }, focus: { r, c: lastCol } }));
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!(activeRow && fullRow)) {
                        setExtraRanges([]);
                        setSel({ anchor: { r, c: 0 }, focus: { r, c: Math.max(colCount - 1, 0) } });
                      }
                      openMenuAt(e);
                    }}
                  >
                    <span className={props.filteredView && row ? "text-[#0563c1] dark:text-sky-400" : ""}>{rowNumber(r)}</span>
                    <div
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        autoFitRow(r);
                      }}
                      title="Duplo clique para ajustar a altura ao conteúdo"
                      className="absolute -bottom-[3px] left-0 z-20 h-[6px] w-full cursor-row-resize transition-colors hover:bg-[var(--xl)]/60"
                    />
                  </div>
                )}
                {Array.from({ length: visualCols }, (_, c) => {
                  const col = columns[c];
                  const selected = multiCell && inRange(r, c) && !(r === sel.focus.r && c === sel.focus.c);
                  if (col && r === totalsRow && tableSpec && inTableCol(c)) {
                    return (
                      <div
                        key={col.id}
                        data-cell=""
                        data-r={r}
                        data-c={c}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (!readOnly) props.onTotalsPick(col, { x: e.clientX, y: e.clientY });
                        }}
                        className={`relative flex shrink-0 items-center overflow-hidden border-r px-[5px] text-[length:var(--xl-fs)] font-bold text-[var(--xl-cell-text)] ${gridLine} ${
                          isNumericType(col.type) ? "justify-end tabular-nums" : ""
                        }`}
                        style={{
                          width: wOf(c),
                          height: rowHeight,
                          backgroundColor: tableSpec.totals.fill,
                          color: tableSpec.totals.fill ? tableSpec.totals.color : undefined,
                          borderTop: `3px double ${tableSpec.totals.borderTop}`,
                          boxShadow: selected ? "inset 0 0 0 9999px var(--xl-range)" : undefined,
                        }}
                        title="Linha de Totais — use a seta para escolher Soma, Média, Contagem…"
                      >
                        <span className={`truncate ${isNumericType(col.type) && sel.focus.r === r && sel.focus.c === c ? "pr-5" : ""}`}>
                          {props.totals[col.id] ?? (c === tableAt?.c1 ? "Total" : "")}
                        </span>
                        {sel.focus.r === r && sel.focus.c === c && !readOnly && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              const b = e.currentTarget.getBoundingClientRect();
                              props.onTotalsPick(col, { x: b.left, y: b.bottom + 2 });
                            }}
                            className="absolute top-1/2 right-0.5 flex -translate-y-1/2 items-center justify-center rounded-[2px] border border-[#bdbdbd] bg-white text-[#444] shadow-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
                            style={{ width: Math.round(16 * z), height: Math.round(16 * z) }}
                            aria-label="Escolher a função da Linha de Totais"
                          >
                            <ChevronDown style={{ width: 11 * z, height: 11 * z }} />
                          </button>
                        )}
                      </div>
                    );
                  }
                  // Linha real do Excel desta linha: decide se ela está dentro da tabela, se é o
                  // cabeçalho da tabela (tabela que começa abaixo da linha 1) e qual faixa recebe.
                  const rn = row ? rowNumber(r) : -1;
                  const inTable = !!tableSpec && !!row && inTableCol(c) && rn >= tableAt!.r1 && rn <= tableAt!.r2;
                  const isTableHeader = inTable && tableAt!.r1 > 1 && rn === tableAt!.r1 && !!props.table!.header;
                  // 1ª linha de dados da tabela (logo abaixo do cabeçalho dela) = faixa 0.
                  const bandIndex = tableAt ? rn - tableAt.r1 - 1 : 0;
                  const cellBand = isTableHeader ? tableSpec!.header.fill : inTable && props.table!.banded ? tableSpec!.band[((bandIndex % 2) + 2) % 2] : undefined;
                  return col ? (
                    <Cell
                      key={col.id}
                      r={r}
                      c={c}
                      col={col}
                      width={wOf(c)}
                      height={rowHeight}
                      expanded={rowHeight > ROW}
                      value={row?.values[col.id]}
                      shown={
                        row && props.showFormulas && row.formulas?.[col.id]
                          ? { display: props.formulaText(row, col) ?? "" }
                          : row && row.formulas?.[col.id]
                            ? props.formulaShown(row.id, col.id)
                            : undefined
                      }
                      fmt={row?.formats?.[col.id]}
                      band={cellBand}
                      tableText={cellBand ? (isTableHeader ? tableSpec!.header.color : tableSpec!.text) : undefined}
                      tableLine={isTableHeader ? (tableSpec!.header.borderBottom ?? tableSpec!.header.fill) : inTable ? tableSpec!.line : undefined}
                      bold={isTableHeader || (inTable && props.table!.firstColumn && c === tableAt!.c1)}
                      refs={refs}
                      selected={selected}
                      gridLine={gridLine}
                      readOnly={readOnly || isNew}
                      editingActive={!!editing}
                      onToggle={() => props.onChanges([{ rowIndex: r - 1, colId: col.id, raw: !row?.values[col.id] }])}
                      onEdit={() => {
                        setExtraRanges([]);
                        setSel({ anchor: { r, c }, focus: { r, c } });
                        startEdit(r, c, null);
                      }}
                    />
                  ) : (
                    <div
                      key={`f-${c}`}
                      data-cell=""
                      data-r={r}
                      data-c={c}
                      className={`xl-cell shrink-0 border-r border-b ${gridLine}`}
                      style={{ width: FILLER_W, height: rowHeight, boxShadow: selected ? "inset 0 0 0 9999px var(--xl-range)" : undefined }}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* ── Seleção: bordas verdes com movimento fluido + célula em foco + alça de preenchimento ── */}
          {rowCount > 1 &&
            !editing &&
            extraRanges.map((rg, idx) => {
              if (rg.r2 < 1) return null;
              const rc = rectOf(rg);
              return (
                <div
                  key={`extra-sel-${idx}`}
                  className="xl-extra-box pointer-events-none absolute z-[6] rounded-[1px] border-2 border-[var(--xl)] shadow-[0_0_0_1px_rgba(16,124,65,0.12)]"
                  style={{ ...rc, top: rc.top - 1, left: rc.left - 1, width: rc.width + 1, height: rc.height + 1 }}
                />
              );
            })}
          {multiCell && focusRect && rowCount > 1 && !editing && (
            <div
              className="xl-focus-cell pointer-events-none absolute z-[6] ring-1 ring-inset ring-[var(--xl)]/45"
              style={focusRect}
            />
          )}
          {showDataSel && rowCount > 1 && !editing && (
            <div
              className={`xl-sel-box pointer-events-none absolute z-[6] rounded-[1px] border-2 border-[var(--xl)] shadow-[0_1px_3px_rgba(16,124,65,0.16)] ${
                moveTarget ? "opacity-40" : ""
              }`}
              style={{ ...selRect, top: selRect.top - 1, left: selRect.left - 1, width: selRect.width + 1, height: selRect.height + 1 }}
            >
              {!readOnly && extraRanges.length === 0 && (
                <>
                  {/* Bordas para mover células arrastando (como no Excel) */}
                  <div
                    className="pointer-events-auto absolute -top-[4px] left-0 right-0 h-[8px] cursor-move"
                    onMouseDown={startMove}
                    title="Arraste a borda para mover para outro local"
                  />
                  <div
                    className="pointer-events-auto absolute top-0 -left-[4px] bottom-0 w-[8px] cursor-move"
                    onMouseDown={startMove}
                    title="Arraste a borda para mover para outro local"
                  />
                  <div
                    className="pointer-events-auto absolute top-0 -right-[4px] bottom-[8px] w-[8px] cursor-move"
                    onMouseDown={startMove}
                    title="Arraste a borda para mover para outro local"
                  />
                  <div
                    className="pointer-events-auto absolute -bottom-[4px] left-0 right-[8px] h-[8px] cursor-move"
                    onMouseDown={startMove}
                    title="Arraste a borda para mover para outro local"
                  />

                  {/* Alça de preenchimento (canto inferior direito) */}
                  <div
                    className="pointer-events-auto absolute -right-[4px] -bottom-[4px] h-[7px] w-[7px] cursor-crosshair border border-white bg-[var(--xl)] transition-transform duration-200 ease-smooth hover:scale-125 dark:border-[var(--xl-sheet)]"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      dragging.current = "fill";
                      setFill({ toRow: range.r2 });
                    }}
                    title="Arraste para preencher"
                  />
                </>
              )}
            </div>
          )}
          {moveTarget && (
            <div
              className="xl-move-box pointer-events-none absolute z-[8] rounded-[1px] border-2 border-dashed border-[var(--xl)] bg-[var(--xl-soft)]/25 shadow-[0_2px_12px_rgba(16,124,65,0.25)] transition-[top,left,width,height] duration-75 ease-out"
              style={{ ...rectOf(moveTarget.dst), top: rectOf(moveTarget.dst).top - 1, left: rectOf(moveTarget.dst).left - 1, width: rectOf(moveTarget.dst).width + 1, height: rectOf(moveTarget.dst).height + 1 }}
            />
          )}
          {fillRect && (
            <div className="xl-sel-box pointer-events-none absolute z-[5] border border-dashed border-[#555]" style={{ left: selRect.left, width: selRect.width, ...fillRect }} />
          )}
          {copied?.map((rg, idx) => rg.r2 >= 1 && <div key={`ants-${idx}`} className="xl-ants pointer-events-none absolute z-[7]" style={rectOf(rg)} />)}

          {editing && editRect && (
            <CellEditor
              key={`${editing.r}:${editing.c}`}
              column={editing.c < colCount ? columns[editing.c] : NEW_COLUMN}
              value={valueAt(editing.r, editing.c)}
              initialText={editing.initialText}
              formula={editing.initialText === null && editing.c < colCount && rows[editing.r - 1] ? props.formulaText(rows[editing.r - 1], columns[editing.c]) : undefined}
              onPointMode={setPointInsert}
              rect={editRect}
              refs={refs}
              onCommit={commitEdit}
              onCancel={() => {
                closedSession.current = editSession.current;
                setEditing(null);
                requestAnimationFrame(focusGrid);
              }}
              onAddOption={(o) => (editing.c < colCount ? props.onAddOption(columns[editing.c].id, o) : Promise.resolve(false))}
            />
          )}

          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              readOnly={readOnly}
              rowCount={selectedRowIds().length}
              colCountSel={selectedColIds.length}
              fullRows={fullRowsInSelection()}
              fullCols={fullColsSelected.length > 0}
              column={sel.focus.c < colCount ? columns[sel.focus.c] : null}
              cellValue={valueAt(sel.focus.r, sel.focus.c)}
              onClose={() => {
                setMenu(null);
                focusGrid();
              }}
              onCopy={() => copyRange(false)}
              onCut={() => copyRange(true)}
              onPaste={pasteFromSystemClipboard}
              onClear={clearRange}
              onFillDown={range.r2 > range.r1 ? () => applyFill(range.r2, true) : null}
              onSort={(dir) => sel.focus.c < colCount && props.onSortColumn(columns[sel.focus.c], dir)}
              onFilterByValue={() => {
                const col = columns[sel.focus.c];
                const v = valueAt(sel.focus.r, sel.focus.c);
                if (col && v !== undefined) props.onFilterByValue(col, v);
              }}
              onDelete={deleteSelectedRows}
              onDeleteColumns={deleteSelectedColumns}
              onRestore={() => props.onRestoreRows(selectedRowIds())}
              onHistory={rows[sel.focus.r - 1] ? () => props.onRowHistory(rows[sel.focus.r - 1].id) : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({
  r,
  c,
  col,
  width,
  height,
  expanded,
  value,
  shown,
  fmt,
  band,
  tableText,
  tableLine,
  bold,
  refs,
  selected,
  gridLine,
  readOnly,
  editingActive,
  onToggle,
  onEdit,
}: {
  r: number;
  c: number;
  col: ClientColumn;
  width: number;
  height: number;
  expanded: boolean;
  value: CellValue | undefined;
  /** Fórmula: texto a mostrar no lugar do valor (erro, resultado fora do tipo, Mostrar Fórmulas). */
  shown?: FormulaShown;
  /** Marcações da célula (negrito, cores…) — ganham do estilo da tabela, como no Excel. */
  fmt?: CellFormat;
  band?: string;
  tableText?: string;
  tableLine?: string;
  bold?: boolean;
  refs: Record<string, string>;
  selected: boolean;
  gridLine: string;
  readOnly: boolean;
  editingActive: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  // Igual ao Excel: número e data à direita, texto à esquerda, caixa de seleção no centro.
  const rightAligned = isNumericType(col.type) || col.type === "DATE";
  const textClass = expanded ? "whitespace-normal break-words leading-[1.2]" : "truncate";
  const base = `group/cell xl-cell flex shrink-0 items-center overflow-hidden border-r border-b px-[5px] text-[length:var(--xl-fs)] ${expanded ? "py-[3px]" : "leading-none"} text-[var(--xl-cell-text)] ${gridLine} ${
    rightAligned ? "justify-end" : ""
  }`;
  // Se a célula tem cor de preenchimento (fill) sem cor de fonte explícita, garante contraste no tema escuro/claro.
  let fillContrastText: string | undefined;
  if (fmt?.fill && !fmt.color) {
    const hex = fmt.fill.slice(1);
    const rr = parseInt(hex.slice(0, 2), 16) || 0;
    const gg = parseInt(hex.slice(2, 4), 16) || 0;
    const bb = parseInt(hex.slice(4, 6), 16) || 0;
    const lum = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
    fillContrastText = lum > 0.48 ? "#000000" : "#FFFFFF";
  }
  const cssFmt = formatCss(fmt);
  const style: React.CSSProperties = {
    width,
    height,
    ...cssFmt,
    backgroundColor: fmt?.fill ?? band,
    color: fmt?.color ?? fillContrastText ?? tableText,
    fontWeight: fmt?.b ? 700 : bold ? 700 : undefined,
    borderBottom: cssFmt?.borderBottom,
    borderBottomColor: cssFmt?.borderBottom ? undefined : tableLine,
    // Seleção do Excel: véu cinza POR CIMA do preenchimento (a cor da célula continua visível).
    boxShadow: selected ? "inset 0 0 0 9999px var(--xl-range)" : undefined,
  };
  let content: React.ReactNode = null;

  if (shown) {
    // Erro do Excel (#DIV/0!…) fica centralizado, como no Excel; texto à esquerda.
    content = <span className={`${textClass} ${shown.error ? "mx-auto" : ""}`}>{shown.display}</span>;
  } else if (col.type === "CHECKBOX" && (value !== undefined || !readOnly)) {
    content = (
      <button
        type="button"
        disabled={readOnly}
        onMouseDown={(e) => !readOnly && e.stopPropagation()}
        onClick={onToggle}
        aria-label={value ? "Desmarcar" : "Marcar"}
        className={`mx-auto flex aspect-square h-[60%] items-center justify-center rounded-[2px] border ${
          value ? "border-[var(--xl)] bg-[var(--xl)] text-white" : "border-[#8a8a8a] bg-white hover:border-[var(--xl)] dark:bg-neutral-900"
        }`}
      >
        {value ? <Check className="h-[80%] w-[80%]" strokeWidth={3.5} /> : null}
      </button>
    );
  } else if (value !== undefined) {
    if (col.type === "SELECT") {
      content = <span className={`${textClass} rounded-full px-2 py-[2px] text-[length:calc(var(--xl-fs)*0.82)] font-medium ${optionColor(col, String(value))}`}>{String(value)}</span>;
    } else if (col.type === "MULTI_SELECT") {
      content = (
        <span className={`flex gap-1 overflow-hidden ${expanded ? "flex-wrap" : ""}`}>
          {(value as string[]).map((o) => (
            <span key={o} className={`shrink-0 rounded-full px-2 py-[2px] text-[length:calc(var(--xl-fs)*0.82)] font-medium ${optionColor(col, o)}`}>{o}</span>
          ))}
        </span>
      );
    } else if (col.type === "CONTACT" || col.type === "DEAL") {
      const href = col.type === "CONTACT" ? `/clientes/${value}` : `/negocios/${value}`;
      const noun = col.type === "CONTACT" ? "cliente" : "negócio";
      content = (
        <span className={`flex w-full min-w-0 items-center justify-between gap-1 ${expanded ? "flex-wrap" : ""}`}>
          <Link
            href={href}
            onMouseDown={(e) => {
              if (!e.shiftKey && !editingActive) e.stopPropagation();
            }}
            onDoubleClick={(e) => {
              if (!editingActive) e.stopPropagation();
            }}
            onClick={(e) => {
              if (e.shiftKey || editingActive) e.preventDefault();
            }}
            title={`Clique para abrir a ficha do ${noun}`}
            className={`group/ref -mx-1 inline-flex max-w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[#0563c1] underline decoration-[#0563c1]/40 underline-offset-2 transition-colors hover:bg-[#0563c1]/10 hover:decoration-[#0563c1] dark:text-sky-400 dark:decoration-sky-400/40 dark:hover:bg-sky-400/15 dark:hover:decoration-sky-400`}
          >
            <span className={textClass}>{displayCell(col, value, refs)}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover/ref:opacity-100" />
          </Link>
          {!readOnly && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title={`Trocar ${noun} vinculado`}
              aria-label={`Trocar ${noun} vinculado`}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-black/10 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          )}
        </span>
      );
    } else if (col.type === "URL" || col.type === "EMAIL") {
      const href = col.type === "EMAIL" ? `mailto:${value}` : String(value);
      content = (
        <a
          href={href}
          target={col.type === "URL" ? "_blank" : undefined}
          rel="noopener noreferrer"
          onMouseDown={(e) => {
            if (!e.shiftKey && !editingActive) e.stopPropagation();
          }}
          onDoubleClick={(e) => {
            if (!editingActive) e.stopPropagation();
          }}
          onClick={(e) => {
            if (e.shiftKey || editingActive) e.preventDefault();
          }}
          title="Clique para abrir"
          className={`${textClass} text-[#0563c1] underline decoration-[#0563c1]/40 underline-offset-2 hover:decoration-[#0563c1] dark:text-sky-400 dark:hover:decoration-sky-400`}
        >
          {col.type === "URL" ? String(value).replace(/^https?:\/\//, "").replace(/\/$/, "") : String(value)}
        </a>
      );
    } else {
      content = <span className={`${textClass} ${rightAligned ? "tabular-nums" : ""}`}>{displayCell(col, value, refs)}</span>;
    }
  }

  return (
    <div data-cell="" data-r={r} data-c={c} role="gridcell" className={base} style={style}>
      {content}
    </div>
  );
}

function ContextMenu(props: {
  x: number;
  y: number;
  readOnly: boolean;
  rowCount: number;
  colCountSel: number;
  fullRows: boolean;
  fullCols: boolean;
  column: ClientColumn | null;
  cellValue: CellValue | undefined;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onClear: () => void;
  onFillDown: (() => void) | null;
  onSort: (dir: "asc" | "desc") => void;
  onFilterByValue: () => void;
  onDelete: () => void;
  onDeleteColumns: () => void;
  onRestore: () => void;
  onHistory: (() => void) | null;
}) {
  const item = (label: string, action: () => void, opts: { danger?: boolean; hint?: string } = {}) => (
    <button
      type="button"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        action();
        props.onClose();
      }}
      className={`flex w-full items-center justify-between gap-8 px-3 py-[5px] text-left text-[13px] hover:bg-[var(--xl-soft)] ${
        opts.danger ? "text-red-600 dark:text-red-400" : "text-neutral-800 dark:text-neutral-200"
      }`}
    >
      {label}
      {opts.hint && <kbd className="font-sans text-[11px] text-neutral-400">{opts.hint}</kbd>}
    </button>
  );
  const sep = <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />;
  const rowsLabel = props.rowCount > 1 ? `${props.rowCount} Linhas` : "Linha";
  const colsLabel = props.colCountSel > 1 ? `${props.colCountSel} Colunas` : "Coluna";
  // Linha(s) inteira(s) → só "Excluir linhas"; coluna(s) inteira(s) → só "Excluir colunas";
  // células comuns → as duas opções, explícitas (o Excel pergunta numa caixa).
  const showRows = props.rowCount > 0 && (props.fullRows || !props.fullCols);
  const showCols = !props.readOnly && props.colCountSel > 0 && (props.fullCols || !props.fullRows);
  const plainCells = !props.fullRows && !props.fullCols;
  const col = props.column;
  const refLink =
    col && typeof props.cellValue === "string"
      ? col.type === "CONTACT"
        ? { href: `/clientes/${props.cellValue}`, label: "Abrir ficha do cliente" }
        : col.type === "DEAL"
          ? { href: `/negocios/${props.cellValue}`, label: "Abrir negócio" }
          : null
      : null;
  return (
    <div
      className="xl-menu-pop absolute z-40 min-w-60 overflow-hidden rounded-md border border-neutral-300 bg-white py-1 font-sans shadow-[0_8px_24px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900"
      style={{ left: props.x, top: props.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!props.readOnly && item("Recortar", props.onCut, { hint: "Ctrl+X" })}
      {item("Copiar", props.onCopy, { hint: "Ctrl+C" })}
      {!props.readOnly && item("Colar", props.onPaste, { hint: "Ctrl+V" })}
      {!props.readOnly && sep}
      {!props.readOnly && props.onFillDown && item("Preencher para Baixo", props.onFillDown, { hint: "Ctrl+D" })}
      {!props.readOnly && item("Limpar Conteúdo", props.onClear, { hint: "Delete" })}
      {col && sep}
      {col && item(isNumericType(col.type) ? "Classificar do Menor para o Maior" : "Classificar de A a Z", () => props.onSort("asc"))}
      {col && item(isNumericType(col.type) ? "Classificar do Maior para o Menor" : "Classificar de Z a A", () => props.onSort("desc"))}
      {col && props.cellValue !== undefined && item("Filtrar pelo Valor da Célula Selecionada", props.onFilterByValue)}
      {(refLink || props.onHistory) && sep}
      {refLink && (
        <Link href={refLink.href} className="block px-3 py-[5px] text-[13px] text-neutral-800 hover:bg-[var(--xl-soft)] dark:text-neutral-200">
          {refLink.label}
        </Link>
      )}
      {props.onHistory && item("Histórico da Linha", props.onHistory)}
      {(showRows || showCols) && sep}
      {showRows &&
        (props.readOnly
          ? item(`Restaurar ${rowsLabel}`, props.onRestore)
          : item(plainCells ? `Excluir ${rowsLabel} da Planilha` : `Excluir ${rowsLabel}`, props.onDelete, { danger: true, hint: props.fullRows ? "Ctrl+-" : undefined }))}
      {showCols && item(plainCells ? `Excluir ${colsLabel} da Planilha` : `Excluir ${colsLabel}`, props.onDeleteColumns, { danger: true, hint: props.fullCols ? "Ctrl+-" : undefined })}
    </div>
  );
}
