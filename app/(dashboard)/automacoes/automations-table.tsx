"use client";

import { requestJson } from "@/lib/client-request";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, Plus, Loader2, Trash2, Play, Pause, History, Pencil, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { DatePicker } from "@/components/date-picker";
import { Switch } from "@/components/switch";
import { VariableInput } from "@/components/variable-input";
import { RecipientPicker, type RecipientEntry } from "./recipient-picker";
import { X } from "lucide-react";
import { CUSTOM_FIELD_ENTITY_LABELS, type CustomFieldType, type CustomFieldEntity } from "@/lib/custom-fields";

type CustomFieldOption = { id: string; entityType: CustomFieldEntity; label: string; type: CustomFieldType; options: string[] };
type CustomFieldConditionOperator = "equals" | "not_equals" | "is_set" | "is_not_set";
type CustomFieldConditionDraft = { fieldId: string; operator: CustomFieldConditionOperator; value: string };

/** Triggers cuja entidade principal é um Deal/Contact estável — mesmo mapa de lib/automations/validation.ts (duplicado aqui pra não puxar código server-only pro bundle do client). */
const CUSTOM_FIELD_CONDITION_TRIGGERS: Partial<Record<Trigger, CustomFieldEntity>> = {
  DEAL_STALE: "DEAL",
  DEAL_CREATED: "DEAL",
  DEAL_WON: "DEAL",
  DEAL_LOST: "DEAL",
  DEAL_STAGE_ENTERED: "DEAL",
  DEAL_NO_OPEN_TASK: "DEAL",
  CONTACT_NO_DEAL: "CONTACT",
};

const OPERATOR_LABELS: Record<CustomFieldConditionOperator, string> = {
  equals: "Igual a",
  not_equals: "Diferente de",
  is_set: "Preenchido",
  is_not_set: "Vazio",
};

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
  | "TASK_DUE_SOON"
  | "MESSAGE_RECEIVED";
type MessageMatchType = "EXACT" | "CONTAINS" | "STARTS_WITH" | "ENDS_WITH";
type BusinessHoursMode = "ALWAYS" | "INSIDE_BUSINESS_HOURS" | "OUTSIDE_BUSINESS_HOURS";
type ContactContext = "ANY" | "NEW_LEAD" | "HAS_OPEN_DEAL";

const MESSAGE_MATCH_TYPE_LABELS: Record<MessageMatchType, string> = {
  EXACT: "É exatamente",
  CONTAINS: "Contém",
  STARTS_WITH: "Começa com",
  ENDS_WITH: "Termina com",
};
const BUSINESS_HOURS_MODE_LABELS: Record<BusinessHoursMode, string> = {
  ALWAYS: "Sempre",
  INSIDE_BUSINESS_HOURS: "Só no horário de atendimento",
  OUTSIDE_BUSINESS_HOURS: "Só fora do horário de atendimento",
};
const CONTACT_CONTEXT_LABELS: Record<ContactContext, string> = {
  ANY: "Qualquer contato",
  NEW_LEAD: "Só lead novo (nunca teve negócio)",
  HAS_OPEN_DEAL: "Só quem já tem negócio em aberto",
};
type Action = "CREATE_TASK" | "CREATE_DEAL" | "ADD_NOTE" | "MARK_LOST" | "SEND_PUSH" | "SEND_WHATSAPP" | "SEND_EMAIL" | "SET_CUSTOM_FIELD" | "SEND_SCRIPT";
type ActionDraft = { id: string; type: Action; config: Record<string, unknown> };

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type TargetType = "EVERYONE" | "SELF" | "USERS" | "TEAM";

type Rule = {
  id: string;
  name: string;
  trigger: Trigger;
  triggerConfig: Record<string, unknown> | null;
  action: Action;
  actionConfig: Record<string, unknown> | null;
  actions: Array<{ type: Action; config: Record<string, unknown> }> | null;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  /** Só vem preenchido pra quem enxerga regra de mais de uma pessoa (OWNER/MANAGER) — ver showCreatedBy. */
  createdByName?: string | null;
  targetType: TargetType;
  targetUserIds: string[];
  targetTeamId: string | null;
};

type StageOption = { id: string; name: string };
type PipelineOption = { id: string; name: string; stages: StageOption[] };
type LossReasonOption = { id: string; label: string };
type MemberOption = { id: string; name: string; role?: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER" };
type TeamOption = { id: string; name: string };
type WhatsappInstanceOption = { userId: string; label: string };
type ScriptOption = { id: string; name: string };

const TARGET_TYPE_LABELS: Record<TargetType, string> = {
  EVERYONE: "Todos",
  SELF: "Só eu",
  USERS: "Usuários específicos",
  TEAM: "Equipe",
};

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
  MESSAGE_RECEIVED: "Mensagem recebida (WhatsApp)",
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
  MESSAGE_RECEIVED: "Dispara em tempo real quando um lead manda uma mensagem de WhatsApp — com ou sem palavra-chave configurada (sem nenhuma, dispara em qualquer mensagem de texto). Suprime sozinho se um atendente já respondeu a conversa há pouco.",
};

const ACTION_LABELS: Record<Action, string> = {
  CREATE_TASK: "Criar tarefa",
  CREATE_DEAL: "Criar negócio",
  ADD_NOTE: "Registrar nota",
  MARK_LOST: "Marcar como perdido",
  SEND_PUSH: "Enviar notificação push",
  SEND_WHATSAPP: "Enviar mensagem de WhatsApp",
  SEND_EMAIL: "Enviar e-mail",
  SET_CUSTOM_FIELD: "Definir campo personalizado",
  SEND_SCRIPT: "Enviar script",
};

export function AutomationsTable({
  initialRules,
  canManage,
  showCreatedBy = false,
  canTargetOthers = false,
  pipelines,
  lossReasons,
  members,
  currentUserId,
  teams,
  whatsappInstances,
  customFields,
  scripts,
}: {
  initialRules: Rule[];
  canManage: boolean;
  /** OWNER/MANAGER vê regra de todo mundo misturada — mostra "por Fulano" pra não ficar ambíguo de quem é cada uma. */
  showCreatedBy?: boolean;
  /** Só OWNER/MANAGER escolhem o alvo (Todos/Eu/Usuários/Equipe) — Supervisor/Consultor sempre cria restrita a si mesmo. */
  canTargetOthers?: boolean;
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  members: MemberOption[];
  currentUserId: string;
  teams: TeamOption[];
  whatsappInstances: WhatsappInstanceOption[];
  customFields: CustomFieldOption[];
  scripts: ScriptOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<Rule | null>(null);
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());
  const [historyByRuleId, setHistoryByRuleId] = useState<Record<string, HistoryEntry[] | "loading" | "error">>({});
  const [detailEntry, setDetailEntry] = useState<{ entry: HistoryEntry; ruleName: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleHistory(rule: Rule) {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(rule.id)) {
        next.delete(rule.id);
      } else {
        next.add(rule.id);
      }
      return next;
    });

    if (rule.runCount === 0 || historyByRuleId[rule.id]) return;
    setHistoryByRuleId((prev) => ({ ...prev, [rule.id]: "loading" }));
    const res = await fetch(`/api/automations/${rule.id}/history`);
    if (!res.ok) {
      setHistoryByRuleId((prev) => ({ ...prev, [rule.id]: "error" }));
      return;
    }
    const entries = await res.json();
    setHistoryByRuleId((prev) => ({ ...prev, [rule.id]: entries }));
  }

  const stageById = new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, `${s.name} (${p.name})`])));
  const lossReasonById = new Map(lossReasons.map((r) => [r.id, r.label]));
  const memberById = new Map(members.map((m) => [m.id, m.name]));
  const teamById = new Map(teams.map((t) => [t.id, t.name]));
  const customFieldById = new Map(customFields.map((f) => [f.id, f]));
  const scriptById = new Map(scripts.map((s) => [s.id, s]));

  /** Resumo de "em quem age" pra mostrar na linha da regra — só chamado quando showCreatedBy (visão de OWNER/MANAGER). */
  function describeTarget(rule: Rule): string {
    if (rule.targetType === "EVERYONE") return "Todos";
    if (rule.targetType === "SELF") return rule.createdByName ? `Só ${rule.createdByName}` : "Só o criador";
    if (rule.targetType === "TEAM") return rule.targetTeamId ? (teamById.get(rule.targetTeamId) ?? "equipe removida") : "equipe removida";
    // USERS
    const names = rule.targetUserIds.map((id) => memberById.get(id) ?? "removido");
    return names.length > 0 ? names.join(", ") : "ninguém selecionado";
  }

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
    if (rule.trigger === "MESSAGE_RECEIVED") {
      const keywords = config.messageKeywords as string[] | undefined;
      const keywordPart = keywords?.length ? `"${keywords.join('", "')}"` : "qualquer mensagem";
      const instanceIds = config.messageInstanceUserIds as string[] | undefined;
      if (!instanceIds?.length) return keywordPart;
      const instanceNames = instanceIds.map((id) => memberById.get(id) ?? "número removido");
      return `${keywordPart} · só no WhatsApp de ${instanceNames.join(", ")}`;
    }
    return null;
  }

  function describeConditions(rule: Rule): string | null {
    const conditions = rule.triggerConfig?.customFieldConditions as CustomFieldConditionDraft[] | undefined;
    if (!conditions?.length) return null;
    return conditions
      .map((c) => {
        const def = customFieldById.get(c.fieldId);
        const fieldLabel = def?.label ?? "campo removido";
        if (c.operator === "is_set" || c.operator === "is_not_set") return `${fieldLabel} ${OPERATOR_LABELS[c.operator].toLowerCase()}`;
        return `${fieldLabel} ${OPERATOR_LABELS[c.operator].toLowerCase()} "${c.value}"`;
      })
      .join(" e ");
  }

  function describeAction(type: Action, config: Record<string, unknown>): string | null {
    if (type === "CREATE_DEAL") {
      const owner = memberById.get(config.dealOwnerId as string);
      const stage = stageById.get(config.dealStageId as string);
      return [owner, stage].filter(Boolean).join(" · ") || null;
    }
    if (type === "MARK_LOST") {
      const lossReasonId = config.lossReasonId as string | undefined;
      return lossReasonId ? (lossReasonById.get(lossReasonId) ?? "motivo removido") : null;
    }
    if (type === "SEND_PUSH") {
      return (config.pushTitle as string | undefined) || null;
    }
    if (type === "SEND_WHATSAPP") {
      const text = config.whatsappMessage as string | undefined;
      return text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : null;
    }
    if (type === "SEND_EMAIL") {
      return (config.emailSubject as string | undefined) || null;
    }
    if (type === "SET_CUSTOM_FIELD") {
      const fieldId = config.customFieldId as string | undefined;
      const def = fieldId ? customFieldById.get(fieldId) : undefined;
      const value = config.customFieldValue as string | undefined;
      return def ? `${def.label} = "${value}"` : null;
    }
    if (type === "SEND_SCRIPT") {
      const scriptId = config.scriptId as string | undefined;
      return scriptId ? (scriptById.get(scriptId)?.name ?? "script removido") : null;
    }
    return null;
  }

  function lowerFirst(s: string): string {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  /** Frase única resumindo gatilho + ação — o que a pessoa lê pra entender a regra sem abrir o modal. */
  function describeRule(rule: Rule): string {
    const triggerDetail = describeTrigger(rule);
    const conditionsDetail = describeConditions(rule);
    const triggerBits = [triggerDetail, conditionsDetail].filter(Boolean);
    const triggerPart = `${lowerFirst(TRIGGER_LABELS[rule.trigger])}${triggerBits.length ? ` (${triggerBits.join(" · ")})` : ""}`;
    const entries = rule.actions?.length ? rule.actions : [{ type: rule.action, config: rule.actionConfig ?? {} }];
    const actionPart = entries
      .map((entry) => {
        const detail = describeAction(entry.type, entry.config);
        return `${lowerFirst(ACTION_LABELS[entry.type])}${detail ? ` (${detail})` : ""}`;
      })
      .join(" + ");
    return `Quando ${triggerPart} → ${actionPart}.`;
  }

  async function toggleEnabled(rule: Rule) {
    setTogglingId(rule.id);
    try {
      const res = await requestJson(`/api/automations/${rule.id}`, {
        method: "PATCH",
        json: { enabled: !rule.enabled },
      });
      if (res.ok) router.refresh();
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteRule(id: string) {
    const res = await requestJson(`/api/automations/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
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
            description="Crie um gatilho e combine ações como criar um negócio, avisar o consultor e agendar uma tarefa."
          />
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {initialRules.map((rule) => {
            const isExpanded = expandedRuleIds.has(rule.id);
            const history = historyByRuleId[rule.id];
            return (
              <div key={rule.id} className="first:rounded-t-lg last:rounded-b-lg">
                <div className={`automation-row flex items-center gap-3 p-4 ${rule.enabled ? "" : "opacity-60"}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                    <Zap className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {rule.name}
                      {showCreatedBy && (
                        <span className="ml-1.5 font-normal text-neutral-400 dark:text-neutral-500">
                          · {rule.createdByName ?? "sem dono definido"}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {describeRule(rule)}
                      {showCreatedBy && ` · Alvo: ${describeTarget(rule)}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleHistory(rule)}
                    disabled={rule.runCount === 0}
                    aria-expanded={isExpanded}
                    className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
                    title="Ver histórico de execuções"
                  >
                    <History className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
                    <span className="hidden text-right sm:block">
                      <p className="text-sm tabular-nums text-neutral-600 dark:text-neutral-300">
                        {rule.runCount} execuç{rule.runCount === 1 ? "ão" : "ões"}
                      </p>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        {rule.lastRunAt ? `última ${new Date(rule.lastRunAt).toLocaleDateString("pt-BR")}` : "nunca rodou"}
                      </p>
                    </span>
                    {rule.runCount > 0 && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-200 ease-smooth dark:text-neutral-500 ${isExpanded ? "rotate-180" : ""
                          }`}
                        strokeWidth={2}
                      />
                    )}
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

                  {canManage && (
                    <button
                      onClick={() => {
                        setEditRule(rule);
                        setOpen(true);
                      }}
                      className="icon-btn-labeled shrink-0"
                      aria-label="Editar automação"
                      title="Editar automação"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      Editar
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

                {isExpanded && (
                  <div className="animate-pop-in border-t border-neutral-100 bg-neutral-50/60 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900/30">
                    {history === "loading" && (
                      <p className="py-2 text-sm text-neutral-500 dark:text-neutral-400">Carregando…</p>
                    )}
                    {history === "error" && (
                      <p className="py-2 text-sm text-red-600 dark:text-red-400">Não foi possível carregar o histórico.</p>
                    )}
                    {Array.isArray(history) && history.length === 0 && (
                      <p className="py-2 text-sm text-neutral-500 dark:text-neutral-400">Essa automação ainda não rodou.</p>
                    )}
                    {Array.isArray(history) && history.length > 0 && (
                      <div className="scrollbar-thin max-h-72 divide-y divide-neutral-100 overflow-y-auto pb-1 dark:divide-neutral-800/60">
                        {history.map((e) => (
                          <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                            {e.success ? (
                              <CheckCircle2
                                className="h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400"
                                strokeWidth={2}
                              />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" strokeWidth={2} />
                            )}
                            <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{e.label}</span>
                            <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                              {new Date(e.executedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                            </span>
                            <button
                              type="button"
                              onClick={() => setDetailEntry({ entry: e, ruleName: rule.name })}
                              className="shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-100"
                            >
                              Ver detalhes
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(history) && history.length >= 50 && (
                      <p className="pt-2 text-xs text-neutral-400 dark:text-neutral-500">
                        Mostrando as 50 execuções mais recentes.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <AutomationDialog
          pipelines={pipelines}
          lossReasons={lossReasons}
          members={members}
          currentUserId={currentUserId}
          teams={teams}
          canTargetOthers={canTargetOthers}
          whatsappInstances={whatsappInstances}
          customFields={customFields}
          scripts={scripts}
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

      {detailEntry && (
        <AutomationExecutionDetailModal
          entry={detailEntry.entry}
          ruleName={detailEntry.ruleName}
          onClose={() => setDetailEntry(null)}
        />
      )}
    </div>
  );
}

type HistoryEntry = {
  id: string;
  executedAt: string;
  label: string;
  href: string | null;
  success: boolean;
  detail: string | null;
};

function AutomationExecutionDetailModal({
  entry,
  ruleName,
  onClose,
}: {
  entry: HistoryEntry;
  ruleName: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} maxWidth="max-w-sm">
      <div className="mb-3 flex items-center gap-2">
        {entry.success ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500 dark:text-emerald-400" strokeWidth={2} />
        ) : (
          <XCircle className="h-5 w-5 shrink-0 text-red-500 dark:text-red-400" strokeWidth={2} />
        )}
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {entry.success ? "Executada com sucesso" : "Falha na execução"}
        </h2>
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <p className="field-label">Automação</p>
          <p className="text-neutral-800 dark:text-neutral-200">{ruleName}</p>
        </div>
        <div>
          <p className="field-label">Entidade</p>
          {entry.href ? (
            <Link href={entry.href} onClick={onClose} className="text-neutral-800 hover:underline dark:text-neutral-200">
              {entry.label}
            </Link>
          ) : (
            <p className="text-neutral-800 dark:text-neutral-200">{entry.label}</p>
          )}
        </div>
        <div>
          <p className="field-label">Quando</p>
          <p className="text-neutral-800 dark:text-neutral-200">
            {new Date(entry.executedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </p>
        </div>
        {entry.detail && (
          <div>
            <p className="field-label">O que aconteceu</p>
            <p className="whitespace-pre-line text-neutral-800 dark:text-neutral-200">{entry.detail}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="btn-primary">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

function AutomationDialog({
  pipelines,
  lossReasons,
  members,
  currentUserId,
  teams,
  canTargetOthers,
  whatsappInstances,
  customFields,
  scripts,
  editRule,
  onClose,
  onSaved,
}: {
  pipelines: PipelineOption[];
  lossReasons: LossReasonOption[];
  members: MemberOption[];
  currentUserId: string;
  teams: TeamOption[];
  /** Só OWNER/MANAGER escolhem em quem a automação age — Supervisor/Consultor sempre cria restrita a si mesmo, sem esse seletor. */
  canTargetOthers: boolean;
  whatsappInstances: WhatsappInstanceOption[];
  customFields: CustomFieldOption[];
  scripts: ScriptOption[];
  editRule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editRule;
  const tc = editRule?.triggerConfig ?? {};
  const savedActions = editRule?.actions?.length
    ? editRule.actions
    : [{ type: editRule?.action ?? "CREATE_TASK", config: editRule?.actionConfig ?? {} }];

  function defaultActionConfig(type: Action): Record<string, unknown> {
    if (type === "CREATE_TASK") return { dueInDays: 1 };
    if (type === "CREATE_DEAL") {
      return {
        dealPipelineId: pipelines[0]?.id ?? "",
        dealStageId: pipelines[0]?.stages[0]?.id ?? "",
        dealOwnerId: currentUserId,
        skipIfOpenDealExists: true,
      };
    }
    if (type === "MARK_LOST") return { lossReasonId: lossReasons[0]?.id ?? "" };
    if (type === "SEND_WHATSAPP") return { whatsappRecipients: [{ type: "CLIENT" }] };
    if (type === "SEND_SCRIPT") return { scriptId: scripts[0]?.id ?? "", scriptRecipients: [{ type: "CLIENT" }] };
    if (type === "SEND_EMAIL") return { emailRecipients: [{ type: "RESPONSIBLE" }] };
    return {};
  }

  const [name, setName] = useState(editRule?.name ?? "");
  const [targetType, setTargetType] = useState<TargetType>(
    editRule?.targetType ?? (canTargetOthers ? "EVERYONE" : "SELF"),
  );
  const [targetUserIds, setTargetUserIds] = useState<string[]>(editRule?.targetUserIds ?? []);
  const [targetTeamId, setTargetTeamId] = useState((editRule?.targetTeamId as string | null | undefined) ?? teams[0]?.id ?? "");
  const [trigger, setTrigger] = useState<Trigger>(editRule?.trigger ?? "DEAL_STALE");
  const [actions, setActions] = useState<ActionDraft[]>(
    savedActions.map((entry, index) => ({
      id: `${entry.type}-${index}`,
      type: entry.type,
      config: { ...defaultActionConfig(entry.type), ...entry.config },
    })),
  );
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
  const [messageMatchType, setMessageMatchType] = useState<MessageMatchType>(
    (tc.messageMatchType as MessageMatchType | undefined) ?? "CONTAINS",
  );
  const [messageKeywordsText, setMessageKeywordsText] = useState(
    ((tc.messageKeywords as string[] | undefined) ?? []).join(", "),
  );
  // Vazio = dispara pra mensagem recebida em QUALQUER número conectado da
  // organização (comportamento de sempre, mantido como padrão) — só
  // restringe de verdade quando pelo menos 1 for marcado.
  const [messageInstanceUserIds, setMessageInstanceUserIds] = useState<string[]>(
    (tc.messageInstanceUserIds as string[] | undefined) ?? [],
  );
  const [businessHoursMode, setBusinessHoursMode] = useState<BusinessHoursMode>(
    (tc.businessHoursMode as BusinessHoursMode | undefined) ?? "ALWAYS",
  );
  const [contactContext, setContactContext] = useState<ContactContext>(
    (tc.contactContext as ContactContext | undefined) ?? "ANY",
  );
  const [stopOnMatch, setStopOnMatch] = useState((tc.stopOnMatch as boolean | undefined) ?? false);
  const [ignoreIfHumanActive, setIgnoreIfHumanActive] = useState((tc.ignoreIfHumanActive as boolean | undefined) ?? true);
  const [customFieldConditions, setCustomFieldConditions] = useState<CustomFieldConditionDraft[]>(
    (tc.customFieldConditions as CustomFieldConditionDraft[] | undefined) ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noStages = pipelines.every((p) => p.stages.length === 0);
  const conditionEntityType = CUSTOM_FIELD_CONDITION_TRIGGERS[trigger];
  const conditionEligibleFields = customFields.filter((f) => f.entityType === conditionEntityType);
  // O recipient-picker mantém o tipo interno "ADMIN" (compatível com regras já
  // salvas), mas quem hoje ocupa esse papel na organização é o Gerente.
  const admins = members.filter((m) => m.role === "MANAGER");
  const owners = members.filter((m) => m.role === "OWNER");
  const memberById = new Map(members.map((m) => [m.id, m.name]));
  const assignableMembers = canTargetOthers ? members : members.filter((member) => member.id === currentUserId);

  function updateActionConfig(id: string, patch: Record<string, unknown>) {
    setActions((current) => current.map((item) => (item.id === id ? { ...item, config: { ...item.config, ...patch } } : item)));
  }

  function changeActionType(id: string, type: Action) {
    setActions((current) => current.map((item) => (item.id === id ? { ...item, type, config: defaultActionConfig(type) } : item)));
  }

  function moveAction(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    setActions((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addAction() {
    if (actions.length >= 8) return;
    const used = new Set(actions.map((item) => item.type));
    const preferred: Action[] = trigger === "CONTACT_NO_DEAL" || trigger === "MESSAGE_RECEIVED"
      ? ["CREATE_DEAL", "SEND_PUSH"]
      : ["SEND_PUSH", "CREATE_TASK"];
    const type = [...preferred, ...(Object.keys(ACTION_LABELS) as Action[])].find((candidate) => !used.has(candidate));
    if (!type) return;
    setActions((current) => [...current, { id: `action-${Date.now()}`, type, config: defaultActionConfig(type) }]);
  }

  function serializeAction(item: ActionDraft) {
    const config = item.config;
    if (item.type === "CREATE_TASK") {
      return { title: (config.title as string | undefined)?.trim() || undefined, dueInDays: Number(config.dueInDays) || 1 };
    }
    if (item.type === "CREATE_DEAL") {
      return {
        dealPipelineId: config.dealPipelineId,
        dealStageId: config.dealStageId,
        dealOwnerId: config.dealOwnerId,
        dealName: (config.dealName as string | undefined)?.trim() || undefined,
        skipIfOpenDealExists: config.skipIfOpenDealExists !== false,
      };
    }
    return config;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const triggerConfigBase =
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
                  : trigger === "MESSAGE_RECEIVED"
                    ? {
                      messageMatchType,
                      messageKeywords: messageKeywordsText
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                      messageInstanceUserIds,
                      businessHoursMode,
                      contactContext,
                      stopOnMatch,
                      ignoreIfHumanActive,
                    }
                    : {};

    const triggerConfig = conditionEntityType && customFieldConditions.length > 0
      ? { ...triggerConfigBase, customFieldConditions }
      : triggerConfigBase;

    const serializedActions = actions.map((item) => ({ type: item.type, config: serializeAction(item) }));

    const res = await fetch(isEdit ? `/api/automations/${editRule!.id}` : "/api/automations", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        trigger,
        triggerConfig,
        action: serializedActions[0]?.type,
        actionConfig: serializedActions[0]?.config,
        actions: serializedActions,
        // Só tem efeito se o servidor confirmar que quem está salvando é
        // OWNER/MANAGER (ver resolveTargetConfig em lib/automations/validation.ts)
        // — pra Supervisor/Consultor, o servidor ignora isso e força SELF de
        // qualquer forma, então mandar sempre é inofensivo mesmo sem canTargetOthers.
        targetType,
        targetUserIds: targetType === "USERS" ? targetUserIds : undefined,
        targetTeamId: targetType === "TEAM" ? targetTeamId || undefined : undefined,
      }),
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
    customFieldConditions.every((c) => !!c.fieldId && (c.operator === "is_set" || c.operator === "is_not_set" || !!c.value)) &&
    actions.length > 0 &&
    actions.every((item) => {
      const config = item.config;
      if (item.type === "CREATE_DEAL") {
        return (
          (trigger === "CONTACT_NO_DEAL" || trigger === "MESSAGE_RECEIVED") &&
          !!config.dealPipelineId &&
          !!config.dealStageId &&
          !!config.dealOwnerId
        );
      }
      if (item.type === "MARK_LOST") return !!config.lossReasonId;
      if (item.type === "SEND_WHATSAPP") {
        return !!(config.whatsappMessage as string | undefined)?.trim() && !!(config.whatsappRecipients as unknown[] | undefined)?.length;
      }
      if (item.type === "SEND_EMAIL") {
        return !!(config.emailBody as string | undefined)?.trim() && !!(config.emailRecipients as unknown[] | undefined)?.length;
      }
      if (item.type === "SEND_SCRIPT") return !!config.scriptId && !!(config.scriptRecipients as unknown[] | undefined)?.length;
      if (item.type === "SET_CUSTOM_FIELD") return !!config.customFieldId && config.customFieldValue !== undefined && config.customFieldValue !== "";
      return true;
    }) &&
    (targetType !== "USERS" || targetUserIds.length > 0) &&
    (targetType !== "TEAM" || !!targetTeamId);

  function renderActionFields(item: ActionDraft) {
    const config = item.config;
    const setConfig = (patch: Record<string, unknown>) => updateActionConfig(item.id, patch);

    if (item.type === "CREATE_TASK") {
      return (
        <>
          <div className="space-y-1">
            <label className="field-label">Título da tarefa</label>
            <input
              value={(config.title as string | undefined) ?? ""}
              onChange={(event) => setConfig({ title: event.target.value })}
              placeholder={`Automação: ${name || "..."}`}
              className="field-input"
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Prazo em dias</label>
            <input
              type="number"
              min={0}
              value={String(config.dueInDays ?? 1)}
              onChange={(event) => setConfig({ dueInDays: event.target.value })}
              className="field-input"
            />
          </div>
        </>
      );
    }

    if (item.type === "CREATE_DEAL") {
      const pipelineId = (config.dealPipelineId as string | undefined) ?? "";
      const selectedPipeline = pipelines.find((pipeline) => pipeline.id === pipelineId);
      const compatible = trigger === "CONTACT_NO_DEAL" || trigger === "MESSAGE_RECEIVED";
      return (
        <>
          {!compatible && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2 dark:bg-amber-950/30 dark:text-amber-300">
              Use esta ação com “Contato sem negócio” ou “Mensagem recebida”.
            </p>
          )}
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={(config.dealOwnerId as string | undefined) ?? ""}
              onChange={(value) => setConfig({ dealOwnerId: value })}
              options={assignableMembers.map((member) => ({ value: member.id, label: member.name }))}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Funil</label>
            <Select
              value={pipelineId}
              onChange={(value) => {
                const pipeline = pipelines.find((candidate) => candidate.id === value);
                setConfig({ dealPipelineId: value, dealStageId: pipeline?.stages[0]?.id ?? "" });
              }}
              options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Etapa</label>
            <Select
              value={(config.dealStageId as string | undefined) ?? ""}
              onChange={(value) => setConfig({ dealStageId: value })}
              options={(selectedPipeline?.stages ?? []).map((stage) => ({ value: stage.id, label: stage.name }))}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Nome do negócio</label>
            <VariableInput
              value={(config.dealName as string | undefined) ?? ""}
              onChange={(value) => setConfig({ dealName: value })}
              placeholder="Gerado automaticamente"
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Evitar negócio duplicado</span>
            <Switch
              checked={config.skipIfOpenDealExists !== false}
              onChange={(value) => setConfig({ skipIfOpenDealExists: value })}
              label="Evitar negócio duplicado"
            />
          </div>
        </>
      );
    }

    if (item.type === "ADD_NOTE") {
      return (
        <div className="space-y-1 sm:col-span-2">
          <label className="field-label">Texto da nota</label>
          <textarea
            value={(config.note as string | undefined) ?? ""}
            onChange={(event) => setConfig({ note: event.target.value })}
            rows={2}
            className="field-input"
          />
        </div>
      );
    }

    if (item.type === "MARK_LOST") {
      return (
        <div className="space-y-1">
          <label className="field-label">Motivo de perda</label>
          {lossReasons.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Cadastre um motivo de perda em Configurações.</p>
          ) : (
            <Select
              value={(config.lossReasonId as string | undefined) ?? ""}
              onChange={(value) => setConfig({ lossReasonId: value })}
              options={lossReasons.map((reason) => ({ value: reason.id, label: reason.label }))}
            />
          )}
        </div>
      );
    }

    if (item.type === "SEND_PUSH") {
      return (
        <>
          <div className="space-y-1">
            <label className="field-label">Título</label>
            <input
              value={(config.pushTitle as string | undefined) ?? ""}
              onChange={(event) => setConfig({ pushTitle: event.target.value })}
              placeholder={`Automação: ${name || "..."}`}
              className="field-input"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="field-label">Texto</label>
            <textarea
              value={(config.pushBody as string | undefined) ?? ""}
              onChange={(event) => setConfig({ pushBody: event.target.value })}
              rows={2}
              className="field-input"
            />
          </div>
        </>
      );
    }

    if (item.type === "SEND_WHATSAPP") {
      return (
        <>
          <div className="space-y-1 sm:col-span-2">
            <label className="field-label">Mensagem</label>
            <VariableInput
              value={(config.whatsappMessage as string | undefined) ?? ""}
              onChange={(value) => setConfig({ whatsappMessage: value })}
              multiline
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Enviar de</label>
            <Select
              value={(config.whatsappSenderId as string | undefined) ?? ""}
              onChange={(value) => setConfig({ whatsappSenderId: value || undefined })}
              options={[
                { value: "", label: "Responsável pelo negócio" },
                ...whatsappInstances.map((instance) => ({ value: instance.userId, label: instance.label })),
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            <RecipientPicker
              recipients={(config.whatsappRecipients as RecipientEntry[] | undefined) ?? []}
              onChange={(value) => setConfig({ whatsappRecipients: value })}
              availableTypes={["CLIENT", "SUPERVISOR", "ADMIN", "OWNER", "CUSTOM"]}
              admins={admins}
              owners={owners}
              memberById={memberById}
              customLabel="Número personalizado"
              customPlaceholder="Ex.: 67991234567"
            />
          </div>
        </>
      );
    }

    if (item.type === "SEND_SCRIPT") {
      return (
        <>
          <div className="space-y-1 sm:col-span-2">
            <label className="field-label">Script</label>
            {scripts.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Crie um script no WhatsApp antes de usar esta ação.</p>
            ) : (
              <Select
                value={(config.scriptId as string | undefined) ?? ""}
                onChange={(value) => setConfig({ scriptId: value })}
                options={scripts.map((script) => ({ value: script.id, label: script.name }))}
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="field-label">Enviar de</label>
            <Select
              value={(config.scriptSenderId as string | undefined) ?? ""}
              onChange={(value) => setConfig({ scriptSenderId: value || undefined })}
              options={[
                { value: "", label: "Responsável pelo negócio" },
                ...whatsappInstances.map((instance) => ({ value: instance.userId, label: instance.label })),
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            <RecipientPicker
              recipients={(config.scriptRecipients as RecipientEntry[] | undefined) ?? []}
              onChange={(value) => setConfig({ scriptRecipients: value })}
              availableTypes={["CLIENT", "SUPERVISOR", "ADMIN", "OWNER", "CUSTOM"]}
              admins={admins}
              owners={owners}
              memberById={memberById}
              customLabel="Número personalizado"
              customPlaceholder="Ex.: 67991234567"
            />
          </div>
        </>
      );
    }

    if (item.type === "SEND_EMAIL") {
      return (
        <>
          <div className="space-y-1">
            <label className="field-label">Assunto</label>
            <VariableInput
              value={(config.emailSubject as string | undefined) ?? ""}
              onChange={(value) => setConfig({ emailSubject: value })}
              placeholder={`Automação: ${name || "..."}`}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="field-label">Texto</label>
            <VariableInput
              value={(config.emailBody as string | undefined) ?? ""}
              onChange={(value) => setConfig({ emailBody: value })}
              multiline
              rows={3}
            />
          </div>
          <div className="sm:col-span-2">
            <RecipientPicker
              recipients={(config.emailRecipients as RecipientEntry[] | undefined) ?? []}
              onChange={(value) => setConfig({ emailRecipients: value })}
              availableTypes={["CLIENT", "RESPONSIBLE", "SUPERVISOR", "ADMIN", "OWNER", "CUSTOM"]}
              admins={admins}
              owners={owners}
              memberById={memberById}
              customLabel="E-mail personalizado"
              customPlaceholder="Ex.: alguem@empresa.com"
            />
          </div>
        </>
      );
    }

    const fieldId = (config.customFieldId as string | undefined) ?? "";
    const field = customFields.find((candidate) => candidate.id === fieldId);
    return (
      <>
        <div className="space-y-1">
          <label className="field-label">Campo</label>
          <Select
            value={fieldId}
            onChange={(value) => setConfig({ customFieldId: value, customFieldValue: "" })}
            options={customFields.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.label} (${CUSTOM_FIELD_ENTITY_LABELS[candidate.entityType]})`,
            }))}
          />
        </div>
        {field && (
          <div className="space-y-1">
            <label className="field-label">Valor</label>
            <TypedValueInput
              type={field.type}
              options={field.options}
              value={(config.customFieldValue as string | undefined) ?? ""}
              onChange={(value) => setConfig({ customFieldValue: value })}
            />
          </div>
        )}
      </>
    );
  }

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

        {canTargetOthers && (
          <div className="space-y-1 sm:col-span-2">
            <label className="field-label">Em quem age</label>
            <Select
              value={targetType}
              onChange={(v) => setTargetType(v as TargetType)}
              options={(Object.entries(TARGET_TYPE_LABELS) as [TargetType, string][]).map(([value, label]) => ({ value, label }))}
            />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              O gatilho continua olhando a organização inteira isso só filtra pelo <strong>responsável</strong> (dono do negócio do contato,{" "}
              {trigger === "MESSAGE_RECEIVED"
                ? "não quem tem o WhatsApp conectado — uma mensagem recebida num número central só conta pra \"Só eu\"/\"Usuários\" se o contato tiver negócio seu"
                : "não necessariamente quem criou/mexeu por último"}
              ). Sem negócio vinculado, cai no dono da instância.
            </p>
            {targetType === "USERS" && (
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
                {members.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={targetUserIds.includes(m.id)}
                      onChange={() =>
                        setTargetUserIds((prev) => (prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id]))
                      }
                      className="accent-neutral-900 dark:accent-white"
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            )}
            {targetType === "TEAM" && (
              <div className="mt-1">
                <Select
                  value={targetTeamId}
                  onChange={setTargetTeamId}
                  placeholder="Selecione a equipe"
                  options={teams.map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
            )}
          </div>
        )}

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

        {trigger === "MESSAGE_RECEIVED" && (
          <>
            <div className="space-y-1">
              <label className="field-label">Palavras-chave (vazio = qualquer mensagem)</label>
              <input
                value={messageKeywordsText}
                onChange={(e) => setMessageKeywordsText(e.target.value)}
                placeholder="Ex.: preço, valor, quanto custa"
                className="field-input"
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Separe várias por vírgula — qualquer uma delas dispara.</p>
            </div>
            <div className="space-y-1">
              <label className="field-label">Número(s) de WhatsApp (vazio = qualquer um conectado)</label>
              {whatsappInstances.length === 0 ? (
                <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum WhatsApp conectado na organização ainda.</p>
              ) : (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
                  {whatsappInstances.map((inst) => (
                    <label
                      key={inst.userId}
                      className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                    >
                      <input
                        type="checkbox"
                        checked={messageInstanceUserIds.includes(inst.userId)}
                        onChange={() =>
                          setMessageInstanceUserIds((prev) =>
                            prev.includes(inst.userId) ? prev.filter((id) => id !== inst.userId) : [...prev, inst.userId],
                          )
                        }
                        className="accent-neutral-900 dark:accent-white"
                      />
                      {inst.label}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Marque só se essa regra deve valer pra mensagem chegando num número específico (ex.: só o número dos anúncios) — sem marcar nenhum, vale pra qualquer número.
              </p>
            </div>
            <div className="space-y-1">
              <label className="field-label">Tipo de correspondência</label>
              <Select
                value={messageMatchType}
                onChange={(v) => setMessageMatchType(v as MessageMatchType)}
                options={Object.entries(MESSAGE_MATCH_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Horário de atendimento</label>
              <Select
                value={businessHoursMode}
                onChange={(v) => setBusinessHoursMode(v as BusinessHoursMode)}
                options={Object.entries(BUSINESS_HOURS_MODE_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Janela configurada em Configurações → Horário de atendimento.
              </p>
            </div>
            <div className="space-y-1">
              <label className="field-label">Contexto do contato</label>
              <Select
                value={contactContext}
                onChange={(v) => setContactContext(v as ContactContext)}
                options={Object.entries(CONTACT_CONTEXT_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
              <div>
                <p className="text-sm text-neutral-800 dark:text-neutral-200">Parar outras regras se esta disparar</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Útil quando duas palavras-chave se sobrepõem (ex.: &ldquo;comprar&rdquo; e &ldquo;comprar casa&rdquo;).</p>
              </div>
              <Switch checked={stopOnMatch} onChange={setStopOnMatch} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
              <div>
                <p className="text-sm text-neutral-800 dark:text-neutral-200">Pausar se um atendente já respondeu</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Não dispara se alguém do time mandou mensagem na conversa nos últimos 20 minutos.</p>
              </div>
              <Switch checked={ignoreIfHumanActive} onChange={setIgnoreIfHumanActive} />
            </div>
          </>
        )}

        {conditionEntityType && (
          <div className="space-y-2 sm:col-span-2">
            <label className="field-label">Condições adicionais (opcional)</label>
            {conditionEligibleFields.length === 0 ? (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Nenhum campo personalizado de {CUSTOM_FIELD_ENTITY_LABELS[conditionEntityType]} cadastrado ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {customFieldConditions.map((condition, i) => {
                  const def = conditionEligibleFields.find((f) => f.id === condition.fieldId);
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
                    >
                      <Select
                        value={condition.fieldId}
                        onChange={(v) =>
                          setCustomFieldConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, fieldId: v, value: "" } : c)))
                        }
                        options={conditionEligibleFields.map((f) => ({ value: f.id, label: f.label }))}
                        className="w-40 py-1.5 text-sm"
                      />
                      <Select
                        value={condition.operator}
                        onChange={(v) =>
                          setCustomFieldConditions((prev) =>
                            prev.map((c, idx) => (idx === i ? { ...c, operator: v as CustomFieldConditionOperator } : c)),
                          )
                        }
                        options={Object.entries(OPERATOR_LABELS).map(([value, label]) => ({ value, label }))}
                        className="w-32 py-1.5 text-sm"
                      />
                      {(condition.operator === "equals" || condition.operator === "not_equals") && def && (
                        <TypedValueInput
                          type={def.type}
                          options={def.options}
                          value={condition.value}
                          onChange={(v) => setCustomFieldConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, value: v } : c)))}
                          className="w-32 py-1.5 text-sm"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setCustomFieldConditions((prev) => prev.filter((_, idx) => idx !== i))}
                        className="icon-btn h-6 w-6 shrink-0"
                        aria-label="Remover condição"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() =>
                    setCustomFieldConditions((prev) => [
                      ...prev,
                      { fieldId: conditionEligibleFields[0]?.id ?? "", operator: "equals", value: "" },
                    ])
                  }
                  className="btn-ghost btn-sm"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Adicionar condição
                </button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1 sm:col-span-2">
          <div className="h-px bg-neutral-100 dark:bg-neutral-800" />
        </div>

        <div className="space-y-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <label className="field-label">Ações</label>
            <span className="text-xs text-neutral-400">Executadas de cima para baixo</span>
          </div>

          {actions.map((item, index) => {
            const selectedElsewhere = new Set(actions.filter((candidate) => candidate.id !== item.id).map((candidate) => candidate.type));
            return (
              <section key={item.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700 sm:p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Select
                      value={item.type}
                      onChange={(value) => changeActionType(item.id, value as Action)}
                      options={(Object.entries(ACTION_LABELS) as Array<[Action, string]>)
                        .filter(([value]) => !selectedElsewhere.has(value))
                        .map(([value, label]) => ({ value, label }))}
                    />
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => moveAction(index, -1)}
                      disabled={index === 0}
                      className="icon-btn h-8 w-8 disabled:opacity-25"
                      aria-label="Mover ação para cima"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAction(index, 1)}
                      disabled={index === actions.length - 1}
                      className="icon-btn h-8 w-8 disabled:opacity-25"
                      aria-label="Mover ação para baixo"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActions((current) => current.filter((candidate) => candidate.id !== item.id))}
                      disabled={actions.length === 1}
                      className="icon-btn h-8 w-8 text-red-500 disabled:opacity-25"
                      aria-label="Remover ação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{renderActionFields(item)}</div>
              </section>
            );
          })}

          <button
            type="button"
            onClick={addAction}
            disabled={actions.length >= 8 || actions.length >= Object.keys(ACTION_LABELS).length}
            className="btn-ghost btn-sm"
          >
            <Plus className="h-4 w-4" />
            Adicionar ação
          </button>
        </div>

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

/** Input do valor de uma condição/ação de campo personalizado — muda de tipo conforme o campo escolhido. */
function TypedValueInput({
  type,
  options,
  value,
  onChange,
  className = "",
}: {
  type: CustomFieldType;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  if (type === "BOOLEAN") {
    return (
      <Select
        value={value}
        onChange={onChange}
        options={[
          { value: "true", label: "Sim" },
          { value: "false", label: "Não" },
        ]}
        className={className}
      />
    );
  }
  if (type === "SELECT") {
    return <Select value={value} onChange={onChange} options={options.map((o) => ({ value: o, label: o }))} className={className} />;
  }
  if (type === "DATE") {
    return <DatePicker value={value} onChange={onChange} className={className} />;
  }
  return (
    <input
      type={type === "NUMBER" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`field-input ${className}`}
    />
  );
}
