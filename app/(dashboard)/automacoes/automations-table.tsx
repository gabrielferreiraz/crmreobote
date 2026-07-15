"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, Plus, Loader2, Trash2, Play, Pause, History, Pencil } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { VariableInput } from "@/components/variable-input";
import { RecipientPicker, type RecipientEntry } from "./recipient-picker";

type Trigger =
  | "DEAL_STALE"
  | "DEAL_CREATED"
  | "DEAL_WON"
  | "DEAL_LOST"
  | "TASK_OVERDUE"
  | "DEAL_STAGE_ENTERED"
  | "DEAL_NO_OPEN_TASK"
  | "CONTACT_NO_DEAL"
  | "SCHEDULED"
  | "TASK_DUE_SOON";
type Action = "CREATE_TASK" | "ADD_NOTE" | "MARK_LOST" | "SEND_PUSH" | "SEND_WHATSAPP" | "SEND_EMAIL";

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Rule = {
  id: string;
  name: string;
  trigger: Trigger;
  triggerConfig: Record<string, unknown> | null;
  action: Action;
  actionConfig: Record<string, unknown> | null;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
};

type StageOption = { id: string; name: string };
type PipelineOption = { id: string; name: string; stages: StageOption[] };
type LossReasonOption = { id: string; label: string };
type MemberOption = { id: string; name: string; role?: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER" };

const TRIGGER_LABELS: Record<Trigger, string> = {
  DEAL_STALE: "Negócio parado",
  DEAL_CREATED: "Negócio criado",
  DEAL_WON: "Negócio ganho",
  DEAL_LOST: "Negócio perdido",
  TASK_OVERDUE: "Tarefa vencida",
  DEAL_STAGE_ENTERED: "Negócio entra em uma etapa",
  DEAL_NO_OPEN_TASK: "Negócio sem tarefa pendente",
  CONTACT_NO_DEAL: "Contato sem negócio",
  SCHEDULED: "Agendamento (horário fixo)",
  TASK_DUE_SOON: "Tarefa perto do prazo",
};

const TRIGGER_DESCRIPTIONS: Record<Trigger, string> = {
  DEAL_STALE: "Dispara quando um negócio aberto fica parado na mesma etapa por N dias.",
  DEAL_CREATED: "Dispara assim que um novo negócio é criado.",
  DEAL_WON: "Dispara quando um negócio é marcado como ganho.",
  DEAL_LOST: "Dispara quando um negócio é marcado como perdido.",
  TASK_OVERDUE: "Dispara quando uma tarefa passa do prazo sem ser concluída.",
  DEAL_STAGE_ENTERED: "Dispara toda vez que um negócio entra na etapa escolhida — ótimo para cobrar retorno após enviar uma proposta.",
  DEAL_NO_OPEN_TASK: "Rede de segurança: pega negócios abertos há mais de N horas que ninguém agendou nenhuma tarefa de acompanhamento.",
  CONTACT_NO_DEAL: "Pega contatos (ex.: importados via planilha) que continuam sem nenhum negócio depois de N dias.",
  SCHEDULED: "Dispara num horário recorrente (ex.: toda segunda às 8h), sem depender de nenhuma mudança em negócio. A checagem roda de hora em hora, então o disparo acontece em algum momento dentro da hora escolhida.",
  TASK_DUE_SOON: "Dispara pouco antes do prazo de uma tarefa (ex.: lembrar de uma visita 15 minutos antes). Combine com \"Enviar notificação push\" pra virar um lembrete no celular. Importante: só funciona com a granularidade da checagem periódica das automações — se ela rodar de hora em hora, um aviso de 15 minutos pode não ser exato.",
};

const ACTION_LABELS: Record<Action, string> = {
  CREATE_TASK: "Criar tarefa",
  ADD_NOTE: "Registrar nota",
  MARK_LOST: "Marcar como perdido",
  SEND_PUSH: "Enviar notificação push",
  SEND_WHATSAPP: "Enviar mensagem de WhatsApp",
  SEND_EMAIL: "Enviar e-mail",
};

export function AutomationsTable({
  initialRules,
  canManage,
  pipelines,
  lossReasons,
  members,
}: {
  initialRules: Rule[];
  canManage: boolean;
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<Rule | null>(null);
  const [historyRule, setHistoryRule] = useState<Rule | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const stageById = new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, `${s.name} (${p.name})`])));
  const lossReasonById = new Map(lossReasons.map((r) => [r.id, r.label]));
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  function describeTrigger(rule: Rule): string | null {
    const config = rule.triggerConfig ?? {};
    if (rule.trigger === "DEAL_STALE") return `após ${config.days ?? 3} dias`;
    if (rule.trigger === "DEAL_STAGE_ENTERED") {
      const stageId = config.stageId as string | undefined;
      return stageId ? (stageById.get(stageId) ?? "etapa removida") : null;
    }
    if (rule.trigger === "DEAL_NO_OPEN_TASK") return `após ${config.minHours ?? 24}h`;
    if (rule.trigger === "TASK_DUE_SOON") return `${config.minutesBefore ?? 15} min antes do prazo`;
    if (rule.trigger === "CONTACT_NO_DEAL") return `após ${config.days ?? 2} dias`;
    if (rule.trigger === "SCHEDULED") {
      const frequency = config.frequency as string | undefined;
      const time = (config.time as string | undefined) ?? "";
      const assigneeName = memberById.get(config.assigneeId as string) ?? "responsável removido";
      if (frequency === "daily") return `todo dia ${time} · ${assigneeName}`;
      if (frequency === "weekly") {
        const dayLabel = WEEKDAY_LABELS[(config.dayOfWeek as number) ?? 1];
        return `toda ${dayLabel} ${time} · ${assigneeName}`;
      }
      if (frequency === "monthly") return `todo dia ${config.dayOfMonth ?? 1} às ${time} · ${assigneeName}`;
      return null;
    }
    return null;
  }

  function describeAction(rule: Rule): string | null {
    const config = rule.actionConfig ?? {};
    if (rule.action === "MARK_LOST") {
      const lossReasonId = config.lossReasonId as string | undefined;
      return lossReasonId ? (lossReasonById.get(lossReasonId) ?? "motivo removido") : null;
    }
    if (rule.action === "SEND_PUSH") {
      return (config.pushTitle as string | undefined) || null;
    }
    if (rule.action === "SEND_WHATSAPP") {
      const text = config.whatsappMessage as string | undefined;
      return text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : null;
    }
    if (rule.action === "SEND_EMAIL") {
      return (config.emailSubject as string | undefined) || null;
    }
    return null;
  }

  function lowerFirst(s: string): string {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  /** Frase única resumindo gatilho + ação — o que a pessoa lê pra entender a regra sem abrir o modal. */
  function describeRule(rule: Rule): string {
    const triggerDetail = describeTrigger(rule);
    const actionDetail = describeAction(rule);
    const triggerPart = `${lowerFirst(TRIGGER_LABELS[rule.trigger])}${triggerDetail ? ` (${triggerDetail})` : ""}`;
    const actionPart = `${lowerFirst(ACTION_LABELS[rule.action])}${actionDetail ? ` (${actionDetail})` : ""}`;
    return `Quando ${triggerPart} → ${actionPart}.`;
  }

  async function toggleEnabled(rule: Rule) {
    setTogglingId(rule.id);
    await fetch(`/api/automations/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    setTogglingId(null);
    router.refresh();
  }

  async function deleteRule(id: string) {
    await fetch(`/api/automations/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setEditRule(null);
              setOpen(true);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Nova automação
          </button>
        </div>
      )}

      {initialRules.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Zap}
            title="Nenhuma automação configurada ainda"
            description="Crie regras como 'negócio entrou em Proposta enviada → criar tarefa de cobrança em 2 dias' ou 'negócio parado 15 dias → marcar como perdido'."
          />
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {initialRules.map((rule) => (
            <div
              key={rule.id}
              className={`automation-row first:rounded-t-lg last:rounded-b-lg flex items-center gap-3 p-4 ${
                rule.enabled ? "" : "opacity-60"
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                <Zap className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{rule.name}</p>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{describeRule(rule)}</p>
              </div>

              <button
                type="button"
                onClick={() => setHistoryRule(rule)}
                disabled={rule.runCount === 0}
                className="hidden shrink-0 text-right transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:hover:opacity-100 sm:block"
                title="Ver histórico de execuções"
              >
                <p className="text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
                  {rule.runCount} execuç{rule.runCount === 1 ? "ão" : "ões"}
                </p>
                <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {rule.lastRunAt ? `última ${new Date(rule.lastRunAt).toLocaleDateString("pt-BR")}` : "nunca rodou"}
                </p>
              </button>

              <button
                disabled={!canManage || togglingId === rule.id}
                onClick={() => toggleEnabled(rule)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {togglingId === rule.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                ) : rule.enabled ? (
                  <Pause className="h-3 w-3" strokeWidth={2} />
                ) : (
                  <Play className="h-3 w-3" strokeWidth={2} />
                )}
                {rule.enabled ? "Pausar" : "Ativar"}
              </button>

              <button
                onClick={() => setHistoryRule(rule)}
                className="icon-btn shrink-0 sm:hidden"
                aria-label="Ver histórico de execuções"
              >
                <History className="h-3.5 w-3.5" strokeWidth={2} />
              </button>

              {canManage && (
                <button
                  onClick={() => {
                    setEditRule(rule);
                    setOpen(true);
                  }}
                  className="icon-btn shrink-0"
                  aria-label="Editar automação"
                  title="Editar automação"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}

              {canManage && (
                <button
                  onClick={() => setRuleToDelete(rule)}
                  className="icon-btn shrink-0"
                  aria-label="Excluir automação"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <AutomationDialog
          pipelines={pipelines}
          lossReasons={lossReasons}
          members={members}
          editRule={editRule}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}

      {ruleToDelete && (
        <ConfirmDialog
          title={`Excluir "${ruleToDelete.name}"?`}
          description="Essa automação para de rodar imediatamente. Não afeta tarefas/notas já criadas por ela."
          confirmLabel="Excluir"
          onClose={() => setRuleToDelete(null)}
          onConfirm={async () => {
            await deleteRule(ruleToDelete.id);
            setRuleToDelete(null);
          }}
        />
      )}

      {historyRule && <AutomationHistoryModal rule={historyRule} onClose={() => setHistoryRule(null)} />}
    </div>
  );
}

type HistoryEntry = { id: string; executedAt: string; label: string; href: string | null };

function AutomationHistoryModal({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/automations/${rule.id}/history`);
      if (cancelled) return;
      if (!res.ok) {
        setError("Não foi possível carregar o histórico.");
        return;
      }
      setEntries(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [rule.id]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histórico de execuções</h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">{rule.name}</p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!error && entries === null && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Carregando…</p>
      )}

      {entries?.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Essa automação ainda não rodou.</p>
      )}

      {entries && entries.length > 0 && (
        <div className="scrollbar-thin max-h-96 space-y-1 overflow-y-auto">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            >
              {e.href ? (
                <Link href={e.href} onClick={onClose} className="min-w-0 truncate text-neutral-800 hover:underline dark:text-neutral-200">
                  {e.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-neutral-800 dark:text-neutral-200">{e.label}</span>
              )}
              <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                {new Date(e.executedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
          ))}
        </div>
      )}

      {entries && entries.length >= 50 && (
        <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">Mostrando as 50 execuções mais recentes.</p>
      )}
    </Modal>
  );
}

function AutomationDialog({
  pipelines,
  lossReasons,
  members,
  editRule,
  onClose,
  onSaved,
}: {
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  members: MemberOption[];
  editRule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editRule;
  const tc = editRule?.triggerConfig ?? {};
  const ac = editRule?.actionConfig ?? {};

  const [name, setName] = useState(editRule?.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>(editRule?.trigger ?? "DEAL_STALE");
  const [action, setAction] = useState<Action>(editRule?.action ?? "CREATE_TASK");
  const [staleDays, setStaleDays] = useState(String((tc.days as number | undefined) ?? 3));
  const [stageId, setStageId] = useState((tc.stageId as string | undefined) ?? pipelines[0]?.stages[0]?.id ?? "");
  const [minHours, setMinHours] = useState(String((tc.minHours as number | undefined) ?? 24));
  const [minutesBefore, setMinutesBefore] = useState(String((tc.minutesBefore as number | undefined) ?? 15));
  const [contactDays, setContactDays] = useState(String((tc.days as number | undefined) ?? 2));
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(
    (tc.frequency as "daily" | "weekly" | "monthly" | undefined) ?? "weekly",
  );
  const [scheduleTime, setScheduleTime] = useState((tc.time as string | undefined) ?? "08:00");
  const [dayOfWeek, setDayOfWeek] = useState(String((tc.dayOfWeek as number | undefined) ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String((tc.dayOfMonth as number | undefined) ?? 1));
  const [assigneeId, setAssigneeId] = useState((tc.assigneeId as string | undefined) ?? members[0]?.id ?? "");
  const [taskTitle, setTaskTitle] = useState((ac.title as string | undefined) ?? "");
  const [taskDueInDays, setTaskDueInDays] = useState(String((ac.dueInDays as number | undefined) ?? 1));
  const [note, setNote] = useState((ac.note as string | undefined) ?? "");
  const [lossReasonId, setLossReasonId] = useState((ac.lossReasonId as string | undefined) ?? lossReasons[0]?.id ?? "");
  const [pushTitle, setPushTitle] = useState((ac.pushTitle as string | undefined) ?? "");
  const [pushBody, setPushBody] = useState((ac.pushBody as string | undefined) ?? "");
  const [whatsappMessage, setWhatsappMessage] = useState((ac.whatsappMessage as string | undefined) ?? "");
  const [whatsappRecipients, setWhatsappRecipients] = useState<RecipientEntry[]>(
    (ac.whatsappRecipients as RecipientEntry[] | undefined) ?? [{ type: "CLIENT" }],
  );
  const [emailSubject, setEmailSubject] = useState((ac.emailSubject as string | undefined) ?? "");
  const [emailBody, setEmailBody] = useState((ac.emailBody as string | undefined) ?? "");
  const [emailRecipients, setEmailRecipients] = useState<RecipientEntry[]>(
    (ac.emailRecipients as RecipientEntry[] | undefined) ?? [{ type: "RESPONSIBLE" }],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noStages = pipelines.every((p) => p.stages.length === 0);
  // O recipient-picker mantém o tipo interno "ADMIN" (compatível com regras já
  // salvas), mas quem hoje ocupa esse papel na organização é o Gerente.
  const admins = members.filter((m) => m.role === "MANAGER");
  const owners = members.filter((m) => m.role === "OWNER");
  const memberById = new Map(members.map((m) => [m.id, m.name]));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const triggerConfig =
      trigger === "DEAL_STALE"
        ? { days: Number(staleDays) || 3 }
        : trigger === "DEAL_STAGE_ENTERED"
          ? { stageId }
          : trigger === "DEAL_NO_OPEN_TASK"
            ? { minHours: Number(minHours) || 24 }
            : trigger === "CONTACT_NO_DEAL"
              ? { days: Number(contactDays) || 2 }
              : trigger === "TASK_DUE_SOON"
                ? { minutesBefore: Number(minutesBefore) || 15 }
                : trigger === "SCHEDULED"
                  ? {
                      frequency,
                      time: scheduleTime,
                      dayOfWeek: frequency === "weekly" ? Number(dayOfWeek) : undefined,
                      dayOfMonth: frequency === "monthly" ? Number(dayOfMonth) : undefined,
                      assigneeId,
                    }
                  : undefined;

    const actionConfig =
      action === "CREATE_TASK"
        ? { title: taskTitle || undefined, dueInDays: Number(taskDueInDays) || 1 }
        : action === "ADD_NOTE"
          ? { note: note || undefined }
          : action === "MARK_LOST"
            ? { lossReasonId }
            : action === "SEND_PUSH"
              ? { pushTitle: pushTitle || undefined, pushBody: pushBody || undefined }
              : action === "SEND_WHATSAPP"
                ? { whatsappMessage, whatsappRecipients }
                : { emailSubject: emailSubject || undefined, emailBody, emailRecipients };

    const res = await fetch(isEdit ? `/api/automations/${editRule!.id}` : "/api/automations", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, trigger, triggerConfig, action, actionConfig }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? (isEdit ? "Erro ao salvar automação" : "Erro ao criar automação"));
      return;
    }

    onSaved();
  }

  const canSubmit =
    !!name.trim() &&
    (trigger !== "DEAL_STAGE_ENTERED" || !!stageId) &&
    (trigger !== "SCHEDULED" || !!assigneeId) &&
    (action !== "MARK_LOST" || !!lossReasonId) &&
    (action !== "SEND_WHATSAPP" || (!!whatsappMessage.trim() && whatsappRecipients.length > 0)) &&
    (action !== "SEND_EMAIL" || (!!emailBody.trim() && emailRecipients.length > 0));

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {isEdit ? "Editar automação" : "Nova automação"}
      </h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <label className="field-label">Nome</label>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Cobrar negócio parado"
            className="field-input"
          />
        </div>

        <div className="space-y-1">
          <label className="field-label">Quando</label>
          <Select
            value={trigger}
            onChange={(v) => setTrigger(v as Trigger)}
            options={Object.entries(TRIGGER_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{TRIGGER_DESCRIPTIONS[trigger]}</p>
        </div>

        {trigger === "DEAL_STALE" && (
          <div className="space-y-1">
            <label className="field-label">Dias parado no mesmo estágio</label>
            <input
              type="number"
              min={1}
              value={staleDays}
              onChange={(e) => setStaleDays(e.target.value)}
              className="field-input"
            />
          </div>
        )}

        {trigger === "DEAL_STAGE_ENTERED" && (
          <div className="space-y-1">
            <label className="field-label">Etapa</label>
            {noStages ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Cadastre etapas em uma pipeline antes de usar esse gatilho.
              </p>
            ) : (
              <Select
                value={stageId}
                onChange={setStageId}
                options={pipelines.flatMap((p) =>
                  p.stages.map((s) => ({ value: s.id, label: `${p.name} — ${s.name}` })),
                )}
              />
            )}
          </div>
        )}

        {trigger === "SCHEDULED" && (
          <>
            <div className="space-y-1">
              <label className="field-label">Frequência</label>
              <Select
                value={frequency}
                onChange={(v) => setFrequency(v as "daily" | "weekly" | "monthly")}
                options={[
                  { value: "daily", label: "Todo dia" },
                  { value: "weekly", label: "Semanalmente" },
                  { value: "monthly", label: "Mensalmente" },
                ]}
              />
            </div>

            {frequency === "weekly" && (
              <div className="space-y-1">
                <label className="field-label">Dia da semana</label>
                <Select
                  value={dayOfWeek}
                  onChange={setDayOfWeek}
                  options={WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label }))}
                />
              </div>
            )}

            {frequency === "monthly" && (
              <div className="space-y-1">
                <label className="field-label">Dia do mês</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className="field-input"
                />
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Use até 28 para garantir que exista em todos os meses.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <label className="field-label">Horário</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="field-input"
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                A checagem roda de hora em hora — só a hora importa, os minutos são ignorados.
              </p>
            </div>

            <div className="space-y-1">
              <label className="field-label">Responsável</label>
              {members.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Nenhum usuário ativo disponível.
                </p>
              ) : (
                <Select
                  value={assigneeId}
                  onChange={setAssigneeId}
                  options={members.map((m) => ({ value: m.id, label: m.name }))}
                />
              )}
            </div>
          </>
        )}

        {trigger === "DEAL_NO_OPEN_TASK" && (
          <div className="space-y-1">
            <label className="field-label">Sem tarefa agendada há quantas horas</label>
            <input
              type="number"
              min={1}
              value={minHours}
              onChange={(e) => setMinHours(e.target.value)}
              className="field-input"
            />
          </div>
        )}

        {trigger === "CONTACT_NO_DEAL" && (
          <div className="space-y-1">
            <label className="field-label">Sem negócio há quantos dias</label>
            <input
              type="number"
              min={1}
              value={contactDays}
              onChange={(e) => setContactDays(e.target.value)}
              className="field-input"
            />
          </div>
        )}

        {trigger === "TASK_DUE_SOON" && (
          <div className="space-y-1">
            <label className="field-label">Minutos de antecedência</label>
            <input
              type="number"
              min={1}
              value={minutesBefore}
              onChange={(e) => setMinutesBefore(e.target.value)}
              className="field-input"
            />
          </div>
        )}

        <div className="space-y-1 sm:col-span-2">
          <div className="h-px bg-neutral-100 dark:bg-neutral-800" />
        </div>

        <div className="space-y-1">
          <label className="field-label">Fazer</label>
          <Select
            value={action}
            onChange={(v) => setAction(v as Action)}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>

        {action === "CREATE_TASK" && (
          <>
            <div className="space-y-1">
              <label className="field-label">Título da tarefa</label>
              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder={`Automação: ${name || "..."}`}
                className="field-input"
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Prazo (dias a partir de agora)</label>
              <input
                type="number"
                min={0}
                value={taskDueInDays}
                onChange={(e) => setTaskDueInDays(e.target.value)}
                className="field-input"
              />
            </div>
          </>
        )}

        {action === "ADD_NOTE" && (
          <div className="space-y-1 sm:col-span-2">
            <label className="field-label">Texto da nota</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="field-input"
            />
          </div>
        )}

        {action === "MARK_LOST" && (
          <div className="space-y-1">
            <label className="field-label">Motivo de perda</label>
            {lossReasons.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Cadastre motivos de perda em Configurações antes de usar essa ação.
              </p>
            ) : (
              <Select
                value={lossReasonId}
                onChange={setLossReasonId}
                options={lossReasons.map((r) => ({ value: r.id, label: r.label }))}
              />
            )}
          </div>
        )}

        {action === "SEND_PUSH" && (
          <>
            <div className="space-y-1">
              <label className="field-label">Título da notificação</label>
              <input
                value={pushTitle}
                onChange={(e) => setPushTitle(e.target.value)}
                placeholder={`Automação: ${name || "..."}`}
                className="field-input"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="field-label">Texto</label>
              <textarea
                value={pushBody}
                onChange={(e) => setPushBody(e.target.value)}
                rows={2}
                className="field-input"
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 sm:col-span-2">
              Só chega em quem ativou notificações push no navegador (Configurações → Perfil). Quem não ativou
              simplesmente não recebe nada.
            </p>
          </>
        )}

        {action === "SEND_WHATSAPP" && (
          <>
            <div className="space-y-1 sm:col-span-2">
              <label className="field-label">Mensagem</label>
              <VariableInput
                value={whatsappMessage}
                onChange={setWhatsappMessage}
                multiline
                rows={3}
                placeholder="Ex.: Olá! Vi que você se interessou pelo nosso consórcio, posso te ajudar com alguma dúvida?"
              />
            </div>
            <div className="sm:col-span-2">
              <RecipientPicker
                recipients={whatsappRecipients}
                onChange={setWhatsappRecipients}
                availableTypes={["CLIENT", "SUPERVISOR", "ADMIN", "OWNER", "CUSTOM"]}
                admins={admins}
                owners={owners}
                memberById={memberById}
                customLabel="Número personalizado"
                customPlaceholder="Ex.: 67991234567"
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 sm:col-span-2">
              Sempre sai pelo número do WhatsApp do responsável pelo negócio/contato/tarefa — os destinatários acima
              são só pra quem recebe. Se ele não tiver conectado o WhatsApp em Configurações → Perfil, a automação
              não consegue enviar pra ninguém (fica registrado no log, não trava as outras ações).
            </p>
          </>
        )}

        {action === "SEND_EMAIL" && (
          <>
            <div className="space-y-1">
              <label className="field-label">Assunto</label>
              <VariableInput value={emailSubject} onChange={setEmailSubject} placeholder={`Automação: ${name || "..."}`} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="field-label">Texto</label>
              <VariableInput value={emailBody} onChange={setEmailBody} multiline rows={3} />
            </div>
            <div className="sm:col-span-2">
              <RecipientPicker
                recipients={emailRecipients}
                onChange={setEmailRecipients}
                availableTypes={["CLIENT", "RESPONSIBLE", "SUPERVISOR", "ADMIN", "OWNER", "CUSTOM"]}
                admins={admins}
                owners={owners}
                memberById={memberById}
                customLabel="E-mail personalizado"
                customPlaceholder="Ex.: alguem@empresa.com"
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                {isEdit ? "Salvando" : "Criando"}
                <LoadingDots />
              </span>
            ) : isEdit ? (
              "Salvar alterações"
            ) : (
              "Criar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
