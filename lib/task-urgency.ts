import { brazilStartOfDay } from "./timezone";

/**
 * Régua única "atrasada → hoje → agendada → sem tarefa" (ver
 * new-design-for-claude/README.md, seção "Interações e comportamento") —
 * isomórfico de propósito (roda no servidor pro filtro/sort do Pipeline e
 * no cliente pra colorir a faixa de tarefa do card), única fonte de verdade
 * pra não ter três lugares decidindo "isso é hoje?" de jeitos ligeiramente
 * diferentes. Usa brazilStartOfDay (lib/timezone.ts) pro limite de "hoje",
 * nunca getters nativos direto — servidor roda em UTC.
 */
export type TaskUrgency = "atrasada" | "hoje" | "agendada" | "sem-tarefa";

export function classifyTaskUrgency(dueAt: Date | string | null | undefined, now: Date = new Date()): TaskUrgency {
  if (!dueAt) return "sem-tarefa";
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const todayStart = brazilStartOfDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
  if (due < todayStart) return "atrasada";
  if (due < tomorrowStart) return "hoje";
  return "agendada";
}

/** Ordem de prioridade pro sort "Urgência" do Pipeline — menor rank primeiro. */
export const TASK_URGENCY_RANK: Record<TaskUrgency, number> = {
  atrasada: 0,
  hoje: 1,
  agendada: 2,
  "sem-tarefa": 3,
};

export const TASK_URGENCY_LABEL: Record<TaskUrgency, string> = {
  atrasada: "Atrasada",
  hoje: "Hoje",
  agendada: "Agendada",
  "sem-tarefa": "Sem tarefa",
};
