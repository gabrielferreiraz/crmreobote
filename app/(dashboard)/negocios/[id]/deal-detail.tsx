"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, StickyNote, CircleDot, CheckCircle2, XCircle, Clock, Loader2, Pencil, Check, X, ThumbsUp, ThumbsDown, Trash2, User, Phone, MessageSquare, Mic, ChevronRight, Wallet, Briefcase, CalendarCheck, UserCheck, Mail, ExternalLink } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { normalizePhoneNumber, ensureBrazilianMobileNinthDigit } from "@/lib/phone-normalize";
import { ACTIVITY_TABS, ACTIVITY_ICON, ACTIVITY_BODY_TEMPLATES, MEETING_OUTCOME_OPTIONS } from "@/lib/activity-icons";
import { MeetingOutcomeDialog, type MeetingOutcomeResult } from "@/components/meeting-outcome-dialog";
import { Avatar } from "@/components/avatar";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorDialog, type ErrorType } from "@/components/error-dialog";
import { ContactConflictNotice, type ContactConflict } from "@/components/contact-conflict-notice";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { CurrencyInput } from "@/components/currency-input";
import { DatePicker } from "@/components/date-picker";
import { TimePicker } from "@/components/time-picker";
import { WhatsAppPanelTrigger } from "@/components/whatsapp-panel-trigger";
import { ScheduleWhatsAppToggle, type ScheduleWhatsAppValue } from "@/components/schedule-whatsapp-toggle";
import { appendDictatedText } from "@/lib/dictation";
import { useVoiceTranscription } from "@/lib/use-voice-transcription";
import type { MeetingInviteTask } from "@/components/meeting-invite-dialog";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { stringifyCustomFieldValue, type CustomFieldValue } from "@/lib/custom-fields";
import { ClosedAtDialog } from "@/components/closed-at-dialog";
import { LossReasonDialog, type LossReasonOption } from "@/components/loss-reason-dialog";
import { useUndoToast } from "@/components/undo-provider";
import { ProposalsCard } from "@/components/proposals/proposals-card";
import type { ProposalDTO } from "@/lib/proposals/types";

// Só carregam depois que a pessoa de fato abre o painel/confete/convite/
// ditado por voz — cada um puxa dependências pesadas (chat com QR/mídia/
// áudio, canvas de confete, Web Speech API) que a maioria das visitas a esta
// página nunca aciona. `ssr: false` porque todos são só client-side de
// qualquer forma (efeito visual, gravação de mídia, WebSpeech).
const WhatsAppPanel = dynamic(() => import("@/components/whatsapp-chat").then((m) => m.WhatsAppPanel), { ssr: false });
const ChatWindow = dynamic(() => import("@/components/whatsapp-chat").then((m) => m.ChatWindow), { ssr: false });
const ConfettiBurst = dynamic(() => import("@/components/confetti-burst").then((m) => m.ConfettiBurst), { ssr: false });
const MeetingInviteDialog = dynamic(
  () => import("@/components/meeting-invite-dialog").then((m) => m.MeetingInviteDialog),
  { ssr: false },
);
const VoiceInputButton = dynamic(() => import("@/components/voice-input-button").then((m) => m.VoiceInputButton), {
  ssr: false,
});

type Stage = { id: string; name: string; order: number; color: string | null };

type Activity = {
  id: string;
  type: string;
  body: string | null;
  createdAt: string | Date;
  userId: string;
  meetingOutcome: "ATTENDED" | "NO_SHOW" | "RESCHEDULED" | "PENDING" | null;
  user: { name: string; photoUrl: string | null };
};

type DealTask = {
  id: string;
  title: string;
  type: string;
  dueAt: string | Date | null;
  completedAt: string | Date | null;
};

type ContactLeadQualification = "QUALIFIED" | "UNQUALIFIED";

type Deal = {
  id: string;
  name: string;
  status: "OPEN" | "WON" | "LOST";
  value: number | null;
  grossValue: number | null;
  description: string | null;
  creditType: string | null;
  createdAt: string | Date;
  startedAt: string | Date;
  closedAt: string | Date | null;
  expectedCloseAt: string | Date | null;
  stageId: string;
  stageEnteredAt: string | Date;
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    jobTitle: string | null;
    source: string | null;
    responsavelId: string | null;
    responsavel: { name: string } | null;
    metaLeadgenId: string | null;
    metaCampaignId: string | null;
    metaCampaignName: string | null;
    metaAdId: string | null;
    metaAdSetId: string | null;
    leadQualification: ContactLeadQualification | null;
    leadQualificationAt: string | Date | null;
    qualifiedBy: { name: string } | null;
  };
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

/**
 * Log automático (mudança de etapa, ganho/perdido, valor) — uma linha
 * minúscula sem cartão nem avatar, pra não competir visualmente com as
 * atividades manuais (nota, ligação etc.), que são o conteúdo principal.
 */
function ActivityItem({
  activity,
  highlighted,
  canEdit,
  onConfirmDelete,
  onSave,
}: {
  activity: Activity;
  highlighted: boolean;
  canEdit: boolean;
  onConfirmDelete: (activity: Activity) => void;
  onSave: (
    activityId: string,
    fields: { activityBody: string; meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED" | "PENDING" | null },
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [meetingOutcome, setMeetingOutcome] = useState<"ATTENDED" | "NO_SHOW" | "RESCHEDULED" | "PENDING" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (activity.type === "SYSTEM") {
    return (
      <p
        id={`activity-${activity.id}`}
        className={`px-1 py-0.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 ${highlighted ? "animate-highlight-once" : ""}`}
      >
        {activity.user.name} {activity.body}
        <span className="font-normal text-neutral-500 dark:text-neutral-500"> · {new Date(activity.createdAt).toLocaleString("pt-BR")}</span>
      </p>
    );
  }

  const isMeetingOrVisit = activity.type === "MEETING" || activity.type === "VISIT";
  const Icon = ACTIVITY_ICON[activity.type] ?? StickyNote;

  function startEdit() {
    setBody(activity.body ?? "");
    setMeetingOutcome(activity.meetingOutcome);
    setEditing(true);
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function saveEdit(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    const result = await onSave(activity.id, {
      activityBody: body,
      meetingOutcome: isMeetingOrVisit ? meetingOutcome : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Erro ao salvar");
      return;
    }
    setEditing(false);
  }

  const activityTypeColors: Record<string, string> = {
    WHATSAPP: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-1 ring-emerald-500/30",
    CALL: "bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400 ring-1 ring-sky-500/30",
    MEETING: "bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 ring-1 ring-violet-500/30",
    VISIT: "bg-rose-500/15 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 ring-1 ring-rose-500/30",
    PROPOSAL: "bg-indigo-500/15 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 ring-1 ring-indigo-500/30",
    EMAIL: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 ring-1 ring-cyan-500/30",
    NOTE: "bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-1 ring-amber-500/30",
  };
  const iconColorClass = activityTypeColors[activity.type] ?? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";

  return (
    <div
      id={`activity-${activity.id}`}
      className={`card flex gap-3.5 p-3.5 text-sm transition-colors hover:border-neutral-700/70 ${highlighted ? "animate-highlight-once" : ""}`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconColorClass}`}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={saveEdit} className="space-y-2">
            <textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="field-input"
              placeholder="O que foi feito e qual o próximo passo?"
            />
            {isMeetingOrVisit && (
              <div className="flex flex-wrap gap-1.5">
                {([
                  { value: "PENDING", label: "Aguardando" },
                  ...MEETING_OUTCOME_OPTIONS,
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMeetingOutcome(opt.value)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      meetingOutcome === opt.value
                        ? (opt as { activeClass?: string }).activeClass ??
                          "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                        : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={cancelEdit} className="btn-ghost !py-1 !text-xs">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary !py-1 !text-xs">
                {saving && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />}
                {saving ? (
                  <span className="inline-flex items-center gap-1">
                    Salvando
                    <LoadingDots />
                  </span>
                ) : (
                  <>
                    <Check className="h-3 w-3" strokeWidth={2.5} /> Salvar
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {activity.body && <p className="text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">{activity.body}</p>}
              </div>
              <div className="flex shrink-0 items-start gap-1">
                {/* PENDING = aguardando a Task ligada concluir (ver
                    ActivityMeetingOutcome no schema) — rótulo próprio, não vem de
                    MEETING_OUTCOME_OPTIONS (esse só tem os 3 resultados finais). */}
                {activity.meetingOutcome === "PENDING" ? (
                  <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    Aguardando
                  </span>
                ) : (
                  activity.meetingOutcome &&
                  activity.meetingOutcome !== "ATTENDED" && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        activity.meetingOutcome === "NO_SHOW"
                          ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      }`}
                    >
                      {MEETING_OUTCOME_OPTIONS.find((o) => o.value === activity.meetingOutcome)?.label}
                    </span>
                  )
                )}
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={startEdit}
                      className="icon-btn h-5 w-5 shrink-0"
                      aria-label="Editar atividade"
                      title="Editar"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirmDelete(activity)}
                      className="icon-btn h-5 w-5 shrink-0 hover:text-red-600 dark:hover:text-red-400"
                      aria-label="Excluir atividade"
                      title="Excluir"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={2} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
              <Avatar name={activity.user.name} src={activity.user.photoUrl} size="xs" />
              {activity.user.name} · {new Date(activity.createdAt).toLocaleString("pt-BR")}
            </p>
          </>
        )}
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
  sources,
  hasUnreadWhatsApp,
  whatsappThreadId,
  isWhatsAppConnected,
  sendAsAlternate,
  canEditDetails,
  currentUserRole,
  currentUserId,
  proposals,
  defaultProposalDescription,
}: {
  deal: Deal;
  members: MemberOption[];
  lossReasons: LossReasonOption[];
  customFields: CustomFieldDefinitionInput[];
  creditTypes: { id: string; label: string }[];
  jobTitles: { id: string; label: string }[];
  sources: { id: string; label: string }[];
  hasUnreadWhatsApp?: boolean;
  /** null quando o contato não tem WhatsApp/celular cadastrado — não dá pra conversar. */
  whatsappThreadId: string | null;
  /** WhatsApp do responsável pelo negócio conectado — condição pro convite de reunião oferecer "enviar" (ver MeetingInviteDialog). */
  isWhatsAppConnected: boolean;
  /** Dono, Gerente ou Supervisor vendo o negócio de outro consultor, com
   * WhatsApp próprio conectado — deixa trocar pra "enviar como você" em vez
   * do padrão (que já é a conversa real do responsável, ver page.tsx). */
  sendAsAlternate?: { threadId: string; label: string; defaultLabel: string } | null;
  /** Só o dono do negócio ou um OWNER da conta pode editar os campos com lápis. */
  canEditDetails: boolean;
  /** Excluir tarefa (Reunião/Visita/etc.) é restrito ao Dono da organização — ver DELETE /api/tasks/[id]. */
  currentUserRole?: string;
  currentUserId: string;
  /** Propostas comerciais deste negócio (mais nova primeiro) — ver components/proposals/proposals-card.tsx. */
  proposals: ProposalDTO[];
  /** Texto padrão da organização pra descrição de proposta NOVA (Configurações → Proposta). */
  defaultProposalDescription: string;
}) {
  const router = useRouter();
  const pushUndoToast = useUndoToast();
  const searchParams = useSearchParams();
  const canDeleteTask = currentUserRole === "OWNER";
  const [activeTab, setActiveTab] = useState("NOTE");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  // Ditado por voz mostra o texto ao vivo enquanto a pessoa fala (ver
  // lib/use-voice-transcription.ts) — `body` continua sendo o valor de
  // VERDADE (confirmado, sem o provisório em andamento), pra toda a lógica
  // abaixo (submissão, template, guarda de "vazio") não mudar; só o
  // textarea em si usa `bodyDictation.value` (com o provisório) pra dar o
  // feedback visual.
  const bodyDictation = useVoiceTranscription("", appendDictatedText);
  const body = bodyDictation.committed;
  const setBody = bodyDictation.setValue;
  const [saving, setSaving] = useState(false);
  const [movingStage, setMovingStage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  // Só pedido (e só mandado pro servidor) quando activeTab é Reunião/Visita
  // E não tem Prazo preenchido — com Prazo, uma Task vai ser criada junto,
  // e o resultado passa a ser perguntado só na CONCLUSÃO dela (ver
  // MeetingOutcomeDialog mais abaixo), não aqui. Sem Prazo é um registro
  // retroativo (algo que já aconteceu, sem tarefa futura pra "pendurar" a
  // pergunta depois) — pergunta na hora, sem pré-seleção (era o próprio
  // problema que essa mudança corrige: "Compareceu" marcado por padrão
  // registrava comparecimento antes do encontro acontecer).
  const [meetingOutcome, setMeetingOutcome] = useState<"ATTENDED" | "NO_SHOW" | "RESCHEDULED" | null>(null);
  // Id da Task MEETING/VISIT sendo concluída — abre o MeetingOutcomeDialog
  // em vez de concluir direto (ver toggleTask).
  const [meetingOutcomeTaskId, setMeetingOutcomeTaskId] = useState<string | null>(null);
  const [lossDialogOpen, setLossDialogOpen] = useState(false);
  const [wonDialogOpen, setWonDialogOpen] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  // Setado depois de criar/reagendar uma tarefa Reunião com data definida —
  // abre o MeetingInviteDialog por cima (ver submitActivity/saveTask).
  const [meetingInviteTask, setMeetingInviteTask] = useState<MeetingInviteTask | null>(null);
  // Toggle "Enviar mensagem agendada para o lead" na própria aba WhatsApp
  // do registro rápido (ver ScheduleWhatsAppToggle/submitActivity) — troca o
  // fluxo antigo (criar tarefa → modal separado perguntava depois) por uma
  // decisão só, na hora de registrar.
  const [scheduleWhatsApp, setScheduleWhatsApp] = useState<ScheduleWhatsAppValue>({ enabled: false, message: "" });
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"activities" | "details">("activities");
  const [showConfetti, setShowConfetti] = useState(false);
  const [leadQualStatus, setLeadQualStatus] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });
  // Usado pra UI refletir a mudança imediata sem esperar router.refresh()
  const [localQualification, setLocalQualification] = useState<ContactLeadQualification | null>(null);
  const [localQualificationAt, setLocalQualificationAt] = useState<string | Date | null>(null);

  const mobileTextareaRef = useRef<HTMLTextAreaElement>(null);
  const phoneDigits = normalizePhoneNumber(deal.contact.phone);
  // ensureBrazilianMobileNinthDigit: corrige na hora de montar o link,
  // mesma rede de segurança de lib/whatsapp/send.ts — sem isso, o botão
  // abria conversa com o número ERRADO pra todo contato salvo sem o 9.
  const whatsappDigits = ensureBrazilianMobileNinthDigit(normalizePhoneNumber(deal.contact.whatsapp) ?? phoneDigits);
  const directPhoneUrl = phoneDigits ? `tel:+55${phoneDigits}` : null;
  const directWhatsAppUrl = whatsappDigits ? `https://wa.me/55${whatsappDigits}` : null;
  const pendingTasksCount = deal.tasks.filter((t) => !t.completedAt).length;

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
    if (status === "WON") {
      setWonDialogOpen(true);
      return;
    }
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function confirmWon(closedAt: string) {
    const wasWon = deal.status === "WON";
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "WON", closedAt }),
    });
    const data = await res.json().catch(() => ({}));
    setWonDialogOpen(false);
    if (!wasWon) setShowConfetti(true);
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function confirmLoss(lossReasonId: string, note: string, closedAt: string) {
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "LOST", lossReasonId, lostReason: note || undefined, closedAt }),
    });
    const data = await res.json().catch(() => ({}));
    setLossDialogOpen(false);
    router.refresh();
    pushUndoToast(data.undo);
  }

  // Troca de responsável tem peso de negócio (comissão, quem fala com o
  // cliente) — o <Select> só ARMA a troca (setPendingOwnerId), nunca grava
  // direto no onChange. Sem isso, um clique/scroll sem querer no dropdown
  // (fácil de acontecer, é um <select> nativo embutido no meio da tela)
  // reatribuía o negócio na hora, sem chance de desfazer o clique antes de
  // acontecer — relatado como "negócio foi parar com outro responsável".
  const [pendingOwnerId, setPendingOwnerId] = useState<string | null>(null);
  const pendingOwnerName = pendingOwnerId ? members.find((m) => m.id === pendingOwnerId)?.name : null;

  // "Mostrar como ajustar" no modal de erro de campo do contato (ver
  // EditableRow) — quando o bloqueio é "contato pertence a outro
  // consultor", em vez de só explicar o motivo, aponta direto pra linha
  // "Responsável" do mesmo card: incrementar este contador faz QUALQUER
  // EditableRow "Responsável" (desktop e mobile, ambas escutam o mesmo
  // valor) rolar até si mesma, abrir modo de edição e piscar um destaque —
  // não importa qual das duas está de fato visível na tela do momento.
  const [responsavelFocusTrigger, setResponsavelFocusTrigger] = useState(0);
  const showResponsavelFix = () => setResponsavelFocusTrigger((n) => n + 1);

  async function confirmReassignOwner(ownerId: string) {
    setPendingOwnerId(null);
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId }),
    });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function updateCreditType(creditType: string) {
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditType: creditType || null }),
    });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    pushUndoToast(data.undo);
    return { ok: true };
  }

  // A rota de contato reescreve nome/e-mail/celular/whatsapp juntos a cada
  // PUT (não é um PATCH parcial) — manda sempre os quatro, só trocando o
  // campo editado, senão os que ficarem de fora são apagados sem querer.
  async function saveContactField(
    field: "name" | "email" | "phone" | "whatsapp" | "jobTitle" | "source" | "responsavelId",
    value: string,
  ): Promise<{ ok: boolean; error?: string; type?: ErrorType; details?: string; conflict?: ContactConflict }> {
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // "details" é o motivo específico (ex.: "Contato pertence a outro
      // consultor." / "Contato sem responsável. Peça atribuição a um
      // gestor.") — a API já manda isso desde a correção de erros com
      // modal (ver components/error-dialog.tsx), mas até aqui esse card em
      // particular descartava e só mostrava "Sem permissão para editar"
      // sem explicar o motivo real. Mesma inferência de type que
      // components/edit-contact-dialog.tsx já usa quando a API não manda
      // um "type" explícito (erro de validação simples, por exemplo).
      return {
        ok: false,
        error: data.error ?? "Erro ao salvar",
        type: data.type ?? (res.status === 403 ? "PERMISSION" : res.status === 404 ? "NOT_FOUND" : res.status === 400 ? "VALIDATION" : "SERVER"),
        details: data.details,
        // 409 de telefone/WhatsApp já usado por OUTRO contato — leva o
        // `conflict` (ver PUT /api/contacts/[id]) pra linha abrir o aviso
        // com "Solicitar lead"/"Assumir" em vez do modal genérico "Erro de
        // servidor" sem saída.
        conflict: res.status === 409 ? (data.conflict as ContactConflict | undefined) : undefined,
      };
    }
    router.refresh();
    pushUndoToast(data.undo);
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

  // Mesmo raciocínio de jobTitleOptions acima, pra Origem — pedido explícito
  // de editar direto no card "Dados do contato" (antes só existia como
  // badge de leitura no card "Origem do lead", ver mais abaixo).
  const sourceOptions = sources.some((s) => s.label === deal.contact.source)
    ? sources.map((s) => ({ value: s.label, label: s.label }))
    : deal.contact.source
      ? [{ value: deal.contact.source, label: `${deal.contact.source} (antigo)` }, ...sources.map((s) => ({ value: s.label, label: s.label }))]
      : sources.map((s) => ({ value: s.label, label: s.label }));

  async function saveDealValue(value: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value ? Number(value) : null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    pushUndoToast(data.undo);
    return { ok: true };
  }

  async function saveDealGrossValue(value: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grossValue: value ? Number(value) : null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    pushUndoToast(data.undo);
    return { ok: true };
  }

  async function saveTask(
    taskId: string,
    fields: { title: string; dueAt: string | null },
  ): Promise<{ ok: boolean; error?: string; ownerGoogleCalendarWriteConnected?: boolean }> {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    pushUndoToast(data.undo);
    return { ok: true, ownerGoogleCalendarWriteConnected: data.ownerGoogleCalendarWriteConnected };
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMoveError(data.error ?? "Não foi possível mover o negócio");
      return;
    }
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function toggleTask(taskId: string, completed: boolean) {
    // Concluindo (não desmarcando) uma Reunião/Visita — precisa do
    // resultado antes (ver MeetingOutcomeDialog); desmarcar continua
    // instantâneo, igual antes.
    if (completed) {
      const task = deal.tasks.find((t) => t.id === taskId);
      if (task && (task.type === "MEETING" || task.type === "VISIT")) {
        setMeetingOutcomeTaskId(taskId);
        return;
      }
    }
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function resolveMeetingOutcome(result: MeetingOutcomeResult) {
    if (!meetingOutcomeTaskId) return;
    const res = await fetch(`/api/tasks/${meetingOutcomeTaskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        result.outcome === "RESCHEDULED"
          ? { meetingOutcome: "RESCHEDULED", dueAt: result.dueAt }
          : { completed: true, meetingOutcome: result.outcome },
      ),
    });
    const data = await res.json().catch(() => ({}));
    setMeetingOutcomeTaskId(null);
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function deleteTask(taskId: string) {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function setLeadQualification(qualification: ContactLeadQualification | null) {
    setLeadQualStatus({ saving: true, error: null });
    try {
      const res = await fetch(`/api/contacts/${deal.contact.id}/lead-qualification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualification }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLeadQualStatus({ saving: false, error: data.error ?? "Erro ao salvar qualificação" });
        return;
      }
      if (qualification) {
        setLocalQualification(qualification);
        setLocalQualificationAt(new Date());
      } else {
        setLocalQualification(null);
        setLocalQualificationAt(null);
      }
      setLeadQualStatus({ saving: false, error: null });
      router.refresh();
    } catch {
      setLeadQualStatus({ saving: false, error: "Falha de conexão." });
    }
  }

  function canEditActivity(activity: Activity): boolean {
    if (activity.type === "SYSTEM") return false;
    if (currentUserRole === "OWNER") return true;
    if (deal.owner.id === currentUserId) return true;
    if (activity.userId === currentUserId) return true;
    return false;
  }

  async function confirmDeleteActivity(activity: Activity) {
    const res = await fetch(`/api/activities/${activity.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function saveActivityEdit(
    activityId: string,
    fields: { activityBody: string; meetingOutcome?: "ATTENDED" | "NO_SHOW" | "RESCHEDULED" | "PENDING" | null },
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/activities/${activityId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Erro ao salvar" };
    }
    router.refresh();
    pushUndoToast(data.undo);
    return { ok: true };
  }

  function selectTab(type: string) {
    setActiveTab(type);
    const template = ACTIVITY_BODY_TEMPLATES[type];
    const isUntouched = !body.trim() || Object.values(ACTIVITY_BODY_TEMPLATES).includes(body);
    if (isUntouched) setBody(template ?? "");
    // Só faz sentido na aba WhatsApp — trocar de aba com o toggle ligado e
    // meio composto deixaria estado "fantasma" esperando pra ser usado numa
    // aba errada (ex.: Nota) na próxima vez que voltar pro WhatsApp.
    if (type !== "WHATSAPP") setScheduleWhatsApp({ enabled: false, message: "" });
  }

  useEffect(() => {
    const el = tabRefs.current[activeTab];
    if (el) setTabIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTab]);

  async function submitActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);

    const isMeetingOrVisit = activeTab === "MEETING" || activeTab === "VISIT";
    // Com Prazo, uma Task vai ser criada logo abaixo e o resultado passa a
    // ser perguntado só na conclusão dela — PENDING aqui é só o estado
    // inicial "aguardando". Sem Prazo não existe conclusão futura nenhuma
    // pra perguntar depois, então usa o que foi escolhido no seletor.
    let activityId: string | undefined;
    if (isMeetingOrVisit) {
      const activityRes = await fetch(`/api/deals/${deal.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          activityBody: body,
          meetingOutcome: dueDate ? "PENDING" : meetingOutcome,
        }),
      });
      if (activityRes.ok) activityId = (await activityRes.json()).id;
    } else {
      await fetch(`/api/deals/${deal.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeTab, activityBody: body }),
      });
    }

    if (dueDate) {
      const taskRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: body,
          type: activeTab,
          dueAt: `${dueDate}T${dueTime || "00:00"}`,
          dealId: deal.id,
          contactId: deal.contact.id,
          // Sempre o RESPONSÁVEL do negócio, nunca omitido — sem isso, POST
          // /api/tasks (ver app/api/tasks/route.ts) cai no default
          // `ownerId ?? userId`, ou seja, dono de QUEM ESTÁ LOGADO agora, não
          // do negócio. Pra quem já é o próprio responsável não muda nada
          // (os dois ids são iguais), mas Dono/Gerente/Supervisor abrindo o
          // negócio de outro consultor pra registrar uma ligação/WhatsApp
          // criava a tarefa em NOME PRÓPRIO — ela nunca aparecia na Agenda do
          // consultor de verdade (relatado: "não fica em tarefas, fica sem
          // nada"), e por não ser dele, os campos de prazo (dia/hora) do
          // card na timeline do negócio também não ficavam editáveis depois.
          ownerId: deal.owner.id,
          activityId,
        }),
      });
      if (activeTab === "MEETING" && taskRes.ok) {
        const created = await taskRes.json();
        setMeetingInviteTask({
          id: created.id,
          title: created.title,
          dueAt: created.dueAt,
          contact: { id: deal.contact.id, name: deal.contact.name, phone: deal.contact.phone, whatsapp: deal.contact.whatsapp },
          owner: { id: deal.owner.id, name: deal.owner.name },
          ownerHasGoogleCalendarWriteAccess: !!created.ownerGoogleCalendarWriteConnected,
        });
      }
      // Toggle "Enviar mensagem agendada" ligado (ver ScheduleWhatsAppToggle,
      // logo abaixo no formulário) — mesmo endpoint que o fluxo antigo (modal
      // separado) já usava, só que decidido de uma vez com o resto do
      // registro, não numa pergunta à parte depois.
      if (activeTab === "WHATSAPP" && taskRes.ok && scheduleWhatsApp.enabled && scheduleWhatsApp.message.trim()) {
        const created = await taskRes.json();
        if (created.dueAt && new Date(created.dueAt) > new Date()) {
          await fetch(`/api/tasks/${created.id}/schedule-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: scheduleWhatsApp.message.trim() }),
          }).catch(() => {});
        }
      }
    }

    setBody("");
    setDueDate("");
    setDueTime("");
    setMeetingOutcome(null);
    setScheduleWhatsApp({ enabled: false, message: "" });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="flex items-start gap-4">
      {showConfetti && <ConfettiBurst onDone={() => setShowConfetti(false)} />}
      <div className="min-w-0 flex-1 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/pipeline"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Pipeline
        </Link>
        {deal.value != null && (
          <span className="inline-flex items-center rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand dark:bg-brand/20 dark:text-brand-light lg:hidden">
            {formatCurrency(deal.value)}
          </span>
        )}
      </div>

      {/* Mobile Header (Clean, compacto e com ações rápidas para consultor na rua) */}
      <div className="space-y-3 lg:hidden">
        <div className="flex items-start gap-3">
          <Avatar name={deal.contact.name} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-snug tracking-tight text-neutral-900 dark:text-neutral-100 line-clamp-2">
              {deal.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <Link
                href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
                className="group inline-flex items-center gap-1.5 font-semibold text-neutral-800 dark:text-neutral-200 hover:text-brand dark:hover:text-brand-light transition-colors bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-md border border-neutral-200 dark:border-neutral-700/60"
                title="Ver ficha do cliente"
              >
                <User className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />
                <span>{deal.contact.name}</span>
                <ExternalLink className="h-3 w-3 text-neutral-400 group-hover:text-brand transition-colors" strokeWidth={2} />
              </Link>
              <span>·</span>
              <span>Resp: {deal.owner.name}</span>
            </p>
          </div>
        </div>

        {/* Status Segmentado Mobile */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
          {(
            [
              { s: "LOST" as const, label: "Perdido", icon: XCircle, activeClass: "bg-red-600 text-white shadow-sm" },
              { s: "OPEN" as const, label: "Em andamento", icon: CircleDot, activeClass: "bg-brand text-white shadow-sm" },
              { s: "WON" as const, label: "Ganho", icon: CheckCircle2, activeClass: "bg-emerald-600 text-white shadow-sm" },
            ]
          ).map(({ s, label, icon: Icon, activeClass }) => {
            const isActive = deal.status === s;
            return (
              <button
                key={s}
                onClick={() => updateStatus(s)}
                className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? activeClass
                    : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-700/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>

        {deal.status !== "OPEN" && deal.closedAt && (
          <p className="text-center text-[11px] text-neutral-400 dark:text-neutral-500">
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

        {/* Barra de Ações Rápidas do Consultor (1 toque) */}
        <div className="grid grid-cols-4 gap-2">
          {directPhoneUrl ? (
            <a
              href={directPhoneUrl}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500/10 py-2.5 text-emerald-700 transition-transform active:scale-95 dark:bg-emerald-500/20 dark:text-emerald-400"
            >
              <Phone className="h-4 w-4" strokeWidth={2.3} />
              <span className="text-[11px] font-semibold">Ligar</span>
            </a>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-neutral-100 py-2.5 text-neutral-400 opacity-60 dark:bg-neutral-800 dark:text-neutral-500">
              <Phone className="h-4 w-4" strokeWidth={2} />
              <span className="text-[11px]">Sem tel</span>
            </div>
          )}

          {directWhatsAppUrl ? (
            <a
              href={directWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500/10 py-2.5 text-emerald-700 transition-transform active:scale-95 dark:bg-emerald-500/20 dark:text-emerald-400"
            >
              <MessageSquare className="h-4 w-4" strokeWidth={2.3} />
              <span className="text-[11px] font-semibold">WhatsApp</span>
            </a>
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-neutral-100 py-2.5 text-neutral-400 opacity-60 dark:bg-neutral-800 dark:text-neutral-500">
              <MessageSquare className="h-4 w-4" strokeWidth={2} />
              <span className="text-[11px]">Sem Whats</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setMobileTab("activities");
              setTimeout(() => {
                mobileTextareaRef.current?.focus();
                mobileTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 50);
            }}
            className="flex flex-col items-center justify-center gap-1 rounded-xl bg-brand/10 py-2.5 text-brand transition-transform active:scale-95 dark:bg-brand/20 dark:text-brand-light"
          >
            <Mic className="h-4 w-4" strokeWidth={2.3} />
            <span className="text-[11px] font-semibold">Ditar Nota</span>
          </button>

          <Link
            href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
            className="flex flex-col items-center justify-center gap-1 rounded-xl bg-neutral-100 py-2.5 text-neutral-700 transition-transform active:scale-95 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <User className="h-4 w-4" strokeWidth={2.3} />
            <span className="text-[11px] font-semibold">Ficha</span>
          </Link>
        </div>
      </div>

      {/* Desktop Header */}
      <div className="hidden card p-5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800/80 shadow-sm lg:flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <Avatar name={deal.contact.name} size="lg" className="ring-2 ring-brand/40 shadow-sm shrink-0" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
                {deal.name}
              </h1>
              {deal.value != null && (
                <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  {formatCurrency(deal.value)}
                </span>
              )}
            </div>
            <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <Link
                href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
                className="group inline-flex items-center gap-1.5 font-semibold text-neutral-800 dark:text-neutral-200 hover:text-brand dark:hover:text-brand-light transition-all bg-neutral-100/90 dark:bg-neutral-800/80 hover:bg-neutral-200/80 dark:hover:bg-neutral-800 px-2.5 py-1 rounded-md border border-neutral-200/90 dark:border-neutral-700/80 shadow-2xs"
                title="Ver ficha do cliente"
              >
                <User className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />
                <span>{deal.contact.name}</span>
                <ExternalLink className="h-3 w-3 text-neutral-400 group-hover:text-brand transition-colors ml-0.5" strokeWidth={2} />
              </Link>
              <span className="text-neutral-400 dark:text-neutral-600">·</span>
              <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="2xs" />
                <span>Resp: <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{deal.owner.name}</strong></span>
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-950/80 p-1 border border-neutral-200 dark:border-neutral-800/80">
            {(
              [
                { s: "LOST" as const, label: "Perdido", icon: XCircle, activeClass: "bg-red-600 text-white shadow-sm shadow-red-900/50" },
                { s: "OPEN" as const, label: "Em andamento", icon: CircleDot, activeClass: "bg-brand text-white shadow-sm shadow-brand/40" },
                { s: "WON" as const, label: "Ganho", icon: CheckCircle2, activeClass: "bg-emerald-600 text-white shadow-sm shadow-emerald-900/50" },
              ]
            ).map(({ s, label, icon: Icon, activeClass }) => {
              const isActive = deal.status === s;
              return (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    isActive
                      ? activeClass
                      : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-200"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? "text-white" : ""}`} strokeWidth={2.2} />
                  {label}
                </button>
              );
            })}
          </div>
          {deal.status !== "OPEN" && deal.closedAt && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
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

      {/* Stepper Visual de Etapas */}
      <div className="card scrollbar-thin flex items-center gap-1.5 overflow-x-auto p-2 bg-white dark:bg-neutral-900/90 border border-neutral-200 dark:border-neutral-800 shadow-sm">
        {deal.pipeline.stages.map((stage, idx) => {
          const isCurrent = stage.id === deal.stageId;
          const stageIndex = deal.pipeline.stages.findIndex((s) => s.id === deal.stageId);
          const isPast = idx < stageIndex;

          return (
            <div key={stage.id} className="flex items-center gap-1.5 shrink-0">
              <button
                disabled={movingStage !== null}
                onClick={() => moveToStage(stage.id)}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                  isCurrent
                    ? "bg-gradient-to-r from-brand to-brand-dark text-white shadow-md shadow-brand/25 ring-1 ring-brand/50 font-semibold"
                    : isPast
                    ? "bg-neutral-100 text-neutral-800 font-semibold hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                    : "bg-neutral-100/70 text-neutral-700 font-medium hover:bg-neutral-200 hover:text-neutral-900 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full transition-transform group-hover:scale-125 ${
                    isCurrent ? "ring-2 ring-white/50 animate-pulse" : ""
                  }`}
                  style={{ backgroundColor: stage.color ?? "#999" }}
                />
                <span>{stage.name}</span>
                {isCurrent && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                      isStale(deal.stageEnteredAt) ? "bg-amber-500/20 text-amber-300 font-semibold" : "bg-white/20 text-white"
                    }`}
                  >
                    <Clock className="h-3 w-3" strokeWidth={2.2} />
                    {daysSince(deal.stageEnteredAt)}d
                  </span>
                )}
              </button>
              {idx < deal.pipeline.stages.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-600 dark:text-neutral-700" strokeWidth={2} />
              )}
            </div>
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
                  className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                    activeTab === tab.type
                      ? "font-semibold text-neutral-900 dark:text-neutral-100"
                      : "font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
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
              <div className="space-y-1.5">
                {/* Pílula com rótulo de texto — não cabia mais discreta num
                    canto do textarea (era só ícone antes); em fileira
                    própria, alinhada à direita, fica visível sem competir
                    com o texto digitado. */}
                <div className="flex justify-end">
                  <VoiceInputButton onResult={bodyDictation.onResult} onInterimResult={bodyDictation.onInterimResult} />
                </div>
                <textarea
                  value={bodyDictation.value}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="O que foi feito e qual o próximo passo?"
                  rows={3}
                  className="field-input"
                />
              </div>
              {(activeTab === "MEETING" || activeTab === "VISIT") && !dueDate && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">Resultado:</span>
                  {MEETING_OUTCOME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMeetingOutcome(opt.value)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                        meetingOutcome === opt.value ? opt.activeClass : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end justify-between gap-3">
                <div className="flex gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-400">Prazo</label>
                    <DatePicker value={dueDate} onChange={setDueDate} className="px-2 py-1 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-700 dark:text-neutral-400">Horário</label>
                    <TimePicker value={dueTime} onChange={setDueTime} disabled={!dueDate} className="px-2 py-1 text-xs" />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving || !body.trim() || ((activeTab === "MEETING" || activeTab === "VISIT") && !dueDate && !meetingOutcome)}
                  className="btn-primary btn-sm shrink-0"
                >
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
              {activeTab === "WHATSAPP" && (
                <ScheduleWhatsAppToggle value={scheduleWhatsApp} onChange={setScheduleWhatsApp} disabled={!dueDate} />
              )}
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
                canEdit={canEditActivity(activity)}
                onConfirmDelete={confirmDeleteActivity}
                onSave={saveActivityEdit}
              />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <DealValueCard label="Valor líquido" value={deal.value} editable={canEditDetails} onSave={saveDealValue} />
          <DealValueCard label="Valor bruto" value={deal.grossValue} editable={canEditDetails} onSave={saveDealGrossValue} />

          {!chatOpen && whatsappThreadId && (
            <WhatsAppPanelTrigger onOpen={() => setChatOpen(true)} hasUnread={hasUnreadWhatsApp} />
          )}

          <ProposalsCard dealId={deal.id} proposals={proposals} defaultDescription={defaultProposalDescription} />

          <div className="card space-y-3 p-4 text-sm border border-neutral-200 dark:border-neutral-800/80 shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-brand" strokeWidth={2} />
                <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Tarefas</h3>
              </div>
              {deal.tasks.length > 0 && (
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:bg-brand/20 dark:text-brand-light">
                  {deal.tasks.filter((t) => !t.completedAt).length} pendente(s)
                </span>
              )}
            </div>
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
                          · Prazo: {new Date(task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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

          <div className="card space-y-3 p-4 text-sm border border-neutral-200 dark:border-neutral-800/80 shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <Briefcase className="h-4 w-4 text-brand" strokeWidth={2} />
              <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Dados do negócio</h3>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">Responsável</span>
              <span className="flex items-center gap-1.5">
                <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="xs" />
                <Select
                  value={deal.owner.id}
                  onChange={setPendingOwnerId}
                  className="py-1 text-xs"
                  options={members.map((m) => ({ value: m.id, label: m.name }))}
                />
              </span>
            </div>
            {/* createdAt é o timestamp real de quando a linha nasceu no banco — sempre
                preenchido sozinho na criação (@default(now())), não importa a origem
                (manual, Facebook Lead Ads, API pública, resposta de WhatsApp). Diferente
                de "Início" (startedAt), que pode ter sido retroagido numa importação. */}
            <Row
              label="Criado em"
              value={new Date(deal.createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
            <Row
              label="Início"
              value={new Date(deal.startedAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
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

          {deal.status === "LOST" && (deal.lossReason || deal.lostReason) && (
            <div className="card space-y-2 border-red-100 dark:border-red-900 bg-red-50/40 dark:bg-red-500/10 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Motivo da perda</h3>
              <Row label="Motivo" value={deal.lossReason?.label ?? deal.lostReason ?? ""} />
              {deal.lossReason && deal.lostReason && <Row label="Detalhes" value={deal.lostReason} />}
            </div>
          )}

          {(deal.contact.metaCampaignName || deal.contact.source) && (
            <div className="card space-y-2 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Origem do lead</h3>
              {deal.contact.metaCampaignName && (
                <div className="inline-flex w-full items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20">
                  <span>Facebook Ads</span>
                  <span className="text-blue-600/70 dark:text-blue-300/70">· {deal.contact.metaCampaignName}</span>
                </div>
              )}
              {deal.contact.source && !deal.contact.metaCampaignName && (
                <div className="inline-flex w-full items-center gap-1.5 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700">
                  Origem: {deal.contact.source}
                </div>
              )}
            </div>
          )}

          <div className="card space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Qualificação do lead</h3>
              {(() => {
                const qual = localQualification ?? deal.contact.leadQualification;
                if (!qual) return null;
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    qual === "QUALIFIED"
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
                      : "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
                  }`}>
                    {qual === "QUALIFIED" ? <ThumbsUp className="h-3 w-3" strokeWidth={2.5} /> : <ThumbsDown className="h-3 w-3" strokeWidth={2.5} />}
                    {qual === "QUALIFIED" ? "Qualificado" : "Desqualificado"}
                  </span>
                );
              })()}
            </div>

            {canEditDetails && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={leadQualStatus.saving}
                  onClick={() => setLeadQualification(
                    (localQualification ?? deal.contact.leadQualification) === "QUALIFIED" ? null : "QUALIFIED"
                  )}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    (localQualification ?? deal.contact.leadQualification) === "QUALIFIED"
                      ? "bg-emerald-600 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-emerald-50 hover:text-emerald-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
                  } disabled:opacity-50`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2} />
                  {(localQualification ?? deal.contact.leadQualification) === "QUALIFIED" ? "Remover" : "Qualificado"}
                </button>
                <button
                  type="button"
                  disabled={leadQualStatus.saving}
                  onClick={() => setLeadQualification(
                    (localQualification ?? deal.contact.leadQualification) === "UNQUALIFIED" ? null : "UNQUALIFIED"
                  )}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    (localQualification ?? deal.contact.leadQualification) === "UNQUALIFIED"
                      ? "bg-neutral-700 text-white dark:bg-neutral-600"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  } disabled:opacity-50`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" strokeWidth={2} />
                  {(localQualification ?? deal.contact.leadQualification) === "UNQUALIFIED" ? "Remover" : "Desqualificado"}
                </button>
                {leadQualStatus.saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" strokeWidth={2.5} />}
              </div>
            )}

            {(() => {
              const qual = localQualification ?? deal.contact.leadQualification;
              const qualAt = localQualificationAt ?? deal.contact.leadQualificationAt;
              if (!qual || !qualAt) {
                if (leadQualStatus.error) return <p className="text-xs text-red-600 dark:text-red-400">{leadQualStatus.error}</p>;
                return null;
              }
              return (
                <div className="space-y-1 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-500 dark:bg-neutral-800/40 dark:text-neutral-400">
                  <p>
                    Classificado em {new Date(qualAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  {deal.contact.qualifiedBy && <p>por {deal.contact.qualifiedBy.name}</p>}
                </div>
              );
            })()}
            {leadQualStatus.error && (
              <p className="text-xs text-red-600 dark:text-red-400">{leadQualStatus.error}</p>
            )}
          </div>

          <div className="card space-y-3 p-4 text-sm border border-neutral-200 dark:border-neutral-800/80 shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-brand" strokeWidth={2} />
                <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Dados do contato</h3>
              </div>
              <Link
                href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
                className="text-xs font-medium text-brand hover:underline"
              >
                Ver ficha →
              </Link>
            </div>
            
            {/* Barra de ações rápidas no card do contato */}
            <div className="grid grid-cols-3 gap-1.5 pt-0.5 pb-1 border-b border-neutral-100 dark:border-neutral-800/60">
              {deal.contact.phone || deal.contact.whatsapp ? (
                <a
                  href={`tel:${normalizePhoneNumber(deal.contact.phone || deal.contact.whatsapp || "")}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors"
                  title="Ligar para contato"
                >
                  <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>Ligar</span>
                </a>
              ) : null}
              {deal.contact.whatsapp || deal.contact.phone ? (
                <a
                  href={`https://wa.me/${normalizePhoneNumber(deal.contact.whatsapp || deal.contact.phone || "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors"
                  title="Abrir WhatsApp"
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>Whats</span>
                </a>
              ) : null}
              {deal.contact.email ? (
                <a
                  href={`mailto:${deal.contact.email}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-500/10 py-1.5 text-xs font-medium text-sky-600 hover:bg-sky-500/20 dark:text-sky-400 transition-colors"
                  title="Enviar e-mail"
                >
                  <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>E-mail</span>
                </a>
              ) : null}
            </div>
            <EditableRow
              label="Nome"
              value={deal.contact.name}
              editable={canEditDetails}
              onSave={(v) => saveContactField("name", v)}
              onShowFix={showResponsavelFix}
            />
            <EditableRow
              label="E-mail"
              value={deal.contact.email ?? ""}
              type="email"
              editable={canEditDetails}
              onSave={(v) => saveContactField("email", v)}
              onShowFix={showResponsavelFix}
            />
            <EditableRow
              label="Celular"
              value={deal.contact.phone ?? ""}
              editable={canEditDetails}
              onSave={(v) => saveContactField("phone", v)}
              onShowFix={showResponsavelFix}
            />
            <EditableRow
              label="WhatsApp"
              value={deal.contact.whatsapp ?? ""}
              editable={canEditDetails}
              onSave={(v) => saveContactField("whatsapp", v)}
              onShowFix={showResponsavelFix}
            />
            <EditableRow
              label="Cargo"
              value={deal.contact.jobTitle ?? ""}
              type="select"
              options={jobTitleOptions}
              editable={canEditDetails}
              onSave={(v) => saveContactField("jobTitle", v)}
              onShowFix={showResponsavelFix}
            />
            <EditableRow
              label="Origem"
              value={deal.contact.source ?? ""}
              type="select"
              options={sourceOptions}
              editable={canEditDetails}
              onSave={(v) => saveContactField("source", v)}
              onShowFix={showResponsavelFix}
            />
            {/* Pedido explícito: mostrar/editar o responsável do CONTATO
                (independente do responsável do negócio, que já tem seu
                próprio seletor no card "Dados do negócio" mais abaixo — os
                dois podem divergir, ver comentário em confirmReassignOwner)
                direto aqui. Sem responsável, quem edita assume
                automaticamente (regra de app/api/contacts/[id]/route.ts,
                sem precisar de gestor); pertencendo a outro consultor
                continua bloqueado, mas o botão "Mostrar como ajustar" do
                ErrorDialog das linhas acima traz o usuário direto pra cá
                (autoEditSignal). */}
            <EditableRow
              label="Responsável"
              value={deal.contact.responsavelId ?? ""}
              displayValue={deal.contact.responsavel?.name ?? "Ninguém"}
              type="select"
              options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
              editable={canEditDetails}
              onSave={(v) => saveContactField("responsavelId", v)}
              autoEditSignal={responsavelFocusTrigger}
            />
          </div>
        </div>
      </div>

      {/* Mobile — abas em vez de grade lado a lado; reaproveita os mesmos
          handlers/estado de cima, só reorganiza a apresentação. */}
      <div className="lg:hidden">
        <div className="relative mb-3 flex w-full rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
          <div
            className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-white shadow-sm transition-transform duration-200 ease-spring dark:bg-neutral-900"
            style={{ transform: mobileTab === "details" ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
          />
          <button
            onClick={() => setMobileTab("activities")}
            className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors active:scale-[0.97] ${
              mobileTab === "activities"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            <span>Atividades</span>
            {deal.activities.length > 0 && (
              <span className="rounded-full bg-neutral-200/80 px-1.5 py-0.2 text-[10px] text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
                {deal.activities.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setMobileTab("details")}
            className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors active:scale-[0.97] ${
              mobileTab === "details"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            <span>Detalhes & Tarefas</span>
            {pendingTasksCount > 0 ? (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                {pendingTasksCount}
              </span>
            ) : deal.tasks.length > 0 ? (
              <span className="rounded-full bg-neutral-200/80 px-1.5 py-0.2 text-[10px] text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
                {deal.tasks.length}
              </span>
            ) : null}
          </button>
        </div>

        {mobileTab === "activities" ? (
          <div className="animate-bubble-in space-y-4">
            <div className="card p-3.5">
              <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
                {ACTIVITY_TABS.map((tab) => (
                  <button
                    key={tab.type}
                    onClick={() => selectTab(tab.type)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                      activeTab === tab.type
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                        : "bg-neutral-100 text-neutral-600 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:active:bg-neutral-700"
                    }`}
                  >
                    <tab.icon className="h-3.5 w-3.5" strokeWidth={2} />
                    {tab.label}
                  </button>
                ))}
              </div>
              <form onSubmit={submitActivity} className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Registro de {ACTIVITY_TABS.find((t) => t.type === activeTab)?.label.toLowerCase()}
                    </span>
                    <VoiceInputButton onResult={bodyDictation.onResult} onInterimResult={bodyDictation.onInterimResult} />
                  </div>
                  <textarea
                    ref={mobileTextareaRef}
                    value={bodyDictation.value}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="O que foi feito e qual o próximo passo? (ou ditar por voz)"
                    rows={3}
                    className="field-input text-sm"
                  />
                </div>
                {(activeTab === "MEETING" || activeTab === "VISIT") && !dueDate && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Resultado:</span>
                    {MEETING_OUTCOME_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setMeetingOutcome(opt.value)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                          meetingOutcome === opt.value ? opt.activeClass : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex gap-2">
                    <div className="space-y-1 flex-1 sm:flex-initial">
                      <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Prazo da próxima ação</label>
                      <DatePicker value={dueDate} onChange={setDueDate} className="w-full px-2 py-1.5 text-xs" />
                    </div>
                    <div className="space-y-1 w-24">
                      <label className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Horário</label>
                      <TimePicker value={dueTime} onChange={setDueTime} disabled={!dueDate} className="w-full px-2 py-1.5 text-xs" />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saving || !body.trim() || ((activeTab === "MEETING" || activeTab === "VISIT") && !dueDate && !meetingOutcome)}
                    className="btn-primary w-full py-2.5 text-sm font-semibold sm:w-auto sm:py-1.5"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                    {saving ? (
                      <span className="inline-flex items-center gap-1">
                        Salvando
                        <LoadingDots />
                      </span>
                    ) : (
                      "Registrar Atividade"
                    )}
                  </button>
                </div>
                {activeTab === "WHATSAPP" && (
                  <ScheduleWhatsAppToggle value={scheduleWhatsApp} onChange={setScheduleWhatsApp} disabled={!dueDate} />
                )}
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
                  canEdit={canEditActivity(activity)}
                  onConfirmDelete={confirmDeleteActivity}
                  onSave={saveActivityEdit}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="animate-bubble-in space-y-4">
            <DealValueCard label="Valor líquido" value={deal.value} editable={canEditDetails} onSave={saveDealValue} />
          <DealValueCard label="Valor bruto" value={deal.grossValue} editable={canEditDetails} onSave={saveDealGrossValue} />

            {!chatOpen && whatsappThreadId && (
              <WhatsAppPanelTrigger onOpen={() => setChatOpen(true)} hasUnread={hasUnreadWhatsApp} />
            )}

            <ProposalsCard dealId={deal.id} proposals={proposals} defaultDescription={defaultProposalDescription} />

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
                            · Prazo: {new Date(task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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
                    onChange={setPendingOwnerId}
                    className="py-1 text-xs"
                    options={members.map((m) => ({ value: m.id, label: m.name }))}
                  />
                </span>
              </div>
              <Row label="Criado em" value={new Date(deal.createdAt).toLocaleDateString("pt-BR")} />
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

            {deal.status === "LOST" && (deal.lossReason || deal.lostReason) && (
              <div className="card space-y-2 border-red-100 bg-red-50/40 p-4 text-sm dark:border-red-900 dark:bg-red-500/10">
                <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Motivo da perda</h3>
                <Row label="Motivo" value={deal.lossReason?.label ?? deal.lostReason ?? ""} />
                {deal.lossReason && deal.lostReason && <Row label="Detalhes" value={deal.lostReason} />}
              </div>
            )}

            {(deal.contact.metaCampaignName || deal.contact.source) && (
              <div className="card space-y-2 p-4 text-sm">
                <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Origem do lead</h3>
                {deal.contact.metaCampaignName && (
                  <div className="inline-flex w-full items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20">
                    <span>Facebook Ads</span>
                    <span className="text-blue-600/70 dark:text-blue-300/70">· {deal.contact.metaCampaignName}</span>
                  </div>
                )}
                {deal.contact.source && !deal.contact.metaCampaignName && (
                  <div className="inline-flex w-full items-center gap-1.5 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700">
                    Origem: {deal.contact.source}
                  </div>
                )}
              </div>
            )}

            <div className="card space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Qualificação do lead</h3>
                {(() => {
                  const qual = localQualification ?? deal.contact.leadQualification;
                  if (!qual) return null;
                  return (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      qual === "QUALIFIED"
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
                        : "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
                    }`}>
                      {qual === "QUALIFIED" ? <ThumbsUp className="h-3 w-3" strokeWidth={2.5} /> : <ThumbsDown className="h-3 w-3" strokeWidth={2.5} />}
                      {qual === "QUALIFIED" ? "Qualificado" : "Desqualificado"}
                    </span>
                  );
                })()}
              </div>

              {canEditDetails && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={leadQualStatus.saving}
                    onClick={() => setLeadQualification(
                      (localQualification ?? deal.contact.leadQualification) === "QUALIFIED" ? null : "QUALIFIED"
                    )}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      (localQualification ?? deal.contact.leadQualification) === "QUALIFIED"
                        ? "bg-emerald-600 text-white"
                        : "bg-neutral-100 text-neutral-600 hover:bg-emerald-50 hover:text-emerald-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
                    } disabled:opacity-50`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2} />
                    {(localQualification ?? deal.contact.leadQualification) === "QUALIFIED" ? "Remover" : "Qualificado"}
                  </button>
                  <button
                    type="button"
                    disabled={leadQualStatus.saving}
                    onClick={() => setLeadQualification(
                      (localQualification ?? deal.contact.leadQualification) === "UNQUALIFIED" ? null : "UNQUALIFIED"
                    )}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      (localQualification ?? deal.contact.leadQualification) === "UNQUALIFIED"
                        ? "bg-neutral-700 text-white dark:bg-neutral-600"
                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    } disabled:opacity-50`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" strokeWidth={2} />
                    {(localQualification ?? deal.contact.leadQualification) === "UNQUALIFIED" ? "Remover" : "Desqualificado"}
                  </button>
                  {leadQualStatus.saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" strokeWidth={2.5} />}
                </div>
              )}

              {(() => {
                const qual = localQualification ?? deal.contact.leadQualification;
                const qualAt = localQualificationAt ?? deal.contact.leadQualificationAt;
                if (!qual || !qualAt) {
                  if (leadQualStatus.error) return <p className="text-xs text-red-600 dark:text-red-400">{leadQualStatus.error}</p>;
                  return null;
                }
                return (
                  <div className="space-y-1 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-500 dark:bg-neutral-800/40 dark:text-neutral-400">
                    <p>
                      Classificado em {new Date(qualAt).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {deal.contact.qualifiedBy && <p>por {deal.contact.qualifiedBy.name}</p>}
                  </div>
                );
              })()}
              {leadQualStatus.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{leadQualStatus.error}</p>
              )}
            </div>

            <div className="card space-y-2 p-4 text-sm">
              <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados do contato</h3>
              <EditableRow
                label="Nome"
                value={deal.contact.name}
                editable={canEditDetails}
                onSave={(v) => saveContactField("name", v)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="E-mail"
                value={deal.contact.email ?? ""}
                type="email"
                editable={canEditDetails}
                onSave={(v) => saveContactField("email", v)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="Celular"
                value={deal.contact.phone ?? ""}
                editable={canEditDetails}
                onSave={(v) => saveContactField("phone", v)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="WhatsApp"
                value={deal.contact.whatsapp ?? ""}
                editable={canEditDetails}
                onSave={(v) => saveContactField("whatsapp", v)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="Cargo"
                value={deal.contact.jobTitle ?? ""}
                type="select"
                options={jobTitleOptions}
                editable={canEditDetails}
                onSave={(v) => saveContactField("jobTitle", v)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="Origem"
                value={deal.contact.source ?? ""}
                type="select"
                options={sourceOptions}
                editable={canEditDetails}
                onSave={(v) => saveContactField("source", v)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="Responsável"
                value={deal.contact.responsavelId ?? ""}
                displayValue={deal.contact.responsavel?.name ?? "Ninguém"}
                type="select"
                options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
                editable={canEditDetails}
                onSave={(v) => saveContactField("responsavelId", v)}
                autoEditSignal={responsavelFocusTrigger}
              />
            </div>
          </div>
        )}
      </div>

      {wonDialogOpen && (
        <ClosedAtDialog
          title="Quando foi ganho?"
          confirmLabel="Marcar como ganho"
          confirmClassName="btn-primary"
          onClose={() => setWonDialogOpen(false)}
          onConfirm={confirmWon}
        />
      )}

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
          canDelete={canDeleteTask}
          onDelete={async () => {
            await deleteTask(editingTask.id);
            setEditingTask(null);
          }}
          onSave={async (fields) => {
            const result = await saveTask(editingTask.id, fields);
            // Reagendou uma Reunião com data definida — mesmo convite
            // oferecido na criação, agora pro novo horário.
            if (result.ok && editingTask.type === "MEETING" && fields.dueAt) {
              setMeetingInviteTask({
                id: editingTask.id,
                title: fields.title,
                dueAt: fields.dueAt,
                contact: { id: deal.contact.id, name: deal.contact.name, phone: deal.contact.phone, whatsapp: deal.contact.whatsapp },
                owner: { id: deal.owner.id, name: deal.owner.name },
                ownerHasGoogleCalendarWriteAccess: !!result.ownerGoogleCalendarWriteConnected,
              });
            }
            return result;
          }}
        />
      )}

      {meetingInviteTask && (
        <MeetingInviteDialog
          task={meetingInviteTask}
          isWhatsAppConnected={isWhatsAppConnected}
          onClose={() => setMeetingInviteTask(null)}
        />
      )}

      {meetingOutcomeTaskId && (
        <MeetingOutcomeDialog
          taskType={deal.tasks.find((t) => t.id === meetingOutcomeTaskId)?.type === "VISIT" ? "VISIT" : "MEETING"}
          onResolve={resolveMeetingOutcome}
          onClose={() => setMeetingOutcomeTaskId(null)}
        />
      )}

      {pendingOwnerId && (
        <ConfirmDialog
          title={`Reatribuir para ${pendingOwnerName ?? "outro responsável"}?`}
          description={`O negócio "${deal.name}" passa a ser de ${pendingOwnerName ?? "outra pessoa"} — o contato vinculado também muda de responsável junto.`}
          confirmLabel="Reatribuir"
          onClose={() => setPendingOwnerId(null)}
          onConfirm={() => confirmReassignOwner(pendingOwnerId)}
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
            sendAsAlternate={sendAsAlternate}
            onClose={() => setChatOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex flex-col bg-white p-4 dark:bg-neutral-950 lg:hidden">
            <ChatWindow
              threadId={whatsappThreadId}
              contactId={deal.contact.id}
              contactName={deal.contact.name}
              contactPhone={deal.contact.whatsapp || deal.contact.phone}
              sendAsAlternate={sendAsAlternate}
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

function EditTaskModal({
  task,
  onClose,
  onSave,
  canDelete,
  onDelete,
}: {
  task: { id: string; title: string; type?: string; dueAt: string | Date | null };
  onClose: () => void;
  onSave: (fields: { title: string; dueAt: string | null }) => Promise<{ ok: boolean; error?: string }>;
  /** Só o Dono da organização pode excluir — ver DELETE /api/tasks/[id]. */
  canDelete?: boolean;
  onDelete?: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(toDateInputValue(task.dueAt));
  const [dueTime, setDueTime] = useState(toTimeInputValue(task.dueAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

        <div className="flex items-center justify-between gap-2 pt-2">
          {/* Excluir — só o Dono vê este botão (ver DELETE /api/tasks/[id], restrito a OWNER). */}
          {canDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="icon-btn text-neutral-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400"
              aria-label="Excluir"
              title="Excluir"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
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
        </div>
      </form>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Excluir "${task.title}"?`}
          description={
            task.type === "MEETING"
              ? "Se esta reunião veio de um agendamento externo (landing page), o horário volta a ficar disponível pra outro lead reservar. Dá pra desfazer logo em seguida, pelo aviso que aparece no canto da tela (ou Ctrl+Z)."
              : "Dá pra desfazer logo em seguida, pelo aviso que aparece no canto da tela (ou Ctrl+Z)."
          }
          confirmLabel="Excluir"
          onClose={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await onDelete?.();
            setConfirmingDelete(false);
          }}
        />
      )}
    </Modal>
  );
}

function DealValueCard({
  label,
  value,
  editable,
  onSave,
}: {
  label: string;
  value: number | null;
  editable: boolean;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    if (!editable) {
      return (
        <div className="card p-4 text-sm bg-white dark:bg-gradient-to-br dark:from-neutral-900 dark:to-neutral-900/90 border border-neutral-200 dark:border-neutral-800 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{label}</p>
            <Wallet className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{formatCurrency(value)}</p>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value != null ? String(value) : "");
          setError(null);
          setEditing(true);
        }}
        className="card group w-full p-4 text-left text-sm transition-all duration-200 hover:border-brand/40 hover:bg-neutral-50 dark:hover:bg-neutral-900/95 border border-neutral-200 dark:border-neutral-800 shadow-sm"
        aria-label={`Editar ${label.toLowerCase()}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-4 w-4 text-brand" strokeWidth={2} />
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{label}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand transition-transform group-hover:scale-105 dark:bg-brand/20 dark:text-brand-light">
            <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} />
            Editar
          </span>
        </div>
        <p className={`mt-2 text-2xl font-bold tracking-tight ${value ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}>
          {formatCurrency(value)}
        </p>
      </button>
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
      <p className="text-neutral-500 dark:text-neutral-400">{label}</p>
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
    <div className="card space-y-2 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Campos personalizados</h3>
        {/* Selo sempre visível (não só no hover) — mesmo tratamento "chamativo"
            de DealValueCard, pedido explícito. Card com N campos, então fica
            só no header (não vira o card inteiro clicável como lá — cada
            linha abaixo já tem seu próprio texto/valor, um botão cobrindo
            tudo isso seria estranho de usar). */}
        {editable && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(values);
              setError(null);
              setEditing(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-semibold text-brand transition-transform hover:scale-105 dark:bg-brand-light"
            aria-label="Editar campos personalizados"
          >
            <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} />
            Editar
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
      <span className="font-medium text-neutral-600 dark:text-neutral-400">{label}</span>
      <span className="text-right font-semibold text-neutral-900 dark:text-neutral-200">{value}</span>
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
  onShowFix,
  autoEditSignal,
}: {
  label: string;
  value: string;
  /** Como mostrar o valor fora do modo edição, se diferente do value bruto (ex.: data formatada). */
  displayValue?: string;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string; type?: ErrorType; details?: string; conflict?: ContactConflict }>;
  type?: "text" | "email" | "textarea" | "date" | "select";
  /** Só usado quando type="select" — lista de opções fixas (ex.: cargo). */
  options?: { value: string; label: string }[];
  editable: boolean;
  /** Erro de permissão desta linha tem "jeito de resolver" em OUTRA linha do
      mesmo card (hoje: contato de outro consultor → aponta pra
      "Responsável") — quando presente, o ErrorDialog ganha o botão
      "Mostrar como ajustar" chamando isto em vez de só fechar o modal. */
  onShowFix?: () => void;
  /** Incrementado externamente (por outra linha, via onShowFix) pra forçar
      ESTA linha a abrir em edição, rolar até si mesma e piscar um destaque —
      é assim que "Mostrar como ajustar" leva o usuário até o campo certo. */
  autoEditSignal?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Modal (não mais texto vermelho pequeno) — pedido explícito: sempre
  // mostrar o motivo REAL de por que a edição falhou (ex.: "Contato sem
  // responsável. Peça atribuição a um gestor." em vez de só "Sem permissão
  // para editar" sem explicar nada), mesmo componente/padrão que
  // components/edit-contact-dialog.tsx já usa.
  const [errorDialog, setErrorDialog] = useState<{ message: string; type?: ErrorType; details?: string } | null>(null);
  const [conflictDialog, setConflictDialog] = useState<{ message: string; conflict: ContactConflict } | null>(null);
  const [highlight, setHighlight] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const lastSignal = useRef(autoEditSignal);

  useEffect(() => {
    if (autoEditSignal === undefined || autoEditSignal === lastSignal.current) return;
    lastSignal.current = autoEditSignal;
    if (!editable) return; // nada pra "mostrar" se esta linha nem é editável por quem está vendo
    setDraft(value);
    setEditing(true);
    setHighlight(true);
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => setHighlight(false), 2200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditSignal]);

  const highlightClass = highlight
    ? "bg-brand/10 ring-2 ring-brand/40 dark:bg-brand/15"
    : "ring-2 ring-transparent";

  if (!editable) return <Row label={label} value={displayValue ?? value ?? "—"} />;

  if (!editing) {
    return (
      <div
        ref={rowRef}
        className={`group -mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-0.5 transition-colors duration-700 ${highlightClass}`}
      >
        <span className="font-medium text-neutral-600 dark:text-neutral-400">{label}</span>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="group/field flex min-w-0 items-center gap-1 rounded text-right"
        >
          <span className="truncate font-semibold text-neutral-900 transition-colors group-hover/field:text-brand dark:text-neutral-200">
            {displayValue ?? (value || "—")}
          </span>
          <Pencil
            className="h-3 w-3 shrink-0 text-brand opacity-40 transition-opacity group-hover/field:opacity-100 group-focus-visible/field:opacity-100 coarse:opacity-100"
            strokeWidth={2}
          />
        </button>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.ok) {
      if (result.conflict) {
        setConflictDialog({ message: result.error ?? "Este número já está cadastrado em outro contato.", conflict: result.conflict });
        return;
      }
      setErrorDialog({ message: result.error ?? "Erro ao salvar", type: result.type, details: result.details });
      return;
    }
    setEditing(false);
  }

  // "Mostrar como ajustar" só faz sentido pra erro de permissão E quando
  // esta linha sabe pra onde apontar — hoje isso é sempre "contato pertence
  // a outro consultor" (o outro motivo, "sem responsável", se resolve
  // sozinho na hora, sem chegar a virar erro — ver app/api/contacts/[id]/route.ts).
  const canShowFix = errorDialog?.type === "PERMISSION" && !!onShowFix;

  return (
    <div ref={rowRef} className={`-mx-2 space-y-1 rounded-lg px-2 py-1 transition-colors duration-700 ${highlightClass}`}>
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
      {conflictDialog && (
        <Modal onClose={() => setConflictDialog(null)} maxWidth="max-w-md">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Número já cadastrado</h2>
          <p className="mt-1 mb-3 text-sm text-neutral-600 dark:text-neutral-300">
            {conflictDialog.message} A alteração não foi salva.
          </p>
          <ContactConflictNotice conflict={conflictDialog.conflict} />
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setConflictDialog(null)} className="btn-ghost">
              Fechar
            </button>
          </div>
        </Modal>
      )}
      {errorDialog && (
        <ErrorDialog
          message={errorDialog.message}
          type={errorDialog.type}
          details={errorDialog.details}
          onClose={() => setErrorDialog(null)}
          actionLabel={canShowFix ? "Mostrar como ajustar" : undefined}
          onAction={
            canShowFix
              ? () => {
                  setErrorDialog(null);
                  setEditing(false);
                  onShowFix!();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
