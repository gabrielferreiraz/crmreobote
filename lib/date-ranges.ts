/**
 * Atalhos de período reaproveitados em qualquer filtro de data do app
 * (Relatórios, Pipeline...) — cada um resolve pra um range "de/até" em
 * "YYYY-MM-DD", calculado na hora (nunca fixo), então "Mês passado" sempre
 * é relativo a hoje.
 */

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type QuickRange = { key: string; label: string; range: () => { from: string; to: string } };

/** Primeiro/último dia do mês que é `monthsAgo` meses antes de hoje (0 = mês atual). */
function monthRange(monthsAgo: number): { from: string; to: string } {
  const now = new Date();
  return {
    from: toISODate(new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)),
    to: toISODate(new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0)),
  };
}

/** 1º de janeiro a 31 de dezembro do ano corrente. */
function yearRange(): { from: string; to: string } {
  const now = new Date();
  return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: toISODate(new Date(now.getFullYear(), 11, 31)) };
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
    { key: "today", label: "Hoje", range: () => ({ from: toISODate(new Date()), to: toISODate(new Date()) }) },
    { key: "this-month", label: "Este mês", range: () => monthRange(0) },
    { key: "last-month", label: "Mês passado", range: () => monthRange(1) },
    { key: "this-year", label: "Este ano", range: yearRange },
  ];
}
