"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StickyNote, CircleDot, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { ACTIVITY_TABS, ACTIVITY_ICON, ACTIVITY_BODY_TEMPLATES } from "@/lib/activity-icons";
import { Avatar } from "@/components/avatar";
import { Modal } from "@/components/modal";
import { ContactPreviewModal } from "@/components/contact-preview-modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { DatePicker } from "@/components/date-picker";
import { TimePicker } from "@/components/time-picker";
import { WhatsAppChat } from "@/components/whatsapp-chat";

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
  creditTerm: number | null;
  groupNumber: string | null;
  quota: string | null;
  contemplated: boolean;
  startedAt: string | Date;
  closedAt: string | Date | null;
  expectedCloseAt: string | Date | null;
  stageId: string;
  stageEnteredAt: string | Date;
  contact: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null };
  owner: { id: string; name: string };
  stage: Stage;
  pipeline: { stages: Stage[] };
  activities: Activity[];
  tasks: DealTask[];
  lossReasonId: string | null;
  lossReason: { id: string; label: string } | null;
  lostReason: string | null;
};

type MemberOption = { id: string; name: string };
type LossReasonOption = { id: string; label: string };

export function DealDetail({
  deal,
  members,
  lossReasons,
}: {
  deal: Deal;
  members: MemberOption[];
  lossReasons: LossReasonOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("NOTE");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [movingStage, setMovingStage] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [lossDialogOpen, setLossDialogOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);

  useEffect(() => {
    const taskId = searchParams.get("highlightTask");
    const activityId = searchParams.get("highlightActivity");
    if (!taskId && !activityId) return;
    const el = document.getElementById(taskId ? `task-${taskId}` : `activity-${activityId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (taskId) setHighlightedTaskId(taskId);
    if (activityId) setHighlightedActivityId(activityId);
    router.replace(`/negocios/${deal.id}`);
    const timeout = setTimeout(() => {
      setHighlightedTaskId(null);
      setHighlightedActivityId(null);
    }, 1400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateStatus(status: "OPEN" | "WON" | "LOST") {
    if (status === "LOST") {
      setLossDialogOpen(true);
      return;
    }
    await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
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

  async function moveToStage(stageId: string) {
    if (stageId === deal.stageId) return;
    setMovingStage(stageId);
    await fetch(`/api/deals/${deal.id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId }),
    });
    setMovingStage(null);
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
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Avatar name={deal.contact.name} size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{deal.name}</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              <button
                type="button"
                onClick={() => setContactModalOpen(true)}
                className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline"
              >
                {deal.contact.name}
              </button>
              {" · "}Responsável: {deal.owner.name}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
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

      <div className="grid grid-cols-3 gap-6">
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
            {deal.activities.map((activity) => {
              const Icon = ACTIVITY_ICON[activity.type] ?? StickyNote;
              return (
                <div
                  key={activity.id}
                  id={`activity-${activity.id}`}
                  className={`card flex gap-3 p-3 text-sm ${
                    highlightedActivityId === activity.id ? "animate-highlight-once" : ""
                  }`}
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
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4 text-sm">
            <p className="text-neutral-500 dark:text-neutral-400">Valor do negócio</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{formatCurrency(deal.value)}</p>
          </div>

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Tarefas</h3>
            <div className="space-y-1.5">
              {deal.tasks.length === 0 && (
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Nenhuma tarefa. Defina um prazo ao registrar uma atividade para criar uma.
                </p>
              )}
              {deal.tasks.map((task) => (
                <label
                  key={task.id}
                  id={`task-${task.id}`}
                  className={`-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-0.5 text-xs ${
                    highlightedTaskId === task.id ? "animate-highlight-once" : ""
                  }`}
                >
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
              ))}
            </div>
          </div>

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do negócio</h3>
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">Responsável</span>
              <Select
                value={deal.owner.id}
                onChange={reassignOwner}
                className="py-1 text-xs"
                options={members.map((m) => ({ value: m.id, label: m.name }))}
              />
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
                  { value: "IMÓVEL", label: "Imóvel" },
                  { value: "VEÍCULO", label: "Veículo" },
                  { value: "OUTROS", label: "Outros" },
                ]}
              />
            </div>
            <Row label="Descrição" value={deal.description ?? "—"} />
          </div>

          {deal.status === "LOST" && deal.lossReason && (
            <div className="card space-y-2 border-red-100 dark:border-red-900 bg-red-50/40 dark:bg-red-500/10 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Motivo da perda</h3>
              <Row label="Motivo" value={deal.lossReason.label} />
              {deal.lostReason && <Row label="Detalhes" value={deal.lostReason} />}
            </div>
          )}

          <div className="card space-y-2 p-4 text-sm">
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do contato</h3>
            <Row label="Nome" value={deal.contact.name} />
            <Row label="E-mail" value={deal.contact.email ?? "—"} />
            <Row label="Celular" value={deal.contact.phone ?? "—"} />
            <Row label="WhatsApp" value={deal.contact.whatsapp ?? "—"} />
          </div>

          <WhatsAppChat
            contactId={deal.contact.id}
            contactName={deal.contact.name}
            contactPhone={deal.contact.whatsapp || deal.contact.phone}
          />
        </div>
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

      {contactModalOpen && (
        <ContactPreviewModal contactId={deal.contact.id} onClose={() => setContactModalOpen(false)} />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="text-right text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}
