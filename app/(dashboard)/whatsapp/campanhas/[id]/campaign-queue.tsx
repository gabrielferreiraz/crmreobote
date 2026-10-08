"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownToLine, ArrowUpToLine, CalendarClock, Check, Clock3, GripVertical, Info, ListOrdered, Loader2, Maximize2, Minimize2, Pencil, Search, UserRoundX, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { trackUse } from "@/lib/feature-usage/track";
import { requestJson } from "@/lib/client-request";
import type { CampaignQueueView, QueueItemView, QueueState } from "@/lib/campaigns/queue";

export type CampaignQueueData = CampaignQueueView & { canEdit: boolean };

/** A tela carrega as primeiras posições da fila (o resto se acha pela busca) — 20 mil linhas não cabem numa tela. */
const PAGE_SIZE = 30;
const MAX_LOADED = 500;
const POLL_MS = 30_000;
const NEXT_HOUR_VISIBLE = 8;

// Horário SEMPRE de Campo Grande (a operação inteira roda nele, ver lib/timezone.ts), não o do
// navegador de quem abriu — e explícito também no servidor, pra renderizar igual nos dois lados.
const TZ = "America/Campo_Grande";
const fmtTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDay = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const fmtDateKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHour = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });

const timeOf = (iso: string | null) => (iso ? fmtTime.format(new Date(iso)) : "—");
const dateKeyOf = (iso: string) => fmtDateKey.format(new Date(iso));
const hourOf = (iso: string) => Number(fmtHour.format(new Date(iso)));

/** "Hoje" / "Amanhã" / "seg., 28/09" — relativo ao relógio do SERVIDOR (serverNow), nunca ao do navegador, pra não divergir. */
function dayLabel(iso: string, serverNowIso: string): string {
  const key = dateKeyOf(iso);
  if (key === dateKeyOf(serverNowIso)) return "Hoje";
  const tomorrow = new Date(new Date(serverNowIso).getTime() + 24 * 60 * 60 * 1000);
  if (key === dateKeyOf(tomorrow.toISOString())) return "Amanhã";
  return fmtDay.format(new Date(iso));
}

function formatInterval(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec))}s`;
  const minutes = sec / 60;
  return minutes < 10 ? `${minutes.toFixed(1).replace(".", ",").replace(",0", "")} min` : `${Math.round(minutes)} min`;
}

type HourGroup = { key: string; label: string; hour: number | null; items: { item: QueueItemView; index: number }[] };

/** Agrupa a fila em faixas de uma hora (dia + hora de Campo Grande), preservando a ordem. */
function groupByHour(items: QueueItemView[], slots: (string | null)[], serverNow: string): HourGroup[] {
  const groups: HourGroup[] = [];
  items.forEach((item, index) => {
    const at = slots[index] ?? null;
    const key = at ? `${dateKeyOf(at)}T${String(hourOf(at)).padStart(2, "0")}` : "sem-horario";
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: at ? dayLabel(at, serverNow) : "Sem horário previsto", hour: at ? hourOf(at) : null, items: [] };
      groups.push(group);
    }
    group.items.push({ item, index });
  });
  return groups;
}

const STATE_TONE: Record<QueueState, string> = {
  sending: "text-emerald-700 dark:text-emerald-400",
  "outside-window": "text-amber-700 dark:text-amber-400",
  "cap-reached": "text-amber-700 dark:text-amber-400",
  paused: "text-neutral-600 dark:text-neutral-300",
  "paused-auto": "text-amber-700 dark:text-amber-400",
  "not-started": "text-neutral-600 dark:text-neutral-300",
  done: "text-neutral-600 dark:text-neutral-300",
  "no-schedule": "text-red-600 dark:text-red-400",
};

function stateMessage(view: CampaignQueueData, firstAt: string | null): string {
  const back = firstAt ? `${dayLabel(firstAt, view.serverNow).toLowerCase()} às ${timeOf(firstAt)}` : "na próxima janela de envio";
  switch (view.state) {
    case "sending":
      return `Enviando agora · em média 1 contato a cada ${formatInterval(view.pace.intervalSec)}`;
    case "outside-window":
      return `Fora do horário de envio da campanha — o próximo envio volta ${back}`;
    case "cap-reached":
      return `Teto diário atingido (${view.sentToday}/${view.dailyLimit}) — o envio volta ${back}`;
    case "paused":
      return "Campanha pausada — a fila espera você retomar. Os horários abaixo valem se retomar agora.";
    case "paused-auto":
      return "Campanha pausada automaticamente (veja o aviso no topo da página) — os horários abaixo valem se ela retomar agora.";
    case "not-started":
      return "Campanha ainda não iniciada — os horários abaixo valem se você iniciar agora.";
    case "done":
      return "Campanha encerrada.";
    case "no-schedule":
      return "A campanha não tem dias/horário de envio válidos configurados — nada será enviado.";
  }
}

function savedNotice(changed: number, ignored: number, refreshed: boolean): string {
  const parts: string[] = [];
  if (changed === 0) parts.push("Nenhuma mudança aplicada — os contatos que você mexeu já tinham sido enviados.");
  else parts.push(`Ordem salva — ${changed} contato${changed === 1 ? "" : "s"} reposicionado${changed === 1 ? "" : "s"}.`);
  if (changed > 0 && ignored > 0) {
    parts.push(ignored === 1 ? "1 já tinha sido enviado e ficou de fora." : `${ignored} já tinham sido enviados e ficaram de fora.`);
  }
  if (!refreshed) parts.push("Recarregue a página para ver a fila atualizada.");
  return parts.join(" ");
}

function TimeChip({ iso, soon }: { iso: string | null; soon?: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[3.6rem] shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${
        soon
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      }`}
      title="Horário previsto — depende do ritmo real de envio"
    >
      {iso ? `~${timeOf(iso)}` : "—"}
    </span>
  );
}

function PersonLine({ item }: { item: QueueItemView }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.contactName}</p>
      <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
        {item.contactJobTitle ?? "Sem cargo"} · {item.contactPhone ?? "sem telefone"}
      </p>
    </div>
  );
}

function SortableRow({
  item,
  position,
  slotIso,
  soon,
  showBottom,
  disabled,
  onTop,
  onBottom,
}: {
  item: QueueItemView;
  position: number;
  slotIso: string | null;
  soon: boolean;
  showBottom: boolean;
  disabled: boolean;
  onTop: () => void;
  onBottom: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 dark:bg-neutral-900 ${
        soon ? "border-emerald-200 dark:border-emerald-900/60" : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        aria-label={`Arrastar ${item.contactName} para reordenar`}
      >
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">#{position}</span>
      <TimeChip iso={slotIso} soon={soon} />
      <PersonLine item={item} />
      <button
        type="button"
        onClick={onTop}
        disabled={disabled || position === 1}
        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        title="Passar para o início da fila"
        aria-label={`Passar ${item.contactName} para o início da fila`}
      >
        <ArrowUpToLine className="h-4 w-4" strokeWidth={2} />
      </button>
      {showBottom && (
        <button
          type="button"
          onClick={onBottom}
          disabled={disabled}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          title="Mandar para o fim da fila"
          aria-label={`Mandar ${item.contactName} para o fim da fila`}
        >
          <ArrowDownToLine className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    </li>
  );
}

/**
 * Fila de disparo da campanha: quem sai em seguida, em que horário previsto, e
 * quem sai na próxima hora — e, pra quem gerencia a campanha, a ordem editável
 * (modo edição explícito, nada muda sem "Salvar ordem"). Os horários são
 * PREVISÕES calculadas pelo servidor (lib/campaigns/queue-estimate.ts): a
 * posição N da fila sempre tem o horário N, então reordenar só troca QUEM ocupa
 * cada horário — por isso a tela mantém os horários parados nas posições
 * enquanto se arrasta.
 */
export function CampaignQueue({ campaignId, initial }: { campaignId: string; initial: CampaignQueueData }) {
  const router = useRouter();
  const [view, setView] = useState<CampaignQueueData>(initial);
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [original, setOriginal] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [recipientToRemove, setRecipientToRemove] = useState<QueueItemView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showingAll, setShowingAll] = useState(false);
  const [query, setQuery] = useState("");
  // O resultado da busca guarda o TERMO que o gerou: "buscando" e "sem busca" saem de comparar termo x resultado.
  const [found, setFound] = useState<{ term: string; items: QueueItemView[] } | null>(null);
  const limitRef = useRef(Math.max(PAGE_SIZE, initial.items.length));
  const mounted = useRef(true);
  // Numeração das buscas da fila: a rede pode entregar fora de ordem, e a resposta mais VELHA nunca pode sobrescrever a mais nova.
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const endpoint = `/api/campaigns/${campaignId}/queue`;

  const fetchQueue = useCallback(
    // `signal` vem do polling abaixo: sair da tela (ou começar a editar a
    // ordem) derruba a consulta em voo em vez de só descartar a resposta.
    // O seq acima continua necessário mesmo assim — ele resolve "resposta
    // velha chegou depois da nova" entre ciclos que NÃO foram cancelados.
    async (wantedLimit: number, signal?: AbortSignal): Promise<CampaignQueueData | null> => {
      const seq = ++requestSeq.current;
      try {
        const res = await fetch(`${endpoint}?offset=0&limit=${wantedLimit}`, { cache: "no-store", signal });
        if (!res.ok) return null;
        const data = (await res.json()) as CampaignQueueData;
        if (seq < appliedSeq.current) return null; // já chegou uma resposta mais nova — esta ficou velha
        appliedSeq.current = seq;
        return data;
      } catch {
        return null; // sem rede agora — mantém o que já está na tela, tenta de novo no próximo ciclo
      }
    },
    [endpoint],
  );

  const refresh = useCallback(
    async (wantedLimit: number) => {
      const data = await fetchQueue(wantedLimit);
      if (data && mounted.current) setView(data);
      return data;
    },
    [fetchQueue],
  );

  // Atualiza sozinha (a fila anda enquanto a campanha envia) — só quando NÃO está editando e a aba está à vista.
  // Resposta que chega depois de a edição começar é descartada: a lista que a pessoa está arrastando não pode mudar por baixo dela.
  useEffect(() => {
    if (editing) return;
    const controller = new AbortController();
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const data = await fetchQueue(limitRef.current, controller.signal);
      if (data && !controller.signal.aborted) setView(data);
    };
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [editing, fetchQueue]);

  // Busca, com pausa de 300ms pra não consultar a cada tecla; a resposta de uma busca antiga (termo já trocado) é descartada.
  const term = query.trim();
  const searchActive = term.length >= 2;
  const results = searchActive && found?.term === term ? found.items : null;
  const searching = searchActive && results === null;
  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let items: QueueItemView[] = [];
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, { cache: "no-store", signal: controller.signal });
        if (res.ok) items = ((await res.json()) as { results?: QueueItemView[] }).results ?? [];
      } catch {
        // sem rede: cai em "ninguém encontrado" — a pessoa refaz a busca
      }
      // Num abort (termo mudou/saiu da tela) nem grava o resultado vazio: a
      // busca seguinte é quem manda agora.
      if (!controller.signal.aborted) setFound({ term, items });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, endpoint]);

  // Cada posição tem o SEU horário (fixo) — reordenar só troca quem ocupa cada uma.
  const slots = useMemo(() => view.items.map((i) => i.estimatedAt), [view.items]);
  const itemsById = useMemo(() => new Map(view.items.map((i) => [i.id, i])), [view.items]);
  const shown = useMemo(
    () => (editing ? draft.map((id) => itemsById.get(id)).filter((i): i is QueueItemView => !!i) : view.items),
    [editing, draft, itemsById, view.items],
  );
  const dirty = editing && draft.some((id, i) => id !== original[i]);
  const untilMs = Date.parse(view.nextHour.untilAt);
  const isSoon = (iso: string | null) => !!iso && Date.parse(iso) <= untilMs;
  const loadedAll = view.items.length >= view.total;

  const nextHourItems = useMemo(() => {
    if (!editing) return view.nextHour.items;
    // Em edição a lista da próxima hora acompanha o rascunho (a contagem é a mesma — depende só dos horários).
    const out: { id: string; contactName: string; estimatedAt: string }[] = [];
    shown.forEach((item, i) => {
      const at = slots[i];
      if (at && Date.parse(at) <= untilMs && out.length < NEXT_HOUR_VISIBLE) out.push({ id: item.id, contactName: item.contactName, estimatedAt: at });
    });
    return out;
  }, [editing, shown, slots, untilMs, view.nextHour.items]);

  const groups = useMemo(() => groupByHour(shown, slots, view.serverNow), [shown, slots, view.serverNow]);

  async function enterEdit() {
    setError(null);
    setNotice(null);
    setStarting(true);
    // Abre a edição com a fila de AGORA: a tela pode estar até 30s defasada, e quem já saiu não deve aparecer pra ser arrastado.
    const fresh = await refresh(limitRef.current);
    if (!mounted.current) return;
    const ids = (fresh ?? view).items.map((i) => i.id);
    setOriginal(ids);
    setDraft(ids);
    setEditing(true);
    setStarting(false);
  }

  function exitEdit() {
    setEditing(false);
    setOriginal([]);
    setDraft([]);
    setConfirmDiscard(false);
    setQuery("");
    setFound(null);
    void refresh(limitRef.current);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((prev) => arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id))));
  }

  function moveInDraft(id: string, to: "top" | "bottom") {
    setDraft((prev) => {
      const without = prev.filter((x) => x !== id);
      return to === "top" ? [id, ...without] : [...without, id];
    });
  }

  async function save() {
    if (!dirty) return exitEdit();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: draft }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; changed?: number; ignored?: number };
      if (!res.ok) {
        setError(data.error ?? "Não foi possível salvar a nova ordem.");
        return;
      }
      trackUse("campanhas.fila.reordenar");
      setEditing(false);
      setOriginal([]);
      setDraft([]);
      setQuery("");
      setFound(null);
      const fresh = await refresh(limitRef.current);
      setNotice(savedNotice(data.changed ?? 0, data.ignored ?? 0, fresh !== null));
      router.refresh();
    } catch {
      setError("Sem conexão — a nova ordem não foi salva. Tente de novo.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function moveFromSearch(item: QueueItemView, to: "top" | "bottom") {
    setBusy(`${item.id}:${to}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move", id: item.id, to }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; moved?: boolean; reason?: string };
      if (!res.ok) {
        setError(data.error ?? "Não foi possível mover esse contato.");
        return;
      }
      if (!data.moved) {
        setNotice(
          data.reason === "already-there"
            ? `${item.contactName} já é ${to === "top" ? "o primeiro" : "o último"} da fila.`
            : `${item.contactName} já foi enviado — saiu da fila.`,
        );
      } else {
        trackUse("campanhas.fila.mover");
        setNotice(`${item.contactName} agora é ${to === "top" ? "o próximo a ser enviado" : "o último da fila"}.`);
        router.refresh();
      }
      setQuery("");
      setFound(null);
      const fresh = await refresh(limitRef.current);
      if (fresh) {
        // A lista de edição recomeça da fila atualizada (este botão só funciona sem mudanças pendentes na lista).
        const ids = fresh.items.map((i) => i.id);
        setOriginal(ids);
        setDraft(ids);
      }
    } catch {
      setError("Sem conexão — nada foi alterado. Tente de novo.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function removeFromQueue() {
    const item = recipientToRemove;
    if (!item) return;
    setBusy(`remove:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await requestJson<{ removed?: boolean; reason?: string }>(
        endpoint,
        { method: "POST", json: { action: "remove", id: item.id } },
        { silent: true },
      );
      if (!res.ok) {
        setError(res.error ?? "Não foi possível remover esse contato da fila.");
        return;
      }
      if (!res.data.removed) {
        setNotice(`${item.contactName} já saiu da fila.`);
        return;
      }
      setNotice(`${item.contactName} foi removido da fila.`);
      setQuery("");
      setFound(null);
      await refresh(limitRef.current);
      router.refresh();
    } finally {
      if (mounted.current) {
        setBusy(null);
        setRecipientToRemove(null);
      }
    }
  }

  async function loadMore() {
    const next = Math.min(MAX_LOADED, view.total, view.items.length + PAGE_SIZE);
    limitRef.current = next;
    const fresh = await refresh(next);
    if (fresh && editing && !dirty) {
      const ids = fresh.items.map((i) => i.id);
      setOriginal(ids);
      setDraft(ids);
    }
  }

  async function showAll() {
    setShowingAll(true);
    setExpanded(true);
    try {
      const next = Math.min(MAX_LOADED, view.total);
      if (next > view.items.length) {
        limitRef.current = next;
        await refresh(next);
      }
    } finally {
      if (mounted.current) setShowingAll(false);
    }
  }

  const firstAt = slots[0] ?? null;
  const canEditNow = view.canEdit && view.total > 1;
  const stoppedButResumable = view.state === "paused" || view.state === "paused-auto";
  const hypothetical = stoppedButResumable || view.state === "not-started";
  const windowTitle = view.state === "not-started" ? "Primeira hora de envio" : stoppedButResumable ? "Primeira hora após retomar" : "Próxima hora";
  const windowHint = view.state === "not-started" ? "se iniciar agora" : stoppedButResumable ? "se retomar agora" : `até ${timeOf(view.nextHour.untilAt)}`;

  return (
    <div className="card space-y-3 p-3">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fila de disparo</h2>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {view.total} na fila
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editing && view.items.length > 8 && (
            <button
              type="button"
              onClick={expanded ? () => setExpanded(false) : showAll}
              disabled={showingAll}
              className="btn-secondary"
              title={view.total > MAX_LOADED ? "Mostra até 500 contatos; use a busca para localizar qualquer outro." : undefined}
            >
              {showingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              ) : expanded ? (
                <Minimize2 className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Maximize2 className="h-4 w-4" strokeWidth={2} />
              )}
              {expanded ? "Compactar" : "Mostrar tudo"}
            </button>
          )}
          {canEditNow && !editing && (
            <button type="button" onClick={enterEdit} disabled={starting} className="btn-secondary">
              {starting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Pencil className="h-4 w-4" strokeWidth={2} />}
              Editar ordem
            </button>
          )}
        </div>
        {editing && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => (dirty ? setConfirmDiscard(true) : exitEdit())} disabled={saving} className="btn-secondary">
              <X className="h-4 w-4" strokeWidth={2} />
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
              Salvar ordem
            </button>
          </div>
        )}
      </div>

      {/* Situação da campanha + de onde vem o ritmo */}
      <div className="space-y-0.5 text-sm">
        <p className={`font-medium ${STATE_TONE[view.state]}`}>{stateMessage(view, firstAt)}</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {view.pace.basis === "observed"
            ? `Ritmo real dos últimos ${view.pace.samples} envios (1 a cada ${formatInterval(view.pace.intervalSec)}).`
            : "Ritmo estimado pela configuração da campanha — melhora depois dos primeiros envios."}
          {view.dailyLimit !== null && ` · Teto de ${view.dailyLimit}/dia (${view.sentToday} hoje).`}
        </p>
      </div>

      {/* Próxima hora */}
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-900/60 dark:bg-emerald-500/10">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" strokeWidth={2} />
          <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{windowTitle}</span>
          <span className="text-xs text-emerald-800/80 dark:text-emerald-300/80">({windowHint})</span>
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold tabular-nums text-white dark:bg-emerald-500">
            {view.nextHour.count} contato{view.nextHour.count === 1 ? "" : "s"}
          </span>
        </div>
        {view.nextHour.count > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {nextHourItems.map((n) => (
              <span
                key={n.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs text-neutral-800 dark:border-emerald-900/60 dark:bg-neutral-900 dark:text-neutral-200"
              >
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{timeOf(n.estimatedAt)}</span>
                <span className="truncate">{n.contactName}</span>
              </span>
            ))}
            {view.nextHour.count > nextHourItems.length && (
              <span className="self-center text-xs text-emerald-800/80 dark:text-emerald-300/80">
                + {view.nextHour.count - nextHourItems.length} outros
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-emerald-900/80 dark:text-emerald-200/80">
            Ninguém será enviado {hypothetical ? "nessa hora" : "na próxima hora"}.
            {firstAt && shown[0] ? ` O próximo envio está previsto para ${dayLabel(firstAt, view.serverNow).toLowerCase()} às ${timeOf(firstAt)} — ${shown[0].contactName}.` : ""}
          </p>
        )}
      </div>

      {editing && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-500/10 dark:text-blue-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            <strong>Modo edição.</strong> Arraste pelo ícone <GripVertical className="inline h-3.5 w-3.5" strokeWidth={2} /> ou use{" "}
            <ArrowUpToLine className="inline h-3.5 w-3.5" strokeWidth={2} /> para mandar alguém pro início da fila. Os horários ficam nas posições:
            quem sobe na lista passa a ser enviado mais cedo. Nada é salvo até você clicar em <strong>Salvar ordem</strong>, e quem já foi
            enviado não muda.
          </span>
        </div>
      )}

      {notice && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          {notice}
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* Busca — acha quem está lá no fundo de uma fila de milhares */}
      {view.total > PAGE_SIZE && (
        <div className="space-y-2">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar contato na fila (nome ou telefone)"
              className="field-input pl-8"
            />
            {searching && <Loader2 className="absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 animate-spin text-neutral-400" strokeWidth={2} />}
          </div>
          {results !== null && (
            <ul className="space-y-1.5">
              {results.length === 0 && (
                <li className="text-xs text-neutral-500 dark:text-neutral-400">Ninguém com esse nome/telefone na fila (quem já foi enviado não aparece aqui).</li>
              )}
              {results.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">#{r.rank}</span>
                  <TimeChip iso={r.estimatedAt} soon={isSoon(r.estimatedAt)} />
                  <PersonLine item={r} />
                  {editing && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => moveFromSearch(r, "top")}
                        disabled={dirty || busy !== null || r.rank === 1}
                        className="btn-secondary btn-sm"
                        title={dirty ? "Salve ou cancele as mudanças da lista antes de mover por aqui." : "Vira o próximo a ser enviado"}
                      >
                        {busy === `${r.id}:top` ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <ArrowUpToLine className="h-3.5 w-3.5" strokeWidth={2} />}
                        Colocar no início
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFromSearch(r, "bottom")}
                        disabled={dirty || busy !== null || r.rank === view.total}
                        className="btn-secondary btn-sm"
                        title={dirty ? "Salve ou cancele as mudanças da lista antes de mover por aqui." : "Vai pro fim da fila"}
                      >
                        {busy === `${r.id}:bottom` ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={2} />}
                        Colocar no fim
                      </button>
                    </div>
                  )}
                  {!editing && view.canEdit && (
                    <button
                      type="button"
                      onClick={() => setRecipientToRemove(r)}
                      disabled={busy !== null}
                      className="btn-secondary btn-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <UserRoundX className="h-3.5 w-3.5" strokeWidth={2} />
                      Remover
                    </button>
                  )}
                </li>
              ))}
              {results.length > 0 && !editing && view.canEdit && (
                <li className="text-xs text-neutral-400 dark:text-neutral-500">Para mover alguém, clique em “Editar ordem”.</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* A fila */}
      {view.total === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400 dark:text-neutral-500">Fila vazia — todos os contatos já foram enviados.</p>
      ) : editing ? (
        <div className="max-h-[55vh] overflow-y-auto overscroll-contain pr-1 scrollbar-thin">
          <DndContext id="campaign-queue" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={draft} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {shown.map((item, index) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    position={index + 1}
                    slotIso={slots[index] ?? null}
                    soon={isSoon(slots[index] ?? null)}
                    showBottom={loadedAll}
                    disabled={saving}
                    onTop={() => moveInDraft(item.id, "top")}
                    onBottom={() => moveInDraft(item.id, "bottom")}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        <div className={expanded ? "space-y-3" : "max-h-[55vh] space-y-3 overflow-y-auto overscroll-contain pr-1 scrollbar-thin"}>
          {groups.map((group) => (
            <div key={group.key}>
              <div className="mb-1 flex items-center gap-1.5 border-b border-neutral-100 pb-1 text-xs font-semibold text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <Clock3 className="h-3.5 w-3.5" strokeWidth={2} />
                {group.label}
                {group.hour !== null && ` · ${String(group.hour).padStart(2, "0")}h`}
                <span className="font-normal text-neutral-400 dark:text-neutral-500">
                  — {group.items.length} contato{group.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="space-y-1">
                {group.items.map(({ item, index }) => (
                  <li key={item.id} className="flex items-center gap-2 px-1 py-1">
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">#{index + 1}</span>
                    <TimeChip iso={slots[index] ?? null} soon={isSoon(slots[index] ?? null)} />
                    <PersonLine item={item} />
                    {view.canEdit && (
                      <button
                        type="button"
                        onClick={() => setRecipientToRemove(item)}
                        disabled={busy !== null}
                        className="ml-auto rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                        title="Remover da fila"
                        aria-label={`Remover ${item.contactName} da fila`}
                      >
                        {busy === `remove:${item.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                        ) : (
                          <UserRoundX className="h-4 w-4" strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Carregar mais */}
      {view.total > view.items.length && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Mostrando os primeiros {view.items.length} de {view.total}.
          </p>
          {view.items.length < MAX_LOADED ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={dirty}
              className="text-xs font-medium text-brand hover:underline disabled:opacity-40"
              title={dirty ? "Salve ou cancele as mudanças antes de carregar mais." : undefined}
            >
              Mostrar mais {Math.min(PAGE_SIZE, view.total - view.items.length)}
            </button>
          ) : (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">Use a busca acima pra achar quem está mais adiante.</span>
          )}
        </div>
      )}

      <p className="text-[11px] leading-snug text-neutral-400 dark:text-neutral-500">
        Horários são previsões: dependem do ritmo real de envio, da janela de dias/horário e do teto diário, e mudam se a campanha for pausada ou
        se algum envio falhar. Fuso de Campo Grande.
      </p>

      {confirmDiscard && (
        <ConfirmDialog
          title="Descartar as mudanças na fila?"
          description="A nova ordem que você montou ainda não foi salva. Se sair agora, a fila continua exatamente como estava."
          confirmLabel="Descartar mudanças"
          onConfirm={exitEdit}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
      {recipientToRemove && (
        <ConfirmDialog
          title={`Remover ${recipientToRemove.contactName} da fila?`}
          description="A pessoa não receberá esta campanha nem os reenvios. O contato e o histórico da campanha serão preservados."
          confirmLabel="Remover da fila"
          danger
          onConfirm={removeFromQueue}
          onClose={() => {
            if (!busy) setRecipientToRemove(null);
          }}
        />
      )}
    </div>
  );
}
