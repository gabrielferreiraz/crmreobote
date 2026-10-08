"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, StickyNote, CircleDot, CheckCircle2, XCircle, Clock, Loader2, Pencil, Check, X, ThumbsUp, ThumbsDown, Trash2, User, Phone, MessageSquare, Mic, ChevronRight, Briefcase, CalendarCheck, UserCheck, Mail, ExternalLink, FileText, ListTodo, Plus, MoreHorizontal } from "lucide-react";
import { formatCurrency, daysSince } from "@/lib/format";
import { isStale } from "@/lib/stale";
import { normalizePhoneNumber, toDialNumber } from "@/lib/phone-normalize";
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
import { requestJson } from "@/lib/client-request";
import { ProposalsCard } from "@/components/proposals/proposals-card";
import type { ProposalDTO } from "@/lib/proposals/types";
import { trackUse } from "@/lib/feature-usage/track";
import { CompleteRequiredFieldsDialog, type RequirableFieldValues } from "@/components/complete-required-fields-dialog";
import type { RequirableDealField } from "@/lib/deal-required-fields";

const COMPOSER_TABS = [...ACTIVITY_TABS, { type: "PROPOSAL", label: "Proposta", icon: FileText }];

function needsJobTitleBeforeWinning(jobTitle: string | null) {
  return !jobTitle?.trim() || jobTitle.trim().toLocaleLowerCase("pt-BR") === "indefinido";
}

function missingFinancialValues(value: number | null, grossValue: number | null): RequirableDealField[] {
  return [
    ...(value == null ? ["value" as const] : []),
    ...(grossValue == null ? ["grossValue" as const] : []),
  ];
}

// Só carregam depois que a pessoa de fato abre o painel/confete/convite/
// ditado por voz — cada um puxa dependências pesadas (chat com QR/mídia/
// áudio, canvas de confete, Web Speech API) que a maioria das visitas a esta
// página nunca aciona. `ssr: false` porque todos são só client-side de
// qualquer forma (efeito visual, gravação de mídia, WebSpeech).
const MOBILE_EDITOR_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([disabled]):not([readonly])',
  "textarea:not([disabled]):not([readonly])",
  "select:not([disabled])",
  '[contenteditable="true"]',
].join(",");

function findVerticalScroller(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (/auto|scroll|overlay/.test(overflowY)) return parent;
    parent = parent.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
}

function centerEditorInMobileViewport(element: HTMLElement, behavior: ScrollBehavior) {
  if (!element.isConnected || window.matchMedia("(min-width: 1024px)").matches) return;

  const viewport = window.visualViewport;
  let visibleTop = viewport?.offsetTop ?? 0;
  let visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
  const scroller = findVerticalScroller(element);
  const isDocumentScroller = scroller === document.documentElement || scroller === document.body;

  if (!isDocumentScroller) {
    const scrollerRect = scroller.getBoundingClientRect();
    visibleTop = Math.max(visibleTop, scrollerRect.top);
    visibleBottom = Math.min(visibleBottom, scrollerRect.bottom);
  }

  // Alguns navegadores posicionam a barra inferior acima do teclado. Se ela
  // estiver dentro da viewport visível, esse espaço não pode contar no centro.
  const bottomNav = document.getElementById("mobile-bottom-nav");
  if (bottomNav && window.getComputedStyle(bottomNav).display !== "none") {
    const navRect = bottomNav.getBoundingClientRect();
    if (navRect.top > visibleTop && navRect.top < visibleBottom) visibleBottom = navRect.top;
  }

  visibleTop += 12;
  visibleBottom -= 12;
  if (visibleBottom <= visibleTop) return;

  const fieldRect = element.getBoundingClientRect();
  const fieldCenter = fieldRect.top + Math.min(fieldRect.height, visibleBottom - visibleTop) / 2;
  const targetCenter = visibleTop + (visibleBottom - visibleTop) / 2;
  const delta = fieldCenter - targetCenter;
  if (Math.abs(delta) < 4) return;

  scroller.scrollBy({ top: delta, behavior });
}

function useMobileEditorCentering() {
  useEffect(() => {
    if (!window.matchMedia("(max-width: 1023.98px)").matches) return;

    const viewport = window.visualViewport;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smoothBehavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";
    let activeEditor: HTMLElement | null = null;
    let animationFrame = 0;
    let settleTimer = 0;
    const focusTimers = new Set<number>();

    function isEditor(target: EventTarget | null): target is HTMLElement {
      return target instanceof HTMLElement && target.matches(MOBILE_EDITOR_SELECTOR);
    }

    function centerActive(behavior: ScrollBehavior) {
      if (!activeEditor || document.activeElement !== activeEditor) return;
      centerEditorInMobileViewport(activeEditor, behavior);
    }

    function scheduleFocusCentering(editor: HTMLElement) {
      activeEditor = editor;
      for (const timer of focusTimers) window.clearTimeout(timer);
      focusTimers.clear();

      // Android e iOS terminam a animação do teclado em tempos diferentes.
      // As passagens finais usam a viewport já reduzida pelo teclado aberto.
      for (const delay of [40, 180, 360, 520]) {
        const timer = window.setTimeout(() => {
          focusTimers.delete(timer);
          centerActive(delay === 520 ? smoothBehavior : "auto");
        }, delay);
        focusTimers.add(timer);
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (isEditor(event.target)) scheduleFocusCentering(event.target);
    }

    function handleFocusOut() {
      window.setTimeout(() => {
        if (!isEditor(document.activeElement)) activeEditor = null;
      }, 0);
    }

    function handleViewportChange() {
      if (!activeEditor || document.activeElement !== activeEditor) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => centerActive("auto"));
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => centerActive(smoothBehavior), 120);
    }

    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);
    if (!viewport) window.addEventListener("resize", handleViewportChange);

    return () => {
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      if (!viewport) window.removeEventListener("resize", handleViewportChange);
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(settleTimer);
      for (const timer of focusTimers) window.clearTimeout(timer);
    };
  }, []);
}

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
  activityId: string | null;
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (activity.type === "SYSTEM") {
    const isProposalEvent = activity.body?.toLocaleLowerCase("pt-BR").includes("proposta");
    return (
      <div
        id={`activity-${activity.id}`}
        className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 py-1 text-xs font-medium ${
          isProposalEvent
            ? "text-indigo-600 dark:text-indigo-400 font-semibold"
            : "text-neutral-700 dark:text-neutral-200"
        } ${highlighted ? "animate-highlight-once" : ""}`}
      >
        {isProposalEvent && <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" strokeWidth={2} />}
        <span>{activity.user.name} {activity.body}</span>
        <span className="font-normal text-neutral-400 dark:text-neutral-400 text-[11px]"> · {new Date(activity.createdAt).toLocaleString("pt-BR")}</span>
      </div>
    );
  }

  const isMeetingOrVisit = activity.type === "VIDEO_CALL" || activity.type === "VISIT";
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
    VIDEO_CALL: "bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400 ring-1 ring-violet-500/30",
    VISIT: "bg-rose-500/15 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 ring-1 ring-rose-500/30",
    PROPOSAL: "bg-indigo-500/15 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 ring-1 ring-indigo-500/30",
    EMAIL: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400 ring-1 ring-cyan-500/30",
    NOTE: "bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-1 ring-amber-500/30",
  };
  const iconColorClass = activityTypeColors[activity.type] ?? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  const editableMeetingOutcomes = [
    { value: "PENDING" as const, label: "Aguardando", icon: Clock },
    ...MEETING_OUTCOME_OPTIONS,
  ];

  function mobileOutcomeSelectedClass(value: (typeof editableMeetingOutcomes)[number]["value"]) {
    if (value === "ATTENDED") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    if (value === "NO_SHOW") return "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300";
    if (value === "RESCHEDULED") return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
    return "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-hover";
  }

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
              <>
                <fieldset className="space-y-1.5 lg:hidden">
                  <legend className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                    Resultado da atividade
                  </legend>
                  <div className="grid grid-cols-2 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50/60 dark:border-white/10 dark:bg-white/[0.025]">
                    {editableMeetingOutcomes.map((opt, index) => {
                      const OutcomeIcon = opt.icon;
                      const selected = meetingOutcome === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setMeetingOutcome(opt.value)}
                          aria-pressed={selected}
                          className={`flex min-h-11 items-center justify-center gap-2 px-2 py-2 text-center text-xs font-medium transition-colors ${
                            index % 2 === 0 ? "border-r border-neutral-200 dark:border-white/10" : ""
                          } ${index < 2 ? "border-b border-neutral-200 dark:border-white/10" : ""} ${
                            selected
                              ? mobileOutcomeSelectedClass(opt.value)
                              : "bg-transparent text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-white/[0.05]"
                          }`}
                        >
                          <OutcomeIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="hidden flex-wrap gap-1.5 lg:flex">
                  {editableMeetingOutcomes.map((opt) => (
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
              </>
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
            <div className="activity-item__content-row flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {activity.body && <p className="whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-200 lg:dark:text-neutral-300">{activity.body}</p>}
              </div>
              <div className="activity-item__actions hidden shrink-0 items-start gap-1 lg:flex">
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
            <div className="mt-1 hidden min-w-0 items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500 lg:flex">
              <Avatar name={activity.user.name} src={activity.user.photoUrl} size="xs" />
              <span className="min-w-0 truncate">
                {activity.user.name} · {new Date(activity.createdAt).toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-400 lg:hidden">
              <Avatar name={activity.user.name} src={activity.user.photoUrl} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                {activity.user.name} · {new Date(activity.createdAt).toLocaleString("pt-BR")}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                {activity.meetingOutcome && (
                  <span
                    className={`text-[10px] font-medium ${
                      activity.meetingOutcome === "ATTENDED"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : activity.meetingOutcome === "NO_SHOW"
                          ? "text-red-600 dark:text-red-400"
                          : "text-neutral-500 dark:text-neutral-400"
                    }`}
                  >
                    {activity.meetingOutcome === "PENDING"
                      ? "Aguardando"
                      : MEETING_OUTCOME_OPTIONS.find((option) => option.value === activity.meetingOutcome)?.label}
                  </span>
                )}
                {canEdit && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen((open) => !open)}
                      className="icon-btn !min-h-8 !min-w-8 text-neutral-400 dark:text-neutral-500 dark:active:text-neutral-300"
                      aria-label="Ações da atividade"
                      aria-expanded={mobileMenuOpen}
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
                    </button>
                    {mobileMenuOpen && (
                      <div className="surface-glass-panel absolute right-0 bottom-9 z-20 min-w-32 overflow-hidden rounded-md py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setMobileMenuOpen(false);
                            startEdit();
                          }}
                          className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs text-neutral-700 dark:text-neutral-200"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMobileMenuOpen(false);
                            onConfirmDelete(activity);
                          }}
                          className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
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
  /** WhatsApp do responsável pelo negócio conectado — condição pro convite de videochamada oferecer "enviar" (ver MeetingInviteDialog). */
  isWhatsAppConnected: boolean;
  /** Dono, Gerente ou Supervisor vendo o negócio de outro consultor, com
   * WhatsApp próprio conectado — deixa trocar pra "enviar como você" em vez
   * do padrão (que já é a conversa real do responsável, ver page.tsx). */
  sendAsAlternate?: { threadId: string; label: string; defaultLabel: string } | null;
  /** Só o dono do negócio ou um OWNER da conta pode editar os campos com lápis. */
  canEditDetails: boolean;
  /** Excluir tarefa (Videochamada/Visita/etc.) é restrito ao Dono da organização — ver DELETE /api/tasks/[id]. */
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
  useMobileEditorCentering();
  const canDeleteTask = currentUserRole === "OWNER";
  const [activeTab, setActiveTab] = useState("NOTE");
  const [sidebarTab, setSidebarTab] = useState<"general" | "contact">("general");
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
  const [requiredFieldsPrompt, setRequiredFieldsPrompt] = useState<{
    stageId: string;
    stageName: string;
    missingFields: RequirableDealField[];
  } | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  // Só pedido (e só mandado pro servidor) quando activeTab é Videochamada/Visita
  // E não tem Prazo preenchido — com Prazo, uma Task vai ser criada junto,
  // e o resultado passa a ser perguntado só na CONCLUSÃO dela (ver
  // MeetingOutcomeDialog mais abaixo), não aqui. Sem Prazo é um registro
  // retroativo (algo que já aconteceu, sem tarefa futura pra "pendurar" a
  // pergunta depois) — pergunta na hora, sem pré-seleção (era o próprio
  // problema que essa mudança corrige: "Compareceu" marcado por padrão
  // registrava comparecimento antes do encontro acontecer).
  const [meetingOutcome, setMeetingOutcome] = useState<"ATTENDED" | "NO_SHOW" | "RESCHEDULED" | null>(null);
  // Id da Task VIDEO_CALL/VISIT sendo concluída — abre o MeetingOutcomeDialog
  // em vez de concluir direto (ver toggleTask).
  const [meetingOutcomeTaskId, setMeetingOutcomeTaskId] = useState<string | null>(null);
  const [lossDialogOpen, setLossDialogOpen] = useState(false);
  const [wonDialogOpen, setWonDialogOpen] = useState(false);
  const [wonJobTitleDialogOpen, setWonJobTitleDialogOpen] = useState(false);
  const [wonJobTitle, setWonJobTitle] = useState("");
  const [wonJobTitleError, setWonJobTitleError] = useState<string | null>(null);
  const [savingWonJobTitle, setSavingWonJobTitle] = useState(false);
  const [wonValuesPromptOpen, setWonValuesPromptOpen] = useState(false);
  const [savingWonValues, setSavingWonValues] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  // Setado depois de criar/reagendar uma tarefa Videochamada com data definida —
  // abre o MeetingInviteDialog por cima (ver submitActivity/saveTask).
  const [meetingInviteTask, setMeetingInviteTask] = useState<MeetingInviteTask | null>(null);
  // Toggle "Enviar mensagem agendada para o lead" na própria aba WhatsApp
  // do registro rápido (ver ScheduleWhatsAppToggle/submitActivity) — troca o
  // fluxo antigo (criar tarefa → modal separado perguntava depois) por uma
  // decisão só, na hora de registrar.
  const [scheduleWhatsApp, setScheduleWhatsApp] = useState<ScheduleWhatsAppValue>({ enabled: false, message: "" });
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"activities" | "details">("activities");
  const [mobileComposerOpen, setMobileComposerOpen] = useState(false);
  const [showAllActivities, setShowAllActivities] = useState(() => !!searchParams.get("highlightActivity"));
  const [showConfetti, setShowConfetti] = useState(false);
  const [leadQualStatus, setLeadQualStatus] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });
  // Usado pra UI refletir a mudança imediata sem esperar router.refresh()
  const [localQualification, setLocalQualification] = useState<ContactLeadQualification | null>(null);
  const [localQualificationAt, setLocalQualificationAt] = useState<string | Date | null>(null);

  const mobileTextareaRef = useRef<HTMLTextAreaElement>(null);
  const phoneDigits = normalizePhoneNumber(deal.contact.phone);
  // toDialNumber: mesma regra de lib/whatsapp/send.ts na hora de montar o
  // link — corrige o 9º dígito faltante (sem isso o botão abria conversa com
  // o número ERRADO pra todo contato salvo sem o 9) e só põe o 55 em número
  // brasileiro (número de outro país já carrega o próprio DDI).
  const whatsappDigits = normalizePhoneNumber(deal.contact.whatsapp) ?? phoneDigits;
  const directPhoneUrl = phoneDigits ? `tel:+${toDialNumber(phoneDigits)}` : null;
  const directWhatsAppUrl = whatsappDigits ? `https://wa.me/${toDialNumber(whatsappDigits)}` : null;
  const pendingTasks = deal.tasks.filter((task) => !task.completedAt);
  const pendingTasksCount = pendingTasks.length;
  const pendingActivityIds = new Set(
    pendingTasks.flatMap((task) => (task.activityId ? [task.activityId] : [])),
  );
  const activityRecords = deal.activities.filter((activity) => !pendingActivityIds.has(activity.id));
  const visibleActivities = showAllActivities ? activityRecords : activityRecords.slice(0, 5);

  useEffect(() => {
    const taskId = searchParams.get("highlightTask");
    const activityId = searchParams.get("highlightActivity");
    if (!taskId && !activityId) return;
    // No mobile, pendências e registros ficam juntos em "Atividades".
    // Espera o próximo tick para o elemento estar disponível. Desktop e mobile
    // renderizam a mesma tarefa/atividade em blocos diferentes (um deles
    // sempre `display:none`) — busca todas as ocorrências do id e pega a
    // que estiver realmente visível na tela.
    const timeout1 = setTimeout(() => {
      const linkedPendingTask = activityId
        ? pendingTasks.find((task) => task.activityId === activityId)
        : undefined;
      const targetId = taskId
        ? `task-${taskId}`
        : linkedPendingTask
          ? `task-${linkedPendingTask.id}`
          : `activity-${activityId}`;
      const matches = document.querySelectorAll(`[id="${targetId}"]`);
      const el = Array.from(matches).find((node) => (node as HTMLElement).offsetParent !== null) as
        | HTMLElement
        | undefined;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (taskId || linkedPendingTask) setHighlightedTaskId(taskId ?? linkedPendingTask?.id ?? null);
      if (activityId && !linkedPendingTask) setHighlightedActivityId(activityId);
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
      if (needsJobTitleBeforeWinning(deal.contact.jobTitle)) {
        setWonJobTitle(jobTitleOptions.find((option) => !needsJobTitleBeforeWinning(option.value))?.value ?? "");
        setWonJobTitleError(null);
        setWonJobTitleDialogOpen(true);
        return;
      }
      if (deal.value == null || deal.grossValue == null) {
        setWonValuesPromptOpen(true);
        return;
      }
      setWonDialogOpen(true);
      return;
    }
    const res = await requestJson(`/api/deals/${deal.id}`, { method: "PUT", json: { status } });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
  }

  async function confirmWon(closedAt: string) {
    const wasWon = deal.status === "WON";
    const res = await requestJson(
      `/api/deals/${deal.id}`,
      { method: "PUT", json: { status: "WON", closedAt } },
      { silent: true, errorMessage: "Não foi possível marcar o negócio como ganho" },
    );
    const data = res.data ?? {};
    if (!res.ok) {
      setMoveError(res.error);
      return;
    }
    setWonDialogOpen(false);
    if (!wasWon) setShowConfetti(true);
    if (!wasWon) trackUse("negocio.ganho");
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function confirmWonJobTitle() {
    if (savingWonJobTitle || !wonJobTitle || needsJobTitleBeforeWinning(wonJobTitle)) return;

    setSavingWonJobTitle(true);
    try {
      const result = await saveContactField("jobTitle", wonJobTitle);
      if (!result.ok) {
        setWonJobTitleError(result.error ?? "Não foi possível salvar o cargo");
        return;
      }

      setWonJobTitleDialogOpen(false);
      if (deal.value == null || deal.grossValue == null) {
        setWonValuesPromptOpen(true);
        return;
      }
      setWonDialogOpen(true);
    } catch {
      setWonJobTitleError("Não foi possível salvar o cargo");
    } finally {
      setSavingWonJobTitle(false);
    }
  }

  async function confirmWonValues(values: RequirableFieldValues) {
    setSavingWonValues(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(values.value !== undefined ? { value: Number(values.value) } : {}),
          ...(values.grossValue !== undefined ? { grossValue: Number(values.grossValue) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMoveError(data.error ?? "Não foi possível salvar os valores");
        return;
      }

      setWonValuesPromptOpen(false);
      setWonDialogOpen(true);
      router.refresh();
      pushUndoToast(data.undo);
    } catch {
      setMoveError("Falha de conexão ao salvar os valores");
    } finally {
      setSavingWonValues(false);
    }
  }

  async function confirmLoss(lossReasonId: string, note: string, closedAt: string) {
    // Falhou: o diálogo continua aberto (motivo e observação preservados) e o
    // erro aparece — antes fechava igual e o negócio seguia aberto sem aviso.
    const res = await requestJson(
      `/api/deals/${deal.id}`,
      { method: "PUT", json: { status: "LOST", lossReasonId, lostReason: note || undefined, closedAt } },
      { silent: true, errorMessage: "Não foi possível marcar o negócio como perdido" },
    );
    if (!res.ok) {
      setMoveError(res.error);
      return;
    }
    setLossDialogOpen(false);
    trackUse("negocio.perdido");
    router.refresh();
    pushUndoToast(res.data?.undo);
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
    const res = await requestJson(`/api/deals/${deal.id}`, { method: "PUT", json: { ownerId } });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
  }

  async function updateCreditType(creditType: string) {
    const res = await requestJson(`/api/deals/${deal.id}`, { method: "PUT", json: { creditType: creditType || null } });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
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

  // "Atualizar contato" do ContactConflictNotice quando o número (Celular/
  // WhatsApp) já é de OUTRO contato seu (ownedByMe) — PUT só no campo que
  // estava sendo editado, no id do contato EXISTENTE (não no de
  // deal.contact) — pedido explícito, mesma correção de
  // components/edit-contact-dialog.tsx. Só o campo em questão (não o
  // snapshot inteiro de deal.contact, que é de OUTRO contato) — os demais
  // campos ficam `undefined`, e PUT /api/contacts/[id] já trata undefined
  // como "não mexe".
  async function updateExistingContactField(
    field: "phone" | "whatsapp",
    value: string,
    existingContactId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/contacts/${existingContactId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Erro ao atualizar" };
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

  async function moveToStage(stageId: string, values?: RequirableFieldValues) {
    if (stageId === deal.stageId) return;
    setMovingStage(stageId);
    setMoveError(null);
    const res = await fetch(`/api/deals/${deal.id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId, ...values }),
    });
    setMovingStage(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (Array.isArray(data.missingFields) && data.missingFields.length > 0) {
        setRequiredFieldsPrompt({
          stageId,
          stageName: deal.pipeline.stages.find((stage) => stage.id === stageId)?.name ?? "esta etapa",
          missingFields: data.missingFields,
        });
        return;
      }
      setMoveError(data.error ?? "Não foi possível mover o negócio");
      return;
    }
    setRequiredFieldsPrompt(null);
    router.refresh();
    pushUndoToast(data.undo);
  }

  async function toggleTask(taskId: string, completed: boolean) {
    // Concluindo (não desmarcando) uma Videochamada/Visita — precisa do
    // resultado antes (ver MeetingOutcomeDialog); desmarcar continua
    // instantâneo, igual antes.
    if (completed) {
      const task = deal.tasks.find((t) => t.id === taskId);
      if (task && (task.type === "VIDEO_CALL" || task.type === "VISIT")) {
        setMeetingOutcomeTaskId(taskId);
        return;
      }
    }
    const res = await requestJson(`/api/tasks/${taskId}`, { method: "PUT", json: { completed } });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
  }

  async function resolveMeetingOutcome(result: MeetingOutcomeResult) {
    if (!meetingOutcomeTaskId) return;
    const res = await requestJson(`/api/tasks/${meetingOutcomeTaskId}`, {
      method: "PUT",
      json:
        result.outcome === "RESCHEDULED"
          ? { meetingOutcome: "RESCHEDULED", dueAt: result.dueAt }
          : { completed: true, meetingOutcome: result.outcome },
    });
    setMeetingOutcomeTaskId(null);
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
  }

  async function deleteTask(taskId: string) {
    const res = await requestJson(`/api/tasks/${taskId}`, { method: "DELETE" });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
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
    const res = await requestJson(`/api/activities/${activity.id}`, { method: "DELETE" });
    router.refresh();
    if (res.ok) pushUndoToast(res.data?.undo);
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

    const isMeetingOrVisit = activeTab === "VIDEO_CALL" || activeTab === "VISIT";
    // Com Prazo, uma Task vai ser criada logo abaixo e o resultado passa a
    // ser perguntado só na conclusão dela — PENDING aqui é só o estado
    // inicial "aguardando". Sem Prazo não existe conclusão futura nenhuma
    // pra perguntar depois, então usa o que foi escolhido no seletor.
    // Registro da atividade falhou (sem permissão, sem internet): PARA aqui,
    // mostra o motivo e mantém o texto digitado no campo — antes o formulário
    // era limpo igual e a anotação sumia sem ter sido salva.
    const activityRes = await requestJson(`/api/deals/${deal.id}/activities`, {
      method: "POST",
      json: isMeetingOrVisit
        ? { type: activeTab, activityBody: body, meetingOutcome: dueDate ? "PENDING" : meetingOutcome }
        : { type: activeTab, activityBody: body },
    });
    if (!activityRes.ok) {
      setSaving(false);
      return;
    }
    const activityId: string | undefined = isMeetingOrVisit ? activityRes.data?.id : undefined;

    if (dueDate) {
      const taskRes = await requestJson(
        "/api/tasks",
        {
          method: "POST",
          json: {
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
          },
        },
        { errorMessage: "A atividade foi registrada, mas a tarefa com prazo não foi criada." },
      );
      if (activeTab === "VIDEO_CALL" && taskRes.ok) {
        const created = taskRes.data;
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
        const created = taskRes.data;
        if (created.dueAt && new Date(created.dueAt) > new Date()) {
          await requestJson(
            `/api/tasks/${created.id}/schedule-message`,
            { method: "POST", json: { message: scheduleWhatsApp.message.trim() } },
            { errorMessage: "A tarefa foi criada, mas a mensagem de WhatsApp não foi agendada." },
          );
        }
      }
    }

    setBody("");
    setDueDate("");
    setDueTime("");
    setMeetingOutcome(null);
    setScheduleWhatsApp({ enabled: false, message: "" });
    setSaving(false);
    setMobileComposerOpen(false);
    router.refresh();
  }

  return (
    <div className="deal-detail flex w-full min-w-0 max-w-full items-start gap-4 overflow-x-clip lg:overflow-visible">
      {showConfetti && <ConfettiBurst onDone={() => setShowConfetti(false)} />}
      <div className="min-w-0 flex-1 space-y-0 lg:space-y-6">
      <div className="hidden items-center justify-between gap-2 lg:flex">
        <Link
          href="/pipeline"
          className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 lg:min-h-0 lg:text-sm"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          Pipeline
        </Link>
        {deal.value != null && (
          <span className="hidden items-center rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand dark:bg-brand/20 dark:text-brand-light">
            {formatCurrency(deal.value)}
          </span>
        )}
      </div>

      {/* Mobile Header Ultra Clean */}
      <section className="pt-4 pb-1 lg:hidden">
        <div className="min-w-0">
          <div className="min-w-0">
            <div className="min-w-0">
              <h1 className="break-words text-[19px] font-bold leading-6 text-neutral-950 dark:text-white">{deal.name}</h1>
              {deal.value != null && (
                <span className="mt-1 block text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(deal.value)}
                </span>
              )}
            </div>
            <Link
              href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
              className="mt-1 block truncate text-xs font-medium text-neutral-600 transition-colors hover:text-brand dark:text-neutral-300"
            >
              {deal.contact.name}
            </Link>
          </div>
        </div>

        <div className="mt-3 flex min-h-11 items-center gap-4 border-y border-neutral-200/80 dark:border-white/[0.08]">
          <div className="relative w-[8.25rem] shrink-0">
            <CircleDot
              className={`pointer-events-none absolute top-1/2 left-0 z-10 h-3 w-3 -translate-y-1/2 ${
                deal.status === "OPEN"
                  ? "text-brand"
                  : deal.status === "WON"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
              }`}
            />
            <Select
              value={deal.status}
              onChange={(status) => {
                if (status !== deal.status) void updateStatus(status as Deal["status"]);
              }}
              options={[
                { value: "OPEN", label: "Em andamento" },
                { value: "WON", label: "Ganho" },
                { value: "LOST", label: "Perdido" },
              ]}
              ariaLabel="Alterar status do negócio"
              className={`deal-mobile-status-select !min-h-11 !border-0 !bg-transparent !py-0 !pr-0 !pl-5 !text-xs !font-medium !shadow-none !ring-0 ${
                deal.status === "OPEN"
                  ? "text-brand"
                  : deal.status === "WON"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
              }`}
            />
          </div>

          <div className="relative min-w-0 flex-1 border-l border-neutral-200 pl-4 dark:border-white/[0.08]">
            <span
              className="pointer-events-none absolute top-1/2 left-4 z-10 h-2 w-2 -translate-y-1/2 rounded-full"
              style={{ backgroundColor: deal.stage.color ?? "#999" }}
            />
            <Select
              value={deal.stageId}
              onChange={moveToStage}
              options={deal.pipeline.stages.map((stage) => ({ value: stage.id, label: stage.name }))}
              disabled={movingStage !== null}
              ariaLabel="Alterar etapa do negócio"
              className="deal-mobile-stage-select !min-h-11 !border-0 !bg-transparent !py-0 !pr-0 !pl-4 !text-xs !font-semibold !shadow-none !ring-0"
            />
          </div>
        </div>

        <div className="flex min-h-11 items-center gap-5 border-b border-neutral-200/80 dark:border-white/[0.08]">
          {directPhoneUrl && (
            <a
              href={directPhoneUrl}
              className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium text-neutral-500 transition-colors active:text-brand dark:text-neutral-400"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={2} />
              Ligar
            </a>
          )}

          {whatsappThreadId ? (
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium text-neutral-500 transition-colors active:text-emerald-700 dark:text-neutral-400 dark:active:text-emerald-400"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
              WhatsApp
            </button>
          ) : directWhatsAppUrl ? (
            <a
              href={directWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium text-neutral-500 transition-colors active:text-emerald-700 dark:text-neutral-400 dark:active:text-emerald-400"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
              WhatsApp
            </a>
          ) : null}

          <Link
            href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-[12px] font-medium text-neutral-500 transition-colors active:text-brand dark:text-neutral-400"
          >
            <User className="h-3.5 w-3.5" strokeWidth={2} />
            Cliente
          </Link>
        </div>
      </section>

      <div className="hidden">
        {/* Nome do Negócio & Valor */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100 leading-snug">
              {deal.name}
            </h1>
            {deal.value != null && (
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                {formatCurrency(deal.value)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <Link
              href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
              className="font-semibold text-neutral-800 dark:text-neutral-200 hover:text-brand dark:hover:text-brand-light transition-colors"
            >
              👤 {deal.contact.name}
            </Link>
            <span>·</span>
            <span>Resp: {deal.owner.name}</span>
          </div>
        </div>

        {/* Linha Única de Chips (Etapa & Status) */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5">
          {/* Status Chip */}
          <button
            onClick={() => {
              const nextStatus = deal.status === "OPEN" ? "WON" : deal.status === "WON" ? "LOST" : "OPEN";
              updateStatus(nextStatus);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-2xs transition-colors ${
              deal.status === "OPEN"
                ? "bg-brand/10 text-brand border border-brand/30 dark:bg-brand/20 dark:text-brand-light"
                : deal.status === "WON"
                ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-400"
                : "bg-red-500/15 text-red-700 border border-red-500/30 dark:bg-red-500/20 dark:text-red-400"
            }`}
          >
            <CircleDot className="h-3 w-3" />
            <span>{deal.status === "OPEN" ? "Em andamento" : deal.status === "WON" ? "Ganho" : "Perdido"}</span>
          </button>

          {/* Etapa Chip com Select nativo por cima */}
          <div className="relative inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: deal.stage.color ?? "#999" }} />
            <span className="truncate max-w-[140px]">{deal.stage.name}</span>
            <ChevronRight className="h-3 w-3 rotate-90 text-neutral-400" />
            <select
              value={deal.stageId}
              onChange={(e) => moveToStage(e.target.value)}
              disabled={movingStage !== null}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            >
              {deal.pipeline.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Barra de 4 Ações Minimalista */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {directPhoneUrl ? (
            <a
              href={directPhoneUrl}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/10 py-2 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 text-xs font-semibold active:scale-95 transition-transform"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={2.3} />
              <span>Ligar</span>
            </a>
          ) : (
            <div className="flex items-center justify-center gap-1.5 rounded-xl bg-neutral-100 py-2 text-neutral-400 opacity-60 dark:bg-neutral-800 dark:text-neutral-500 text-xs font-medium">
              <Phone className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Sem tel</span>
            </div>
          )}

          {directWhatsAppUrl ? (
            <a
              href={directWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500/10 py-2.5 text-emerald-700 transition-transform active:scale-95 dark:bg-emerald-500/20 dark:text-emerald-400 text-xs font-semibold"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.3} />
              <span>Whats</span>
            </a>
          ) : (
            <div className="flex items-center justify-center gap-1.5 rounded-xl bg-neutral-100 py-2 text-neutral-400 opacity-60 dark:bg-neutral-800 dark:text-neutral-500 text-xs font-medium">
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
              <span>Whats</span>
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
            className="flex items-center justify-center gap-1.5 rounded-xl bg-brand/10 py-2 text-brand dark:bg-brand/20 dark:text-brand-light text-xs font-semibold active:scale-95 transition-transform"
          >
            <Mic className="h-3.5 w-3.5" strokeWidth={2.3} />
            <span>Ditar</span>
          </button>

          <Link
            href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-neutral-100 py-2 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 text-xs font-semibold active:scale-95 transition-transform"
          >
            <User className="h-3.5 w-3.5" strokeWidth={2.3} />
            <span>Ficha</span>
          </Link>
        </div>
      </div>

      {/* Desktop Header */}
      <div className="hidden card p-4 lg:flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={deal.contact.name} size="lg" className="shrink-0 ring-1 ring-brand/35" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                {deal.name}
              </h1>
              {deal.value != null && (
                <span className="inline-flex shrink-0 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                  {formatCurrency(deal.value)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <Link
                href={`/clientes/${deal.contact.id}?fromDeal=${deal.id}`}
                className="group inline-flex items-center gap-1.5 font-medium text-neutral-800 transition-colors hover:text-brand dark:text-neutral-200 dark:hover:text-brand-light"
                title="Ver ficha do cliente"
              >
                <User className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />
                <span>{deal.contact.name}</span>
                <ExternalLink className="ml-0.5 h-3 w-3 text-neutral-400 transition-colors group-hover:text-brand" strokeWidth={2} />
              </Link>
              <span className="border-l border-neutral-200 pl-2 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={deal.owner.name} src={deal.owner.photoUrl} size="2xs" />
                  <span>Resp. <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{deal.owner.name}</strong></span>
                </span>
              </span>

              {/* Botões de Ação Rápida do Contato */}
              <div className="ml-1 flex items-center gap-1 border-l border-neutral-200 pl-2.5 dark:border-neutral-700">
                {(deal.contact.phone || deal.contact.whatsapp) && (
                  <a
                    href={`tel:+${toDialNumber(normalizePhoneNumber(deal.contact.phone || deal.contact.whatsapp || "")) ?? ""}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                    title="Ligar para contato"
                  >
                    <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>Ligar</span>
                  </a>
                )}
                {(deal.contact.whatsapp || deal.contact.phone) && (
                  <a
                    href={`https://wa.me/${toDialNumber(normalizePhoneNumber(deal.contact.whatsapp || deal.contact.phone || "")) ?? ""}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                    title="Abrir WhatsApp"
                  >
                    <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>Whats</span>
                  </a>
                )}
                {deal.contact.email && (
                  <a
                    href={`mailto:${deal.contact.email}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                    title="Enviar e-mail"
                  >
                    <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>E-mail</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-950/80">
            {(
              [
                { s: "LOST" as const, label: "Perdido", icon: XCircle, activeClass: "bg-red-600 text-white" },
                { s: "OPEN" as const, label: "Em andamento", icon: CircleDot, activeClass: "bg-brand text-white" },
                { s: "WON" as const, label: "Ganho", icon: CheckCircle2, activeClass: "bg-emerald-600 text-white" },
              ]
            ).map(({ s, label, icon: Icon, activeClass }) => {
              const isActive = deal.status === s;
              return (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
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

          {/* Qualificação de Lead no Cabeçalho */}
          <div className="flex items-center gap-1.5">
            {(() => {
              const qual = localQualification ?? deal.contact.leadQualification;
              return (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Qualificação:</span>
                  {qual ? (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      qual === "QUALIFIED"
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
                        : "bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
                    }`}>
                      {qual === "QUALIFIED" ? <ThumbsUp className="h-3 w-3" strokeWidth={2.5} /> : <ThumbsDown className="h-3 w-3" strokeWidth={2.5} />}
                      {qual === "QUALIFIED" ? "Qualificado" : "Desqualificado"}
                    </span>
                  ) : (
                    <span className="text-[11px] italic text-neutral-400">Pendente</span>
                  )}
                  {canEditDetails && (
                    <div className="ml-1 flex items-center gap-1">
                      <button
                        type="button"
                        disabled={leadQualStatus.saving}
                        onClick={() => setLeadQualification(qual === "QUALIFIED" ? null : "QUALIFIED")}
                        title={qual === "QUALIFIED" ? "Remover qualificação" : "Marcar como Qualificado"}
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          qual === "QUALIFIED"
                            ? "bg-emerald-600 text-white"
                            : "bg-neutral-100 text-neutral-600 hover:bg-emerald-50 hover:text-emerald-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
                        }`}
                      >
                        <ThumbsUp className="h-3 w-3" strokeWidth={2} />
                        {qual === "QUALIFIED" ? "Remover" : "Qualificado"}
                      </button>
                      <button
                        type="button"
                        disabled={leadQualStatus.saving}
                        onClick={() => setLeadQualification(qual === "UNQUALIFIED" ? null : "UNQUALIFIED")}
                        title={qual === "UNQUALIFIED" ? "Remover qualificação" : "Marcar como Desqualificado"}
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          qual === "UNQUALIFIED"
                            ? "bg-neutral-700 text-white dark:bg-neutral-600"
                            : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        }`}
                      >
                        <ThumbsDown className="h-3 w-3" strokeWidth={2} />
                        {qual === "UNQUALIFIED" ? "Remover" : "Desqualificado"}
                      </button>
                      {leadQualStatus.saving && <Loader2 className="h-3 w-3 animate-spin text-neutral-500" strokeWidth={2.5} />}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Stepper Visual de Etapas (Apenas Desktop — no mobile usava seletor embutido) */}
      <div className="hidden lg:flex card scrollbar-thin items-center gap-1.5 overflow-x-auto p-2">
        {deal.pipeline.stages.map((stage, idx) => {
          const isCurrent = stage.id === deal.stageId;
          const stageIndex = deal.pipeline.stages.findIndex((s) => s.id === deal.stageId);
          const isPast = idx < stageIndex;

          return (
            <div key={stage.id} className="flex items-center gap-1.5 shrink-0">
              <button
                disabled={movingStage !== null}
                onClick={() => moveToStage(stage.id)}
                className={`group flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  isCurrent
                    ? "bg-brand text-white font-semibold"
                    : isPast
                    ? "bg-neutral-100 text-neutral-800 font-semibold hover:bg-neutral-200 hover:text-neutral-950 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isCurrent ? "ring-2 ring-white/50" : ""
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
              {COMPOSER_TABS.map((tab) => (
                <button
                  key={tab.type}
                  ref={(el) => {
                    tabRefs.current[tab.type] = el;
                  }}
                  onClick={() => selectTab(tab.type)}
                  className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                    activeTab === tab.type
                      ? tab.type === "PROPOSAL"
                        ? "font-semibold text-neutral-900 dark:text-neutral-100"
                        : "font-semibold text-neutral-900 dark:text-neutral-100"
                      : tab.type === "PROPOSAL"
                        ? "font-semibold text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
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
            {activeTab === "PROPOSAL" ? (
              <ProposalsCard dealId={deal.id} proposals={proposals} defaultDescription={defaultProposalDescription} embedded />
            ) : (
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
              {(activeTab === "VIDEO_CALL" || activeTab === "VISIT") && !dueDate && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">Resultado:</span>
                  {MEETING_OUTCOME_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setMeetingOutcome(opt.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                          meetingOutcome === opt.value ? opt.activeClass : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </button>
                    );
                  })}
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
                  disabled={saving || !body.trim() || ((activeTab === "VIDEO_CALL" || activeTab === "VISIT") && !dueDate && !meetingOutcome)}
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
            )}
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
          {/* Seletor de Abas da Coluna Lateral */}
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <button
              type="button"
              onClick={() => setSidebarTab("general")}
              className={`flex items-center justify-center gap-2 border-r border-neutral-200 px-3 py-2.5 text-xs font-semibold transition-colors dark:border-neutral-800 ${
                sidebarTab === "general"
                  ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white"
                  : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
              }`}
            >
              <Briefcase className="h-3.5 w-3.5 text-brand" strokeWidth={2} />
              <span>Negócio & Tarefas</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("contact")}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold transition-colors ${
                sidebarTab === "contact"
                  ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-white"
                  : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
              }`}
            >
              <UserCheck className="h-3.5 w-3.5 text-brand" strokeWidth={2} />
              <span>Contato & Origem</span>
            </button>
          </div>

          <div key={sidebarTab} className="animate-bubble-in space-y-4">
            {sidebarTab === "general" ? (
              <>
                {/* Card de Valores Financeiros Unificado */}
                <FinancialValuesCard
                  value={deal.value}
                  grossValue={deal.grossValue}
                  editable={canEditDetails}
                  onSaveValue={saveDealValue}
                  onSaveGrossValue={saveDealGrossValue}
                />

                {!chatOpen && whatsappThreadId && (
                  <WhatsAppPanelTrigger onOpen={() => setChatOpen(true)} hasUnread={hasUnreadWhatsApp} />
                )}

                <div className="card space-y-3 p-4 text-sm border border-neutral-200 dark:border-neutral-800/80 shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
                    <div className="flex items-center gap-2">
                      <CalendarCheck className="h-4 w-4 text-brand" strokeWidth={2} />
                      <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Tarefas</h3>
                    </div>
                    {deal.tasks.length > 0 && (
                      <span className="rounded-full bg-brand/10 border border-brand/20 px-2 py-0.5 text-[11px] font-bold text-brand dark:bg-brand/25 dark:border-brand/40 dark:text-brand-hover">
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
              </>
            ) : (
              <>
                {/* Aba Contato & Origem */}
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
                  <EditableRow label="Nome" value={deal.contact.name} editable={canEditDetails} onSave={(v) => saveContactField("name", v)} onShowFix={showResponsavelFix} />
                  <EditableRow label="E-mail" value={deal.contact.email ?? ""} type="email" editable={canEditDetails} onSave={(v) => saveContactField("email", v)} onShowFix={showResponsavelFix} />
                  <EditableRow label="Celular" value={deal.contact.phone ?? ""} editable={canEditDetails} onSave={(v) => saveContactField("phone", v)} onUpdateExisting={(v, id) => updateExistingContactField("phone", v, id)} onShowFix={showResponsavelFix} />
                  <EditableRow label="WhatsApp" value={deal.contact.whatsapp ?? ""} editable={canEditDetails} onSave={(v) => saveContactField("whatsapp", v)} onUpdateExisting={(v, id) => updateExistingContactField("whatsapp", v, id)} onShowFix={showResponsavelFix} />
                  <EditableRow label="Cargo" value={deal.contact.jobTitle ?? ""} type="select" options={jobTitleOptions} editable={canEditDetails} onSave={(v) => saveContactField("jobTitle", v)} onShowFix={showResponsavelFix} />
                  <EditableRow label="Origem" value={deal.contact.source ?? ""} type="select" options={sourceOptions} editable={canEditDetails} onSave={(v) => saveContactField("source", v)} onShowFix={showResponsavelFix} />
                  <EditableRow label="Responsável" value={deal.contact.responsavelId ?? ""} displayValue={deal.contact.responsavel?.name ?? "Ninguém"} type="select" options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} editable={canEditDetails} onSave={(v) => saveContactField("responsavelId", v)} autoEditSignal={responsavelFocusTrigger} />
                </div>

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

                {(() => {
                  const qual = localQualification ?? deal.contact.leadQualification;
                  const qualAt = localQualificationAt ?? deal.contact.leadQualificationAt;
                  if (!qual || !qualAt) return null;
                  return (
                    <div className="card space-y-2 p-4 text-sm">
                      <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Histórico de Qualificação</h3>
                      <div className="space-y-1 rounded-md bg-neutral-50 px-2.5 py-2 text-xs text-neutral-600 dark:bg-neutral-800/40 dark:text-neutral-300">
                        <p>
                          Status: <strong>{qual === "QUALIFIED" ? "Qualificado" : "Desqualificado"}</strong>
                        </p>
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
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile — abas em vez de grade lado a lado; reaproveita os mesmos
          handlers/estado de cima, só reorganiza a apresentação. */}
      <div className="lg:hidden">
        <nav className="sticky top-0 z-20 -mx-4 grid grid-cols-2 border-b border-neutral-200/80 bg-white px-4 dark:border-white/[0.08] dark:bg-neutral-950">
          <button
            type="button"
            onClick={() => setMobileTab("activities")}
            className={`relative flex min-h-12 items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
              mobileTab === "activities" ? "text-brand" : "text-neutral-400 dark:text-neutral-400"
            }`}
          >
            Atividades
            {mobileTab === "activities" && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("details")}
            className={`relative flex min-h-12 items-center justify-center gap-1.5 text-xs font-semibold transition-colors ${
              mobileTab === "details" ? "text-brand" : "text-neutral-400 dark:text-neutral-400"
            }`}
          >
            Dados
            {mobileTab === "details" && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" />}
          </button>
        </nav>

        {mobileTab === "activities" ? (
          <div className="animate-bubble-in">
            {pendingTasksCount > 0 && (
              <section className="border-b border-neutral-200/80 dark:border-white/[0.08]">
                <div className="flex min-h-10 items-center gap-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  <ListTodo className="h-4 w-4 text-amber-600 dark:text-amber-400" strokeWidth={2} />
                  <span className="flex-1">Pendentes</span>
                  <span className="text-[11px] font-medium tabular-nums text-neutral-400 dark:text-neutral-500">
                    {pendingTasksCount}
                  </span>
                </div>
                <div className="divide-y divide-neutral-100 dark:divide-white/[0.06]">
                  {pendingTasks.map((task) => (
                    <div
                      key={task.id}
                      id={`task-${task.id}`}
                      className={`group flex min-h-16 items-start gap-3 py-3 ${
                        highlightedTaskId === task.id ? "animate-highlight-once" : ""
                      }`}
                    >
                      <label className="flex min-w-0 flex-1 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => toggleTask(task.id, true)}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-snug text-neutral-800 dark:text-neutral-100">
                            {task.title}
                          </span>
                          <span className="mt-1 flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                            <Clock className="h-3 w-3" />
                            {task.dueAt
                              ? new Date(task.dueAt).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Sem prazo"}
                          </span>
                        </span>
                      </label>
                      {canEditDetails && (
                        <button
                          type="button"
                          onClick={() => setEditingTask(task)}
                          className="icon-btn shrink-0 text-neutral-400 dark:text-neutral-500"
                          aria-label="Editar atividade pendente"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <button
              type="button"
              onClick={() => setMobileComposerOpen((open) => !open)}
              aria-expanded={mobileComposerOpen}
              className="flex min-h-12 w-full items-center justify-between border-b border-neutral-200/80 text-sm font-semibold text-brand transition-colors active:text-brand-active dark:border-white/[0.08]"
            >
              <span className="inline-flex items-center gap-2">
                {mobileComposerOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {mobileComposerOpen ? "Fechar" : "Nova atividade"}
              </span>
              {!mobileComposerOpen && <ChevronRight className="h-4 w-4" />}
            </button>

            {mobileComposerOpen && (
            <div className="deal-mobile-composer border-b border-neutral-200/80 py-3 dark:border-white/[0.08]">
              <div className="scrollbar-none mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
                {COMPOSER_TABS.map((tab) => (
                  <button
                    key={tab.type}
                    onClick={() => selectTab(tab.type)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97] ${
                      activeTab === tab.type
                        ? tab.type === "PROPOSAL"
                          ? "bg-neutral-900 text-white dark:bg-brand/20 dark:text-brand-hover dark:ring-1 dark:ring-brand/30"
                          : "bg-neutral-900 text-white dark:bg-brand/20 dark:text-brand-hover dark:ring-1 dark:ring-brand/30"
                        : tab.type === "PROPOSAL"
                          ? "bg-neutral-100 text-neutral-700 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:active:bg-neutral-700"
                          : "bg-neutral-100 text-neutral-600 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:active:bg-neutral-700"
                    }`}
                  >
                    <tab.icon className="h-3.5 w-3.5" strokeWidth={2} />
                    {tab.label}
                  </button>
                ))}
              </div>
              {activeTab === "PROPOSAL" ? (
                <ProposalsCard dealId={deal.id} proposals={proposals} defaultDescription={defaultProposalDescription} embedded />
              ) : (
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
                {(activeTab === "VIDEO_CALL" || activeTab === "VISIT") && !dueDate && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Resultado:</span>
                    {MEETING_OUTCOME_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setMeetingOutcome(opt.value)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                            meetingOutcome === opt.value ? opt.activeClass : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
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
                    disabled={saving || !body.trim() || ((activeTab === "VIDEO_CALL" || activeTab === "VISIT") && !dueDate && !meetingOutcome)}
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
              )}
            </div>
            )}

            <div className="deal-mobile-timeline space-y-0">
              {activityRecords.length === 0 && pendingTasks.length === 0 && (
                <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">Nenhuma atividade registrada.</p>
              )}
              {visibleActivities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  highlighted={highlightedActivityId === activity.id}
                  canEdit={canEditActivity(activity)}
                  onConfirmDelete={confirmDeleteActivity}
                  onSave={saveActivityEdit}
                />
              ))}
              {activityRecords.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllActivities((showAll) => !showAll)}
                  className="min-h-12 w-full border-b border-neutral-200/80 text-left text-xs font-semibold text-neutral-500 dark:border-white/[0.08] dark:text-neutral-400"
                >
                  {showAllActivities ? "Mostrar menos" : `Ver todas as atividades (${activityRecords.length})`}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="deal-mobile-details animate-bubble-in">
            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Status do negócio</h2>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { status: "LOST" as const, label: "Perdido", icon: XCircle, active: "bg-red-600 text-white" },
                    { status: "OPEN" as const, label: "Em aberto", icon: CircleDot, active: "bg-brand text-white" },
                    { status: "WON" as const, label: "Ganho", icon: CheckCircle2, active: "bg-emerald-600 text-white" },
                  ]
                ).map(({ status, label, icon: Icon, active }) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => updateStatus(status)}
                    className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors ${
                      deal.status === status
                        ? active
                        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <FinancialValuesCard
              value={deal.value}
              grossValue={deal.grossValue}
              editable={canEditDetails}
              onSaveValue={saveDealValue}
              onSaveGrossValue={saveDealGrossValue}
            />

            <div className="hidden">
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
                onUpdateExisting={(v, id) => updateExistingContactField("phone", v, id)}
                onShowFix={showResponsavelFix}
              />
              <EditableRow
                label="WhatsApp"
                value={deal.contact.whatsapp ?? ""}
                editable={canEditDetails}
                onSave={(v) => saveContactField("whatsapp", v)}
                onUpdateExisting={(v, id) => updateExistingContactField("whatsapp", v, id)}
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

      {requiredFieldsPrompt && (
        <CompleteRequiredFieldsDialog
          isOpen={true}
          onClose={() => setRequiredFieldsPrompt(null)}
          missingFields={requiredFieldsPrompt.missingFields}
          stageName={requiredFieldsPrompt.stageName}
          leadSources={sources}
          jobTitles={jobTitles}
          creditTypes={creditTypes}
          deals={[
            {
              id: deal.id,
              name: deal.name,
              contactName: deal.contact.name,
              contactInitials: deal.contact.name.charAt(0),
            },
          ]}
          onSubmit={(values) => moveToStage(requiredFieldsPrompt.stageId, values)}
          submitting={movingStage === requiredFieldsPrompt.stageId}
        />
      )}

      {wonValuesPromptOpen && (
        <CompleteRequiredFieldsDialog
          isOpen={true}
          onClose={() => {
            if (!savingWonValues) setWonValuesPromptOpen(false);
          }}
          missingFields={missingFinancialValues(deal.value, deal.grossValue)}
          stageName="Ganho"
          leadSources={sources}
          jobTitles={jobTitles}
          creditTypes={creditTypes}
          deals={[
            {
              id: deal.id,
              name: deal.name,
              contactName: deal.contact.name,
              contactInitials: deal.contact.name.charAt(0),
            },
          ]}
          onSubmit={confirmWonValues}
          submitting={savingWonValues}
          submitLabel="Salvar e continuar"
        />
      )}

      {wonDialogOpen && (
        <ClosedAtDialog
          title="Quando foi ganho?"
          confirmLabel="Marcar como ganho"
          confirmClassName="btn-primary"
          onClose={() => setWonDialogOpen(false)}
          onConfirm={confirmWon}
        />
      )}

      {wonJobTitleDialogOpen && (
        <Modal
          onClose={() => {
            if (savingWonJobTitle) return;
            setWonJobTitleDialogOpen(false);
            setWonJobTitleError(null);
          }}
        >
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Qual é o cargo de {deal.contact.name}?</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Informe antes de marcar este negócio como ganho.</p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              confirmWonJobTitle();
            }}
          >
            <div className="space-y-1.5">
              <label className="field-label">Cargo</label>
              <Select
                value={wonJobTitle}
                onChange={(value) => {
                  setWonJobTitle(value);
                  setWonJobTitleError(null);
                }}
                options={jobTitleOptions.filter((option) => !needsJobTitleBeforeWinning(option.value))}
                placeholder="Selecione o cargo"
                autoFocus
                invalid={!!wonJobTitleError}
              />
              {wonJobTitleError && <p className="field-error">{wonJobTitleError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={savingWonJobTitle} onClick={() => setWonJobTitleDialogOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={savingWonJobTitle || !wonJobTitle || needsJobTitleBeforeWinning(wonJobTitle)} className="btn-primary">
                {savingWonJobTitle ? "Salvando..." : "Continuar"}
              </button>
            </div>
          </form>
        </Modal>
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
            // Reagendou uma Videochamada com data definida — mesmo convite
            // oferecido na criação, agora pro novo horário.
            if (result.ok && editingTask.type === "VIDEO_CALL" && fields.dueAt) {
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
          taskType={deal.tasks.find((t) => t.id === meetingOutcomeTaskId)?.type === "VISIT" ? "VISIT" : "VIDEO_CALL"}
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
            task.type === "VIDEO_CALL"
              ? "Se esta videochamada veio de um agendamento externo (landing page), o horário volta a ficar disponível pra outro lead reservar. Dá pra desfazer logo em seguida, pelo aviso que aparece no canto da tela (ou Ctrl+Z)."
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

function FinancialValuesCard({
  value,
  grossValue,
  editable,
  onSaveValue,
  onSaveGrossValue,
}: {
  value: number | null;
  grossValue: number | null;
  editable: boolean;
  onSaveValue: (v: string) => Promise<{ ok: boolean; error?: string }>;
  onSaveGrossValue: (v: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <div className="card p-3.5 border border-neutral-200 dark:border-neutral-800/80 shadow-2xs bg-white dark:bg-neutral-900/90">
      <div className="grid grid-cols-2 gap-3">
        <ValueItem label="Valor Líquido" value={value} editable={editable} onSave={onSaveValue} />
        <div className="border-l border-neutral-100 dark:border-neutral-800/80 pl-3">
          <ValueItem label="Valor Bruto" value={grossValue} editable={editable} onSave={onSaveGrossValue} />
        </div>
      </div>
    </div>
  );
}

function ValueItem({
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

  useEffect(() => {
    if (!editing) {
      setDraft(value != null ? String(value) : "");
    }
  }, [value, editing]);

  async function handleSave() {
    if (saving) return;

    const nextValue = draft.trim() ? Number(draft) : null;
    if (nextValue === value) {
      setError(null);
      setEditing(false);
      return;
    }

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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
      setDraft(value != null ? String(value) : "");
      setError(null);
    }
  }

  if (!editable) {
    return (
      <div className="space-y-0.5">
        <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{label}</span>
        <p className={`text-lg font-bold tracking-tight ${value ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}>
          {formatCurrency(value)}
        </p>
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value != null ? String(value) : "");
          setError(null);
          setEditing(true);
        }}
        className="group w-full text-left space-y-0.5 rounded-lg p-1 -m-1 transition-colors hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60 cursor-pointer"
        title="Clique para editar"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{label}</span>
          <Pencil className="h-3 w-3 text-neutral-400 opacity-40 group-hover:opacity-100 transition-opacity shrink-0" strokeWidth={2} />
        </div>
        <p className={`text-lg font-bold tracking-tight ${value ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400 dark:text-neutral-500"}`}>
          {formatCurrency(value)}
        </p>
      </button>
    );
  }

  return (
    <div className="space-y-1 rounded-lg p-1 -m-1 bg-neutral-100/80 dark:bg-neutral-800/80 ring-2 ring-brand/40">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">{label}</span>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-brand shrink-0" strokeWidth={2.5} />}
      </div>
      <div onKeyDown={handleKeyDown}>
        <CurrencyInput
          value={draft}
          onChange={setDraft}
          autoFocus
          onBlur={() => handleSave()}
          className="text-base font-bold tracking-tight py-1 bg-white dark:bg-neutral-900 text-emerald-600 dark:text-emerald-400 border border-neutral-300 dark:border-neutral-700 rounded-md w-full"
        />
      </div>
      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
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
  onUpdateExisting,
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
  /** Só faz sentido em campos de telefone (Celular/WhatsApp) — "Atualizar
   * contato" do ContactConflictNotice quando o número já é de OUTRO contato
   * seu (ownedByMe): reenvia só ESTE campo pro id do contato EXISTENTE, não
   * o de `onSave` (que sempre mira o contato deste negócio). Ausente nos
   * outros campos (Nome/Cargo/Origem/Responsável nunca geram esse conflito). */
  onUpdateExisting?: (value: string, existingContactId: string) => Promise<{ ok: boolean; error?: string }>;
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
  const [conflictDialog, setConflictDialog] = useState<ContactConflict | null>(null);
  const [updatingExisting, setUpdatingExisting] = useState(false);
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
        setConflictDialog(result.conflict);
        return;
      }
      setErrorDialog({ message: result.error ?? "Erro ao salvar", type: result.type, details: result.details });
      return;
    }
    setEditing(false);
  }

  // "Atualizar contato" — ver onUpdateExisting acima e updateExistingContactField
  // no componente pai. Sucesso fecha o modal de conflito E sai do modo edição
  // (o valor "certo" já está salvo no outro contato, nada mais pra fazer aqui).
  async function handleUpdateExisting() {
    if (!conflictDialog || !onUpdateExisting) return;
    setUpdatingExisting(true);
    const result = await onUpdateExisting(draft, conflictDialog.contactId);
    setUpdatingExisting(false);
    if (!result.ok) {
      setErrorDialog({ message: result.error ?? "Não foi possível atualizar o contato." });
      return;
    }
    setConflictDialog(null);
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
          <ContactConflictNotice
            conflict={conflictDialog}
            onUpdateExisting={
              onUpdateExisting ? () => handleUpdateExisting() : undefined
            }
            updatingExisting={updatingExisting}
          />
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
