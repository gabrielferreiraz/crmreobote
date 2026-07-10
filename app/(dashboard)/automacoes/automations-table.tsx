"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Plus, Loader2, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";

type Trigger =
  | "DEAL_STALE"
  | "DEAL_CREATED"
  | "DEAL_WON"
  | "DEAL_LOST"
  | "TASK_OVERDUE"
  | "DEAL_STAGE_ENTERED"
  | "DEAL_NO_OPEN_TASK"
  | "CONTACT_NO_DEAL"
  | "SCHEDULED";
type Action = "CREATE_TASK" | "ADD_NOTE" | "MARK_LOST" | "SEND_PUSH" | "SEND_WHATSAPP";

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
type MemberOption = { id: string; name: string };

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
};

const ACTION_LABELS: Record<Action, string> = {
  CREATE_TASK: "Criar tarefa",
  ADD_NOTE: "Registrar nota",
  MARK_LOST: "Marcar como perdido",
  SEND_PUSH: "Enviar notificação push",
  SEND_WHATSAPP: "Enviar mensagem de WhatsApp",
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
  const [ruleToDelete, setRuleToDelete] = useState<Rule | null>(null);
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
    return null;
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
          <button onClick={() => setOpen(true)} className="btn-primary">
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
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Gatilho</th>
                <th className="px-4 py-2 font-medium">Ação</th>
                <th className="px-4 py-2 font-medium">Execuções</th>
                <th className="px-4 py-2 font-medium">Última execução</th>
                <th className="px-4 py-2 font-medium">Ativa</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {initialRules.map((rule) => (
                <tr key={rule.id} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                  <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{rule.name}</td>
                  <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                    {TRIGGER_LABELS[rule.trigger]}
                    {describeTrigger(rule) && (
                      <span className="block text-xs text-neutral-400 dark:text-neutral-500">{describeTrigger(rule)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                    {ACTION_LABELS[rule.action]}
                    {describeAction(rule) && (
                      <span className="block text-xs text-neutral-400 dark:text-neutral-500">{describeAction(rule)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-neutral-500 dark:text-neutral-400">{rule.runCount}</td>
                  <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                    {rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={!canManage || togglingId === rule.id}
                      onClick={() => toggleEnabled(rule)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                        rule.enabled ? "bg-neutral-900 dark:bg-white" : "bg-neutral-200 dark:bg-neutral-700"
                      }`}
                      aria-label={rule.enabled ? "Pausar" : "Ativar"}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white dark:bg-neutral-900 transition-transform ${
                          rule.enabled ? "translate-x-4.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canManage && (
                      <button
                        onClick={() => setRuleToDelete(rule)}
                        className="icon-btn"
                        aria-label="Excluir automação"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <NewAutomationDialog
          pipelines={pipelines}
          lossReasons={lossReasons}
          members={members}
          onClose={() => setOpen(false)}
          onCreated={() => {
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
    </div>
  );
}

function NewAutomationDialog({
  pipelines,
  lossReasons,
  members,
  onClose,
  onCreated,
}: {
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  members: MemberOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("DEAL_STALE");
  const [action, setAction] = useState<Action>("CREATE_TASK");
  const [staleDays, setStaleDays] = useState("3");
  const [stageId, setStageId] = useState(pipelines[0]?.stages[0]?.id ?? "");
  const [minHours, setMinHours] = useState("24");
  const [contactDays, setContactDays] = useState("2");
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [assigneeId, setAssigneeId] = useState(members[0]?.id ?? "");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueInDays, setTaskDueInDays] = useState("1");
  const [note, setNote] = useState("");
  const [lossReasonId, setLossReasonId] = useState(lossReasons[0]?.id ?? "");
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noStages = pipelines.every((p) => p.stages.length === 0);

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
              : { whatsappMessage };

    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, trigger, triggerConfig, action, actionConfig }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar automação");
      return;
    }

    onCreated();
  }

  const canSubmit =
    !!name.trim() &&
    (trigger !== "DEAL_STAGE_ENTERED" || !!stageId) &&
    (trigger !== "SCHEDULED" || !!assigneeId) &&
    (action !== "MARK_LOST" || !!lossReasonId) &&
    (action !== "SEND_WHATSAPP" || !!whatsappMessage.trim());

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nova automação</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
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
          <div className="space-y-1">
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
            <div className="space-y-1">
              <label className="field-label">Texto</label>
              <textarea
                value={pushBody}
                onChange={(e) => setPushBody(e.target.value)}
                rows={2}
                className="field-input"
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Só chega em quem ativou notificações push no navegador (Configurações → Perfil). Quem não ativou
              simplesmente não recebe nada.
            </p>
          </>
        )}

        {action === "SEND_WHATSAPP" && (
          <>
            <div className="space-y-1">
              <label className="field-label">Mensagem</label>
              <textarea
                required
                value={whatsappMessage}
                onChange={(e) => setWhatsappMessage(e.target.value)}
                rows={3}
                placeholder="Ex.: Olá! Vi que você se interessou pelo nosso consórcio, posso te ajudar com alguma dúvida?"
                className="field-input"
              />
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Enviada pelo número do WhatsApp do responsável pelo negócio/contato. Se ele não tiver conectado o
              WhatsApp em Configurações → Perfil, a automação não consegue enviar (fica registrado no log, não
              trava as outras ações).
            </p>
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Criando
                <LoadingDots />
              </span>
            ) : (
              "Criar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
