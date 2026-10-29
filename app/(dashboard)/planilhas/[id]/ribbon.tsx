"use client";

import { useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpAZ,
  ArrowUpFromLine,
  Baseline,
  Bold,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  ClipboardList,
  Columns3,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  Filter,
  FilterX,
  FolderOpen,
  History,
  Italic,
  Keyboard,
  ListFilter,
  PaintBucket,
  Paintbrush,
  Pencil,
  Percent,
  Redo2,
  Replace,
  Rows3,
  Ruler,
  Scissors,
  Search,
  Sheet,
  Sigma,
  SquareFunction,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { SHEET_COLUMN_TYPE_LABELS, SHEET_COLUMN_TYPES, type SheetColumnType } from "@/lib/sheets/column-types";
import {
  STANDARD_COLORS,
  STANDARD_COLOR_NAMES,
  TABLE_STYLES,
  themePaletteGrid,
  type CellFormat,
  type TableSettings,
  type TableStyleSpec,
} from "@/lib/sheets/formats";
import type { ClientColumn } from "@/lib/sheets/format";
import { ColumnTypeIcon } from "./column-type-icon";

export type RibbonTab = "home" | "insert" | "formulas" | "data" | "view" | "design";
type AutoSumFn = "SOMA" | "MÉDIA" | "CONT.NÚM" | "MÁXIMO" | "MÍNIMO";
export type BorderCommand =
  | "bottom"
  | "top"
  | "left"
  | "right"
  | "none"
  | "all"
  | "outside"
  | "thickOutside"
  | "thickBottom"
  | "topBottom"
  | "topThickBottom";
export type ViewPrefs = { zoom: number; gridlines: boolean; headings: boolean; formulaBar: boolean; filterButtons: boolean; ribbonCollapsed: boolean };

export type RibbonActions = {
  undo: () => void;
  redo: () => void;
  paste: () => void;
  pasteSpecial: () => void;
  cut: () => void;
  copy: () => void;
  formatPainter: (persistent: boolean) => void;
  toggleFormat: (key: "b" | "i" | "u" | "s") => void;
  setFill: (hex: string | null) => void;
  setColor: (hex: string | null) => void;
  setAlign: (align: "left" | "center" | "right") => void;
  setBorders: (command: BorderCommand) => void;
  setColumnType: (type: SheetColumnType) => void;
  changeDecimals: (delta: 1 | -1) => void;
  formatAsTable: (styleId: string) => void;
  setTable: (patch: Partial<TableSettings>) => void;
  removeTable: () => void;
  insertRow: () => void;
  insertColumn: (where: "left" | "right", type?: SheetColumnType) => void;
  deleteRows: () => void;
  archiveColumn: () => void;
  editColumn: () => void;
  autoFit: () => void;
  sort: (dir: "asc" | "desc") => void;
  toggleFilterButtons: () => void;
  clearFilters: () => void;
  advancedFilter: (at: { x: number; y: number }) => void;
  find: () => void;
  replace: () => void;
  clear: (what: "all" | "formats" | "contents") => void;
  importFile: () => void;
  pullCrm: () => void;
  pushCrm: () => void;
  exportFile: () => void;
  history: () => void;
  toggleTrash: () => void;
  archivedColumns: () => void;
  setView: (patch: Partial<ViewPrefs>) => void;
  newSheet: () => void;
  openSheet: (id: string) => void;
  rename: () => void;
  archiveSheet: () => void;
  back: () => void;
  shortcuts: () => void;
  autoSum: (fn: AutoSumFn) => void;
  insertFunction: () => void;
  toggleShowFormulas: () => void;
  showFormulas: boolean;
};

type Props = {
  tab: RibbonTab;
  onTab: (tab: RibbonTab) => void;
  view: ViewPrefs;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  activeColumn: ClientColumn | null;
  activeFormat: CellFormat | undefined;
  formatPainterActive: boolean;
  hasDataSelection: boolean;
  table: TableSettings | null;
  filtersActive: boolean;
  trash: boolean;
  sheetTabs: { id: string; name: string }[];
  currentSheetId: string;
  actions: RibbonActions;
};

const TAB_LABELS: { id: RibbonTab; label: string }[] = [
  { id: "home", label: "Página Inicial" },
  { id: "insert", label: "Inserir" },
  { id: "formulas", label: "Fórmulas" },
  { id: "data", label: "Dados" },
  { id: "view", label: "Exibir" },
];

/**
 * A Faixa de Opções do Excel: guias (Arquivo, Página Inicial, Inserir,
 * Dados, Exibir e a guia contextual "Design da Tabela"), grupos com o nome
 * embaixo, botões grandes e pequenos, menus suspensos. Só tem o que funciona
 * de verdade — nenhum botão de enfeite.
 */
export function Ribbon(props: Props) {
  const { tab, view, actions: a, readOnly, activeFormat, table } = props;
  const [fileOpen, setFileOpen] = useState(false);
  const [lastFill, setLastFill] = useState("#FFFF00");
  const [lastColor, setLastColor] = useState("#C00000");
  const [lastBorder, setLastBorder] = useState<BorderCommand>("all");
  const ro = readOnly;
  const pickBorder = (cmd: BorderCommand) => {
    setLastBorder(cmd);
    a.setBorders(cmd);
  };

  return (
    <div className="shrink-0 border-b border-[#d6d6d6] bg-[var(--xl-ribbon)] font-sans select-none dark:border-neutral-800">
      {/* ── Guias ── */}
      <div className="flex items-end gap-0.5 overflow-x-auto px-2 pt-1 text-[13px]" role="tablist">
        <button
          type="button"
          onClick={() => setFileOpen(true)}
          className="xl-tab-button rounded-t px-3 py-1.5 font-medium text-[var(--xl)] hover:bg-black/5 dark:hover:bg-white/5"
        >
          Arquivo
        </button>
        {TAB_LABELS.map((t) => (
          <TabButton key={t.id} active={tab === t.id && !view.ribbonCollapsed} onClick={() => {
              props.onTab(t.id);
              if (view.ribbonCollapsed) a.setView({ ribbonCollapsed: false });
            }}>
            {t.label}
          </TabButton>
        ))}
        {table && (
          <TabButton contextual active={tab === "design" && !view.ribbonCollapsed} onClick={() => {
              props.onTab("design");
              if (view.ribbonCollapsed) a.setView({ ribbonCollapsed: false });
            }}>
            Design da Tabela
          </TabButton>
        )}
        <div className="ml-auto flex items-center pb-1">
          <button
            type="button"
            onClick={() => a.setView({ ribbonCollapsed: !view.ribbonCollapsed })}
            className="xl-chrome-button rounded p-1 text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5"
            title={view.ribbonCollapsed ? "Mostrar a Faixa de Opções" : "Recolher a Faixa de Opções"}
            aria-label={view.ribbonCollapsed ? "Mostrar a Faixa de Opções" : "Recolher a Faixa de Opções"}
          >
            {view.ribbonCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Faixa ── */}
      {!view.ribbonCollapsed && (
        <div key={tab} className="xl-ribbon-content flex h-[96px] items-stretch overflow-x-auto border-t border-[#e1e1e1] bg-white px-1 dark:border-neutral-800 dark:bg-neutral-950">
          {tab === "home" && (
            <>
              <Group label="Desfazer">
                <Col>
                  <Small icon={Undo2} label="Desfazer" hint="Ctrl+Z" disabled={!props.canUndo || ro} onClick={a.undo} />
                  <Small icon={Redo2} label="Refazer" hint="Ctrl+Y" disabled={!props.canRedo || ro} onClick={a.redo} />
                </Col>
              </Group>
              <Group label="Área de Transferência">
                <Dropdown
                  trigger={(open) => <Big icon={ClipboardPaste} label="Colar" hint="Ctrl+V" menu disabled={ro} onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={ClipboardPaste} label="Colar" hint="Ctrl+V" onClick={a.paste} />
                      <MenuItem icon={ClipboardList} label="Colar Especial…" hint="Ctrl+Alt+V" onClick={a.pasteSpecial} />
                    </Menu>
                  )}
                />
                <Col>
                  <Small icon={Scissors} label="Recortar" hint="Ctrl+X" disabled={ro} onClick={a.cut} />
                  <Small icon={Copy} label="Copiar" hint="Ctrl+C" onClick={a.copy} />
                  <Small
                    icon={Paintbrush}
                    label="Pincel de Formatação"
                    disabled={ro || !props.hasDataSelection}
                    active={props.formatPainterActive}
                    title="Pincel de Formatação (duplo clique mantém ligado)"
                    onClick={() => a.formatPainter(false)}
                    onDoubleClick={() => a.formatPainter(true)}
                  />
                </Col>
              </Group>
              <Group label="Fonte">
                <div className="flex flex-col justify-center gap-1">
                  <div className="flex gap-0.5">
                    <Toggle icon={Bold} label="Negrito" hint="Ctrl+B" active={!!activeFormat?.b} disabled={ro || !props.hasDataSelection} onClick={() => a.toggleFormat("b")} />
                    <Toggle icon={Italic} label="Itálico" hint="Ctrl+I" active={!!activeFormat?.i} disabled={ro || !props.hasDataSelection} onClick={() => a.toggleFormat("i")} />
                    <Toggle icon={Underline} label="Sublinhado" hint="Ctrl+U" active={!!activeFormat?.u} disabled={ro || !props.hasDataSelection} onClick={() => a.toggleFormat("u")} />
                    <Toggle icon={Strikethrough} label="Tachado" hint="Ctrl+5" active={!!activeFormat?.s} disabled={ro || !props.hasDataSelection} onClick={() => a.toggleFormat("s")} />
                  </div>
                  <div className="flex gap-0.5">
                    <ColorSplit
                      icon={PaintBucket}
                      label="Cor de Preenchimento"
                      color={lastFill}
                      noneLabel="Sem Preenchimento"
                      disabled={ro || !props.hasDataSelection}
                      onPick={(hex) => {
                        if (hex) setLastFill(hex);
                        a.setFill(hex);
                      }}
                    />
                    <ColorSplit
                      icon={Baseline}
                      label="Cor da Fonte"
                      color={lastColor}
                      noneLabel="Automático"
                      disabled={ro || !props.hasDataSelection}
                      onPick={(hex) => {
                        if (hex) setLastColor(hex);
                        a.setColor(hex);
                      }}
                    />
                    <Dropdown
                      trigger={(open) => (
                        <Small
                          icon={BORDER_ICONS[lastBorder]}
                          label="Bordas"
                          menu
                          disabled={ro || !props.hasDataSelection}
                          onClick={open}
                        />
                      )}
                      render={(close) => (
                        <Menu close={close}>
                          <MenuItem icon={BORDER_ICONS.bottom} label="Borda Inferior" onClick={() => pickBorder("bottom")} />
                          <MenuItem icon={BORDER_ICONS.top} label="Borda Superior" onClick={() => pickBorder("top")} />
                          <MenuItem icon={BORDER_ICONS.left} label="Borda Esquerda" onClick={() => pickBorder("left")} />
                          <MenuItem icon={BORDER_ICONS.right} label="Borda Direita" onClick={() => pickBorder("right")} />
                          <MenuSep />
                          <MenuItem icon={BORDER_ICONS.none} label="Sem Borda" onClick={() => pickBorder("none")} />
                          <MenuItem icon={BORDER_ICONS.all} label="Todas as Bordas" onClick={() => pickBorder("all")} />
                          <MenuItem icon={BORDER_ICONS.outside} label="Bordas Externas" onClick={() => pickBorder("outside")} />
                          <MenuItem icon={BORDER_ICONS.thickOutside} label="Bordas Externas Espessas" onClick={() => pickBorder("thickOutside")} />
                          <MenuSep />
                          <MenuItem icon={BORDER_ICONS.thickBottom} label="Borda Inferior Espessa" onClick={() => pickBorder("thickBottom")} />
                          <MenuItem icon={BORDER_ICONS.topBottom} label="Borda Superior e Inferior" onClick={() => pickBorder("topBottom")} />
                          <MenuItem icon={BORDER_ICONS.topThickBottom} label="Borda Superior e Inferior Espessa" onClick={() => pickBorder("topThickBottom")} />
                        </Menu>
                      )}
                    />
                  </div>
                </div>
              </Group>
              <Group label="Alinhamento">
                <div className="flex items-center gap-0.5">
                  <Toggle icon={AlignLeft} label="Alinhar à Esquerda" active={activeFormat?.align === "left"} disabled={ro || !props.hasDataSelection} onClick={() => a.setAlign("left")} />
                  <Toggle icon={AlignCenter} label="Centralizar" active={activeFormat?.align === "center"} disabled={ro || !props.hasDataSelection} onClick={() => a.setAlign("center")} />
                  <Toggle icon={AlignRight} label="Alinhar à Direita" active={activeFormat?.align === "right"} disabled={ro || !props.hasDataSelection} onClick={() => a.setAlign("right")} />
                </div>
              </Group>
              <Group label="Número">
                <div className="flex flex-col justify-center gap-1">
                  <select
                    value={props.activeColumn?.type ?? ""}
                    disabled={ro || !props.activeColumn}
                    onChange={(e) => a.setColumnType(e.target.value as SheetColumnType)}
                    title="Formato de Número (tipo da coluna)"
                    className="h-[22px] w-40 rounded-[2px] border border-[#c6c6c6] bg-white px-1 text-[12px] text-neutral-800 outline-none focus:border-[var(--xl)] disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                  >
                    {!props.activeColumn && <option value="">Geral</option>}
                    {SHEET_COLUMN_TYPES.map((t) => (
                      <option key={t} value={t}>{SHEET_COLUMN_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <div className="flex gap-0.5">
                    <TextTool label="R$" title="Formato de Moeda" disabled={ro || !props.activeColumn} onClick={() => a.setColumnType("CURRENCY")} />
                    <TextTool icon={Percent} title="Estilo de Porcentagem" disabled={ro || !props.activeColumn} onClick={() => a.setColumnType("PERCENT")} />
                    <TextTool label="000" title="Número" disabled={ro || !props.activeColumn} onClick={() => a.setColumnType("NUMBER")} />
                    <TextTool label="←,0" title="Aumentar Casas Decimais" disabled={ro || !props.activeColumn} onClick={() => a.changeDecimals(1)} />
                    <TextTool label=",00→" title="Diminuir Casas Decimais" disabled={ro || !props.activeColumn} onClick={() => a.changeDecimals(-1)} />
                  </div>
                </div>
              </Group>
              <Group label="Estilos">
                <Dropdown
                  trigger={(open) => <Big icon={Table2} label="Formatar como Tabela" menu disabled={ro} onClick={open} />}
                  render={(close) => (
                    <TableGallery
                      current={table?.style}
                      onPick={(id) => {
                        close();
                        a.formatAsTable(id);
                      }}
                      onClear={table ? () => (close(), a.removeTable()) : undefined}
                    />
                  )}
                />
              </Group>
              <Group label="Células">
                <Dropdown
                  trigger={(open) => <Big icon={Rows3} label="Inserir" menu disabled={ro} onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={Rows3} label="Inserir Linha (no fim)" onClick={a.insertRow} />
                      <MenuItem icon={Columns3} label="Inserir Coluna à Esquerda" onClick={() => a.insertColumn("left")} disabled={!props.activeColumn} />
                      <MenuItem icon={Columns3} label="Inserir Coluna à Direita" onClick={() => a.insertColumn("right")} />
                    </Menu>
                  )}
                />
                <Dropdown
                  trigger={(open) => <Big icon={Trash2} label="Excluir" menu disabled={ro} onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={Rows3} label="Excluir Linhas Selecionadas" onClick={a.deleteRows} disabled={!props.hasDataSelection} />
                      <MenuItem icon={Columns3} label="Excluir Coluna (arquivar)" onClick={a.archiveColumn} disabled={!props.activeColumn} />
                    </Menu>
                  )}
                />
                <Dropdown
                  trigger={(open) => <Big icon={Ruler} label="Formatar" menu disabled={ro || !props.activeColumn} onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={Ruler} label="AutoAjuste da Largura da Coluna" onClick={a.autoFit} />
                      <MenuItem icon={Pencil} label="Formatar Coluna… (nome, tipo, opções)" onClick={a.editColumn} />
                    </Menu>
                  )}
                />
              </Group>
              <Group label="Edição">
                <AutoSumButton disabled={ro} onPick={a.autoSum} />
                <Dropdown
                  trigger={(open) => <Big icon={ListFilter} label="Classificar e Filtrar" menu onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={ArrowDownAZ} label="Classificar de A a Z" onClick={() => a.sort("asc")} disabled={!props.activeColumn} />
                      <MenuItem icon={ArrowUpAZ} label="Classificar de Z a A" onClick={() => a.sort("desc")} disabled={!props.activeColumn} />
                      <MenuSep />
                      <MenuItem icon={Filter} label={view.filterButtons ? "Ocultar Botões de Filtro" : "Filtro"} hint="Ctrl+Shift+L" onClick={a.toggleFilterButtons} />
                      <MenuItem icon={FilterX} label="Limpar" onClick={a.clearFilters} disabled={!props.filtersActive} />
                    </Menu>
                  )}
                />
                <Dropdown
                  trigger={(open) => <Big icon={Search} label="Localizar e Selecionar" menu onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={Search} label="Localizar…" hint="Ctrl+F" onClick={a.find} />
                      <MenuItem icon={Replace} label="Substituir…" hint="Ctrl+H" onClick={a.replace} disabled={ro} />
                    </Menu>
                  )}
                />
                <Dropdown
                  trigger={(open) => <Big icon={Eraser} label="Limpar" menu disabled={ro} onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      <MenuItem icon={Eraser} label="Limpar Tudo" onClick={() => a.clear("all")} />
                      <MenuItem icon={PaintBucket} label="Limpar Formatos" onClick={() => a.clear("formats")} />
                      <MenuItem icon={Eraser} label="Limpar Conteúdo" hint="Delete" onClick={() => a.clear("contents")} />
                    </Menu>
                  )}
                />
              </Group>
            </>
          )}

          {tab === "insert" && (
            <>
              <Group label="Tabelas">
                <Big icon={Table2} label={table ? "Tabela (ativa)" : "Tabela"} hint="Ctrl+L" disabled={ro || !!table} onClick={() => a.formatAsTable("medium-2")} />
              </Group>
              <Group label="Linhas">
                <Big icon={Rows3} label="Nova Linha" disabled={ro} onClick={a.insertRow} />
              </Group>
              <Group label="Colunas (inseridas à direita da célula ativa)">
                <div className="grid grid-flow-col grid-rows-3 gap-x-1 gap-y-0.5">
                  {(["TEXT", "NUMBER", "CURRENCY", "PERCENT", "DATE", "CHECKBOX", "SELECT", "MULTI_SELECT", "LONG_TEXT", "EMAIL", "PHONE", "CPF", "CNPJ", "URL", "CONTACT", "DEAL", "USER"] as SheetColumnType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={ro}
                      onClick={() => a.insertColumn("right", t)}
                      className="xl-tool-button flex h-[22px] items-center gap-1.5 rounded-[2px] px-1.5 text-[12px] whitespace-nowrap text-neutral-800 hover:bg-[var(--xl-soft)] disabled:opacity-40 dark:text-neutral-200"
                    >
                      <ColumnTypeIcon type={t} className="h-3.5 w-3.5 text-[var(--xl)]" />
                      {SHEET_COLUMN_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </Group>
            </>
          )}

          {tab === "formulas" && (
            <>
              <Group label="Biblioteca de Funções">
                <Big icon={SquareFunction} label="Inserir Função" hint="Shift+F3" disabled={ro} onClick={a.insertFunction} />
                <AutoSumButton disabled={ro} onPick={a.autoSum} />
              </Group>
              <Group label="Auditoria de Fórmulas">
                <Big icon={SquareFunction} label="Mostrar Fórmulas" hint="Ctrl+`" active={a.showFormulas} onClick={a.toggleShowFormulas} />
              </Group>
              <Group label="Como funciona">
                <div className="max-w-[340px] px-1 py-1 text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                  Digite <b>=</b> numa célula e escreva como no Excel: <b>=SOMA(B2:B10)</b>, <b>=SE(C2&gt;100;&quot;Alto&quot;;&quot;Baixo&quot;)</b>, <b>=PROCV(A2;A:C;3;FALSO)</b>. Clique nas células para
                  inserir a referência; arraste a alça para copiar a fórmula para baixo.
                </div>
              </Group>
            </>
          )}

          {tab === "data" && (
            <>
              <Group label="Obter e Transformar Dados">
                <Big icon={ArrowDownToLine} label="Obter Dados do CRM" disabled={ro} onClick={a.pullCrm} />
                <Big icon={Upload} label="Do Arquivo (Excel/CSV)" disabled={ro} onClick={a.importFile} />
                <Big icon={Download} label="Baixar Cópia (.xlsx)" onClick={a.exportFile} />
              </Group>
              <Group label="Conexões do CRM">
                <Big icon={ArrowUpFromLine} label="Enviar ao CRM" disabled={ro} onClick={a.pushCrm} />
              </Group>
              <Group label="Classificar e Filtrar">
                <Col>
                  <Small icon={ArrowDownAZ} label="A→Z" title="Classificar de A a Z" disabled={!props.activeColumn} onClick={() => a.sort("asc")} />
                  <Small icon={ArrowUpAZ} label="Z→A" title="Classificar de Z a A" disabled={!props.activeColumn} onClick={() => a.sort("desc")} />
                </Col>
                <Big icon={Filter} label="Filtro" hint="Ctrl+Shift+L" active={view.filterButtons} onClick={a.toggleFilterButtons} />
                <Col>
                  <Small icon={FilterX} label="Limpar" disabled={!props.filtersActive} onClick={a.clearFilters} />
                  <Small
                    icon={ListFilter}
                    label="Avançado"
                    title="Filtro Avançado (várias condições)"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      a.advancedFilter({ x: r.left, y: r.bottom + 4 });
                    }}
                  />
                </Col>
              </Group>
              <Group label="Ferramentas de Dados">
                <Big icon={History} label="Histórico" onClick={a.history} />
                <Big icon={Trash2} label="Lixeira" active={props.trash} onClick={a.toggleTrash} />
                <Big icon={Columns3} label="Colunas Arquivadas" onClick={a.archivedColumns} />
              </Group>
            </>
          )}

          {tab === "view" && (
            <>
              <Group label="Mostrar">
                <div className="flex flex-col justify-center gap-1 px-1 text-[12px] text-neutral-800 dark:text-neutral-200">
                  <Check label="Barra de Fórmulas" checked={view.formulaBar} onChange={(v) => a.setView({ formulaBar: v })} />
                  <Check label="Linhas de Grade" checked={view.gridlines} onChange={(v) => a.setView({ gridlines: v })} />
                  <Check label="Títulos" checked={view.headings} onChange={(v) => a.setView({ headings: v })} />
                </div>
              </Group>
              <Group label="Zoom">
                <Dropdown
                  trigger={(open) => <Big icon={Search} label="Zoom" menu onClick={open} />}
                  render={(close) => (
                    <Menu close={close}>
                      {[200, 150, 125, 110, 100, 90, 75, 50].map((p) => (
                        <MenuItem key={p} label={`${p}%`} active={Math.round(view.zoom * 100) === p} onClick={() => a.setView({ zoom: p / 100 })} />
                      ))}
                    </Menu>
                  )}
                />
                <Big icon={Sheet} label="100%" onClick={() => a.setView({ zoom: 1 })} />
                <Col>
                  <Small icon={ZoomIn} label="Ampliar" onClick={() => a.setView({ zoom: Math.min(2, Math.round((view.zoom + 0.1) * 10) / 10) })} />
                  <Small icon={ZoomOut} label="Reduzir" onClick={() => a.setView({ zoom: Math.max(0.5, Math.round((view.zoom - 0.1) * 10) / 10) })} />
                </Col>
              </Group>
              <Group label="Ajuda">
                <Big icon={Keyboard} label="Atalhos de Teclado" onClick={a.shortcuts} />
              </Group>
            </>
          )}

          {tab === "design" && table && (
            <>
              <Group label="Ferramentas">
                <Big icon={Table2} label="Converter em Intervalo" disabled={ro} onClick={a.removeTable} />
              </Group>
              <Group label="Opções de Estilo de Tabela">
                <div className="grid grid-flow-col grid-rows-3 gap-x-4 gap-y-0.5 px-1 py-1 text-[12px] text-neutral-800 dark:text-neutral-200">
                  <Check label="Linha de Cabeçalho" checked={table.header} disabled={ro} onChange={(v) => a.setTable({ header: v })} />
                  <Check label="Linha de Totais" checked={table.totals} disabled={ro} onChange={(v) => a.setTable({ totals: v })} />
                  <Check label="Linhas em Tiras" checked={table.banded} disabled={ro} onChange={(v) => a.setTable({ banded: v })} />
                  <Check label="Primeira Coluna" checked={table.firstColumn} disabled={ro} onChange={(v) => a.setTable({ firstColumn: v })} />
                  <Check label="Botão de Filtro" checked={view.filterButtons} onChange={() => a.toggleFilterButtons()} />
                </div>
              </Group>
              <Group label="Estilos de Tabela">
                <div className="flex items-center gap-1 overflow-x-auto py-1">
                  {TABLE_STYLES.filter((s) => s.family === "medium").map((s) => (
                    <Swatch key={s.id} spec={s} active={table.style === s.id} onClick={() => !ro && a.setTable({ style: s.id })} />
                  ))}
                  <Dropdown
                    trigger={(open) => (
                      <button type="button" onClick={open} title="Mais estilos" className="flex h-[52px] w-5 items-center justify-center rounded-[2px] border border-[#c6c6c6] text-neutral-600 hover:bg-[var(--xl-soft)] dark:border-neutral-700 dark:text-neutral-300">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    )}
                    render={(close) => <TableGallery current={table.style} onPick={(id) => (close(), a.setTable({ style: id }))} onClear={() => (close(), a.removeTable())} />}
                  />
                </div>
              </Group>
            </>
          )}
        </div>
      )}

      {/* ── Arquivo (Backstage) ── */}
      {fileOpen && (
        <div className="fixed inset-0 z-50 flex bg-black/30" onMouseDown={() => setFileOpen(false)}>
          <div className="flex h-full w-[min(560px,100vw)] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <nav className="flex w-52 shrink-0 flex-col gap-0.5 bg-[#107c41] py-3 text-[14px] text-white dark:bg-[#185c37]">
              <button type="button" onClick={() => setFileOpen(false)} className="mb-2 flex items-center gap-2 px-4 py-2 hover:bg-white/15" aria-label="Fechar">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <BackItem icon={ArrowLeft} label="Todas as Planilhas" onClick={a.back} />
              <BackItem icon={FilePlus2} label="Novo" onClick={() => (setFileOpen(false), a.newSheet())} />
              <BackItem icon={Pencil} label="Renomear" onClick={() => (setFileOpen(false), a.rename())} />
              <BackItem icon={Upload} label="Importar" onClick={() => (setFileOpen(false), a.importFile())} />
              <BackItem icon={Download} label="Baixar uma Cópia" onClick={() => (setFileOpen(false), a.exportFile())} />
              <BackItem icon={History} label="Histórico de Versões" onClick={() => (setFileOpen(false), a.history())} />
              <div className="mt-auto" />
              <BackItem icon={Archive} label="Arquivar Planilha" onClick={() => (setFileOpen(false), a.archiveSheet())} />
            </nav>
            <div className="flex-1 overflow-auto bg-white p-6 dark:bg-neutral-900">
              <h2 className="mb-3 flex items-center gap-2 text-xl font-light text-neutral-800 dark:text-neutral-100">
                <FolderOpen className="h-5 w-5 text-[var(--xl)]" /> Abrir
              </h2>
              <ul className="space-y-0.5">
                {props.sheetTabs.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => (setFileOpen(false), a.openSheet(t.id))}
                      className={`flex w-full items-center gap-2.5 rounded px-2 py-2 text-left text-[14px] hover:bg-[var(--xl-soft)] ${
                        t.id === props.currentSheetId ? "font-semibold text-[var(--xl)]" : "text-neutral-800 dark:text-neutral-200"
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--xl-btn)] text-white">
                        <Sheet className="h-4 w-4" />
                      </span>
                      <span className="truncate">{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Peças da faixa ──────────────────────────────────────────────────

function TabButton({ active, contextual, onClick, children }: { active: boolean; contextual?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`xl-tab-button relative px-3 py-1.5 whitespace-nowrap ${
        active ? "font-semibold text-[var(--xl)]" : contextual ? "font-medium text-[var(--xl)] hover:bg-black/5 dark:hover:bg-white/5" : "text-neutral-700 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5"
      }`}
    >
      {children}
      {active && <span className="xl-tab-indicator absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[var(--xl)]" />}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r border-[#e1e1e1] px-1.5 pt-1 dark:border-neutral-800">
      <div className="flex flex-1 items-start gap-0.5">{children}</div>
      <p className="truncate pb-0.5 text-center text-[11px] text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}

function Col({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col justify-center gap-0.5 self-stretch">{children}</div>;
}

function Big({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  menu,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  menu?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      aria-pressed={active || undefined}
      className={`xl-tool-button flex h-[70px] w-[64px] shrink-0 flex-col items-center justify-start gap-1 rounded-[3px] px-1 pt-1.5 text-[12px] leading-tight disabled:pointer-events-none disabled:opacity-35 ${
        active ? "bg-[var(--xl-soft)] text-[var(--xl)] ring-1 ring-[var(--xl)]/40" : "text-neutral-800 hover:bg-[var(--xl-soft)] dark:text-neutral-200"
      }`}
    >
      <Icon className="h-6 w-6 shrink-0 text-[var(--xl)]" strokeWidth={1.6} />
      <span className="line-clamp-2 text-center">
        {label}
        {menu && <ChevronDown className="ml-0.5 inline h-3 w-3 align-[-1px]" />}
      </span>
    </button>
  );
}

type IconLike = React.ComponentType<{ className?: string; strokeWidth?: number | string }>;

/**
 * Desenho 2×2 de bordas no estilo do Excel: as divisórias sem borda aparecem
 * pontilhadas em cinza-claro e os lados com borda aparecem em traço sólido
 * (ou espesso), exatamente como na galeria de Bordas do Excel.
 */
function BorderGlyph({ command, className }: { command: BorderCommand; className?: string }) {
  const dotted = "#9ca3af";
  const solid = "currentColor";
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className ?? "h-4 w-4 shrink-0"} aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" stroke={dotted} strokeWidth="1" strokeDasharray="1.5 1.5" />
      <line x1="8" y1="2" x2="8" y2="14" stroke={dotted} strokeWidth="1" strokeDasharray="1.5 1.5" />
      <line x1="2" y1="8" x2="14" y2="8" stroke={dotted} strokeWidth="1" strokeDasharray="1.5 1.5" />

      {command === "bottom" && <line x1="1.5" y1="14" x2="14.5" y2="14" stroke={solid} strokeWidth="1.9" />}
      {command === "top" && <line x1="1.5" y1="2" x2="14.5" y2="2" stroke={solid} strokeWidth="1.9" />}
      {command === "left" && <line x1="2" y1="1.5" x2="2" y2="14.5" stroke={solid} strokeWidth="1.9" />}
      {command === "right" && <line x1="14" y1="1.5" x2="14" y2="14.5" stroke={solid} strokeWidth="1.9" />}
      {command === "all" && (
        <>
          <rect x="2" y="2" width="12" height="12" stroke={solid} strokeWidth="1.5" />
          <line x1="8" y1="2" x2="8" y2="14" stroke={solid} strokeWidth="1.4" />
          <line x1="2" y1="8" x2="14" y2="8" stroke={solid} strokeWidth="1.4" />
        </>
      )}
      {command === "outside" && <rect x="2" y="2" width="12" height="12" stroke={solid} strokeWidth="1.7" />}
      {command === "thickOutside" && <rect x="2" y="2" width="12" height="12" stroke={solid} strokeWidth="2.5" />}
      {command === "thickBottom" && <line x1="1.5" y1="13.7" x2="14.5" y2="13.7" stroke={solid} strokeWidth="2.8" />}
      {command === "topBottom" && (
        <>
          <line x1="1.5" y1="2" x2="14.5" y2="2" stroke={solid} strokeWidth="1.6" />
          <line x1="1.5" y1="14" x2="14.5" y2="14" stroke={solid} strokeWidth="1.6" />
        </>
      )}
      {command === "topThickBottom" && (
        <>
          <line x1="1.5" y1="2" x2="14.5" y2="2" stroke={solid} strokeWidth="1.5" />
          <line x1="1.5" y1="13.7" x2="14.5" y2="13.7" stroke={solid} strokeWidth="2.8" />
        </>
      )}
    </svg>
  );
}

const BORDER_ICONS: Record<BorderCommand, IconLike> = {
  bottom: ({ className }) => <BorderGlyph command="bottom" className={className} />,
  top: ({ className }) => <BorderGlyph command="top" className={className} />,
  left: ({ className }) => <BorderGlyph command="left" className={className} />,
  right: ({ className }) => <BorderGlyph command="right" className={className} />,
  none: ({ className }) => <BorderGlyph command="none" className={className} />,
  all: ({ className }) => <BorderGlyph command="all" className={className} />,
  outside: ({ className }) => <BorderGlyph command="outside" className={className} />,
  thickOutside: ({ className }) => <BorderGlyph command="thickOutside" className={className} />,
  thickBottom: ({ className }) => <BorderGlyph command="thickBottom" className={className} />,
  topBottom: ({ className }) => <BorderGlyph command="topBottom" className={className} />,
  topThickBottom: ({ className }) => <BorderGlyph command="topThickBottom" className={className} />,
};

function Small({
  icon: Icon,
  label,
  onClick,
  disabled,
  hint,
  title,
  active,
  menu,
  onDoubleClick,
}: {
  icon: IconLike;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  hint?: string;
  title?: string;
  active?: boolean;
  menu?: boolean;
  onDoubleClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-pressed={active || undefined}
      title={[title ?? label, hint && `(${hint})`].filter(Boolean).join(" ")}
      className={`xl-tool-button flex h-[22px] items-center gap-1.5 rounded-[2px] px-1.5 text-[12px] whitespace-nowrap hover:bg-[var(--xl-soft)] disabled:pointer-events-none disabled:opacity-35 ${active ? "bg-[var(--xl-soft)] font-medium text-[var(--xl)] ring-1 ring-inset ring-[var(--xl)]/40" : "text-neutral-800 dark:text-neutral-200"}`}
    >
      <Icon className="h-4 w-4 shrink-0 text-[var(--xl)]" strokeWidth={1.8} />
      {label}
      {menu && <ChevronDown className="-ml-0.5 h-3 w-3 opacity-70" />}
    </button>
  );
}

function Toggle({ icon: Icon, label, onClick, active, disabled, hint }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={!!active}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className={`xl-tool-button flex h-[24px] w-[26px] items-center justify-center rounded-[2px] disabled:pointer-events-none disabled:opacity-35 ${
        active ? "bg-[#cde6d7] text-[var(--xl-dark)] ring-1 ring-[var(--xl)]/50 dark:bg-[var(--xl-soft)] dark:text-[var(--xl)]" : "text-neutral-800 hover:bg-[var(--xl-soft)] dark:text-neutral-200"
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={2.2} />
    </button>
  );
}

function TextTool({ label, icon: Icon, title, onClick, disabled }: { label?: string; icon?: LucideIcon; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className="xl-tool-button flex h-[24px] min-w-[26px] items-center justify-center rounded-[2px] px-1 text-[12px] font-semibold text-neutral-800 hover:bg-[var(--xl-soft)] disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-200"
    >
      {Icon ? <Icon className="h-4 w-4" /> : label}
    </button>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap ${disabled ? "opacity-40" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--xl)]" />
      {label}
    </label>
  );
}

/** Menu suspenso em posição FIXA (a faixa rola na horizontal e cortaria um menu preso a ela). */
function Dropdown({ trigger, render }: { trigger: (open: (e: React.MouseEvent<HTMLButtonElement>) => void) => React.ReactNode; render: (close: () => void) => React.ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAt(null);
  return (
    <>
      {trigger((e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt((cur) => (cur ? null : { x: r.left, y: r.bottom + 2 }));
      })}
      {at && (
        <div className="fixed inset-0 z-50" onMouseDown={close}>
          <div className="xl-menu-pop absolute" style={{ left: Math.max(4, Math.min(at.x, window.innerWidth - 420)), top: at.y }} onMouseDown={(e) => e.stopPropagation()}>
            {render(close)}
          </div>
        </div>
      )}
    </>
  );
}

function Menu({ children, close }: { children: React.ReactNode; close: () => void }) {
  return (
    <div className="min-w-60 rounded-[4px] border border-[#c6c6c6] bg-white py-1 shadow-[0_6px_18px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900" onClick={close}>
      {children}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, disabled, hint, active }: { icon?: IconLike; label: string; onClick: () => void; disabled?: boolean; hint?: string; active?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`xl-menu-item flex w-full items-center gap-2.5 px-3 py-[5px] text-left text-[13px] hover:bg-[var(--xl-soft)] disabled:pointer-events-none disabled:opacity-40 ${
        active ? "font-semibold text-[var(--xl)]" : "text-neutral-800 dark:text-neutral-200"
      }`}
    >
      <span className="flex w-4 shrink-0 justify-center">{Icon && <Icon className="h-4 w-4 text-[var(--xl)]" />}</span>
      <span className="flex-1">{label}</span>
      {hint && <kbd className="font-sans text-[11px] text-neutral-400">{hint}</kbd>}
    </button>
  );
}

function MenuSep() {
  return <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />;
}

function BackItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="xl-menu-item flex items-center gap-3 px-4 py-2 text-left hover:bg-white/15">
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}

/** Botão dividido de cor (balde / "A"): a parte principal aplica a última cor; a seta abre a paleta. */
function ColorSplit({
  icon: Icon,
  label,
  color,
  noneLabel,
  disabled,
  onPick,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  noneLabel: string;
  disabled?: boolean;
  onPick: (hex: string | null) => void;
}) {
  return (
    <div className={`flex items-stretch rounded-[2px] hover:ring-1 hover:ring-[#c6c6c6] dark:hover:ring-neutral-700 ${disabled ? "pointer-events-none opacity-35" : ""}`}>
      <button type="button" onClick={() => onPick(color)} title={label} aria-label={label} className="flex h-[24px] w-[26px] flex-col items-center justify-center hover:bg-[var(--xl-soft)]">
        <Icon className="h-3.5 w-3.5 text-neutral-800 dark:text-neutral-200" strokeWidth={2} />
        <span className="mt-[1px] h-[3px] w-4" style={{ backgroundColor: color }} />
      </button>
      <Dropdown
        trigger={(open) => (
          <button type="button" onClick={open} aria-label={`${label}: escolher cor`} className="flex w-3.5 items-center justify-center hover:bg-[var(--xl-soft)]">
            <ChevronDown className="h-3 w-3 text-neutral-600 dark:text-neutral-400" />
          </button>
        )}
        render={(close) => <Palette noneLabel={noneLabel} onPick={(hex) => (close(), onPick(hex))} />}
      />
    </div>
  );
}

/** Botão AutoSoma (Σ) com o menu de funções, igual ao do Excel. */
function AutoSumButton({ onPick, disabled }: { onPick: (fn: AutoSumFn) => void; disabled?: boolean }) {
  return (
    <Dropdown
      trigger={(open) => <Big icon={Sigma} label="AutoSoma" hint="Alt+=" menu disabled={disabled} onClick={open} />}
      render={(close) => (
        <Menu close={close}>
          <MenuItem icon={Sigma} label="Soma" onClick={() => onPick("SOMA")} />
          <MenuItem label="Média" onClick={() => onPick("MÉDIA")} />
          <MenuItem label="Contar Números" onClick={() => onPick("CONT.NÚM")} />
          <MenuItem label="Máx" onClick={() => onPick("MÁXIMO")} />
          <MenuItem label="Mín" onClick={() => onPick("MÍNIMO")} />
        </Menu>
      )}
    />
  );
}

/** Paleta igual à do Excel: "Cores do Tema" (10 × 6 tons) + "Cores Padrão". */
function Palette({ noneLabel, onPick }: { noneLabel: string; onPick: (hex: string | null) => void }) {
  const grid = themePaletteGrid();
  return (
    <div className="w-[236px] rounded-[4px] border border-[#c6c6c6] bg-white p-2 text-[12px] shadow-[0_6px_18px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900">
      <button type="button" onClick={() => onPick(null)} className="mb-2 flex w-full items-center gap-2 rounded px-1 py-1 text-left text-neutral-800 hover:bg-[var(--xl-soft)] dark:text-neutral-200">
        <span className="h-4 w-4 border border-neutral-400 bg-[linear-gradient(135deg,transparent_45%,#e00_45%,#e00_55%,transparent_55%)]" />
        {noneLabel}
      </button>
      <p className="mb-1 font-semibold text-neutral-600 dark:text-neutral-300">Cores do Tema</p>
      <div className="flex gap-[3px]">
        {grid.map((column, ci) => (
          <div key={ci} className="flex flex-col gap-[1px]">
            {column.map((c, ri) => (
              <button
                key={c.hex + ri}
                type="button"
                title={c.label}
                aria-label={c.label}
                onClick={() => onPick(c.hex)}
                className={`h-[17px] w-[19px] border border-black/10 hover:outline-2 hover:outline-[#e4a03c] ${ri === 0 ? "mb-[3px]" : ""}`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 mb-1 font-semibold text-neutral-600 dark:text-neutral-300">Cores Padrão</p>
      <div className="flex gap-[3px]">
        {STANDARD_COLORS.map((hex, i) => (
          <button
            key={hex}
            type="button"
            title={STANDARD_COLOR_NAMES[i]}
            aria-label={STANDARD_COLOR_NAMES[i]}
            onClick={() => onPick(hex)}
            className="h-[17px] w-[19px] border border-black/10 hover:outline-2 hover:outline-[#e4a03c]"
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  );
}

/** Miniatura de um estilo de tabela (como na galeria do Excel). */
function Swatch({ spec, active, onClick }: { spec: TableStyleSpec; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${spec.label} (${spec.excelName})`}
      aria-label={spec.label}
      className={`shrink-0 rounded-[2px] p-[3px] ${active ? "ring-2 ring-[#e4a03c]" : "hover:ring-2 hover:ring-[#f3c27a]"}`}
    >
      <div className="grid h-[44px] w-[58px] grid-rows-5 overflow-hidden border border-black/10 bg-white">
        <div style={{ backgroundColor: spec.header.fill ?? "#fff", borderBottom: spec.header.borderBottom ? `2px solid ${spec.header.borderBottom}` : undefined }} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ backgroundColor: spec.band[i % 2] ?? "#fff", borderBottom: spec.line ? `1px solid ${spec.line}` : undefined }} />
        ))}
      </div>
    </button>
  );
}

function TableGallery({ current, onPick, onClear }: { current?: string; onPick: (id: string) => void; onClear?: () => void }) {
  return (
    <div className="max-h-[70vh] w-[min(470px,92vw)] overflow-auto rounded-[4px] border border-[#c6c6c6] bg-white p-2 shadow-[0_6px_18px_rgba(0,0,0,0.16)] dark:border-neutral-700 dark:bg-neutral-900">
      {(["light", "medium", "dark"] as const).map((family) => (
        <div key={family} className="mb-2">
          <p className="mb-1 bg-neutral-100 px-1.5 py-0.5 text-[12px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {family === "light" ? "Claro" : family === "medium" ? "Médio" : "Escuro"}
          </p>
          <div className="flex flex-wrap gap-0.5">
            {TABLE_STYLES.filter((s) => s.family === family).map((s) => (
              <Swatch key={s.id} spec={s} active={current === s.id} onClick={() => onPick(s.id)} />
            ))}
          </div>
        </div>
      ))}
      {onClear && (
        <button type="button" onClick={onClear} className="mt-1 flex w-full items-center gap-2 border-t border-neutral-200 px-1.5 pt-2 text-[13px] text-neutral-700 hover:text-red-600 dark:border-neutral-700 dark:text-neutral-300">
          <Eraser className="h-4 w-4" /> Limpar (Converter em Intervalo)
        </button>
      )}
    </div>
  );
}
