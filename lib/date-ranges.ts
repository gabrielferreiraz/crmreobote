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
