/**
 * Atalhos de período reaproveitados em qualquer filtro de data do app
 * (Relatórios, Pipeline...) — cada um resolve pra um range "de/até" em
 * "YYYY-MM-DD", calculado na hora (nunca fixo), então "Mês passado" sempre
 * é relativo a hoje.
 */

import { getBrazilParts } from "@/lib/timezone";

/** Dia civil (`Date.UTC(ano, mês, dia)`) → "YYYY-MM-DD", lido em UTC. */
function utcKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * "Hoje" no calendário de Campo Grande, nunca no fuso da máquina. O
 * servidor roda em UTC: com getters locais, das 20h à meia-noite de MS ele já
 * estava no dia seguinte, e no último dia do mês o "Este mês" padrão dos
 * Relatórios (ver lib/reports/commercial-data.ts) abria o mês seguinte vazio.
 */
function brazilToday(): { year: number; month: number; day: number } {
  const { year, month, day } = getBrazilParts(new Date());
  return { year, month, day };
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valida um dia civil no formato usado pelos filtros (`YYYY-MM-DD`).
 * A comparacao dos componentes impede que o Date normalize silenciosamente
 * entradas como 2026-02-31 para 2026-03-03.
 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Aceita o intervalo somente quando as duas pontas existem, sao validas e estao em ordem. */
export function normalizeDateKeyRange(
  from: unknown,
  to: unknown,
): { from: string; to: string } | null {
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) return null;
  return { from, to };
}

export type QuickRange = { key: string; label: string; range: () => { from: string; to: string } };

/** Primeiro/último dia do mês que é `monthsAgo` meses antes de hoje (0 = mês atual). */
function monthRange(monthsAgo: number): { from: string; to: string } {
  const { year, month } = brazilToday();
  return {
    from: utcKey(new Date(Date.UTC(year, month - monthsAgo, 1))),
    to: utcKey(new Date(Date.UTC(year, month - monthsAgo + 1, 0))),
  };
}

/** 1º de janeiro a 31 de dezembro do ano corrente. */
function yearRange(): { from: string; to: string } {
  const { year } = brazilToday();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function todayRange(): { from: string; to: string } {
  const { year, month, day } = brazilToday();
  const key = utcKey(new Date(Date.UTC(year, month, day)));
  return { from: key, to: key };
}

/** Usado em Relatórios — janela mais larga, útil pra comparar meses recentes. */
export function buildQuickRanges(): QuickRange[] {
  return [
    { key: "this-month", label: "Este mês", range: () => monthRange(0) },
    { key: "last-month", label: "Mês passado", range: () => monthRange(1) },
    { key: "2-months-ago", label: "Há 2 meses", range: () => monthRange(2) },
    { key: "3-months-ago", label: "Há 3 meses", range: () => monthRange(3) },
    { key: "this-year", label: "Este ano", range: yearRange },
  ];
}

/**
 * Se um "de/até" (YYYY-MM-DD) cobre um mês CIVIL inteiro — 1º dia até o
 * último dia do MESMO mês — devolve o nome dele por extenso ("Setembro de
 * 2026"); senão null. Usado pra mostrar qual mês o filtro de período dos
 * Relatórios selecionou com destaque no topo da tela (pedido explícito: "Há
 * 2 meses"/"Há 3 meses" sozinho não diz QUAL mês é — ver relatorios/page.tsx),
 * não só quando um dos atalhos de mês é clicado — um período PERSONALIZADO
 * que por acaso bata exatamente com um mês inteiro também é reconhecido,
 * mesma regra, sem distinguir a origem do range.
 */
export function singleMonthLabel(from: string, to: string): string | null {
  // Parse local (não UTC) de propósito — from/to já são dias civis de
  // Brasília na origem (ver comentário em lib/reports/commercial-data.ts),
  // então só precisa comparar componentes de calendário, nunca fuso.
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  if (fromDate.getDate() !== 1) return null;
  // Dia 0 do mês seguinte = último dia do mês de `from` — mesmo truque de
  // isValidCalendarDate em lib/birth-date.ts, cobre ano bissexto sozinho.
  const lastDayOfFromMonth = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 0).getDate();
  const isSameMonth = toDate.getFullYear() === fromDate.getFullYear() && toDate.getMonth() === fromDate.getMonth();
  if (!isSameMonth || toDate.getDate() !== lastDayOfFromMonth) return null;

  // toLocaleDateString já devolve minúsculo em pt-BR ("setembro de 2026") —
  // só capitaliza a 1ª letra pra virar título ("Setembro de 2026").
  const label = fromDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Usado nos filtros de "Cadastrado em"/"Criado em" de Clientes e Negócios —
 * atalhos mais curtos, pensados pra triagem do dia a dia (não comparação de
 * meses). O calendário personalizado (DateRangeField) cobre qualquer período
 * fora desses atalhos. */
export function buildListQuickRanges(): QuickRange[] {
  return [
    { key: "today", label: "Hoje", range: todayRange },
    { key: "this-month", label: "Este mês", range: () => monthRange(0) },
    { key: "last-month", label: "Mês passado", range: () => monthRange(1) },
    { key: "this-year", label: "Este ano", range: yearRange },
  ];
}
