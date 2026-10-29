"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Plus, Search, X } from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { columnOptions, editText, type ClientColumn } from "@/lib/sheets/format";
import { FUNCTIONS, lookupFunction } from "@/lib/sheets/formula";
import { isMultiUserColumn, refIds, type CellValue } from "@/lib/sheets/column-types";

/** Como a edição terminou — decide para onde o cursor vai (igual ao Excel). */
export type CommitMove = "down" | "up" | "right" | "left" | "none" | "selection";

type EditorProps = {
  column: ClientColumn;
  value: CellValue | undefined;
  /** Texto digitado que abriu a edição (substitui o valor, como no Excel). */
  initialText: string | null;
  /** Fórmula atual da célula (já em A1) — abre a edição com ela, como o F2 do Excel. */
  formula?: string;
  rect: { top: number; left: number; width: number; height: number };
  refs: Record<string, string>;
  /** refLabel: nome do escolhido (vários membros: { id: nome }) — a tela mostra sem esperar o servidor. */
  onCommit: (raw: unknown, move: CommitMove, refLabel?: string | Record<string, string>) => void;
  onCancel: () => void;
  onAddOption: (option: string) => Promise<boolean>;
  /** Modo "apontar" do Excel: enquanto a fórmula espera uma referência, clicar numa célula a insere. */
  onPointMode?: (insert: ((ref: string, extend: boolean) => void) | null) => void;
};

/** Paleta das opções de seleção (cor estável pela posição da opção). */
const OPTION_COLORS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
];

export function optionColor(column: ClientColumn, option: string) {
  const i = columnOptions(column).indexOf(option);
  return OPTION_COLORS[(i < 0 ? 0 : i) % OPTION_COLORS.length];
}

export function CellEditor(props: EditorProps) {
  // Digitou "=" (ou a célula já tem fórmula): editor de texto com recursos de fórmula, em qualquer tipo.
  if (props.formula !== undefined || props.initialText?.startsWith("=")) return <TextEditor {...props} />;
  switch (props.column.type) {
    case "SELECT":
    case "MULTI_SELECT":
      return <OptionsEditor {...props} />;
    case "USER":
    case "CONTACT":
    case "DEAL":
      return isMultiUserColumn(props.column) ? <MultiMemberEditor {...props} /> : <ReferenceEditor {...props} />;
    case "LONG_TEXT":
      return <TextEditor {...props} multiline />;
    default:
      return <TextEditor {...props} />;
  }
}

const PLACEHOLDERS: Partial<Record<ClientColumn["type"], string>> = {
  DATE: "DD/MM/AAAA",
  CURRENCY: "0,00",
  PERCENT: "0,0",
  PHONE: "(00) 00000-0000",
  CPF: "000.000.000-00",
  CNPJ: "00.000.000/0000-00",
  EMAIL: "nome@email.com",
  URL: "https://",
};

/** Caracteres depois dos quais o Excel entende que você vai apontar uma célula. */
const EXPECTS_REF = /[=(;,:+\-*/^&<>]\s*$/;

/** Nome de função que está sendo digitado logo antes do cursor (para o autocompletar). */
function typingFunction(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const m = /(?:^=|[=(;,+\-*/^&<>\s])([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)$/.exec(before);
  if (!m) return null;
  // "A1", "B12" é referência, não função.
  if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null;
  return m[1];
}

/** Função mais interna aberta antes do cursor + qual argumento (para a dica de sintaxe). */
function currentCall(text: string, caret: number): { name: string; arg: number } | null {
  let depth = 0;
  let arg = 0;
  let inStr = false;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) {
        const m = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.]*)\s*$/.exec(text.slice(0, i));
        return m ? { name: m[1], arg } : null;
      }
      depth--;
    } else if ((ch === ";" || ch === ",") && depth === 0) arg++;
  }
  return null;
}

/**
 * F4 do Excel: alterna a referência mais próxima do cursor sem mexer no
 * restante da fórmula. Referências dentro de texto entre aspas não entram.
 */
export function cycleFormulaReference(text: string, caret: number): { text: string; caret: number } | null {
  const refs: { start: number; end: number; value: string }[] = [];
  let inString = false;
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      inString = !inString;
      i++;
      continue;
    }
    if (!inString) {
      const match = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(text.slice(i));
      const before = text[i - 1] ?? "";
      const after = match ? text[i + match[0].length] ?? "" : "";
      if (match && !/[A-Za-z0-9_.]/.test(before) && !/[A-Za-z0-9_]/.test(after)) {
        refs.push({ start: i, end: i + match[0].length, value: match[0] });
        i += match[0].length;
        continue;
      }
    }
    i++;
  }
  const target = refs.find((ref) => caret >= ref.start && caret <= ref.end) ?? [...refs].reverse().find((ref) => ref.end <= caret) ?? refs[0];
  if (!target) return null;
  const match = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(target.value)!;
  const [, colDollar, col, rowDollar, row] = match;
  const next = !colDollar && !rowDollar ? `$${col}$${row}`
    : colDollar && rowDollar ? `${col}$${row}`
    : !colDollar && rowDollar ? `$${col}${row}`
    : `${col}${row}`;
  return {
    text: text.slice(0, target.start) + next + text.slice(target.end),
    caret: target.start + next.length,
  };
}

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

function TextEditor({ column, value, initialText, formula, rect, onCommit, onCancel, onPointMode, multiline = false }: EditorProps & { multiline?: boolean }) {
  const [text, setText] = useState(initialText ?? formula ?? editText(column, value));
  const [caret, setCaret] = useState((initialText ?? formula ?? editText(column, value)).length);
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Última referência inserida apontando (clicar de novo troca, como no Excel).
  const lastInsert = useRef<{ start: number; end: number; anchor: string } | null>(null);
  const [insertedEnd, setInsertedEnd] = useState<number | null>(null);
  const isFormula = text.startsWith("=");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const fnToken = isFormula ? typingFunction(text, caret) : null;
  const suggestions = useMemo(() => (fnToken ? FUNCTIONS.filter((f) => plain(f.name).startsWith(plain(fnToken)) || f.en.startsWith(plain(fnToken))).slice(0, 8) : []), [fnToken]);
  const call = isFormula ? currentCall(text, caret) : null;
  const callInfo = call ? lookupFunction(call.name) : undefined;

  // Avisa a grade se clicar numa célula agora deve inserir a referência (modo apontar).
  const expectsRef = isFormula && (EXPECTS_REF.test(text.slice(0, caret)) || insertedEnd === caret);
  useEffect(() => {
    if (!onPointMode) return;
    if (!expectsRef) {
      onPointMode(null);
      return;
    }
    onPointMode((label, extend) => {
      const el = ref.current;
      if (!el) return;
      const cur = el.selectionStart ?? el.value.length;
      const prev = lastInsert.current;
      const replacing = prev && prev.end === cur;
      const start = replacing ? prev.start : cur;
      const insert = extend && replacing ? `${prev.anchor}:${label}` : label;
      const next = el.value.slice(0, start) + insert + el.value.slice(cur);
      lastInsert.current = { start, end: start + insert.length, anchor: extend && replacing ? prev.anchor : label };
      setInsertedEnd(start + insert.length);
      setText(next);
      setCaret(start + insert.length);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + insert.length, start + insert.length);
      });
    });
    return () => onPointMode(null);
  }, [expectsRef, onPointMode]);

  function accept(index: number) {
    const f = suggestions[index];
    if (!f || !fnToken) return;
    const startAt = caret - fnToken.length;
    const next = `${text.slice(0, startAt)}${f.name}(${text.slice(caret)}`;
    const pos = startAt + f.name.length + 1;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => ref.current?.setSelectionRange(pos, pos));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (suggestions.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        accept(pick);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "F4" && isFormula) {
      e.preventDefault();
      const cycled = cycleFormulaReference(text, ref.current?.selectionStart ?? caret);
      if (!cycled) return;
      setText(cycled.text);
      setCaret(cycled.caret);
      requestAnimationFrame(() => ref.current?.setSelectionRange(cycled.caret, cycled.caret));
    } else if (e.key === "Enter" && !(multiline && (e.altKey || e.shiftKey)) && !(e.altKey && !multiline)) {
      e.preventDefault();
      onCommit(autoClose(text), e.ctrlKey || e.metaKey ? "selection" : e.shiftKey ? "up" : "down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      onCommit(autoClose(text), e.shiftKey ? "left" : "right");
    }
  }

  const style: React.CSSProperties = multiline
    ? { top: rect.top, left: rect.left, width: Math.max(rect.width, 320), minHeight: 120 }
    : { top: rect.top - 1, left: rect.left - 1, width: Math.max(rect.width + 2, isFormula ? 260 : 120, (text.length + 2) * 8), height: rect.height + 2 };
  // Igual ao Excel: a caixa de edição fica exatamente sobre a célula, mesma fonte, borda verde.
  const cls =
    "absolute z-30 border-2 border-[var(--xl)] bg-[var(--xl-sheet)] px-[5px] text-[length:var(--xl-fs)] text-[var(--xl-cell-text)] shadow-[0_2px_8px_rgba(0,0,0,0.18)] outline-none [font-family:var(--xl-font)]";
  const track = (el: HTMLInputElement | HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? el.value.length);
    setPick(0);
  };
  const editor = multiline ? (
    <textarea
      ref={ref}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        track(e.target);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(text, "none")}
      className={`${cls} resize py-1.5`}
      style={style}
    />
  ) : (
    <input
      ref={ref}
      value={text}
      placeholder={PLACEHOLDERS[column.type]}
      inputMode={!isFormula && (column.type === "NUMBER" || column.type === "CURRENCY" || column.type === "PERCENT") ? "decimal" : undefined}
      spellCheck={!isFormula}
      onChange={(e) => {
        setText(e.target.value);
        track(e.target);
        lastInsert.current = null;
        setInsertedEnd(null);
      }}
      onKeyUp={(e) => track(e.currentTarget)}
      onClick={(e) => track(e.currentTarget)}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(autoClose(text), "none")}
      className={cls}
      style={style}
    />
  );

  return (
    <>
      {editor}
      {isFormula && (suggestions.length > 0 || callInfo) && (
        <div className="absolute z-40 font-sans" style={{ top: rect.top + rect.height + 3, left: rect.left }} onMouseDown={(e) => e.preventDefault()}>
          {suggestions.length > 0 ? (
            <ul className="w-80 overflow-hidden rounded-[3px] border border-[#c6c6c6] bg-white py-0.5 text-[12px] shadow-[0_4px_14px_rgba(0,0,0,0.18)] dark:border-neutral-700 dark:bg-neutral-900">
              {suggestions.map((f, i) => (
                <li key={f.name}>
                  <button
                    type="button"
                    onMouseEnter={() => setPick(i)}
                    onClick={() => accept(i)}
                    className={`flex w-full items-baseline gap-2 px-2 py-1 text-left ${i === pick ? "bg-[var(--xl-soft)]" : ""}`}
                  >
                    <span className="font-mono text-[11px] text-[var(--xl)]">ƒx</span>
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100">{f.name}</span>
                    {i === pick && <span className="truncate text-neutral-500">{f.description}</span>}
                  </button>
                </li>
              ))}
              <li className="border-t border-neutral-100 px-2 py-0.5 text-[11px] text-neutral-400 dark:border-neutral-800">Tab para inserir</li>
            </ul>
          ) : (
            callInfo && (
              <div className="rounded-[2px] border border-[#c6c6c6] bg-[#ffffe1] px-2 py-0.5 text-[12px] text-neutral-800 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                <SignatureHint signature={callInfo.signature} arg={call!.arg} />
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}

/** Como o Excel: esqueceu de fechar parênteses? Ele fecha ao confirmar. */
function autoClose(text: string) {
  if (!text.startsWith("=")) return text;
  let depth = 0;
  let inStr = false;
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === "(") depth++;
    else if (!inStr && ch === ")") depth--;
  }
  return depth > 0 && !inStr ? text + ")".repeat(depth) : text;
}

/** Dica amarela de sintaxe com o argumento atual em negrito (igual à dica do Excel). */
function SignatureHint({ signature, arg }: { signature: string; arg: number }) {
  const open = signature.indexOf("(");
  const name = signature.slice(0, open);
  const params = signature.slice(open + 1, signature.lastIndexOf(")")).split(";").map((p) => p.trim());
  return (
    <span>
      {name}(
      {params.map((p, i) => (
        <span key={i}>
          {i > 0 && "; "}
          <span className={i === Math.min(arg, params.length - 1) ? "font-bold" : ""}>{p}</span>
        </span>
      ))}
      )
    </span>
  );
}

/** Lista flutuante com busca e navegação por setas — base dos editores de opção e de referência. */
function Popover({ rect, children }: { rect: EditorProps["rect"]; children: React.ReactNode }) {
  return (
    <div
      className="absolute z-30 w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      style={{ top: rect.top + rect.height + 2, left: rect.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function OptionsEditor({ column, value, initialText, rect, onCommit, onCancel, onAddOption }: EditorProps) {
  const multi = column.type === "MULTI_SELECT";
  const options = columnOptions(column);
  const [query, setQuery] = useState(initialText ?? "");
  const [selected, setSelected] = useState<string[]>(multi ? ((value as string[]) ?? []) : value ? [String(value)] : []);
  const [cursor, setCursor] = useState(0);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const canCreate = query.trim() && !options.some((o) => o.toLowerCase() === query.trim().toLowerCase());
  const items = [...filtered.map((o) => ({ kind: "opt" as const, label: o })), ...(canCreate ? [{ kind: "new" as const, label: query.trim() }] : [])];

  async function choose(label: string, isNew: boolean, move: CommitMove = "down") {
    if (isNew) {
      setAdding(true);
      const ok = await onAddOption(label);
      setAdding(false);
      if (!ok) return;
    }
    if (!multi) return onCommit(label, move);
    setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (multi) onCommit(selected, "none");
      else onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[cursor];
      const move = e.ctrlKey || e.metaKey ? "selection" : "down";
      if (multi && move === "selection") onCommit(selected, move);
      else if (it) choose(it.label, it.kind === "new", move);
      else if (multi) onCommit(selected, move);
      else if (!query) onCommit(null, move);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onCommit(multi ? selected : (selected[0] ?? null), e.shiftKey ? "left" : "right");
    } else if (e.key === "Backspace" && !query && !multi && selected.length) {
      onCommit(null, "none");
    }
  }

  return (
    <Popover rect={rect}>
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-2 dark:border-neutral-800">
        <Search className="h-3.5 w-3.5 text-neutral-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => (multi ? onCommit(selected, "none") : onCancel())}
          placeholder={options.length ? "Buscar ou criar opção" : "Digite para criar uma opção"}
          className="w-full bg-transparent py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
      </div>
      <ul className="max-h-60 overflow-auto py-1">
        {items.map((it, i) => (
          <li key={`${it.kind}:${it.label}`}>
            <button
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(it.label, it.kind === "new")}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${i === cursor ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
            >
              {it.kind === "new" ? (
                <>
                  <Plus className="h-3.5 w-3.5 text-brand" />
                  <span className="text-neutral-800 dark:text-neutral-200">
                    Criar <span className={`rounded-full px-2 py-0.5 text-xs ${OPTION_COLORS[options.length % OPTION_COLORS.length]}`}>{it.label}</span>
                  </span>
                  {adding && <LoadingDots />}
                </>
              ) : (
                <>
                  <span className={`flex h-4 w-4 items-center justify-center ${selected.includes(it.label) ? "text-brand" : "text-transparent"}`}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className={`truncate rounded-full px-2 py-0.5 text-xs font-medium ${optionColor(column, it.label)}`}>{it.label}</span>
                </>
              )}
            </button>
          </li>
        ))}
        {!items.length && <li className="px-3 py-2 text-xs text-neutral-400">Nenhuma opção</li>}
      </ul>
      {(selected.length > 0 || multi) && (
        <div className="flex justify-between border-t border-neutral-100 px-2 py-1.5 text-xs dark:border-neutral-800">
          <button type="button" className="text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400" onClick={() => onCommit(null, "none")}>Limpar</button>
          {multi && <button type="button" className="font-medium text-brand" onClick={() => onCommit(selected, "down")}>Concluir</button>}
        </div>
      )}
    </Popover>
  );
}

type LookupItem = { id: string; label: string; hint: string | null };

/**
 * Membro da equipe com vários por célula (venda dividida): clicar/Enter marca e desmarca,
 * "Concluir" (ou sair da caixa) grava a lista; Esc cancela.
 */
function MultiMemberEditor({ value, initialText, rect, refs, onCommit, onCancel }: EditorProps) {
  const [query, setQuery] = useState(initialText ?? "");
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string[]>(() => refIds(value));
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(refIds(value).map((id) => [id, refs[id] ?? "…"])));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sheets/lookup?type=USER&q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const data = await res.json();
        setItems(data.items ?? []);
        setCursor(0);
      } catch {
        /* busca cancelada pela próxima tecla */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const toggle = (it: LookupItem) => {
    setLabels((l) => ({ ...l, [it.id]: it.label }));
    setSelected((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id]));
  };
  const done = (move: CommitMove) => onCommit(selected.length ? selected : null, move, labels);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Enter com busca vazia confirma; com busca, marca/desmarca o membro destacado.
      if (!query.trim() || e.ctrlKey || e.metaKey) return done(e.ctrlKey || e.metaKey ? "selection" : "down");
      const it = items[cursor];
      if (it) {
        toggle(it);
        setQuery("");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      done(e.shiftKey ? "left" : "right");
    }
  }

  return (
    <Popover rect={rect}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
          {selected.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              {labels[id] ?? refs[id] ?? "…"}
              <button
                type="button"
                aria-label="Remover membro"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSelected((s) => s.filter((x) => x !== id))}
                className="hover:text-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-2 dark:border-neutral-800">
        <Search className="h-3.5 w-3.5 text-neutral-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => done("none")}
          placeholder="Buscar membro — marque um ou mais"
          className="w-full bg-transparent py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        {loading && <LoadingDots />}
      </div>
      <ul className="max-h-64 overflow-auto py-1">
        {items.map((it, i) => {
          const on = selected.includes(it.id);
          return (
            <li key={it.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => toggle(it)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === cursor ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-brand bg-brand text-white" : "border-neutral-300 dark:border-neutral-600"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${on ? "font-semibold text-brand" : "text-neutral-900 dark:text-neutral-100"}`}>{it.label}</span>
                  {it.hint && <span className="block truncate text-xs text-neutral-500">{it.hint}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {!loading && !items.length && <li className="px-3 py-2 text-xs text-neutral-400">Nenhum membro encontrado</li>}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-3 py-1.5 text-xs dark:border-neutral-800">
        <button type="button" onMouseDown={(e) => e.preventDefault()} className="text-neutral-500 hover:text-red-600 dark:text-neutral-400" onClick={() => onCommit(null, "none")}>
          Limpar
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} className="font-medium text-brand" onClick={() => done("down")}>
          Concluir ({selected.length})
        </button>
      </div>
    </Popover>
  );
}

function ReferenceEditor({ column, value, initialText, rect, refs, onCommit, onCancel }: EditorProps) {
  const [query, setQuery] = useState(initialText ?? "");
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sheets/lookup?type=${column.type}&q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const data = await res.json();
        setItems(data.items ?? []);
        setCursor(0);
      } catch {
        /* busca cancelada pela próxima tecla */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, column.type]);

  const noun = column.type === "CONTACT" ? "cliente" : column.type === "DEAL" ? "negócio" : "membro";

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[cursor];
      if (it) onCommit(it.id, e.ctrlKey || e.metaKey ? "selection" : "down", it.label);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <Popover rect={rect}>
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-2 dark:border-neutral-800">
        <Search className="h-3.5 w-3.5 text-neutral-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onCancel}
          placeholder={`Buscar ${noun} por nome${column.type === "CONTACT" ? ", telefone ou e-mail" : ""}`}
          className="w-full bg-transparent py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        {loading && <LoadingDots />}
      </div>
      <ul className="max-h-64 overflow-auto py-1">
        {items.map((it, i) => (
          <li key={it.id}>
            <button
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => onCommit(it.id, "down", it.label)}
              className={`flex w-full flex-col items-start px-3 py-1.5 text-left ${i === cursor ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
            >
              <span className={`truncate text-sm ${it.id === value ? "font-semibold text-brand" : "text-neutral-900 dark:text-neutral-100"}`}>{it.label}</span>
              {it.hint && <span className="truncate text-xs text-neutral-500">{it.hint}</span>}
            </button>
          </li>
        ))}
        {!loading && !items.length && <li className="px-3 py-2 text-xs text-neutral-400">Nenhum {noun} encontrado</li>}
      </ul>
      {value !== undefined && (
        <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-3 py-1.5 text-xs dark:border-neutral-800">
          {column.type === "CONTACT" || column.type === "DEAL" ? (
            <Link
              href={column.type === "CONTACT" ? `/clientes/${value}` : `/negocios/${value}`}
              className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-[#0563c1] hover:underline dark:text-sky-400"
              title={`Abrir ficha do ${noun}`}
            >
              <span className="truncate">{refs[String(value)] ?? `Abrir ${noun}`}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </Link>
          ) : (
            <span className="truncate text-neutral-500">Atual: {refs[String(value)] ?? "—"}</span>
          )}
          <button type="button" className="shrink-0 text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400" onClick={() => onCommit(null, "none")}>Remover</button>
        </div>
      )}
    </Popover>
  );
}
