"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArchiveRestore, ArrowLeft, Check, ChevronLeft, ChevronRight, Cloud, Keyboard, Loader2, Minus, Plus, Search, Sheet, X, XCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { CellValueError, coerceCellValue, SHEET_COLUMN_TYPE_LABELS, type CellValue, type SheetColumnType } from "@/lib/sheets/column-types";
import { columnDecimals, displayCell, editText, isNumericType, isReferenceType, parseNameBoxInput, type ClientColumn, type ClientRow, type NameBoxTarget, columnLabel } from "@/lib/sheets/format";
import { cleanFormat, DEFAULT_TABLE_STYLE, readSheetSettings, TOTAL_FN_LABELS, type CellFormat, type TableSettings, type TotalFn } from "@/lib/sheets/formats";
import type { FilterOp, RowFilter } from "@/lib/sheets/rows";
import { SheetGrid, type ActiveInfo, type CellChange, type FormulaShown, type GridController, type NewColumnsRequest, type SelectionStats } from "./sheet-grid";
import { compileFormula, displayFormula, FUNCTIONS, NO_FORMULA_TYPES, recalcSheet, scalarToStored, type FunctionInfo } from "@/lib/sheets/formula";
import { Ribbon, type BorderCommand, type RibbonActions, type RibbonTab, type ViewPrefs } from "./ribbon";
import { AutoFilterMenu } from "./autofilter-menu";
import { ColumnDialog } from "./column-dialog";
import { ColumnTypeIcon } from "./column-type-icon";
import { HistoryPanel } from "./history-panel";
import { FindReplaceDialog, type FindMatch } from "./find-replace-dialog";
import { PasteSpecialDialog } from "./paste-special-dialog";
import { CrmIntegrationDialog } from "./crm-integration-dialog";
import { ImportDialog } from "../import-dialog";

type Sort = { columnId: string; dir: "asc" | "desc" } | null;
type CellEdit = { rowId: string; colId: string; before: CellValue | undefined; after: CellValue | undefined };
type FmtEdit = { rowId: string; colId: string; before: CellFormat | undefined; after: CellFormat | undefined };
type FmlEdit = { rowId: string; colId: string; before: string | undefined; after: string | undefined };
type UndoEntry = { cells: CellEdit[]; formats: FmtEdit[]; formulas: FmlEdit[]; inserted: string[]; deleted: string[] };
/** Linhas além disto: fórmulas ficam sem recalcular (o cálculo é no navegador). */
const MAX_CALC_ROWS = 20_000;

const PAGE = 200;
const VIEW_KEY = "sheet-view-prefs";
const DEFAULT_VIEW: ViewPrefs = { zoom: 1, gridlines: true, headings: true, formulaBar: true, filterButtons: true, ribbonCollapsed: false };
const emptyEntry = (): UndoEntry => ({ cells: [], formats: [], formulas: [], inserted: [], deleted: [] });

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error ?? "Algo deu errado. Tente de novo.") as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

/** Função da Linha de Totais → métrica do /summary. "Contagem" do Excel = células preenchidas. */
const TOTAL_TO_METRIC: Record<Exclude<TotalFn, "none">, "sum" | "avg" | "min" | "max" | "countFilled"> = {
  sum: "sum",
  avg: "avg",
  min: "min",
  max: "max",
  count: "countFilled",
  countFilled: "countFilled",
};

function totalsFnsFor(col: ClientColumn): TotalFn[] {
  if (isNumericType(col.type)) return ["none", "avg", "count", "countFilled", "max", "min", "sum"];
  if (col.type === "DATE") return ["none", "count", "max", "min"];
  return ["none", "count"];
}

export function SheetEditor({
  sheet: initialSheet,
  initialColumns,
  initialRows,
  initialTotal,
  initialRefs,
  initialSettings,
  initialAllTotal,
  initialHasFormulas,
  sheetTabs,
}: {
  sheet: { id: string; name: string; description: string };
  initialColumns: ClientColumn[];
  initialRows: ClientRow[];
  initialTotal: number;
  initialRefs: Record<string, string>;
  initialSettings: unknown;
  initialAllTotal: number;
  initialHasFormulas: boolean;
  sheetTabs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sheetId = initialSheet.id;
  const grid = useRef<GridController>(null);
  const [name, setName] = useState(initialSheet.name);
  const [renaming, setRenaming] = useState(false);
  const [columns, setColumns] = useState(initialColumns);
  /** Nome para mostrar (coluna sem título = "Coluna C"); o título guardado continua vazio. */
  const labelOf = useCallback((c: ClientColumn) => columnLabel(c, columns.findIndex((x) => x.id === c.id)), [columns]);
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [refs, setRefs] = useState(initialRefs);
  const [table, setTableState] = useState<TableSettings | null>(() => readSheetSettings(initialSettings).table ?? null);
  const [trash, setTrash] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<RowFilter[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [sort, setSort] = useState<Sort>(null);
  const [pending, setPending] = useState(0);
  const [mode, setMode] = useState<"ready" | "edit" | "enter">("ready");
  const [toast, setToast] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [view, setViewState] = useState<ViewPrefs>(DEFAULT_VIEW);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>("home");
  const [active, setActive] = useState<ActiveInfo>({
    pos: { r: 1, c: 0 },
    range: { r1: 1, r2: 1, c1: 0, c2: 0 },
    ranges: [{ r1: 1, r2: 1, c1: 0, c2: 0 }],
    rangeLabel: "A2",
    kind: "cell",
    rowIndex: 0,
    isNewRow: initialRows.length === 0,
    isTotals: false,
    selectedColIds: initialColumns[0] ? [initialColumns[0].id] : [],
  });
  const [stats, setStats] = useState<SelectionStats>({ filled: 0, sum: 0, nums: 0, currency: false, multi: false });
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [columnDialog, setColumnDialog] = useState<{
    column?: ClientColumn;
    insertAt?: number;
    initialType?: SheetColumnType;
    initialConflict?: { count: number; samples: { rowNumber: number; value: string }[] } | null;
  } | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ column: ClientColumn; x: number; y: number } | null>(null);
  const [autoFilter, setAutoFilter] = useState<{ column: ClientColumn; x: number; y: number } | null>(null);
  const [totalsMenu, setTotalsMenu] = useState<{ column: ClientColumn; x: number; y: number } | null>(null);
  const [filterAt, setFilterAt] = useState<{ x: number; y: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [history, setHistory] = useState<{ rowId?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [archivedCols, setArchivedCols] = useState<ClientColumn[] | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; label: string; danger?: boolean; action: () => Promise<void> } | null>(null);
  // Fórmulas: a planilha inteira na ordem real (o cálculo precisa de todas as linhas, não só da visão filtrada).
  const [allTotal, setAllTotal] = useState(initialAllTotal);
  const [hasFormulas, setHasFormulas] = useState(initialHasFormulas);
  const [canon, setCanon] = useState<ClientRow[] | null>(null);
  const [shown, setShown] = useState<Map<string, FormulaShown>>(new Map());
  const [circular, setCircular] = useState<string[]>([]);
  const [showFormulas, setShowFormulas] = useState(false);
  const [functionDialog, setFunctionDialog] = useState(false);
  const [findDialog, setFindDialog] = useState<"find" | "replace" | null>(null);
  const [findRows, setFindRows] = useState<ClientRow[] | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false);
  const [crmIntegration, setCrmIntegration] = useState<"pull" | "push" | null>(null);
  const [formatPainter, setFormatPainter] = useState<{ format: CellFormat | undefined; persistent: boolean } | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const loadingMore = useRef(false);
  const queryVersion = useRef(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ─── Preferências locais: larguras (por planilha) e modo de exibição ──
  const widthKey = `sheet-widths:${sheetId}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(widthKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferências só existem no navegador (o servidor desenha com as padrão)
      if (saved) setWidths(JSON.parse(saved));
      const v = localStorage.getItem(VIEW_KEY);
      if (v) setViewState({ ...DEFAULT_VIEW, ...JSON.parse(v) });
    } catch {
      /* sem armazenamento local: padrões */
    }
  }, [widthKey]);
  const resize = useCallback(
    (colId: string, w: number) =>
      setWidths((prev) => {
        const next = { ...prev, [colId]: Math.round(w) };
        try {
          localStorage.setItem(widthKey, JSON.stringify(next));
        } catch {
          /* ignora */
        }
        return next;
      }),
    [widthKey],
  );
  const resizeMany = useCallback(
    (colIds: string[], w: number) =>
      setWidths((prev) => {
        const next = { ...prev };
        for (const id of colIds) next[id] = Math.round(w);
        try {
          localStorage.setItem(widthKey, JSON.stringify(next));
        } catch {
          /* ignora */
        }
        return next;
      }),
    [widthKey],
  );
  const setView = useCallback((patch: Partial<ViewPrefs>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* ignora */
      }
      return next;
    });
  }, []);

  const showToast = useCallback((kind: "error" | "ok", text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === "error" ? 6000 : 2500);
  }, []);

  /** Toda gravação passa por aqui, em fila: nunca duas escritas da mesma tela competindo. */
  const enqueue = useCallback(<T,>(fn: () => Promise<T>) => {
    setPending((p) => p + 1);
    const run = queue.current.then(fn, fn);
    queue.current = run.catch(() => { });
    return run.finally(() => setPending((p) => p - 1));
  }, []);

  const pushUndo = useCallback((entry: Partial<UndoEntry>) => {
    setUndoStack((s) => [...s.slice(-99), { ...emptyEntry(), ...entry }]);
    setRedoStack([]);
  }, []);

  // ─── Leitura ───────────────────────────────────────────────────────
  const queryBody = useCallback(
    (offset: number) => ({
      filters: filters.length ? filters : undefined,
      match,
      sort: sort ? [sort] : undefined,
      search: search.trim() || undefined,
      deleted: trash || undefined,
      offset,
      limit: PAGE,
    }),
    [filters, match, sort, search, trash],
  );

  type QueryResult = { rows: ClientRow[]; total: number; allTotal: number; hasFormulas: boolean; refs: Record<string, string>; columns: ClientColumn[] };

  const reload = useCallback(async () => {
    const version = ++queryVersion.current;
    try {
      const data = await api<QueryResult>(`/api/sheets/${sheetId}/rows/query`, { method: "POST", body: JSON.stringify(queryBody(0)) });
      if (version !== queryVersion.current) return;
      setRows(data.rows);
      setTotal(data.total);
      setAllTotal(data.allTotal);
      setHasFormulas((h) => h || data.hasFormulas);
      setRefs((r) => ({ ...r, ...data.refs }));
      setColumns(data.columns);
    } catch (err) {
      showToast("error", (err as Error).message);
    }
  }, [sheetId, queryBody, showToast]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(reload, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [reload, search]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || rows.length >= total) return;
    loadingMore.current = true;
    const version = queryVersion.current;
    try {
      const data = await api<QueryResult>(`/api/sheets/${sheetId}/rows/query`, { method: "POST", body: JSON.stringify(queryBody(rows.length)) });
      if (version !== queryVersion.current) return;
      setRows((r) => {
        const seen = new Set(r.map((x) => x.id));
        return [...r, ...data.rows.filter((x) => !seen.has(x.id))];
      });
      setRefs((r) => ({ ...r, ...data.refs }));
    } catch (err) {
      showToast("error", (err as Error).message);
    } finally {
      loadingMore.current = false;
    }
  }, [rows.length, total, sheetId, queryBody, showToast]);

  const reloadColumns = useCallback(async () => {
    const data = await api<{ sheet: { columns: ClientColumn[] } }>(`/api/sheets/${sheetId}`);
    setColumns(data.sheet.columns);
    await reload();
  }, [sheetId, reload]);

  // ─── Fórmulas: planilha inteira na ordem real ──────────────────────
  const canonVersion = useRef(0);
  const loadCanon = useCallback(async () => {
    const version = ++canonVersion.current;
    const all: ClientRow[] = [];
    try {
      for (let offset = 0; offset < MAX_CALC_ROWS; offset += 500) {
        const data = await api<QueryResult>(`/api/sheets/${sheetId}/rows/query`, { method: "POST", body: JSON.stringify({ offset, limit: 500 }) });
        all.push(...data.rows);
        setRefs((r) => ({ ...r, ...data.refs }));
        if (data.rows.length < 500) break;
      }
      if (version === canonVersion.current) setCanon(all);
    } catch (err) {
      showToast("error", (err as Error).message);
    }
  }, [sheetId, showToast]);

  /** Localizar/Substituir trabalha na planilha inteira, não só na página virtualizada. */
  const openFindDialog = useCallback(async (tab: "find" | "replace") => {
    setFindDialog(tab);
    setFindLoading(true);
    const all: ClientRow[] = [];
    try {
      for (let offset = 0; offset < 50_000; offset += 500) {
        const data = await api<QueryResult>(`/api/sheets/${sheetId}/rows/query`, { method: "POST", body: JSON.stringify({ offset, limit: 500 }) });
        all.push(...data.rows);
        setRefs((current) => ({ ...current, ...data.refs }));
        if (data.rows.length < 500) break;
      }
      setFindRows(all);
    } catch (error) {
      showToast("error", (error as Error).message);
      setFindDialog(null);
    } finally {
      setFindLoading(false);
    }
  }, [sheetId, showToast]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da planilha inteira quando há fórmulas
    if (hasFormulas && !trash) loadCanon();
  }, [hasFormulas, trash, loadCanon]);
  const canonReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCanonReload = useCallback(() => {
    if (!hasFormulas) return;
    if (canonReloadTimer.current) clearTimeout(canonReloadTimer.current);
    canonReloadTimer.current = setTimeout(loadCanon, 300);
  }, [hasFormulas, loadCanon]);

  // ─── Linha de Totais (calculada no banco, respeitando filtros) ─────
  const rowsVersion = useMemo(() => rows.map((r) => r.updatedAt).join("|").length + rows.length, [rows]);
  useEffect(() => {
    if (!table?.totals) return;
    const wanted = columns.filter((c) => (table.totalsFns[c.id] ?? "none") !== "none");
    if (!wanted.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sem funções escolhidas, não há o que buscar
      setTotals({});
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const data = await api<{ groups: { values: (number | string | null)[] }[] }>(`/api/sheets/${sheetId}/summary`, {
          method: "POST",
          body: JSON.stringify({
            metrics: wanted.map((c) => ({ columnId: c.id, fn: TOTAL_TO_METRIC[table.totalsFns[c.id] as Exclude<TotalFn, "none">] })),
            ...(filters.length ? { filters, match } : {}),
          }),
          signal: ctrl.signal,
        });
        const values = data.groups[0]?.values ?? [];
        const out: Record<string, string> = {};
        wanted.forEach((c, i) => {
          const v = values[i];
          const fn = table.totalsFns[c.id];
          if (v === null || v === undefined) out[c.id] = "";
          else if (fn === "count" || fn === "countFilled") out[c.id] = Number(v).toLocaleString("pt-BR");
          else out[c.id] = displayCell(c, c.type === "DATE" ? String(v) : Number(v), refs);
        });
        setTotals(out);
      } catch {
        /* totais são enfeite útil: falha não atrapalha a edição */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [table, columns, filters, match, sheetId, rowsVersion, refs]);

  // ─── Escrita ───────────────────────────────────────────────────────
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  /**
   * Grava valores e/ou marcações de linhas existentes (otimista: mostra na
   * hora, volta atrás se o servidor recusar). `record` = entra no Ctrl+Z.
   */
  const patchRows = useCallback(
    async (cells: CellEdit[], fmts: FmtEdit[], record: boolean, fmls: FmlEdit[] = []) => {
      if (!cells.length && !fmts.length && !fmls.length) return;
      const byRow = new Map<string, { values?: Record<string, CellValue | null>; formats?: Record<string, CellFormat | null>; formulas?: Record<string, string | null> }>();
      for (const e of fmls) {
        const cur = byRow.get(e.rowId) ?? {};
        byRow.set(e.rowId, { ...cur, formulas: { ...(cur.formulas ?? {}), [e.colId]: e.after ?? null } });
      }
      for (const e of cells) {
        const cur = byRow.get(e.rowId) ?? {};
        byRow.set(e.rowId, { ...cur, values: { ...(cur.values ?? {}), [e.colId]: e.after ?? null } });
      }
      for (const e of fmts) {
        const cur = byRow.get(e.rowId) ?? {};
        byRow.set(e.rowId, { ...cur, formats: { ...(cur.formats ?? {}), [e.colId]: e.after ?? null } });
      }
      const apply = (which: "before" | "after") =>
        setRows((list) =>
          list.map((r) => {
            const mineV = cells.filter((e) => e.rowId === r.id);
            const mineF = fmts.filter((e) => e.rowId === r.id);
            const mineL = fmls.filter((e) => e.rowId === r.id);
            if (!mineV.length && !mineF.length && !mineL.length) return r;
            const formulas = { ...(r.formulas ?? {}) };
            for (const e of mineL) {
              const v = e[which];
              if (v === undefined) delete formulas[e.colId];
              else formulas[e.colId] = v;
            }
            const values = { ...r.values };
            for (const e of mineV) {
              const v = e[which];
              if (v === undefined) delete values[e.colId];
              else values[e.colId] = v;
            }
            const formats = { ...(r.formats ?? {}) };
            for (const e of mineF) {
              const v = e[which];
              if (v === undefined) delete formats[e.colId];
              else formats[e.colId] = v;
            }
            return { ...r, values, formats, formulas };
          }),
        );
      apply("after");
      try {
        const allEntries = [...byRow].map(([id, patch]) => ({ id, ...patch }));
        const fresh = new Map<string, ClientRow>();
        const CHUNK = 1_000;
        for (let i = 0; i < allEntries.length; i += CHUNK) {
          const slice = allEntries.slice(i, i + CHUNK);
          const data = await enqueue(() =>
            api<{ rows: ClientRow[] }>(`/api/sheets/${sheetId}/rows`, {
              method: "PATCH",
              body: JSON.stringify({ rows: slice }),
            }),
          );
          for (const r of data.rows) fresh.set(r.id, r);
        }
        // Mantém a posição real (rank) que só a consulta conhece.
        setRows((list) => list.map((r) => (fresh.has(r.id) ? { ...fresh.get(r.id)!, rank: r.rank } : r)));
        setCanon((list) => (list ? list.map((r) => (fresh.has(r.id) ? { ...fresh.get(r.id)!, rank: r.rank } : r)) : list));
        if (fmls.some((e) => e.after)) setHasFormulas(true);
        if (record) pushUndo({ cells, formats: fmts, formulas: fmls });
      } catch (err) {
        apply("before");
        showToast("error", (err as Error).message);
        throw err;
      }
    },
    [enqueue, sheetId, showToast, pushUndo],
  );

  const insertRows = useCallback(
    async (newRows: Record<string, CellValue>[], extras?: ({ formats?: Record<string, CellFormat>; formulas?: Record<string, string> } | undefined)[]) => {
      const CHUNK = 1_000;
      const inserted: ClientRow[] = [];
      for (let i = 0; i < newRows.length; i += CHUNK) {
        const rowsSlice = newRows.slice(i, i + CHUNK);
        const extrasSlice = extras ? extras.slice(i, i + CHUNK) : undefined;
        const data = await enqueue(() =>
          api<{ rows: ClientRow[] }>(`/api/sheets/${sheetId}/rows`, {
            method: "POST",
            body: JSON.stringify({ rows: rowsSlice, ...(extrasSlice?.some(Boolean) ? { extras: extrasSlice } : {}) }),
          }),
        );
        inserted.push(...data.rows);
      }
      let next = allTotal;
      const withRank = inserted.map((r) => ({ ...r, rank: ++next }));
      setRows((list) => [...list, ...withRank]);
      setTotal((t) => t + inserted.length);
      setAllTotal(next);
      if (extras?.some((e) => e?.formulas && Object.keys(e.formulas).length)) setHasFormulas(true);
      scheduleCanonReload();
      return withRank;
    },
    [enqueue, sheetId, allTotal, scheduleCanonReload],
  );

  /**
   * Exclui/restaura linhas. O servidor reescreve as fórmulas das outras linhas
   * (referência abaixo sobe, à linha excluída vira #REF!, como no Excel) e
   * devolve o que mudou — aplicado aqui e guardado para o Ctrl+Z.
   */
  const setDeleted = useCallback(
    async (ids: string[], deleted: boolean): Promise<FmlEdit[]> => {
      if (!ids.length) return [];
      const CHUNK = 1_000;
      const changes: { rowId: string; colId: string; before: string; after: string }[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const data = await enqueue(() =>
          api<{ formulaChanges?: { rowId: string; colId: string; before: string; after: string }[] }>(`/api/sheets/${sheetId}/rows${deleted ? "" : "/restore"}`, {
            method: deleted ? "DELETE" : "POST",
            body: JSON.stringify({ ids: slice }),
          }),
        );
        if (data.formulaChanges?.length) changes.push(...data.formulaChanges);
      }
      if (changes.length) {
        const apply = (list: ClientRow[]) =>
          list.map((r) => {
            const mine = changes.filter((c) => c.rowId === r.id);
            if (!mine.length) return r;
            const formulas = { ...(r.formulas ?? {}) };
            for (const c of mine) formulas[c.colId] = c.after;
            return { ...r, formulas };
          });
        setRows(apply);
        setCanon((list) => (list ? apply(list) : list));
      }
      setRows((list) => list.filter((r) => !ids.includes(r.id)));
      setTotal((t) => Math.max(0, t - ids.length));
      setAllTotal((t) => Math.max(0, t + (deleted ? -ids.length : ids.length)));
      scheduleCanonReload();
      return changes.map((c) => ({ rowId: c.rowId, colId: c.colId, before: c.before, after: c.after }));
    },
    [enqueue, sheetId, scheduleCanonReload],
  );

  /** Nome → id de cliente/negócio/membro já conhecido na tela (para colar nomes vindos do Excel). */
  const refByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, label] of Object.entries(refs)) m.set(label.trim().toLowerCase(), id);
    return m;
  }, [refs]);

  /**
   * Mudanças de células (grade, barra de fórmulas, colar, arrastar): valida,
   * separa linha existente × nova e grava. Texto começando com "=" é fórmula:
   * é compilada (A1 → interno) com a linha REAL da célula; o resultado vem do
   * recálculo logo depois. Valor comum digitado numa célula com fórmula
   * apaga a fórmula (como no Excel).
   */
  const applyChanges = useCallback(
    async (changes: CellChange[], colsOverride?: ClientColumn[]) => {
      const colList = colsOverride ?? columnsRef.current;
      const cols = new Map(colList.map((c) => [c.id, c]));
      const current = rowsRef.current;
      const edits: CellEdit[] = [];
      const fmtEdits: FmtEdit[] = [];
      const fmlEdits: FmlEdit[] = [];
      const fresh = new Map<number, { values: Record<string, CellValue>; formats: Record<string, CellFormat>; formulas: Record<string, string> }>();
      const newRefs: Record<string, string> = {};
      let firstError: string | null = null;
      // Linha real (número do Excel) de cada linha nova: continua do fim da planilha, na ordem em que aparecem.
      const newIndexes = [...new Set(changes.filter((c) => c.rowIndex >= current.length).map((c) => c.rowIndex))].sort((a, b) => a - b);
      const ownRowOf = (rowIndex: number) =>
        rowIndex < current.length ? (current[rowIndex].rank ?? rowIndex + 1) + 1 : allTotal + 2 + newIndexes.indexOf(rowIndex);
      const formulaCols = colList.map((c) => ({ id: c.id, name: c.name, type: c.type }));

      for (const ch of changes) {
        const col = cols.get(ch.colId);
        if (!col) continue;
        const existing = ch.rowIndex < current.length ? current[ch.rowIndex] : undefined;
        const bucket = () => {
          let b = fresh.get(ch.rowIndex);
          if (!b) fresh.set(ch.rowIndex, (b = { values: {}, formats: {}, formulas: {} }));
          return b;
        };
        // Marcação colada/arrastada.
        if (ch.format !== undefined) {
          const after = cleanFormat(ch.format ?? undefined);
          if (existing) {
            const before = existing.formats?.[col.id];
            if (JSON.stringify(before) !== JSON.stringify(after)) fmtEdits.push({ rowId: existing.id, colId: col.id, before, after });
          } else if (after) bucket().formats[col.id] = after;
        }
        // Fórmula: interna (copiada/arrastada) ou digitada.
        let formula: string | undefined = ch.formula;
        if (!formula && typeof ch.raw === "string" && ch.raw.trim().startsWith("=") && ch.raw.trim().length > 1) {
          if (NO_FORMULA_TYPES.has(col.type)) {
            firstError ??= `"${labelOf(col)}": colunas de ${SHEET_COLUMN_TYPE_LABELS[col.type]} não aceitam fórmula`;
            continue;
          }
          const compiled = compileFormula(ch.raw, ownRowOf(ch.rowIndex), formulaCols);
          if (!compiled.ok) {
            firstError ??= `Fórmula com problema: ${compiled.error}`;
            continue;
          }
          formula = compiled.internal;
        }
        if (formula) {
          if (existing) {
            const before = existing.formulas?.[col.id];
            if (before !== formula) fmlEdits.push({ rowId: existing.id, colId: col.id, before, after: formula });
          } else bucket().formulas[col.id] = formula;
          continue;
        }
        if (ch.raw === undefined) continue;
        let raw = ch.raw;
        if (isReferenceType(col.type) && typeof raw === "string" && !/^[a-z0-9]{20,40}$/i.test(raw)) {
          const id = refByName.get(raw.trim().toLowerCase());
          if (!id) {
            firstError ??= `"${labelOf(col)}": "${raw}" não encontrado — escolha pelo seletor da célula (F2)`;
            continue;
          }
          raw = id;
        }
        let value: CellValue | undefined;
        try {
          value = coerceCellValue(col, raw);
        } catch (err) {
          if (err instanceof CellValueError) {
            firstError ??= err.message;
            continue;
          }
          throw err;
        }
        if (ch.refLabel && typeof value === "string") newRefs[value] = ch.refLabel;
        if (existing) {
          const before = existing.values[col.id];
          if (JSON.stringify(before) !== JSON.stringify(value)) edits.push({ rowId: existing.id, colId: col.id, before, after: value });
          // Digitou um valor por cima de uma fórmula: a fórmula sai.
          const hadFormula = existing.formulas?.[col.id];
          if (hadFormula) fmlEdits.push({ rowId: existing.id, colId: col.id, before: hadFormula, after: undefined });
        } else if (value !== undefined) bucket().values[col.id] = value;
      }
      if (firstError) showToast("error", firstError);
      if (Object.keys(newRefs).length) setRefs((r) => ({ ...r, ...newRefs }));

      try {
        if (edits.length || fmtEdits.length || fmlEdits.length) await patchRows(edits, fmtEdits, true, fmlEdits);
        if (fresh.size) {
          const ordered = [...fresh.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
          const created = await insertRows(
            ordered.map((o) => o.values),
            ordered.map((o) => (Object.keys(o.formats).length || Object.keys(o.formulas).length ? { formats: o.formats, formulas: o.formulas } : undefined)),
          );
          pushUndo({ inserted: created.map((r) => r.id) });
        }
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        if (fresh.size && !edits.length) showToast("error", err.message);
      }
    },
    [refByName, patchRows, insertRows, showToast, pushUndo, allTotal, labelOf],
  );
  const onChanges = useCallback((changes: CellChange[]) => applyChanges(changes), [applyChanges]);

  /** Substituições passam pela mesma coerção/compilação e viram um único passo do Ctrl+Z. */
  const replaceFound = useCallback(
    async (replacements: { match: FindMatch; text: string }[]) => {
      const source = findRows ?? rowsRef.current;
      const byRow = new Map(source.map((row) => [row.id, row]));
      const edits: CellEdit[] = [];
      const formulas: FmlEdit[] = [];
      const formulaCols = columnsRef.current.map((col) => ({ id: col.id, name: col.name, type: col.type }));
      for (const replacement of replacements) {
        const row = byRow.get(replacement.match.rowId);
        const col = columnsRef.current.find((candidate) => candidate.id === replacement.match.colId);
        if (!row || !col) continue;
        const beforeFormula = row.formulas?.[col.id];
        const text = replacement.text;
        if (text.trim().startsWith("=") && text.trim().length > 1) {
          if (NO_FORMULA_TYPES.has(col.type)) throw new Error(`"${labelOf(col)}": esta coluna não aceita fórmula`);
          const compiled = compileFormula(text, (row.rank ?? source.indexOf(row) + 1) + 1, formulaCols);
          if (!compiled.ok) throw new Error(`Fórmula com problema: ${compiled.error}`);
          if (beforeFormula !== compiled.internal) formulas.push({ rowId: row.id, colId: col.id, before: beforeFormula, after: compiled.internal });
          continue;
        }
        let raw: unknown = text;
        if (isReferenceType(col.type) && typeof raw === "string") {
          const id = refByName.get(raw.trim().toLocaleLowerCase("pt-BR"));
          if (!id && raw.trim()) throw new Error(`"${labelOf(col)}": "${raw}" não encontrado`);
          raw = id ?? null;
        }
        const value = coerceCellValue(col, raw);
        const before = row.values[col.id];
        if (JSON.stringify(before) !== JSON.stringify(value)) edits.push({ rowId: row.id, colId: col.id, before, after: value });
        if (beforeFormula) formulas.push({ rowId: row.id, colId: col.id, before: beforeFormula, after: undefined });
      }
      if (!edits.length && !formulas.length) return 0;
      await patchRows(edits, [], true, formulas);
      const editMap = new Map(edits.map((edit) => [`${edit.rowId}:${edit.colId}`, edit.after]));
      const formulaMap = new Map(formulas.map((formula) => [`${formula.rowId}:${formula.colId}`, formula.after]));
      setFindRows((list) => list?.map((row) => {
        const values = { ...row.values };
        const nextFormulas = { ...(row.formulas ?? {}) };
        for (const col of columnsRef.current) {
          const key = `${row.id}:${col.id}`;
          if (editMap.has(key)) {
            const value = editMap.get(key);
            if (value === undefined) delete values[col.id];
            else values[col.id] = value;
          }
          if (formulaMap.has(key)) {
            const formula = formulaMap.get(key);
            if (formula === undefined) delete nextFormulas[col.id];
            else nextFormulas[col.id] = formula;
          }
        }
        return { ...row, values, formulas: nextFormulas };
      }) ?? list);
      return new Set([...edits.map((edit) => `${edit.rowId}:${edit.colId}`), ...formulas.map((formula) => `${formula.rowId}:${formula.colId}`)]).size;
    },
    [findRows, refByName, patchRows, labelOf],
  );

  /** Digitar/colar à direita da tabela: cria as colunas (Texto) e grava as células — como a tabela do Excel se expande. */
  const createColumns = useCallback(
    async (req: NewColumnsRequest) => {
      const maxOffset = Math.max(-1, ...Object.keys(req.names).map(Number), ...req.cells.map((c) => c.offset));
      if (maxOffset < 0) return;
      const created: ClientColumn[] = [];
      try {
        for (let k = 0; k <= maxOffset; k++) {
          // Como no Excel: coluna nova não ganha nome inventado ("Coluna6") — fica sem título até alguém digitar na linha 1.
          const colName = req.names[k]?.trim() ?? "";
          const data = await enqueue(() =>
            api<{ column: ClientColumn }>(`/api/sheets/${sheetId}/columns`, {
              method: "POST",
              body: JSON.stringify({ name: colName, type: req.types?.[k] ?? "TEXT" }),
            }),
          );
          created.push(data.column);
        }
      } catch (err) {
        showToast("error", (err as Error).message);
      }
      if (!created.length) return;
      const allCols = [...columnsRef.current, ...created];
      setColumns(allCols);
      columnsRef.current = allCols;
      const changes: CellChange[] = req.cells
        .filter((c) => created[c.offset])
        .map((c) => ({ rowIndex: c.rowIndex, colId: created[c.offset].id, raw: c.raw, format: c.format, ...(c.formula ? { formula: c.formula } : {}) }));
      if (changes.length) await applyChanges(changes, allCols);
    },
    [enqueue, sheetId, showToast, applyChanges],
  );

  const deleteRows = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      try {
        const rewritten = await setDeleted(ids, true);
        // As fórmulas reescritas entram no mesmo passo: desfazer devolve o texto original (inclusive o que virou #REF!).
        pushUndo({ deleted: ids, formulas: rewritten });
        showToast("ok", `${ids.length} linha(s) excluída(s) — Ctrl+Z desfaz`);
      } catch (err) {
        showToast("error", (err as Error).message);
      }
    },
    [setDeleted, showToast, pushUndo],
  );

  const restoreRows = useCallback(
    async (ids: string[]) => {
      try {
        await setDeleted(ids, false);
        showToast("ok", `${ids.length} linha(s) restaurada(s)`);
      } catch (err) {
        showToast("error", (err as Error).message);
      }
    },
    [setDeleted, showToast],
  );

  /** Desfazer/refazer: aplica o inverso no servidor (células, marcações, linhas novas e exclusões). */
  const travel = useCallback(
    async (direction: "undo" | "redo") => {
      const stack = direction === "undo" ? undoStack : redoStack;
      const entry = stack[stack.length - 1];
      if (!entry || trash) return;
      (direction === "undo" ? setUndoStack : setRedoStack)(stack.slice(0, -1));
      const restore = async (ids: string[]) => {
        for (let i = 0; i < ids.length; i += 1_000) {
          const slice = ids.slice(i, i + 1_000);
          await enqueue(() => api(`/api/sheets/${sheetId}/rows/restore`, { method: "POST", body: JSON.stringify({ ids: slice }) }));
        }
      };
      try {
        const known = new Set(rowsRef.current.map((r) => r.id));
        const flip = <T extends { before: unknown; after: unknown }>(e: T): T => (direction === "undo" ? { ...e, before: e.after, after: e.before } : e);
        const cells = entry.cells.filter((e) => known.has(e.rowId)).map(flip);
        const fmts = entry.formats.filter((e) => known.has(e.rowId)).map(flip);
        // Exclusão de linhas: as fórmulas reescritas pelo servidor só voltam DEPOIS de restaurar as linhas.
        const deletion = entry.deleted.length > 0;
        const fmls = deletion ? [] : entry.formulas.filter((e) => known.has(e.rowId)).map(flip);
        if (cells.length || fmts.length || fmls.length) await patchRows(cells, fmts, false, fmls);
        if (direction === "undo") {
          if (entry.inserted.length) await setDeleted(entry.inserted, true);
          if (deletion) {
            await restore(entry.deleted);
            const original = entry.formulas.map(flip);
            if (original.length) await patchRows([], [], false, original);
            await reload();
            scheduleCanonReload();
          }
          setRedoStack((s) => [...s, entry]);
        } else {
          if (entry.inserted.length) {
            await restore(entry.inserted);
            await reload();
          }
          if (deletion) await setDeleted(entry.deleted, true);
          setUndoStack((s) => [...s, entry]);
        }
      } catch (err) {
        showToast("error", (err as Error).message);
      }
    },
    [undoStack, redoStack, trash, patchRows, setDeleted, enqueue, sheetId, reload, showToast, scheduleCanonReload],
  );

  // ─── Marcações (Fonte / Alinhamento / Limpar) ──────────────────────
  /** Células de dados de todos os intervalos selecionados (linhas existentes × colunas existentes, sem duplicatas). */
  const selectionCells = useCallback(() => {
    const out: { row: ClientRow; col: ClientColumn }[] = [];
    const seen = new Set<string>();
    for (const { r1, r2, c1, c2 } of active.ranges) {
      for (let r = Math.max(r1, 1); r <= Math.min(r2, rowsRef.current.length); r++) {
        for (let c = c1; c <= Math.min(c2, columnsRef.current.length - 1); c++) {
          const key = `${r}:${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ row: rowsRef.current[r - 1], col: columnsRef.current[c] });
        }
      }
    }
    return out;
  }, [active.ranges]);

  const activeFormat: CellFormat | undefined = active.kind === "cell" ? rows[active.rowIndex]?.formats?.[columns[active.pos.c]?.id ?? ""] : undefined;

  const applyFormat = useCallback(
    async (fn: (current: CellFormat) => CellFormat) => {
      const fmts: FmtEdit[] = [];
      for (const { row, col } of selectionCells()) {
        const before = row.formats?.[col.id];
        const after = cleanFormat(fn({ ...(before ?? {}) }));
        if (JSON.stringify(before) !== JSON.stringify(after)) fmts.push({ rowId: row.id, colId: col.id, before, after });
      }
      if (!fmts.length) return;
      try {
        await patchRows([], fmts, true);
      } catch {
        /* aviso já mostrado */
      }
    },
    [selectionCells, patchRows],
  );

  /** Aplica uma marcação completa a um intervalo já fechado pelo mouse. */
  const paintRange = useCallback(
    async (range: ActiveInfo["range"], format: CellFormat | undefined) => {
      const fmts: FmtEdit[] = [];
      for (let r = Math.max(range.r1, 1); r <= Math.min(range.r2, rowsRef.current.length); r++) {
        for (let c = range.c1; c <= Math.min(range.c2, columnsRef.current.length - 1); c++) {
          const row = rowsRef.current[r - 1];
          const col = columnsRef.current[c];
          const before = row.formats?.[col.id];
          const after = cleanFormat(format ? { ...format } : undefined);
          if (JSON.stringify(before) !== JSON.stringify(after)) fmts.push({ rowId: row.id, colId: col.id, before, after });
        }
      }
      if (fmts.length) await patchRows([], fmts, true);
    },
    [patchRows],
  );

  const toggleFormat = useCallback(
    (key: "b" | "i" | "u" | "s") => {
      const turnOn = !activeFormat?.[key];
      applyFormat((f) => ({ ...f, [key]: turnOn }));
    },
    [activeFormat, applyFormat],
  );

  const applyBorders = useCallback(
    async (command: BorderCommand) => {
      const edits: FmtEdit[] = [];
      const seen = new Set<string>();
      for (const { r1, r2, c1, c2 } of active.ranges) {
        const top = Math.max(r1, 1);
        const bottom = Math.min(r2, rowsRef.current.length);
        const left = c1;
        const right = Math.min(c2, columnsRef.current.length - 1);
        for (let r = top; r <= bottom; r++) {
          for (let c = left; c <= right; c++) {
            const key = `${r}:${c}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const row = rowsRef.current[r - 1];
            const col = columnsRef.current[c];
            const before = row.formats?.[col.id];
            const next: CellFormat = { ...(before ?? {}) };
            if (command === "none") {
              delete next.borderTop;
              delete next.borderRight;
              delete next.borderBottom;
              delete next.borderLeft;
            } else if (command === "all") {
              next.borderTop = { style: "thin" };
              next.borderRight = { style: "thin" };
              next.borderBottom = { style: "thin" };
              next.borderLeft = { style: "thin" };
            } else {
              const outStyle = command === "thickOutside" ? "thick" : "thin";
              if ((command === "top" || command === "outside" || command === "thickOutside" || command === "topBottom" || command === "topThickBottom") && r === top) {
                next.borderTop = { style: outStyle };
              }
              if ((command === "right" || command === "outside" || command === "thickOutside") && c === right) {
                next.borderRight = { style: outStyle };
              }
              if ((command === "bottom" || command === "outside" || command === "thickOutside" || command === "thickBottom" || command === "topBottom" || command === "topThickBottom") && r === bottom) {
                next.borderBottom = { style: command === "thickBottom" || command === "thickOutside" || command === "topThickBottom" ? "thick" : "thin" };
              }
              if ((command === "left" || command === "outside" || command === "thickOutside") && c === left) {
                next.borderLeft = { style: outStyle };
              }
            }
            const after = cleanFormat(next);
            if (JSON.stringify(before) !== JSON.stringify(after)) edits.push({ rowId: row.id, colId: col.id, before, after });
          }
        }
      }
      if (edits.length) await patchRows([], edits, true);
    },
    [active.ranges, patchRows],
  );

  const clearSelection = useCallback(
    async (what: "all" | "formats" | "contents") => {
      if (what === "contents") return grid.current?.clear();
      const cells: CellEdit[] = [];
      const fmts: FmtEdit[] = [];
      const fmls: FmlEdit[] = [];
      for (const { row, col } of selectionCells()) {
        if (row.formats?.[col.id]) fmts.push({ rowId: row.id, colId: col.id, before: row.formats[col.id], after: undefined });
        if (what === "all" && row.values[col.id] !== undefined) cells.push({ rowId: row.id, colId: col.id, before: row.values[col.id], after: undefined });
        if (what === "all" && row.formulas?.[col.id]) fmls.push({ rowId: row.id, colId: col.id, before: row.formulas[col.id], after: undefined });
      }
      try {
        await patchRows(cells, fmts, true, fmls);
      } catch {
        /* aviso já mostrado */
      }
    },
    [selectionCells, patchRows],
  );

  // ─── Recálculo (como o Excel: a cada mudança, tudo que depende atualiza) ─
  const formulaColumns = useMemo(() => columns.map((c) => ({ id: c.id, name: c.name, type: c.type })), [columns]);
  useEffect(() => {
    if (!canon) return;
    const { results, circular: circ } = recalcSheet({ columns: formulaColumns, rows: canon, refs });
    const nextShown = new Map<string, FormulaShown>();
    const writes: CellEdit[] = [];
    const byId = new Map(canon.map((r) => [r.id, r]));
    for (const [rowId, byCol] of results) {
      const row = byId.get(rowId)!;
      for (const [colId, result] of byCol) {
        const col = columns.find((c) => c.id === colId);
        if (!col) continue;
        const stored = scalarToStored(col.type, result);
        if (stored.display !== undefined) nextShown.set(`${rowId}:${colId}`, { display: stored.display, error: stored.error });
        const before = row.values[colId];
        if (JSON.stringify(before) !== JSON.stringify(stored.value)) writes.push({ rowId, colId, before, after: stored.value });
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resultado do recálculo
    setShown(nextShown);
    setCircular(circ);
    // Resultados novos vão para o banco (filtro, soma, exportação e Linha de Totais usam o valor guardado).
    if (writes.length && !trash) {
      for (let i = 0; i < writes.length; i += 500) patchRows(writes.slice(i, i + 500), [], false).catch(() => { });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcula quando a planilha inteira/colunas/nomes mudam
  }, [canon, formulaColumns, refs]);

  const formulaText = useCallback(
    (row: ClientRow, col: ClientColumn) => {
      const internal = row.formulas?.[col.id];
      if (!internal) return undefined;
      return displayFormula(internal, (row.rank ?? 0) + 1, formulaColumns);
    },
    [formulaColumns],
  );
  const formulaShown = useCallback((rowId: string, colId: string) => shown.get(`${rowId}:${colId}`), [shown]);

  /** AutoSoma (Σ) do Excel: soma/média/… dos números logo acima (ou à esquerda) da célula ativa. */
  const autoSum = useCallback(
    (fn: "SOMA" | "MÉDIA" | "CONT.NÚM" | "MÁXIMO" | "MÍNIMO") => {
      const { pos } = active;
      if (pos.r < 1 || pos.c >= columns.length) return showToast("error", "Escolha uma célula da tabela para a AutoSoma");
      const letter = (c: number) => {
        let s2 = "";
        let n = c + 1;
        while (n > 0) {
          s2 = String.fromCharCode(65 + ((n - 1) % 26)) + s2;
          n = Math.floor((n - 1) / 26);
        }
        return s2;
      };
      const numAt = (r: number, c: number) => {
        const row = rows[r - 1];
        const col = columns[c];
        return !!row && !!col && typeof row.values[col.id] === "number";
      };
      const realRow = (r: number) => (rows[r - 1]?.rank ?? r) + 1;
      let r = pos.r - 1;
      while (r >= 1 && numAt(r, pos.c)) r--;
      let formula = `=${fn}()`;
      if (r < pos.r - 1) formula = `=${fn}(${letter(pos.c)}${realRow(r + 1)}:${letter(pos.c)}${realRow(pos.r - 1)})`;
      else {
        let c = pos.c - 1;
        while (c >= 0 && numAt(pos.r, c)) c--;
        if (c < pos.c - 1) formula = `=${fn}(${letter(c + 1)}${realRow(pos.r)}:${letter(pos.c - 1)}${realRow(pos.r)})`;
      }
      // Igual ao Excel: propõe a fórmula e espera o Enter.
      grid.current?.edit(pos, formula);
    },
    [active, columns, rows, showToast],
  );

  // ─── Colunas ───────────────────────────────────────────────────────
  const patchColumn = useCallback(
    async (col: ClientColumn, body: Record<string, unknown>, describe: string) => {
      try {
        await enqueue(() => api(`/api/sheets/${sheetId}/columns/${col.id}`, { method: "PATCH", body: JSON.stringify(body) }));
        await reloadColumns();
      } catch (err) {
        const e = err as Error & { status?: number; data?: { invalidCount?: number; invalidSamples?: { rowNumber: number; value: string }[] } };
        if (e.status === 409 && typeof e.data?.invalidCount === "number") {
          if (typeof body.type === "string") {
            setColumnDialog({
              column: col,
              initialType: body.type as SheetColumnType,
              initialConflict: { count: e.data.invalidCount, samples: Array.isArray(e.data.invalidSamples) ? e.data.invalidSamples : [] },
            });
            return;
          }
          setConfirm({
            title: `Mudar "${labelOf(col)}" para ${describe}?`,
            description: `${e.data.invalidCount} valor(es) não cabem no novo formato e serão apagados. Os demais são convertidos.`,
            label: "Apagar e converter",
            danger: true,
            action: async () => {
              await enqueue(() => api(`/api/sheets/${sheetId}/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ ...body, force: true }) }));
              await reloadColumns();
            },
          });
        } else showToast("error", e.message);
      }
    },
    [enqueue, sheetId, reloadColumns, showToast, labelOf],
  );

  const addOption = useCallback(
    async (colId: string, option: string) => {
      const col = columnsRef.current.find((c) => c.id === colId);
      if (!col) return false;
      const options = [...((col.config as { options?: string[] })?.options ?? []), option];
      try {
        const data = await enqueue(() =>
          api<{ column: ClientColumn }>(`/api/sheets/${sheetId}/columns/${colId}`, { method: "PATCH", body: JSON.stringify({ config: { options } }) }),
        );
        if (data.column) setColumns((list) => list.map((c) => (c.id === colId ? data.column : c)));
        return true;
      } catch (err) {
        showToast("error", (err as Error).message);
        return false;
      }
    },
    [enqueue, sheetId, showToast],
  );

  const renameColumn = useCallback(
    async (col: ClientColumn, next: string) => {
      setColumns((list) => list.map((c) => (c.id === col.id ? { ...c, name: next } : c)));
      try {
        await enqueue(() => api(`/api/sheets/${sheetId}/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ name: next }) }));
      } catch (err) {
        setColumns((list) => list.map((c) => (c.id === col.id ? { ...c, name: col.name } : c)));
        showToast("error", (err as Error).message);
      }
    },
    [enqueue, sheetId, showToast],
  );

  async function setColumnArchived(col: ClientColumn, archived: boolean) {
    return setColumnsArchived([col], archived);
  }

  async function setColumnsArchived(cols: ClientColumn[], archived: boolean) {
    if (!cols.length) return;
    try {
      for (const col of cols) {
        await enqueue(() => api(`/api/sheets/${sheetId}/columns/${col.id}`, { method: "PATCH", body: JSON.stringify({ archived }) }));
      }
      await reloadColumns();
      if (cols.length === 1) {
        showToast("ok", archived ? `Coluna "${cols[0].name}" excluída (arquivada)` : `Coluna "${cols[0].name}" restaurada`);
      } else {
        showToast("ok", archived ? `${cols.length} colunas excluídas (arquivadas)` : `${cols.length} colunas restauradas`);
      }
    } catch (err) {
      showToast("error", (err as Error).message);
    }
  }

  // ─── Tabela (Formatar como Tabela / Design da Tabela) ──────────────
  const saveTable = useCallback(
    async (next: TableSettings | null) => {
      const prev = table;
      setTableState(next);
      try {
        await enqueue(() => api(`/api/sheets/${sheetId}`, { method: "PATCH", body: JSON.stringify({ settings: { table: next } }) }));
      } catch (err) {
        setTableState(prev);
        showToast("error", (err as Error).message);
      }
    },
    [table, enqueue, sheetId, showToast],
  );

  const formatAsTable = useCallback(
    (style: string) => {
      // Já existe tabela: só troca o estilo (o intervalo fica). Senão, como no Excel, a tabela
      // nasce sobre a SELEÇÃO; com uma célula só, sobre os dados da planilha inteira.
      let range: TableSettings["range"];
      if (table) range = table.range;
      else {
        const sel = active.range;
        const multi = sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
        const lastCol = columnsRef.current.length - 1;
        if (multi && lastCol >= 0) {
          if (sel.c1 > lastCol) {
            showToast("error", "Selecione células com colunas da planilha para formatar como tabela");
            return;
          }
          const realRow = (r: number) => (r <= 0 ? 1 : (rowsRef.current[r - 1]?.rank ?? r) + 1);
          const r1 = Math.max(1, realRow(sel.r1));
          // Seleção que chega ao fim dos dados (ou passa dele) = a tabela cresce com as linhas novas.
          const r2 = sel.r2 >= rowsRef.current.length ? null : Math.max(r1, realRow(sel.r2));
          range = { c1: columnsRef.current[sel.c1].id, c2: columnsRef.current[Math.min(sel.c2, lastCol)].id, r1, r2 };
        }
      }
      const base: TableSettings = table ?? { style, header: true, banded: true, firstColumn: false, totals: false, totalsFns: {} };
      saveTable({ ...base, style, ...(range ? { range } : {}) });
      setView({ filterButtons: true });
      setRibbonTab("design");
    },
    [table, saveTable, setView, active.range, showToast],
  );

  // ─── Planilha ──────────────────────────────────────────────────────
  async function rename(next: string) {
    setRenaming(false);
    const clean = next.trim();
    if (!clean || clean === name) return;
    const prev = name;
    setName(clean);
    try {
      await enqueue(() => api(`/api/sheets/${sheetId}`, { method: "PATCH", body: JSON.stringify({ name: clean }) }));
      router.refresh();
    } catch (err) {
      setName(prev);
      showToast("error", (err as Error).message);
    }
  }

  async function newSheet() {
    const used = new Set(sheetTabs.map((t) => t.name));
    let n = sheetTabs.length + 1;
    while (used.has(`Planilha${n}`)) n++;
    try {
      const data = await api<{ id: string }>("/api/sheets", { method: "POST", body: JSON.stringify({ name: `Planilha${n}` }) });
      window.open(`/planilhas/${data.id}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      showToast("error", (err as Error).message);
    }
  }

  async function openArchivedColumns() {
    try {
      const data = await api<{ archivedColumns: ClientColumn[] }>(`/api/sheets/${sheetId}?archivedColumns=1`);
      setArchivedCols(data.archivedColumns ?? []);
    } catch (err) {
      showToast("error", (err as Error).message);
    }
  }

  function toggleTrash() {
    setTrash((t) => !t);
    setUndoStack([]);
    setRedoStack([]);
  }

  const activeColumn = active.kind === "cell" || active.kind === "header" ? (columns[active.pos.c] ?? null) : null;
  const selectedColumns = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const list = active.selectedColIds.map((id) => byId.get(id)).filter((c): c is ClientColumn => !!c);
    return list.length ? list : activeColumn ? [activeColumn] : [];
  }, [columns, active.selectedColIds, activeColumn]);
  const filteredColumnIds = useMemo(() => new Set(filters.map((f) => f.columnId)), [filters]);
  const filtersActive = filters.length > 0 || !!sort || !!search.trim();

  const actions: RibbonActions = {
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    copy: () => grid.current?.copy(),
    formatPainter: (persistent) => {
      if (active.kind !== "cell" || active.rowIndex >= rows.length || active.pos.c >= columns.length) {
        showToast("error", "Escolha a célula cuja formatação deseja copiar");
        return;
      }
      setFormatPainter({ format: cleanFormat(activeFormat ? { ...activeFormat } : undefined), persistent });
      grid.current?.focus();
    },
    cut: () => grid.current?.cut(),
    paste: async () => {
      try {
        const text = await navigator.clipboard.readText();
        grid.current?.paste(text);
      } catch {
        showToast("error", "O navegador não liberou a área de transferência — use Ctrl+V na planilha");
      }
      grid.current?.focus();
    },
    pasteSpecial: () => {
      if (!grid.current?.hasInternalClip()) {
        showToast("error", "Copie células desta planilha antes de usar Colar Especial");
        return;
      }
      setPasteSpecialOpen(true);
    },
    toggleFormat,
    setFill: (hex) => applyFormat((f) => ({ ...f, fill: hex ?? undefined })),
    setColor: (hex) => applyFormat((f) => ({ ...f, color: hex ?? undefined })),
    setAlign: (align) => applyFormat((f) => ({ ...f, align: f.align === align ? undefined : align })),
    setBorders: (command) => applyBorders(command).catch(() => { }),
    setColumnType: (type) => {
      const targets = selectedColumns.filter((c) => c.type !== type);
      for (const col of targets) patchColumn(col, { type }, SHEET_COLUMN_TYPE_LABELS[type]);
    },
    changeDecimals: (delta) => {
      const targets = selectedColumns.filter((c) => isNumericType(c.type));
      if (!targets.length) return showToast("error", "Casas decimais valem para colunas de Número, Moeda ou Porcentagem");
      for (const col of targets) {
        const current = columnDecimals(col) ?? (col.type === "CURRENCY" ? 2 : 0);
        // Mesmo teto do servidor (columnConfigSchema): 0 a 6 casas.
        const decimals = Math.max(0, Math.min(6, current + delta));
        patchColumn(col, { config: { ...(col.config as object), decimals } }, "outro formato");
      }
    },
    formatAsTable,
    setTable: (patch) => table && saveTable({ ...table, ...patch }),
    removeTable: () => {
      saveTable(null);
      setRibbonTab("home");
    },
    insertRow: () => grid.current?.editNewRow(),
    insertColumn: (where, type) => {
      const base = active.pos.c < columns.length ? active.pos.c : columns.length - 1;
      setColumnDialog({ insertAt: where === "left" ? Math.max(base, 0) : base + 1, initialType: type });
    },
    deleteRows: () => deleteRows(grid.current?.selectedRowIds() ?? []),
    archiveColumn: () => {
      if (!selectedColumns.length) return;
      const many = selectedColumns.length > 1;
      setConfirm({
        title: many ? `Excluir ${selectedColumns.length} colunas selecionadas?` : `Excluir a coluna "${selectedColumns[0].name}"?`,
        description: many
          ? `As colunas (${selectedColumns.map((c) => `"${labelOf(c)}"`).join(", ")}) saem da planilha, mas os valores ficam guardados: dá para restaurar em Dados → Colunas Arquivadas.`
          : "A coluna sai da planilha, mas os valores ficam guardados: dá para restaurar em Dados → Colunas Arquivadas.",
        label: many ? `Excluir ${selectedColumns.length} colunas` : "Excluir coluna",
        danger: true,
        action: () => setColumnsArchived(selectedColumns, true),
      });
    },
    editColumn: () => activeColumn && setColumnDialog({ column: activeColumn }),
    autoFit: () => grid.current?.autoFit(),
    sort: (dir) => activeColumn && setSort({ columnId: activeColumn.id, dir }),
    toggleFilterButtons: () => setView({ filterButtons: !view.filterButtons }),
    clearFilters: () => {
      setFilters([]);
      setSort(null);
      setSearch("");
    },
    advancedFilter: (at) => setFilterAt(at),
    find: () => {
      openFindDialog("find");
    },
    replace: () => openFindDialog("replace"),
    clear: clearSelection,
    importFile: () => setImporting(true),
    pullCrm: () => setCrmIntegration("pull"),
    pushCrm: () => setCrmIntegration("push"),
    exportFile: () => downloadExport(sheetId),
    history: () => setHistory({}),
    toggleTrash,
    archivedColumns: openArchivedColumns,
    setView,
    newSheet,
    openSheet: (id) => window.open(`/planilhas/${id}`, "_blank", "noopener,noreferrer"),
    rename: () => setRenaming(true),
    archiveSheet: () =>
      setConfirm({
        title: "Arquivar planilha?",
        description: "Ela sai da lista, mas nada é apagado: dá para restaurar em Planilhas → Arquivadas.",
        label: "Arquivar",
        danger: true,
        action: async () => {
          await api(`/api/sheets/${sheetId}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
          router.push("/planilhas");
        },
      }),
    back: () => router.push("/planilhas"),
    shortcuts: () => setShortcutsOpen(true),
    autoSum,
    insertFunction: () => setFunctionDialog(true),
    toggleShowFormulas: () => setShowFormulas((v) => !v),
    showFormulas,
  };

  const onShortcut = useCallback(
    (action: "bold" | "italic" | "underline" | "strike" | "table" | "filterButtons") => {
      if (action === "bold") toggleFormat("b");
      else if (action === "italic") toggleFormat("i");
      else if (action === "underline") toggleFormat("u");
      else if (action === "strike") toggleFormat("s");
      else if (action === "table") {
        if (!table) formatAsTable(DEFAULT_TABLE_STYLE);
        else setRibbonTab("design");
      } else setView({ filterButtons: !view.filterButtons });
    },
    [toggleFormat, table, formatAsTable, setView, view.filterButtons],
  );

  const autoSumRef = useRef(autoSum);
  useEffect(() => {
    autoSumRef.current = autoSum;
  }, [autoSum]);
  // Atalhos fora da grade: Ctrl+F/Ctrl+H abrem o diálogo do Excel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
        e.preventDefault();
        openFindDialog(e.key.toLowerCase() === "h" ? "replace" : "find");
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (grid.current?.hasInternalClip()) setPasteSpecialOpen(true);
        else showToast("error", "Copie células desta planilha antes de usar Colar Especial");
      }
      if (e.key === "Escape") setFormatPainter(null);
      // Ctrl+` = Mostrar Fórmulas; Alt+= = AutoSoma (atalhos do Excel).
      if ((e.ctrlKey || e.metaKey) && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        setShowFormulas((v) => !v);
      }
      if (e.altKey && (e.key === "=" || e.code === "Equal") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        autoSumRef.current("SOMA");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFindDialog, showToast]);

  function onColumnAction(action: ColumnAction, col: ClientColumn, at: { x: number; y: number }) {
    const idx = columns.findIndex((c) => c.id === col.id);
    setColumnMenu(null);
    const inMulti = selectedColumns.length > 1 && selectedColumns.some((c) => c.id === col.id);
    const targets = inMulti ? selectedColumns : [col];
    if (action === "format") setColumnDialog({ column: col });
    else if (action === "rename") grid.current?.edit({ r: 0, c: idx });
    else if (action === "autofit") grid.current?.autoFit(inMulti ? undefined : col.id);
    else if (action === "asc" || action === "desc") setSort({ columnId: col.id, dir: action });
    else if (action === "filter") setAutoFilter({ column: col, x: at.x, y: at.y });
    else if (action === "insertLeft") setColumnDialog({ insertAt: idx });
    else if (action === "insertRight") setColumnDialog({ insertAt: idx + 1 });
    else if (action === "delete") {
      const many = targets.length > 1;
      setConfirm({
        title: many ? `Excluir ${targets.length} colunas selecionadas?` : `Excluir a coluna "${labelOf(col)}"?`,
        description: many
          ? `As colunas (${targets.map((c) => `"${labelOf(c)}"`).join(", ")}) saem da planilha, mas os valores ficam guardados: dá para restaurar em Dados → Colunas Arquivadas.`
          : "A coluna sai da planilha, mas os valores ficam guardados: dá para restaurar em Dados → Colunas Arquivadas.",
        label: many ? `Excluir ${targets.length} colunas` : "Excluir coluna",
        danger: true,
        action: () => setColumnsArchived(targets, true),
      });
    }
  }

  const activeRow = active.kind === "cell" ? rows[active.rowIndex] : undefined;
  const saving = pending > 0;
  const statusText = saving ? "Salvando…" : mode === "edit" ? "Editar" : mode === "enter" ? "Inserir" : trash ? "Somente leitura" : filtersActive ? "Modo de Filtro" : "Pronto";

  return (
    <div className="xl-theme xl-workbook-enter flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-[#c8c8c8] bg-[var(--xl-sheet)] shadow-sm dark:border-neutral-800">
      {/* ── Barra de título (verde do Excel) ── */}
      <div className="flex h-10 shrink-0 items-center gap-2 bg-[var(--xl)] px-2 text-white dark:bg-[#185c37]">
        <Link href="/planilhas" className="xl-chrome-button rounded p-1.5 hover:bg-white/15" aria-label="Todas as planilhas" title="Todas as planilhas">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-white text-[var(--xl)]">
          <Sheet className="h-4 w-4" strokeWidth={2.2} />
        </span>
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            maxLength={120}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(e.currentTarget.value);
              if (e.key === "Escape") setRenaming(false);
            }}
            className="min-w-0 rounded-[3px] border border-white/60 bg-white px-1.5 py-0.5 text-[14px] font-semibold text-neutral-900 outline-none"
          />
        ) : (
          <button type="button" onClick={() => setRenaming(true)} className="xl-chrome-button min-w-0 truncate rounded-[3px] px-1.5 py-0.5 text-[14px] font-semibold hover:bg-white/15" title="Renomear">
            {name}
          </button>
        )}
        <span className="flex shrink-0 items-center gap-1 text-[12px] text-white/85" aria-live="polite">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {saving ? "Salvando…" : "Salvo"}
        </span>
        <div className="mx-auto hidden w-full max-w-md md:block">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500 dark:text-white/70" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  grid.current?.focus();
                }
                if (e.key === "Enter") grid.current?.focus();
              }}
              placeholder="Pesquisar na planilha"
              className="h-7 w-full rounded-[4px] border border-transparent bg-white/90 pr-7 pl-8 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500 focus:bg-white dark:bg-black/25 dark:text-white dark:placeholder:text-white/65 dark:focus:border-white/30 dark:focus:bg-black/40"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="xl-chrome-button absolute top-1/2 right-2 -translate-y-1/2 text-neutral-500 hover:text-neutral-800 dark:text-white/70 dark:hover:text-white" aria-label="Limpar busca">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <button type="button" onClick={() => setShortcutsOpen(true)} className="xl-chrome-button ml-auto rounded p-1.5 hover:bg-white/15 md:ml-0" title="Atalhos de teclado" aria-label="Atalhos de teclado">
          <Keyboard className="h-4 w-4" />
        </button>
      </div>

      <Ribbon
        tab={ribbonTab === "design" && !table ? "home" : ribbonTab}
        onTab={setRibbonTab}
        view={view}
        readOnly={trash}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        activeColumn={activeColumn}
        activeFormat={activeFormat}
        formatPainterActive={!!formatPainter}
        hasDataSelection={active.ranges.some((rg) => rg.r2 >= 1 && rg.r1 <= rows.length && rg.c1 < columns.length)}
        table={table}
        filtersActive={filtersActive}
        trash={trash}
        sheetTabs={sheetTabs}
        currentSheetId={sheetId}
        actions={actions}
      />

      {/* Faixa amarela de aviso (como o "Modo de Exibição Protegido" do Excel) */}
      {trash && (
        <div className="xl-bar-reveal flex shrink-0 items-center gap-2 border-b border-[#e5c96b] bg-[#fff4ce] px-3 py-1.5 text-[13px] text-[#5c4a00] dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-semibold">LIXEIRA</span>
          <span>Estas linhas foram excluídas. Clique com o botão direito numa linha para restaurá-la.</span>
          <button type="button" onClick={toggleTrash} className="ml-auto rounded-[3px] border border-[#c9a92c] bg-white px-2.5 py-0.5 text-[12px] font-medium hover:bg-[#fffbe6] dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100 dark:hover:bg-amber-800">
            Sair da Lixeira
          </button>
        </div>
      )}

      {view.formulaBar && (
        <FormulaBar
          key={`${active.pos.r}:${active.pos.c}:${activeColumn?.id ?? ""}:${activeColumn?.type ?? ""}:${activeColumn?.name ?? ""}:${JSON.stringify(activeRow?.values[activeColumn?.id ?? ""] ?? null)}:${activeRow?.formulas?.[activeColumn?.id ?? ""] ?? ""}:${active.rangeLabel}`}
          active={active}
          column={activeColumn}
          value={activeRow?.values[activeColumn?.id ?? ""]}
          formula={activeRow && activeColumn ? formulaText(activeRow, activeColumn) : undefined}
          refs={refs}
          readOnly={trash || active.isTotals}
          onGo={(targets) => {
            if (!grid.current?.selectByNameBox(targets)) {
              const first = targets[0];
              if (first && (first.kind === "cells" || first.kind === "rows")) showToast("error", `A linha ${first.r1} está escondida pelo filtro`);
            }
          }}
          onOpenEditor={() => grid.current?.edit()}
          onConfigureColumn={activeColumn && !trash ? () => setColumnDialog({ column: activeColumn }) : undefined}
          onCommit={(text) => {
            const { pos, kind } = active;
            if (kind === "header" && activeColumn) {
              if (text.trim() && text.trim() !== activeColumn.name) renameColumn(activeColumn, text.trim());
            } else if (kind === "newColumnHeader") {
              if (text.trim()) createColumns({ names: { [pos.c - columns.length]: text.trim() }, cells: [] });
            } else if (kind === "newColumnCell") {
              if (text.trim()) createColumns({ names: {}, cells: [{ rowIndex: pos.r - 1, offset: pos.c - columns.length, raw: text }] });
            } else if (activeColumn) {
              onChanges([{ rowIndex: pos.r - 1, colId: activeColumn.id, raw: text }]);
            }
            grid.current?.moveTo({ r: pos.r + 1, c: pos.c });
          }}
          onCancel={() => grid.current?.focus()}
        />
      )}

      {/* ── Grade ── */}
      <SheetGrid
        sheetId={sheetId}
        columns={columns}
        rows={rows}
        refs={refs}
        readOnly={trash}
        widths={widths}
        zoom={view.zoom}
        showGridlines={view.gridlines}
        showHeadings={view.headings}
        showFilterButtons={view.filterButtons}
        table={table}
        totals={totals}
        allTotal={allTotal}
        filteredView={filtersActive}
        formulaText={formulaText}
        formulaShown={formulaShown}
        showFormulas={showFormulas}
        sort={sort}
        filteredColumnIds={filteredColumnIds}
        controllerRef={grid}
        onActiveChange={setActive}
        onStats={setStats}
        onModeChange={setMode}
        onResize={resize}
        onResizeMany={resizeMany}
        onChanges={onChanges}
        onRenameColumn={renameColumn}
        onClearColumns={(columnIds) => {
          // Tudo carregado na tela: a limpeza normal já cobriu (e o Ctrl+Z desfaz). Senão, o resto sai no servidor.
          if (rowsRef.current.length >= total) return;
          enqueue(() => api(`/api/sheets/${sheetId}/columns/clear`, { method: "POST", body: JSON.stringify({ columnIds }) }))
            .then(() => {
              reload();
              scheduleCanonReload();
            })
            .catch((err: Error) => showToast("error", err.message));
        }}
        onCreateColumns={createColumns}
        onDeleteRows={deleteRows}
        onRestoreRows={restoreRows}
        onUndo={() => travel("undo")}
        onRedo={() => travel("redo")}
        onLoadMore={loadMore}
        onColumnMenu={(column, at) => setColumnMenu({ column, ...at })}
        onAutoFilter={(column, at) => setAutoFilter({ column, ...at })}
        onSortColumn={(column, dir) => setSort({ columnId: column.id, dir })}
        onFilterByValue={(column, value) =>
          setFilters((f) => [...f.filter((x) => x.columnId !== column.id), { columnId: column.id, op: column.type === "MULTI_SELECT" ? "eq" : "in", value: column.type === "MULTI_SELECT" ? (value as string[])[0] : [String(value)] }])
        }
        onRowHistory={(rowId) => setHistory({ rowId })}
        onAddOption={addOption}
        onImport={() => setImporting(true)}
        onTotalsPick={(column, at) => setTotalsMenu({ column, ...at })}
        onShortcut={onShortcut}
        onNotice={(message) => showToast("error", message)}
        onPasteSpecial={() => {
          if (grid.current?.hasInternalClip()) setPasteSpecialOpen(true);
          else showToast("error", "Copie células desta planilha antes de usar Colar Especial");
        }}
        formatPainterActive={!!formatPainter}
        onSelectionCommit={(range) => {
          if (!formatPainter) return;
          paintRange(range, formatPainter.format).catch(() => { });
          if (!formatPainter.persistent) setFormatPainter(null);
        }}
      />

      {/* ── Abas das planilhas (como no Excel) ── */}
      <div className="flex h-8 shrink-0 items-stretch border-t border-[#c8c8c8] bg-[var(--xl-head)] text-[13px] dark:border-neutral-800">
        <div className="flex shrink-0 items-center px-1 text-neutral-500 dark:text-neutral-400">
          <button type="button" onClick={() => tabsRef.current?.scrollBy({ left: -160, behavior: "smooth" })} className="xl-chrome-button rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Rolar abas para a esquerda">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => tabsRef.current?.scrollBy({ left: 160, behavior: "smooth" })} className="xl-chrome-button rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Rolar abas para a direita">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div ref={tabsRef} className="flex min-w-0 items-stretch overflow-x-hidden">
          {sheetTabs.map((t) =>
            t.id === sheetId ? (
              <span
                key={t.id}
                onDoubleClick={() => setRenaming(true)}
                title="Duplo clique para renomear"
                className="xl-sheet-tab relative -mt-px flex max-w-52 shrink-0 cursor-default items-center border-x border-[#c8c8c8] bg-[var(--xl-sheet)] px-4 font-semibold text-[var(--xl)] dark:border-neutral-700"
              >
                <span className="truncate">{name}</span>
                <span className="xl-tab-indicator absolute inset-x-3 bottom-0.5 h-[3px] rounded-full bg-[var(--xl)]" />
              </span>
            ) : (
              <Link
                key={t.id}
                href={`/planilhas/${t.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="xl-sheet-tab flex max-w-52 shrink-0 items-center border-r border-[#d6d6d6] px-4 text-neutral-700 hover:bg-black/5 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-white/5 dark:hover:text-neutral-100"
              >
                <span className="truncate">{t.name}</span>
              </Link>
            ),
          )}
        </div>
        <button
          type="button"
          onClick={newSheet}
          className="xl-chrome-button ml-1 flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full text-neutral-600 hover:bg-black/10 dark:text-neutral-300 dark:hover:bg-white/10"
          title="Nova planilha"
          aria-label="Nova planilha"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* ── Barra de status (Pronto · Quantidade/Soma/Média · linhas · zoom) ── */}
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-[#d6d6d6] bg-[var(--xl-head)] px-3 text-[12px] text-neutral-600 tabular-nums dark:border-neutral-800 dark:text-neutral-400">
        <span className="font-medium">{statusText}</span>
        {circular.length > 0 && (
          <span className="font-medium text-red-600 dark:text-red-400" title="Uma fórmula depende dela mesma (o Excel mostra o mesmo aviso)">
            Referências Circulares: {circular.slice(0, 3).join(", ")}
            {circular.length > 3 ? "…" : ""}
          </span>
        )}
        {canon && canon.length >= MAX_CALC_ROWS && <span className="text-amber-700 dark:text-amber-400">Planilha grande: fórmulas calculadas só nas primeiras {MAX_CALC_ROWS.toLocaleString("pt-BR")} linhas</span>}
        {filtersActive && !trash && (
          <span>
            {total.toLocaleString("pt-BR")} {total === 1 ? "registro encontrado" : "registros encontrados"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {(stats.multi || stats.filled > 0) && (
            <div className="xl-status-reveal flex items-center gap-3 border-r border-[#d6d6d6] pr-3 dark:border-neutral-700">
              <span>
                Quantidade: <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{stats.filled.toLocaleString("pt-BR")}</strong>
              </span>
              <span>
                Soma:{" "}
                <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
                  {stats.currency ? "R$ " : ""}
                  {stats.sum.toLocaleString("pt-BR", { minimumFractionDigits: stats.currency ? 2 : 0, maximumFractionDigits: 2 })}
                </strong>
              </span>
              <span>
                Média:{" "}
                <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
                  {stats.currency ? "R$ " : ""}
                  {(stats.nums > 0 ? stats.sum / stats.nums : 0).toLocaleString("pt-BR", { minimumFractionDigits: stats.currency ? 2 : 0, maximumFractionDigits: 2 })}
                </strong>
              </span>
            </div>
          )}
          <span>{total.toLocaleString("pt-BR")} {total === 1 ? "linha" : "linhas"}</span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setView({ zoom: Math.max(0.5, Math.round((view.zoom - 0.1) * 10) / 10) })} className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10" aria-label="Reduzir zoom">
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="range"
              min={50}
              max={200}
              step={10}
              value={Math.round(view.zoom * 100)}
              onChange={(e) => setView({ zoom: Number(e.target.value) / 100 })}
              className="h-1 w-24 accent-[var(--xl)]"
              aria-label="Zoom"
            />
            <button type="button" onClick={() => setView({ zoom: Math.min(2, Math.round((view.zoom + 0.1) * 10) / 10) })} className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10" aria-label="Ampliar zoom">
              <Plus className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => setView({ zoom: 1 })} className="w-10 text-right hover:underline" title="Voltar para 100%">
              {Math.round(view.zoom * 100)}%
            </button>
          </div>
        </div>
      </div>

      {/* ── Menus e diálogos ── */}
      {pasteSpecialOpen && (
        <PasteSpecialDialog
          onPaste={(mode) => {
            if (!grid.current?.pasteSpecial(mode)) showToast("error", "A cópia interna não está mais disponível");
            setPasteSpecialOpen(false);
            grid.current?.focus();
          }}
          onClose={() => {
            setPasteSpecialOpen(false);
            grid.current?.focus();
          }}
        />
      )}
      {crmIntegration && (
        <CrmIntegrationDialog
          key={crmIntegration}
          sheetId={sheetId}
          columns={columns}
          initialMode={crmIntegration}
          onClose={() => {
            setCrmIntegration(null);
            grid.current?.focus();
          }}
          onDone={reload}
        />
      )}
      {findDialog && (
        <FindReplaceDialog
          key={findDialog}
          initialTab={findDialog}
          rows={findRows ?? rows}
          columns={columns}
          refs={refs}
          loading={findLoading}
          formulaText={formulaText}
          onNavigate={(match) => {
            const visible = rowsRef.current.some((row) => row.id === match.rowId);
            if (!visible && findRows) {
              setFilters([]);
              setSort(null);
              setSearch("");
              setRows(findRows);
              setTotal(findRows.length);
              requestAnimationFrame(() => requestAnimationFrame(() => grid.current?.goTo(match.colIndex, match.rowNumber)));
            } else grid.current?.goTo(match.colIndex, match.rowNumber);
          }}
          onReplace={replaceFound}
          onClose={() => setFindDialog(null)}
        />
      )}
      {autoFilter && (
        <AutoFilterMenu
          sheetId={sheetId}
          column={autoFilter.column}
          label={labelOf(autoFilter.column)}
          at={autoFilter}
          filters={filters}
          match={match}
          sortDir={sort?.columnId === autoFilter.column.id ? sort.dir : null}
          onSort={(dir) => {
            setSort({ columnId: autoFilter.column.id, dir });
            setAutoFilter(null);
            grid.current?.focus();
          }}
          onApply={(colFilters) => {
            setFilters((f) => [...f.filter((x) => x.columnId !== autoFilter.column.id), ...colFilters]);
            setAutoFilter(null);
            grid.current?.focus();
          }}
          onQuickType={
            !trash
              ? (nextType) => {
                const col = autoFilter.column;
                setAutoFilter(null);
                patchColumn(col, { type: nextType }, SHEET_COLUMN_TYPE_LABELS[nextType]);
                grid.current?.focus();
              }
              : undefined
          }
          onEditColumn={
            !trash
              ? () => {
                const col = autoFilter.column;
                setAutoFilter(null);
                setColumnDialog({ column: col });
              }
              : undefined
          }
          onClose={() => {
            setAutoFilter(null);
            grid.current?.focus();
          }}
        />
      )}

      {totalsMenu && table && (
        <div className="fixed inset-0 z-40" onMouseDown={() => setTotalsMenu(null)}>
          <div
            className="xl-menu-pop absolute min-w-44 rounded-[4px] border border-[#c6c6c6] bg-white py-1 text-[13px] shadow-[0_6px_18px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900"
            style={{ left: Math.min(totalsMenu.x, window.innerWidth - 200), top: Math.min(totalsMenu.y, window.innerHeight - 260) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {totalsFnsFor(totalsMenu.column).map((fn) => {
              const current = (table.totalsFns[totalsMenu.column.id] ?? "none") === fn;
              return (
                <button
                  key={fn}
                  type="button"
                  onClick={() => {
                    saveTable({ ...table, totalsFns: { ...table.totalsFns, [totalsMenu.column.id]: fn } });
                    setTotalsMenu(null);
                    grid.current?.focus();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-[5px] text-left hover:bg-[var(--xl-soft)] ${current ? "font-semibold text-[var(--xl)]" : "text-neutral-800 dark:text-neutral-200"}`}
                >
                  <span className="w-4">{current && <Check className="h-3.5 w-3.5" />}</span>
                  {TOTAL_FN_LABELS[fn]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filterAt && (
        <FilterPopover
          at={filterAt}
          columns={columns}
          filters={filters}
          match={match}
          preferColumnId={activeColumn?.id}
          onClose={() => setFilterAt(null)}
          onApply={(f, m) => {
            setFilters(f);
            setMatch(m);
            setFilterAt(null);
            grid.current?.focus();
          }}
        />
      )}

      {columnMenu && (
        <div className="fixed inset-0 z-40" onMouseDown={() => setColumnMenu(null)} onContextMenu={(e) => { e.preventDefault(); setColumnMenu(null); }}>
          <div
            className="xl-menu-pop absolute min-w-64 rounded-[4px] border border-[#c6c6c6] bg-white py-1 text-[13px] shadow-[0_6px_18px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900"
            style={{ left: Math.min(columnMenu.x, window.innerWidth - 270), top: Math.min(columnMenu.y, window.innerHeight - 330) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="flex items-center gap-1.5 truncate px-3 py-1.5 text-xs font-semibold text-neutral-500">
              <ColumnTypeIcon type={columnMenu.column.type} className="h-3.5 w-3.5" />
              {selectedColumns.length > 1 && selectedColumns.some((c) => c.id === columnMenu.column.id)
                ? `${selectedColumns.length} colunas selecionadas`
                : columnMenu.column.name}
              <span className="font-normal text-neutral-400">· {SHEET_COLUMN_TYPE_LABELS[columnMenu.column.type]}</span>
            </p>
            <ColumnMenuItems
              column={columnMenu.column}
              selectedCount={selectedColumns.some((c) => c.id === columnMenu.column.id) ? selectedColumns.length : 1}
              trash={trash}
              onQuickType={(nextType) => {
                const targets = selectedColumns.some((c) => c.id === columnMenu.column.id) ? selectedColumns : [columnMenu.column];
                setColumnMenu(null);
                for (const col of targets) {
                  if (col.type !== nextType) patchColumn(col, { type: nextType }, SHEET_COLUMN_TYPE_LABELS[nextType]);
                }
              }}
              onPick={(action) => onColumnAction(action, columnMenu.column, columnMenu)}
            />
          </div>
        </div>
      )}

      {columnDialog && (
        <ColumnDialog
          sheetId={sheetId}
          column={columnDialog.column}
          insertAt={columnDialog.insertAt}
          initialType={columnDialog.initialType}
          initialConflict={columnDialog.initialConflict}
          sampleValues={
            columnDialog.column
              ? (canon ?? rows).map((r) => r.values[columnDialog.column!.id]).filter((v): v is CellValue => v !== undefined)
              : []
          }
          onClose={() => {
            setColumnDialog(null);
            grid.current?.focus();
          }}
          onSaved={async () => {
            setColumnDialog(null);
            await reloadColumns();
            grid.current?.focus();
          }}
        />
      )}

      {archivedCols && (
        <ArchivedColumnsDialog
          items={archivedCols}
          onClose={() => setArchivedCols(null)}
          onRestore={async (col) => {
            setArchivedCols((list) => list?.filter((c) => c.id !== col.id) ?? null);
            await setColumnArchived(col, false);
          }}
          onRestoreMany={async (cols) => {
            const ids = new Set(cols.map((c) => c.id));
            setArchivedCols((list) => list?.filter((c) => !ids.has(c.id)) ?? null);
            await setColumnsArchived(cols, false);
          }}
        />
      )}

      {importing && (
        <ImportDialog
          mode="append"
          sheetId={sheetId}
          columns={columns}
          onClose={() => setImporting(false)}
          onDone={async () => {
            setImporting(false);
            await reload();
          }}
        />
      )}

      {history && (
        <HistoryPanel
          sheetId={sheetId}
          rowId={history.rowId}
          columns={columns}
          refs={refs}
          formulaToText={(internal, rowId) => {
            const row = (canon ?? rows).find((r) => r.id === rowId);
            return row?.rank ? displayFormula(internal, row.rank + 1, formulaColumns) : undefined;
          }}
          rowNumber={(rowId) => {
            const row = (canon ?? rows).find((candidate) => candidate.id === rowId);
            return row?.rank ? row.rank + 1 : undefined;
          }}
          onRestored={reload}
          onClose={() => setHistory(null)}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {functionDialog && (
        <InsertFunctionDialog
          onClose={() => {
            setFunctionDialog(false);
            grid.current?.focus();
          }}
          onPick={(f) => {
            setFunctionDialog(false);
            if (active.pos.r < 1 || active.pos.c >= columns.length) return showToast("error", "Escolha uma célula da tabela");
            grid.current?.edit(active.pos, `=${f.name}(`);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.label}
          danger={confirm.danger ?? true}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await confirm.action();
            } catch (err) {
              showToast("error", (err as Error).message);
            } finally {
              setConfirm(null);
            }
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className={`xl-toast fixed bottom-20 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-md px-4 py-2.5 text-sm text-white shadow-lg lg:bottom-10 ${toast.kind === "error" ? "bg-red-600" : "bg-neutral-900 dark:bg-neutral-700"
            }`}
        >
          {toast.kind === "error" ? <XCircle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100" aria-label="Fechar">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

type ColumnAction = "format" | "rename" | "autofit" | "asc" | "desc" | "filter" | "insertLeft" | "insertRight" | "delete";

const QUICK_MENU_TYPES: { type: SheetColumnType; label: string }[] = [
  { type: "TEXT", label: "Texto" },
  { type: "CURRENCY", label: "Moeda R$" },
  { type: "NUMBER", label: "Número" },
  { type: "DATE", label: "Data" },
  { type: "SELECT", label: "Lista" },
  { type: "PERCENT", label: "%" },
];

/** Itens do menu da coluna (clique direito no cabeçalho ou na letra), na ordem do Excel. */
function ColumnMenuItems({
  column,
  selectedCount = 1,
  trash,
  onQuickType,
  onPick,
}: {
  column: ClientColumn;
  selectedCount?: number;
  trash: boolean;
  onQuickType?: (type: SheetColumnType) => void;
  onPick: (action: ColumnAction) => void;
}) {
  const item = (label: string, action: ColumnAction, danger = false) => (
    <button
      type="button"
      onClick={() => onPick(action)}
      className={`block w-full px-3 py-[5px] text-left hover:bg-[var(--xl-soft)] ${danger ? "text-red-600 dark:text-red-400" : "text-neutral-800 dark:text-neutral-200"}`}
    >
      {label}
    </button>
  );
  const numeric = isNumericType(column.type);
  const many = selectedCount > 1;
  return (
    <>
      {!trash && onQuickType && (
        <div className="border-y border-neutral-100 bg-neutral-50/70 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-800/40">
          <p className="mb-1 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">Tipo rápido</p>
          <div className="flex flex-wrap gap-1">
            {QUICK_MENU_TYPES.map((q) => {
              const active = column.type === q.type;
              return (
                <button
                  key={q.type}
                  type="button"
                  onClick={() => !active && onQuickType(q.type)}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors ${active
                      ? "border-[var(--xl)] bg-[var(--xl-soft)] text-[var(--xl)]"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    }`}
                >
                  <ColumnTypeIcon type={q.type} className="h-3 w-3" />
                  {q.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!trash && item("Mais tipos e opções da coluna…", "format")}
      {!trash && item("Renomear", "rename")}
      {item(many ? `AutoAjuste da Largura (${selectedCount} colunas)` : "AutoAjuste da Largura", "autofit")}
      <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
      {item(numeric ? "Classificar do Menor para o Maior" : "Classificar de A a Z", "asc")}
      {item(numeric ? "Classificar do Maior para o Menor" : "Classificar de Z a A", "desc")}
      {item("Filtrar…", "filter")}
      {!trash && (
        <>
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
          {item("Inserir Coluna à Esquerda", "insertLeft")}
          {item("Inserir Coluna à Direita", "insertRight")}
          {item(many ? `Excluir ${selectedCount} Colunas` : "Excluir Coluna", "delete", true)}
        </>
      )}
    </>
  );
}

/** Baixa o .xlsx pela própria rota (Content-Disposition: attachment) sem sair da tela. */
function downloadExport(sheetId: string) {
  const a = document.createElement("a");
  a.href = `/api/sheets/${sheetId}/export`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ─── Barra de fórmulas ───────────────────────────────────────────────

/**
 * Caixa de Nome (mostra A1 / B2:D9; digite "B12" + Enter para ir até lá),
 * botões ✕ ✓ fx e o conteúdo da célula ativa, editável como no Excel. Na
 * linha 1 mostra/renomeia o nome da coluna. Tipos com seletor abrem o editor.
 */
function FormulaBar({
  active,
  column,
  value,
  formula,
  refs,
  readOnly,
  onGo,
  onOpenEditor,
  onConfigureColumn,
  onCommit,
  onCancel,
}: {
  active: ActiveInfo;
  column: ClientColumn | null;
  value: CellValue | undefined;
  /** Fórmula da célula em A1 — a barra mostra a fórmula, não o resultado (como no Excel). */
  formula?: string;
  refs: Record<string, string>;
  readOnly: boolean;
  onGo: (targets: NameBoxTarget[]) => void;
  onOpenEditor: () => void;
  onConfigureColumn?: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const isHeader = active.kind === "header" || active.kind === "newColumnHeader";
  const isNewCol = active.kind === "newColumnHeader" || active.kind === "newColumnCell";
  const textual = formula !== undefined || isHeader || isNewCol || (!!column && !["SELECT", "MULTI_SELECT", "CHECKBOX", "USER", "CONTACT", "DEAL"].includes(column.type));
  const shown =
    formula ?? (isHeader ? (column?.name ?? "") : isNewCol ? "" : column ? (textual ? editText(column, value) : displayCell(column, value, refs)) : "");
  const [draft, setDraft] = useState(shown);
  const [nameBox, setNameBox] = useState(active.rangeLabel);
  const [focused, setFocused] = useState(false);
  const dirty = draft !== shown;

  return (
    <div className="flex h-[30px] shrink-0 items-stretch border-b border-[#d6d6d6] bg-[var(--xl-sheet)] text-[13px] dark:border-neutral-800">
      <div className="flex w-[110px] shrink-0 items-center border-r border-[#d6d6d6] dark:border-neutral-800">
        <input
          value={nameBox}
          onChange={(e) => setNameBox(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setNameBox(active.rangeLabel)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const parsed = parseNameBoxInput(nameBox);
              if (parsed) onGo(parsed);
              else setNameBox(active.rangeLabel);
            } else if (e.key === "Escape") {
              setNameBox(active.rangeLabel);
              onCancel();
            }
          }}
          title="Caixa de Nome — digite uma célula (B12), intervalo (A2:D10), colunas (A:C), linhas (2:5) ou vários separados por ; (A2:B5; D2:D5) e pressione Enter"
          aria-label="Caixa de Nome"
          className="h-full w-full bg-transparent px-2 text-[13px] text-neutral-800 outline-none focus:ring-2 focus:ring-[var(--xl)] focus:ring-inset dark:text-neutral-200"
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2 text-neutral-500">
        <span className="mr-1 text-neutral-300 dark:text-neutral-700">⋮</span>
        <button
          type="button"
          disabled={!dirty && !focused}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft(shown);
            onCancel();
          }}
          className="rounded p-0.5 enabled:text-neutral-700 enabled:hover:bg-black/5 disabled:opacity-40 dark:enabled:text-neutral-200 dark:enabled:hover:bg-white/10"
          aria-label="Cancelar"
          title="Cancelar"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={!dirty}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit(draft)}
          className="rounded p-0.5 enabled:text-neutral-700 enabled:hover:bg-black/5 disabled:opacity-40 dark:enabled:text-neutral-200 dark:enabled:hover:bg-white/10"
          aria-label="Inserir"
          title="Inserir"
        >
          <Check className="h-4 w-4" />
        </button>
        <span className="px-1 font-serif text-[15px] text-neutral-600 italic select-none dark:text-neutral-300" aria-hidden="true">
          fx
        </span>
      </div>
      {textual && !readOnly ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (dirty) onCommit(draft);
              else onCancel();
            } else if (e.key === "Escape") {
              setDraft(shown);
              onCancel();
            }
          }}
          placeholder={isNewCol ? (isHeader ? "Digite o nome para criar uma coluna nova" : "Digite para criar uma coluna nova com este valor") : ""}
          aria-label="Barra de fórmulas"
          className={`min-w-0 flex-1 border-l border-[#e1e1e1] bg-transparent px-2 text-[var(--xl-cell-text)] outline-none placeholder:text-neutral-400 [font-family:var(--xl-font)] dark:border-neutral-800 ${isHeader ? "font-bold" : ""}`}
        />
      ) : (
        <button
          type="button"
          disabled={readOnly || !column}
          onClick={onOpenEditor}
          className="min-w-0 flex-1 truncate border-l border-[#e1e1e1] px-2 text-left text-[var(--xl-cell-text)] [font-family:var(--xl-font)] disabled:cursor-default dark:border-neutral-800"
          title={readOnly ? undefined : "Clique para escolher"}
        >
          {shown || <span className="text-neutral-400">{readOnly || !column ? "" : "Clique para escolher…"}</span>}
        </button>
      )}
      {column && onConfigureColumn && (
        <button
          type="button"
          onClick={onConfigureColumn}
          title={`Tipo da coluna "${column.name}": ${SHEET_COLUMN_TYPE_LABELS[column.type]} — clique para mudar o tipo ou configurar`}
          className="flex shrink-0 items-center gap-1.5 border-l border-[#d6d6d6] px-2.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-[var(--xl-soft)] hover:text-[var(--xl)] dark:border-neutral-800 dark:text-neutral-300"
        >
          <ColumnTypeIcon type={column.type} className="h-3.5 w-3.5 text-[var(--xl)]" />
          <span className="hidden sm:inline">{SHEET_COLUMN_TYPE_LABELS[column.type]}</span>
        </button>
      )}
    </div>
  );
}

// ─── Inserir Função (fx) ─────────────────────────────────────────────

function InsertFunctionDialog({ onClose, onPick }: { onClose: () => void; onPick: (f: FunctionInfo) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const plain = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const list = FUNCTIONS.filter((f) => !query || plain(`${f.name} ${f.en} ${f.description}`).includes(plain(query)));
  const current = list[Math.min(index, list.length - 1)];
  return (
    <Modal onClose={onClose} maxWidth="max-w-lg" mobileSheet>
      <div className="space-y-3 p-5 font-sans">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Inserir Função</h2>
        <label className="block space-y-1 text-[13px]">
          <span className="text-neutral-700 dark:text-neutral-300">Procure por uma função:</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, list.length - 1));
              if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
              if (e.key === "Enter" && current) onPick(current);
            }}
            placeholder="Ex.: soma, procurar, data, texto…"
            className="field-input w-full"
          />
        </label>
        <ul className="h-56 overflow-auto rounded border border-neutral-300 dark:border-neutral-700">
          {list.map((f, i) => (
            <li key={f.name}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                onDoubleClick={() => onPick(f)}
                className={`block w-full px-2 py-1 text-left text-[13px] ${f === current ? "bg-[#107c41] text-white" : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
              >
                {f.name}
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <div className="rounded bg-neutral-50 p-2 text-[13px] dark:bg-neutral-800/60">
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">{current.signature}</p>
            <p className="text-neutral-600 dark:text-neutral-400">{current.description}. Em inglês: {current.en}.</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border border-neutral-300 bg-white px-4 py-1 text-[13px] text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!current}
            className="rounded border border-[var(--xl-btn-hover)] bg-[var(--xl-btn)] px-5 py-1 text-[13px] font-medium text-white hover:bg-[var(--xl-btn-hover)] disabled:opacity-50"
            onClick={() => current && onPick(current)}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Diálogos ────────────────────────────────────────────────────────

function ArchivedColumnsDialog({
  items,
  onClose,
  onRestore,
  onRestoreMany,
}: {
  items: ClientColumn[];
  onClose: () => void;
  onRestore: (col: ClientColumn) => Promise<void> | void;
  onRestoreMany: (cols: ClientColumn[]) => Promise<void> | void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoringBatch, setRestoringBatch] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => {
      const name = (c.name.trim() || "Coluna sem título").toLowerCase();
      const typeLabel = SHEET_COLUMN_TYPE_LABELS[c.type].toLowerCase();
      return name.includes(q) || typeLabel.includes(q);
    });
  }, [items, search]);

  const validSelected = useMemo(() => {
    const itemMap = new Map(items.map((c) => [c.id, c]));
    const cols: ClientColumn[] = [];
    for (const id of selectedIds) {
      const col = itemMap.get(id);
      if (col) cols.push(col);
    }
    return cols;
  }, [items, selectedIds]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const c of filtered) next.delete(c.id);
      } else {
        for (const c of filtered) next.add(c.id);
      }
      return next;
    });
  };

  const handleRestoreOne = async (col: ClientColumn) => {
    setRestoringId(col.id);
    try {
      await onRestore(col);
      setSelectedIds((prev) => {
        if (!prev.has(col.id)) return prev;
        const next = new Set(prev);
        next.delete(col.id);
        return next;
      });
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreBatch = async (cols: ClientColumn[]) => {
    if (cols.length === 0) return;
    setRestoringBatch(true);
    try {
      await onRestoreMany(cols);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const c of cols) next.delete(c.id);
        return next;
      });
    } finally {
      setRestoringBatch(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg" mobileSheet panelClassName="!p-0 !pb-0 overflow-hidden">
      <div className="flex max-h-[82vh] flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4 dark:border-neutral-800/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <ArchiveRestore className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Colunas arquivadas</h2>
                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {items.length}
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Restaure colunas individualmente ou selecione várias de uma vez.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar (Search + Select all) */}
        {items.length > 0 && (
          <div className="space-y-2.5 border-b border-neutral-100 bg-neutral-50/60 px-5 py-3 dark:border-neutral-800/80 dark:bg-neutral-900/40">
            {items.length > 4 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar coluna arquivada…"
                  className="field-input h-8 w-full py-1 pl-8 pr-7 text-xs"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <label className="inline-flex cursor-pointer select-none items-center gap-2 font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                  disabled={filtered.length === 0 || restoringBatch}
                  className="h-3.5 w-3.5 rounded border-neutral-300 accent-[var(--brand)] dark:border-neutral-700"
                />
                <span>
                  {allFilteredSelected ? "Desmarcar todas" : "Selecionar todas"}
                  {search.trim() ? ` (${filtered.length})` : ""}
                </span>
              </label>
              {validSelected.length > 0 && (
                <span className="font-medium text-brand">
                  {validSelected.length} selecionada{validSelected.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* List Body */}
        <div className="scrollbar-thin max-h-[340px] min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
                <ArchiveRestore className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nenhuma coluna arquivada</p>
              <p className="mt-0.5 text-xs text-neutral-500">Todas as colunas desta planilha estão ativas.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-500">
              Nenhuma coluna encontrada para <span className="font-medium text-neutral-700 dark:text-neutral-300">&ldquo;{search}&rdquo;</span>.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((c) => {
                const checked = selectedIds.has(c.id);
                const isRestoring = restoringId === c.id || restoringBatch;
                return (
                  <li
                    key={c.id}
                    onClick={() => !isRestoring && toggleOne(c.id)}
                    className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${checked
                        ? "border-brand/40 bg-brand/5 dark:border-brand/40 dark:bg-brand/10"
                        : "border-neutral-200/80 bg-white hover:border-neutral-300 hover:bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/50"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={isRestoring}
                      className="h-3.5 w-3.5 shrink-0 rounded border-neutral-300 accent-[var(--brand)] dark:border-neutral-700"
                    />
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      <ColumnTypeIcon type={c.type} className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                        {c.name.trim() || "Coluna sem título"}
                      </div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        {SHEET_COLUMN_TYPE_LABELS[c.type]}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isRestoring}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRestoreOne(c);
                      }}
                      className="btn-secondary btn-sm inline-flex shrink-0 items-center gap-1.5 text-xs"
                    >
                      {restoringId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      )}
                      Restaurar
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-5 py-3.5 dark:border-neutral-800/80">
          <div>
            {items.length > 1 && (
              validSelected.length > 0 ? (
                <button
                  type="button"
                  disabled={restoringBatch}
                  onClick={() => void handleRestoreBatch(validSelected)}
                  className="btn-primary btn-sm inline-flex items-center gap-1.5"
                >
                  {restoringBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                  Restaurar {validSelected.length} selecionada{validSelected.length > 1 ? "s" : ""}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={restoringBatch}
                  onClick={() => void handleRestoreBatch(items)}
                  className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                >
                  {restoringBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                  Restaurar todas ({items.length})
                </button>
              )
            )}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "Navegar",
    items: [
      ["Setas", "Mover entre células"],
      ["Enter / Shift+Enter", "Descer / subir"],
      ["Tab / Shift+Tab", "Direita / esquerda"],
      ["Ctrl + setas", "Ir até a borda dos dados"],
      ["Home / End", "Início / fim da linha"],
      ["Ctrl+Home / Ctrl+End", "Primeira / última célula"],
      ["Page Up / Page Down", "Subir / descer uma tela"],
    ],
  },
  {
    group: "Selecionar",
    items: [
      ["Arrastar em células / colunas (A, B…) / linhas (1, 2…)", "Selecionar várias células, colunas ou linhas"],
      ["Shift + setas / Shift + clique", "Estender a seleção (células, linhas ou colunas)"],
      ["Ctrl + clique / Ctrl + arraste", "Adicionar ou remover da seleção (intervalos não adjacentes)"],
      ["Ctrl+A", "Selecionar tudo"],
      ["Shift+Espaço", "Selecionar as linhas do intervalo"],
      ["Ctrl+Espaço", "Selecionar as colunas do intervalo"],
      ["Caixa de Nome (ex.: A2:D10, A:C, 2:5, A2:B5; D2:D5)", "Selecionar pelo endereço"],
    ],
  },
  {
    group: "Editar",
    items: [
      ["Digitar", "Substitui o conteúdo da célula"],
      ["F2 / duplo clique", "Editar a célula"],
      ["Esc", "Cancelar"],
      ["Delete", "Limpar conteúdo"],
      ["Ctrl+C / X / V", "Copiar / recortar / colar (também com o Excel)"],
      ["Ctrl+D", "Preencher para baixo"],
      ["Ctrl+Z / Ctrl+Y", "Desfazer / refazer"],
      ["Alt+Enter", "Quebra de linha (texto longo)"],
    ],
  },
  {
    group: "Formatar",
    items: [
      ["Ctrl+B", "Negrito"],
      ["Ctrl+I", "Itálico"],
      ["Ctrl+U (ou Ctrl+S)", "Sublinhado"],
      ["Ctrl+5", "Tachado"],
      ["Ctrl+L", "Formatar como Tabela"],
      ["Ctrl+Shift+L", "Botões de filtro"],
      ["Ctrl+F", "Localizar"],
    ],
  },
  {
    group: "Fórmulas",
    items: [
      ["=", "Começar uma fórmula"],
      ["Clique numa célula", "Inserir a referência (Shift = intervalo)"],
      ["Tab", "Completar o nome da função"],
      ["Alt+=", "AutoSoma"],
      ["Ctrl+`", "Mostrar Fórmulas"],
    ],
  },
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl" mobileSheet>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-[var(--xl)]" />
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Atalhos de teclado</h2>
          <span className="text-xs text-neutral-400">— os mesmos do Excel</span>
        </div>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">{g.group}</p>
              <dl className="space-y-1">
                {g.items.map(([k, d]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <dt>
                      <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-px font-sans text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">{k}</kbd>
                    </dt>
                    <dd className="text-right text-neutral-600 dark:text-neutral-400">{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-primary btn-sm" onClick={onClose}>Entendi</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Filtro Avançado (várias condições) ──────────────────────────────

const OP_LABELS: Record<FilterOp, string> = {
  eq: "é igual a",
  neq: "é diferente de",
  contains: "contém",
  notContains: "não contém",
  gt: "maior que",
  gte: "maior ou igual a",
  lt: "menor que",
  lte: "menor ou igual a",
  empty: "está vazio",
  notEmpty: "está preenchido",
  in: "é um de",
};

function opsFor(col: ClientColumn): FilterOp[] {
  if (isNumericType(col.type) || col.type === "DATE") return ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"];
  if (col.type === "CHECKBOX") return ["eq"];
  if (col.type === "SELECT" || col.type === "MULTI_SELECT") return ["eq", "neq", "empty", "notEmpty"];
  if (isReferenceType(col.type)) return ["empty", "notEmpty"];
  return ["contains", "notContains", "eq", "neq", "empty", "notEmpty"];
}

function FilterPopover({
  at,
  columns,
  filters: initial,
  match: initialMatch,
  preferColumnId,
  onApply,
  onClose,
}: {
  at: { x: number; y: number };
  columns: ClientColumn[];
  filters: RowFilter[];
  match: "all" | "any";
  preferColumnId?: string;
  onApply: (filters: RowFilter[], match: "all" | "any") => void;
  onClose: () => void;
}) {
  const start = columns.find((c) => c.id === preferColumnId) ?? columns[0];
  const editable = initial.filter((f) => f.op !== "in");
  const keptLists = initial.filter((f) => f.op === "in");
  const [list, setList] = useState<RowFilter[]>(editable.length ? editable : start ? [{ columnId: start.id, op: opsFor(start)[0], value: "" }] : []);
  const [match, setMatch] = useState(initialMatch);
  const colOf = (id: string) => columns.find((c) => c.id === id);
  const update = (i: number, patch: Partial<RowFilter>) => setList((l) => l.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  // Filtros de lista do AutoFiltro (marcar valores) continuam valendo junto.
  const apply = () => onApply([...keptLists, ...list.filter((f) => f.op === "empty" || f.op === "notEmpty" || (f.value !== "" && f.value !== undefined))], match);

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        className="fixed z-50 w-[min(92vw,580px)] space-y-2 rounded-[4px] border border-[#c6c6c6] bg-white p-3 font-sans shadow-[0_6px_18px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900"
        style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 600)), top: at.y }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement)) apply();
          if (e.key === "Escape") onClose();
        }}
      >
        <p className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-200">Filtro Avançado — mostrar linhas em que…</p>
        {list.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            atendem
            <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className="field-input py-0.5 text-xs">
              <option value="all">todas as condições (E)</option>
              <option value="any">qualquer condição (OU)</option>
            </select>
          </div>
        )}
        {list.map((f, i) => {
          const col = colOf(f.columnId);
          if (!col) return null;
          const needsValue = f.op !== "empty" && f.op !== "notEmpty";
          const options = (col.config as { options?: string[] })?.options ?? [];
          return (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <select
                value={f.columnId}
                onChange={(e) => {
                  const next = colOf(e.target.value)!;
                  update(i, { columnId: next.id, op: opsFor(next)[0], value: "" });
                }}
                className="field-input w-40 py-1 text-sm"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>{columnLabel(c, columns.indexOf(c))}</option>
                ))}
              </select>
              <select value={f.op} onChange={(e) => update(i, { op: e.target.value as FilterOp })} className="field-input w-40 py-1 text-sm">
                {opsFor(col).map((op) => (
                  <option key={op} value={op}>{OP_LABELS[op]}</option>
                ))}
              </select>
              {needsValue &&
                (col.type === "CHECKBOX" ? (
                  <select value={String(f.value === "" || f.value === undefined ? true : f.value)} onChange={(e) => update(i, { value: e.target.value === "true" })} className="field-input flex-1 py-1 text-sm">
                    <option value="true">Marcado</option>
                    <option value="false">Desmarcado</option>
                  </select>
                ) : options.length ? (
                  <select value={String(f.value ?? "")} onChange={(e) => update(i, { value: e.target.value })} className="field-input flex-1 py-1 text-sm">
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    autoFocus={i === list.length - 1}
                    value={String(f.value ?? "")}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder={col.type === "DATE" ? "DD/MM/AAAA" : "valor"}
                    className="field-input min-w-24 flex-1 py-1 text-sm"
                  />
                ))}
              <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="p-1 text-neutral-400 hover:text-red-600" aria-label="Remover condição">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="text-sm font-medium text-[var(--xl)] hover:underline"
            onClick={() => start && setList((l) => [...l, { columnId: start.id, op: opsFor(start)[0], value: "" }])}
          >
            + Adicionar condição
          </button>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-neutral-300 bg-white px-3 py-1 text-[13px] text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700" onClick={() => onApply([], "all")}>
              Limpar
            </button>
            <button type="button" className="rounded border border-[var(--xl-btn-hover)] bg-[var(--xl-btn)] px-4 py-1 text-[13px] font-medium text-white hover:bg-[var(--xl-btn-hover)]" onClick={apply}>
              OK
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
