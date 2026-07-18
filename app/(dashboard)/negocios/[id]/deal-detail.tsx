"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, StickyNote, CircleDot, CheckCircle2, XCircle, Clock, Loader2, Pencil, Check, X } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { ACTIVITY_TABS, ACTIVITY_ICON, ACTIVITY_BODY_TEMPLATES } from "@/lib/activity-icons";
import { Avatar } from "@/components/avatar";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { CurrencyInput } from "@/components/currency-input";
import { DatePicker } from "@/components/date-picker";
import { TimePicker } from "@/components/time-picker";
import { WhatsAppPanel, WhatsAppPanelTrigger, ChatWindow } from "@/components/whatsapp-chat";
import { ConfettiBurst } from "@/components/confetti-burst";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { stringifyCustomFieldValue, type CustomFieldValue } from "@/lib/custom-fields";

type Stage = { id: string; name: string; order: number; color: string | null };

type Activity = {
  id: string;
  type: string;
  body: string | null;
  createdAt: string | Date;
  user: { name: string; photoUrl: string | null };
};

type DealTask = {
  id: string;
  title: string;
  dueAt: string | Date | null;
  completedAt: string | Date | null;
};

type Deal = {
  id: string;
  name: string;
  status: "OPEN" | "WON" | "LOST";
  value: number | null;
  description: string | null;
  creditType: string | null;
  startedAt: string | Date;
  closedAt: string | Date | null;
  expectedCloseAt: string | Date | null;
  stageId: string;
  stageEnteredAt: string | Date;
  contact: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; jobTitle: string | null };
  owner: { id: string; name: string; photoUrl: string | null };
  stage: Stage;
  pipeline: { stages: Stage[] };
  activities: Activity[];
  tasks: DealTask[];
  lossReasonId: string | null;
  lossReason: { id: string; label: string } | null;
  lostReason: string | null;
  customFieldValues: CustomFieldFormValues | null;
};

type MemberOption = { id: string; name: string };
type LossReasonOption = { id: string; label: string };

/**
 * Log automático (mudança de etapa, ganho/perdido, valor) — uma linha
 * minúscula sem cartão nem avatar, pra não competir visualmente com as
 * atividades manuais (nota, ligação etc.), que são o conteúdo principal.
 */
function ActivityItem({ activity, highlighted }: { activity: Activity; highlighted: boolean }) {
  if (activity.type === "SYSTEM") {
    return (
      <p
        id={`activity-${activity.id}`}
        className={`px-1 py-0.5 text-[11px] text-neutral-400 dark:text-neutral-500 ${highlighted ? "animate-highlight-once" : ""}`}
      >
        {activity.user.name} {activity.body}
        <span className="text-neutral-300 dark:text-neutral-600"> · {new Date(activity.createdAt).toLocaleString("pt-BR")}</span>
      </p>
    );
  }

  const Icon = ACTIVITY_ICON[activity.type] ?? StickyNote;
  return (
    <div
      id={`activity-${activity.id}`}
      className={`card flex gap-3 p-3 text-sm ${highlighted ? "animate-highlight-once" : ""}`}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
        <Icon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        {activity.body && <p className="text-neutral-700 dark:text-neutral-300">{activity.body}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          <Avatar name={activity.user.name} src={activity.user.photoUrl} size="xs" />
          {activity.user.name} · {new Date(activity.createdAt).toLocaleString("pt-BR")}
        </p>
      </div>
    </div>
  );
}

export function DealDetail({
  deal,
  members,
  lossReasons,
  customFields,
  creditTypes,
  jobTitles,
  currentUserName,
  currentUserPhotoUrl,
  hasUnreadWhatsApp,
  whatsappThreadId,
  canEditDetails,
}: {
  deal: Deal;
  members: MemberOption[];
  lossReasons: LossReasonOption[];
  customFields: CustomFieldDefinitionInput[];
  creditTypes: { id: string; label: string }[];
  jobTitles: { id: string; label: string }[];
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
  hasUnreadWhatsApp?: boolean;
  /** null quando o contato não tem WhatsApp/celular cadastrado — não dá pra conversar. */
  whatsappThreadId: string | null;
  /** Só o dono do negócio ou um OWNER da conta pode editar os campos com lápis. */
  canEditDetails: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("NOTE");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [movingStage, setMovingStage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [lossDialogOpen, setLossDialogOpen] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"activities" | "details">("activities");
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    const taskId = searchParams.get("highlightTask");
    const activityId = searchParams.get("highlightActivity");
    if (!taskId && !activityId) return;
    // No mobile a tarefa mora na aba "Detalhes" — troca antes de procurar o
    // elemento, senão ele nem existe no DOM ainda (a outra aba não é montada).
    if (taskId) setMobileTab("details");

    // Espera o próximo tick pra garantir que a troca de aba acima (se houve)
    // já renderizou antes de procurar o elemento. Desktop e mobile também
    // renderizam a mesma tarefa/atividade em blocos diferentes (um deles
    // sempre `display:none`) — busca todas as ocorrências do id e pega a
    // que estiver realmente visível na tela.
    const timeout1 = setTimeout(() => {
      const matches = document.querySelectorAll(`[id="${taskId ? `task-${taskId}` : `activity-${activityId}`}"]`);
      const el = Array.from(matches).find((node) => (node as HTMLElement).offsetParent !== null) as
        | HTMLElement
        | undefined;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (taskId) setHighlightedTaskId(taskId);
      if (activityId) setHighlightedActivityId(activityId);
    }, 50);
    router.replace(`/negocios/${deal.id}`);
    const timeout2 = setTimeout(() => {
      setHighlightedTaskId(null);
      setHighlightedActivityId(null);
    }, 1450);
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateStatus(status: "OPEN" | "WON" | "LOST") {
    if (status === "LOST") {
      setLossDialogOpen(true);
      return;
    }
    const wasWon = deal.status === "WON";
    await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (status === "WON" && !wasWon) setShowConfetti(true);
    router.refresh();
  }

  async function confirmLoss(lossReasonId: string, note: string) {
    await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "LOST", lossReasonId, lostReason: note || undefined }),
    });
    setLossDialogOpen(false);
    router.refresh();
  }

  async function reassignOwner(ownerId: string) {
    await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId }),
    });
    router.refresh();
  }

  async function updateCreditType(creditType: string) {
    await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditType: creditType || null }),
    });
    router.refresh();
  }

  async function saveDealField(
    field: "description" | "expectedCloseAt",
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    return { ok: true };
  }

  // A rota de contato reescreve nome/e-mail/celular/whatsapp juntos a cada
  // PUT (não é um PATCH parcial) — manda sempre os quatro, só trocando o
  // campo editado, senão os que ficarem de fora são apagados sem querer.
  async function saveContactField(
    field: "name" | "email" | "phone" | "whatsapp" | "jobTitle",
    value: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/contacts/${deal.contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: deal.contact.name,
        email: deal.contact.email ?? "",
        phone: deal.contact.phone ?? "",
        whatsapp: deal.contact.whatsapp ?? "",
        [field]: value,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    return { ok: true };
  }

  // Mesma ideia de "sempre incluir o valor atual" usada no Select de Cargo
  // do EditContactDialog — se o cargo já salvo não bate com nenhum item da
  // lista (cadastro antigo, cargo renomeado/excluído depois), ele aparece
  // como opção extra marcada "(antigo)" em vez de sumir da tela.
  const jobTitleOptions = jobTitles.some((j) => j.label === deal.contact.jobTitle)
    ? jobTitles.map((j) => ({ value: j.label, label: j.label }))
    : deal.contact.jobTitle
      ? [{ value: deal.contact.jobTitle, label: `${deal.contact.jobTitle} (antigo)` }, ...jobTitles.map((j) => ({ value: j.label, label: j.label }))]
      : jobTitles.map((j) => ({ value: j.label, label: j.label }));

  async function saveDealValue(value: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value ? Number(value) : null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    return { ok: true };
  }

  async function saveTask(
    taskId: string,
    fields: { title: string; dueAt: string | null },
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    return { ok: true };
  }

  async function moveToStage(stageId: string) {
    if (stageId === deal.stageId) return;
    setMovingStage(stageId);
    setMoveError(null);
    const res = await fetch(`/api/deals/${deal.id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId }),
    });
    setMovingStage(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMoveError(data.error ?? "Não foi possível mover o negócio");
      return;
    }
    router.refresh();
  }

  async function toggleTask(taskId: string, completed: boolean) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    router.refresh();
  }

  function selectTab(type: string) {
    setActiveTab(type);
    const template = ACTIVITY_BODY_TEMPLATES[type];
    const isUntouched = !body.trim() || Object.values(ACTIVITY_BODY_TEMPLATES).includes(body);
    if (isUntouched) setBody(template ?? "");
  }

  useEffect(() => {
    const el = tabRefs.current[activeTab];
    if (el) setTabIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab]);

  async function submitActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);

    await fetch(`/api/deals/${deal.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: activeTab, activityBody: body }),
    });

    if (dueDate) {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: body,
          type: activeTab,
          dueAt: `${dueDate}T${dueTime || "00:00"}`,
          dealId: deal.id,
          contactId: deal.contact.id,
        }),
      });
    }

    setBody("");
    setDueDate("");
    setDueTime("");
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex items-start gap-4">
      {showConfetti && <ConfettiBurst onDone={() => setShowConfetti(false)} />}
      <div className="min-w-0 flex-1 space-y-6">
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Pipeline
      </Link>

      <div className="flex flex-col items-start justify-between gap-3 lg:flex-row">
        <div className="flex items-start gap-3">
          <Avatar name={deal.contact.name} size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{deal.name}</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              <Link
                href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
                className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline"
              >
                {deal.contact.name}
              </Link>
              {" · "}Responsável: {deal.owner.name}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { s: "LOST" as const, icon: XCircle },
              { s: "OPEN" as const, icon: CircleDot },
              { s: "WON" as const, icon: CheckCircle2 },
            ]
          ).map(({ s, icon: Icon }) => (
            <button
              key={s}
              onClick={() => updateStatus(s)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                deal.status === s
                  ? s === "WON"
                    ? "bg-emerald-600 text-white"
                    : s === "LOST"
                      ? "bg-red-600 text-white"
                      : "bg-neutral-800 text-white"
                  : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {s === "OPEN" ? "Em andamento" : s === "WON" ? "Ganho" : "Perdido"}
            </button>
          ))}
          {/* Sem isso, "Ganho"/"Perdido" não diz QUANDO — só pelo status dá pra
              confundir "ontem à noite" com "hoje", principalmente pouco depois
              da meia-noite. */}
          {deal.status !== "OPEN" && deal.closedAt && (
            <p className="w-full text-right text-xs text-neutral-400 dark:text-neutral-500">
              {deal.status === "WON" ? "Ganho" : "Perdido"} em{" "}
              {new Date(deal.closedAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>

      <div className="card scrollbar-thin flex items-center gap-1 overflow-x-auto p-2">
        {deal.pipeline.stages.map((stage) => {
          const isCurrent = stage.id === deal.stageId;
          return (
            <button
              key={stage.id}
              disabled={movingStage !== null}
              onClick={() => moveToStage(stage.id)}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
                isCurrent
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color ?? "#999" }} />
              {stage.name}
              {isCurrent && (
                <span
                  className={`inline-flex items-center gap-1 ${
                    isStale(deal.stageEnteredAt) ? "font-medium text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"
                  }`}
                >
                  <Clock className="h-3 w-3" strokeWidth={2} />
                  {daysSince(deal.stageEnteredAt)}d
                </span>
              )}
            </button>
          );
        })}
      </div>

      {moveError && <p className="text-xs text-red-600 dark:text-red-400">{moveError}</p>}

      {/* Desktop — inalterado, só passou a ficar atrás de lg: */}
      <div className="hidden lg:grid lg:grid-cols-3 lg:gap-6">
        <div className="col-span-2 space-y-4">
          <div className="card p-4">
            <div className="relative mb-3 flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800">
              {ACTIVITY_TABS.map((tab) => (
                <button
                  key={tab.type}
                  ref={(el) => {
                    tabRefs.current[tab.type] = el;
                  }}
                  onClick={() => selectTab(tab.type)}
                  className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === tab.type
                      ? "text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {tab.label}
                </button>
              ))}
              <span
                className="absolute bottom-0 h-0.5 rounded-full bg-neutral-900 transition-all duration-300 ease-out dark:bg-white"
                style={{ left: tabIndicator.left, width: tabIndicator.width }}
              />
            </div>
            <form onSubmit={submitActivity} className="space-y-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="O que foi feito e qual o próximo passo?"
                rows={3}
                className="field-input"
              />
              <div className="flex items-end justify-between gap-3">
                <div className="flex gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400">Prazo</label>
                    <DatePicker value={dueDate} onChange={setDueDate} className="px-2 py-1 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400">Horário</label>
                    <TimePicker value={dueTime} onChange={setDueTime} disabled={!dueDate} className="px-2 py-1 text-xs" />
                  </div>
                </div>
                <button type="submit" disabled={saving || !body.trim()} className="btn-primary btn-sm shrink-0">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
                  {saving ? (
                    <span className="inline-flex items-center gap-1">
                      Salvando
                      <LoadingDots />
                    </span>
                  ) : (
                    "Registrar"
                  )}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-2">
            {deal.activities.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma atividade registrada.</p>
            )}
            {deal.activities.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                highlighted={highlightedActivityId === activity.id}
              />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <DealValueCard value={deal.value} editable={canEditDetails} onSave={saveDealValue} />

          {!chatOpen && whatsappThreadId && (
            <WhatsAppPanelTrigger onOpen={() => setChatOpen(true)} hasUnread={hasUnreadWhatsApp} />
          )}

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Tarefas</h3>
            <div className="space-y-1.5">
              {deal.tasks.length === 0 && (
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Nenhuma tarefa. Defina um prazo ao registrar uma atividade para criar uma.
                </p>
              )}
              {deal.tasks.map((task) => (
                <div
                  key={task.id}
                  id={`task-${task.id}`}
                  className={`group -mx-1.5 flex items-start gap-1 rounded-md px-1.5 py-0.5 text-xs ${
                    highlightedTaskId === task.id ? "animate-highlight-once" : ""
                  }`}
                >
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!!task.completedAt}
                      onChange={(e) => toggleTask(task.id, e.target.checked)}
                      className="mt-0.5 accent-neutral-900 dark:accent-white"
                    />
                    <span className={task.completedAt ? "text-neutral-400 dark:text-neutral-500 line-through" : "text-neutral-700 dark:text-neutral-300"}>
                      {task.title}
                      {task.dueAt && (
                        <span className="ml-1 text-neutral-400 dark:text-neutral-500">
                          · {new Date(task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </span>
                  </label>
                  {canEditDetails && (
                    <button
                      type="button"
                      onClick={() => setEditingTask(task)}
                      className="icon-btn h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100"
                      aria-label="Editar tarefa"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={2} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do negócio</h3>
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">Responsável</span>
              <span className="flex items-center gap-1.5">
                <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                <Select
                  value={deal.owner.id}
                  onChange={reassignOwner}
                  className="py-1 text-xs"
                  options={members.map((m) => ({ value: m.id, label: m.name }))}
                />
              </span>
            </div>
            <Row label="Início" value={new Date(deal.startedAt).toLocaleDateString("pt-BR")} />
            <EditableRow
              label="Conclusão prevista"
              value={toDateInputValue(deal.expectedCloseAt)}
              displayValue={deal.expectedCloseAt ? new Date(deal.expectedCloseAt).toLocaleDateString("pt-BR") : "—"}
              type="date"
              editable={canEditDetails}
              onSave={(v) => saveDealField("expectedCloseAt", v)}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">Tipo de crédito</span>
              <Select
                value={deal.creditType ?? ""}
                onChange={updateCreditType}
                className="py-1 text-xs"
                options={[
                  { value: "", label: "—" },
                  ...creditTypes.map((c) => ({ value: c.label, label: c.label })),
                ]}
              />
            </div>
            <EditableRow
              label="Descrição"
              value={deal.description ?? ""}
              type="textarea"
              editable={canEditDetails}
              onSave={(v) => saveDealField("description", v)}
            />
          </div>

          <CustomFieldsCard
            dealId={deal.id}
            customFields={customFields}
            values={deal.customFieldValues ?? {}}
            editable={canEditDetails}
            onSaved={() => router.refresh()}
          />

          {deal.status === "LOST" && deal.lossReason && (
            <div className="card space-y-2 border-red-100 dark:border-red-900 bg-red-50/40 dark:bg-red-500/10 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Motivo da perda</h3>
              <Row label="Motivo" value={deal.lossReason.label} />
              {deal.lostReason && <Row label="Detalhes" value={deal.lostReason} />}
            </div>
          )}

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do contato</h3>
            <EditableRow
              label="Nome"
              value={deal.contact.name}
              editable={canEditDetails}
              onSave={(v) => saveContactField("name", v)}
            />
            <EditableRow
              label="E-mail"
              value={deal.contact.email ?? ""}
              type="email"
              editable={canEditDetails}
              onSave={(v) => saveContactField("email", v)}
            />
            <EditableRow
              label="Celular"
              value={deal.contact.phone ?? ""}
              editable={canEditDetails}
              onSave={(v) => saveContactField("phone", v)}
            />
            <EditableRow
              label="WhatsApp"
              value={deal.contact.whatsapp ?? ""}
              editable={canEditDetails}
              onSave={(v) => saveContactField("whatsapp", v)}
            />
            <EditableRow
              label="Cargo"
              value={deal.contact.jobTitle ?? ""}
              type="select"
              options={jobTitleOptions}
              editable={canEditDetails}
              onSave={(v) => saveContactField("jobTitle", v)}
            />
          </div>
        </div>
      </div>

      {/* Mobile — abas em vez de grade lado a lado; reaproveita os mesmos
          handlers/estado de cima, só reorganiza a apresentação. */}
      <div className="lg:hidden">
        <div className="relative mb-3 flex w-full max-w-[240px] rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
          <div
            className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-neutral-900"
            style={{ transform: mobileTab === "details" ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
          />
          <button
            onClick={() => setMobileTab("activities")}
            className={`relative z-10 flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
              mobileTab === "activities"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            Atividades
          </button>
          <button
            onClick={() => setMobileTab("details")}
            className={`relative z-10 flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
              mobileTab === "details"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            Detalhes
          </button>
        </div>

        {mobileTab === "activities" ? (
          <div className="space-y-4">
            <div className="card p-4">
              <div className="mb-3 flex gap-1 overflow-x-auto">
                {ACTIVITY_TABS.map((tab) => (
                  <button
                    key={tab.type}
                    onClick={() => selectTab(tab.type)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                      activeTab === tab.type
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                        : "bg-neutral-100 text-neutral-500 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:active:bg-neutral-700"
                    }`}
                  >
                    <tab.icon className="h-3.5 w-3.5" strokeWidth={2} />
                    {tab.label}
                  </button>
                ))}
              </div>
              <form onSubmit={submitActivity} className="space-y-2">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="O que foi feito e qual o próximo passo?"
                  rows={3}
                  className="field-input"
                />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400">Prazo</label>
                    <DatePicker value={dueDate} onChange={setDueDate} className="px-2 py-1 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400">Horário</label>
                    <TimePicker value={dueTime} onChange={setDueTime} disabled={!dueDate} className="px-2 py-1 text-xs" />
                  </div>
                  <button type="submit" disabled={saving || !body.trim()} className="btn-primary btn-sm ml-auto shrink-0">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
                    {saving ? (
                      <span className="inline-flex items-center gap-1">
                        Salvando
                        <LoadingDots />
                      </span>
                    ) : (
                      "Registrar"
                    )}
                  </button>
                </div>
              </form>
            </div>

            <div className="space-y-2">
              {deal.activities.length === 0 && (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Nenhuma atividade registrada.</p>
              )}
              {deal.activities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  highlighted={highlightedActivityId === activity.id}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <DealValueCard value={deal.value} editable={canEditDetails} onSave={saveDealValue} />

            {!chatOpen && whatsappThreadId && (
              <WhatsAppPanelTrigger onOpen={() => setChatOpen(true)} hasUnread={hasUnreadWhatsApp} />
            )}

            <div className="card space-y-2 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Tarefas</h3>
              <div className="space-y-1.5">
                {deal.tasks.length === 0 && (
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    Nenhuma tarefa. Defina um prazo ao registrar uma atividade para criar uma.
                  </p>
                )}
                {deal.tasks.map((task) => (
                  <div
                    key={task.id}
                    id={`task-${task.id}`}
                    className={`group -mx-1.5 flex items-start gap-1 rounded-md px-1.5 py-0.5 text-xs ${
                      highlightedTaskId === task.id ? "animate-highlight-once" : ""
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={!!task.completedAt}
                        onChange={(e) => toggleTask(task.id, e.target.checked)}
                        className="mt-0.5 accent-neutral-900 dark:accent-white"
                      />
                      <span className={task.completedAt ? "text-neutral-400 dark:text-neutral-500 line-through" : "text-neutral-700 dark:text-neutral-300"}>
                        {task.title}
                        {task.dueAt && (
                          <span className="ml-1 text-neutral-400 dark:text-neutral-500">
                            · {new Date(task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </span>
                    </label>
                    {canEditDetails && (
                      <button
                        type="button"
                        onClick={() => setEditingTask(task)}
                        className="icon-btn h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100"
                        aria-label="Editar tarefa"
                      >
                        <Pencil className="h-3 w-3" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="card space-y-2 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do negócio</h3>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Responsável</span>
                <span className="flex items-center gap-1.5">
                  <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                  <Select
                    value={deal.owner.id}
                    onChange={reassignOwner}
                    className="py-1 text-xs"
                    options={members.map((m) => ({ value: m.id, label: m.name }))}
                  />
                </span>
              </div>
              <Row label="Início" value={new Date(deal.startedAt).toLocaleDateString("pt-BR")} />
              <Row
                label="Conclusão prevista"
                value={deal.expectedCloseAt ? new Date(deal.expectedCloseAt).toLocaleDateString("pt-BR") : "—"}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Tipo de crédito</span>
                <Select
                  value={deal.creditType ?? ""}
                  onChange={updateCreditType}
                  className="py-1 text-xs"
                  options={[
                    { value: "", label: "—" },
                    ...creditTypes.map((c) => ({ value: c.label, label: c.label })),
                  ]}
                />
              </div>
              <EditableRow
              label="Descrição"
              value={deal.description ?? ""}
              type="textarea"
              editable={canEditDetails}
              onSave={(v) => saveDealField("description", v)}
            />
            </div>

            <CustomFieldsCard
              dealId={deal.id}
              customFields={customFields}
              values={deal.customFieldValues ?? {}}
              editable={canEditDetails}
              onSaved={() => router.refresh()}
            />

            {deal.status === "LOST" && deal.lossReason && (
              <div className="card space-y-2 border-red-100 bg-red-50/40 p-4 text-sm dark:border-red-900 dark:bg-red-500/10">
                <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Motivo da perda</h3>
                <Row label="Motivo" value={deal.lossReason.label} />
                {deal.lostReason && <Row label="Detalhes" value={deal.lostReason} />}
              </div>
            )}

            <div className="card space-y-2 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do contato</h3>
              <EditableRow
                label="Nome"
                value={deal.contact.name}
                editable={canEditDetails}
                onSave={(v) => saveContactField("name", v)}
              />
              <EditableRow
                label="E-mail"
                value={deal.contact.email ?? ""}
                type="email"
                editable={canEditDetails}
                onSave={(v) => saveContactField("email", v)}
              />
              <EditableRow
                label="Celular"
                value={deal.contact.phone ?? ""}
                editable={canEditDetails}
                onSave={(v) => saveContactField("phone", v)}
              />
              <EditableRow
                label="WhatsApp"
                value={deal.contact.whatsapp ?? ""}
                editable={canEditDetails}
                onSave={(v) => saveContactField("whatsapp", v)}
              />
              <EditableRow
                label="Cargo"
                value={deal.contact.jobTitle ?? ""}
                type="select"
                options={jobTitleOptions}
                editable={canEditDetails}
                onSave={(v) => saveContactField("jobTitle", v)}
              />
            </div>
          </div>
        )}
      </div>

      {lossDialogOpen && (
        <LossReasonDialog
          lossReasons={lossReasons}
          initialReasonId={deal.lossReasonId}
          initialNote={deal.lostReason}
          onClose={() => setLossDialogOpen(false)}
          onConfirm={confirmLoss}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={(fields) => saveTask(editingTask.id, fields)}
        />
      )}
      </div>

      {chatOpen && whatsappThreadId && (
        <>
          <WhatsAppPanel
            threadId={whatsappThreadId}
            contactId={deal.contact.id}
            contactName={deal.contact.name}
            contactPhone={deal.contact.whatsapp || deal.contact.phone}
            currentUserName={currentUserName}
            currentUserPhotoUrl={currentUserPhotoUrl}
            onClose={() => setChatOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex flex-col bg-white p-4 dark:bg-neutral-950 lg:hidden">
            <ChatWindow
              threadId={whatsappThreadId}
              contactId={deal.contact.id}
              contactName={deal.contact.name}
              contactPhone={deal.contact.whatsapp || deal.contact.phone}
              currentUserName={currentUserName}
              currentUserPhotoUrl={currentUserPhotoUrl}
              onClose={() => setChatOpen(false)}
              backMode
              className="h-full"
            />
          </div>
        </>
      )}
    </div>
  );
}

function LossReasonDialog({
  lossReasons,
  initialReasonId,
  initialNote,
  onClose,
  onConfirm,
}: {
  lossReasons: LossReasonOption[];
  initialReasonId: string | null;
  initialNote: string | null;
  onClose: () => void;
  onConfirm: (lossReasonId: string, note: string) => Promise<void>;
}) {
  const [reasonId, setReasonId] = useState(initialReasonId ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonId) {
      setError("Selecione um motivo");
      return;
    }
    setLoading(true);
    setError(null);
    await onConfirm(reasonId, note);
    setLoading(false);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Por que esse negócio foi perdido?</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Motivo</label>
          <Select
            autoFocus
            value={reasonId}
            onChange={setReasonId}
            options={[
              { value: "", label: "Selecione" },
              ...lossReasons.map((r) => ({ value: r.id, label: r.label })),
            ]}
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Detalhes (opcional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="field-input"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="btn-primary bg-red-600 hover:bg-red-700 focus-visible:ring-red-500">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Marcar como perdido"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditTaskModal({
  task,
  onClose,
  onSave,
}: {
  task: { id: string; title: string; dueAt: string | Date | null };
  onClose: () => void;
  onSave: (fields: { title: string; dueAt: string | null }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(toDateInputValue(task.dueAt));
  const [dueTime, setDueTime] = useState(toTimeInputValue(task.dueAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await onSave({
      title,
      dueAt: dueDate ? `${dueDate}T${dueTime || "00:00"}` : null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Erro ao salvar");
      return;
    }
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Editar tarefa</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Título</label>
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1">
            <label className="field-label">Prazo</label>
            <DatePicker value={dueDate} onChange={setDueDate} />
          </div>
          <div className="space-y-1">
            <label className="field-label">Horário</label>
            <TimePicker value={dueTime} onChange={setDueTime} disabled={!dueDate} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={saving || !title.trim()} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {saving ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Salvar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DealValueCard({
  value,
  editable,
  onSave,
}: {
  value: number | null;
  editable: boolean;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="card group p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-neutral-500 dark:text-neutral-400">Valor do negócio</p>
          {editable && (
            <button
              type="button"
              onClick={() => {
                setDraft(value != null ? String(value) : "");
                setError(null);
                setEditing(true);
              }}
              className="icon-btn h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100"
              aria-label="Editar valor do negócio"
            >
              <Pencil className="h-3 w-3" strokeWidth={2} />
            </button>
          )}
        </div>
        <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(value)}</p>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Erro ao salvar");
      return;
    }
    setEditing(false);
  }

  return (
    <div className="card space-y-2 p-4 text-sm">
      <p className="text-neutral-500 dark:text-neutral-400">Valor do negócio</p>
      <div className="flex items-center gap-1.5">
        <CurrencyInput value={draft} onChange={setDraft} />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="icon-btn shrink-0"
          aria-label="Salvar"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="icon-btn shrink-0"
          aria-label="Cancelar"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function CustomFieldsCard({
  dealId,
  customFields,
  values,
  editable,
  onSaved,
}: {
  dealId: string;
  customFields: CustomFieldDefinitionInput[];
  values: CustomFieldFormValues;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CustomFieldFormValues>(values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (customFields.length === 0) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customFieldValues: draft }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar");
      return;
    }
    setEditing(false);
    onSaved();
  }

  return (
    <div className="card group space-y-2 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Campos personalizados</h3>
        {editable && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(values);
              setError(null);
              setEditing(true);
            }}
            className="icon-btn h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 coarse:opacity-100"
            aria-label="Editar campos personalizados"
          >
            <Pencil className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>

      {editing ? (
        <>
          <CustomFieldsFieldset definitions={customFields} values={draft} onChange={setDraft} />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost btn-sm">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary btn-sm">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />}
              Salvar
            </button>
          </div>
        </>
      ) : (
        customFields.map((def) => (
          <Row key={def.id} label={def.label} value={stringifyCustomFieldValue(def, (values[def.id] as CustomFieldValue) ?? null) || "—"} />
        ))
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="text-right text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}

/** "2026-07-12T00:00:00.000Z" → "2026-07-12", o formato que <input type="date"> espera. */
function toDateInputValue(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

/** "2026-07-12T07:00:00.000Z" → "07:00", o formato que o TimePicker espera. */
function toTimeInputValue(value: string | Date | null): string {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Mesmo "Row", mas com lápis pra editar no lugar — só quando `editable` é
 * true (dono do negócio ou OWNER da conta). Sem permissão, cai de volta pro
 * Row normal, só leitura.
 */
function EditableRow({
  label,
  value,
  displayValue,
  onSave,
  type = "text",
  options,
  editable,
}: {
  label: string;
  value: string;
  /** Como mostrar o valor fora do modo edição, se diferente do value bruto (ex.: data formatada). */
  displayValue?: string;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
  type?: "text" | "email" | "textarea" | "date" | "select";
  /** Só usado quando type="select" — lista de opções fixas (ex.: cargo). */
  options?: { value: string; label: string }[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable) return <Row label={label} value={displayValue ?? value ?? "—"} />;

  if (!editing) {
    return (
      <div className="group flex items-center justify-between gap-2">
        <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setError(null);
            setEditing(true);
          }}
          className="group/field flex min-w-0 items-center gap-1 text-right"
        >
          <span className="truncate text-neutral-800 dark:text-neutral-200">{displayValue ?? (value || "—")}</span>
          <Pencil
            className="h-3 w-3 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible/field:opacity-100 coarse:opacity-100 dark:text-neutral-500"
            strokeWidth={2}
          />
        </button>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Erro ao salvar");
      return;
    }
    setEditing(false);
  }

  return (
    <div className="space-y-1">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className="flex items-center gap-1">
        {type === "textarea" ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="field-input text-xs"
          />
        ) : type === "select" ? (
          <Select value={draft} onChange={setDraft} options={options ?? []} autoFocus className="text-xs" />
        ) : (
          <input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="field-input text-xs"
          />
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="icon-btn shrink-0"
          aria-label="Salvar"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="icon-btn shrink-0"
          aria-label="Cancelar"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
