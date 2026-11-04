"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  Megaphone,
  Plus,
  Loader2,
  Trash2,
  Play,
  Pause,
  StopCircle,
  Send,
  CheckCheck,
  RefreshCw,
  Image as ImageIcon,
  Video,
  Pencil,
  X,
  Users,
  Clock,
  Search,
  Radio,
  Hourglass,
  CircleCheckBig,
  Eye,
  TriangleAlert,
  Unplug,
  ChevronDown,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge, type BadgeTone } from "@/components/badge";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { BulkCampaignScheduleFields, type BulkCampaignSchedule } from "@/components/bulk-campaign-schedule-fields";
import { BulkScriptPicker, type BulkScriptOption } from "@/components/bulk-script-picker";
import { RmktWavesFields } from "@/components/rmkt-waves-fields";
import { useRmktWaves, type WaveRow } from "@/lib/use-rmkt-waves";
import { renderSteps, pickWeighted, renderSamplePreview, stepDelayLabel, SAMPLE_CONTACT_VARS, type WeightedScript, type ScriptStep } from "@/lib/campaigns/spintax";
import { DuplicateCampaignButton } from "./duplicate-campaign-button";
import { trackUse } from "@/lib/feature-usage/track";
import { PAUSE_REASON, type PauseReason } from "@/lib/campaigns/pause-reasons";

type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "DONE";

/** Etiqueta (e explicação no hover) de uma campanha PAUSADA pelo próprio motor — ver Campaign.pausedReason no schema. */
const PAUSE_REASON_BADGE: Record<PauseReason, { label: string; hint: string }> = {
  [PAUSE_REASON.WHATSAPP_DISCONNECTED]: {
    label: "WhatsApp desconectado",
    hint: "Pausada automaticamente porque o WhatsApp caiu. Volta a enviar SOZINHA quando ele reconectar — não precisa retomar.",
  },
  [PAUSE_REASON.WHATSAPP_INSTABILITY]: {
    label: "Número instável",
    hint: "Pausada automaticamente: o WhatsApp caiu 3 vezes ou mais em 7 dias (risco de banimento). NÃO volta sozinha — retome na mão quando o número estiver estável.",
  },
  [PAUSE_REASON.FAILURES]: {
    label: "Falhas seguidas",
    hint: "Pausada automaticamente depois de 5 falhas de envio seguidas. NÃO volta sozinha — resolva o problema e retome na mão.",
  },
};
type AudienceFilter = { jobTitles: string[]; tags: string[]; cities: string[] };
type AudienceOptions = AudienceFilter;

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  /** Por que está PAUSED sem alguém ter clicado em Pausar (null = pausa manual ou não pausada). */
  pausedReason: PauseReason | null;
  audienceFilter: AudienceFilter;
  audienceLabel: string;
  instanceName: string;
  createdByName: string;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  createdAt: string;
  counts: { pending: number; sent: number; failed: number; skipped: number; replied: number };
  /** false = só enxerga (envio em massa do Pipeline em que só parte dos destinatários saiu do WhatsApp dela) — sem botões de gerenciar. */
  canManage: boolean;
};

/** Vem cru de GET /api/campaigns/[id] — usado só pra pré-preencher o modal em modo edição. */
type RawCampaign = {
  id: string;
  name: string;
  audienceFilter: AudienceFilter;
  instanceId: string;
  messageTemplates: { steps: ScriptStep[]; weight: number; scriptId?: string }[];
  followUpTemplates: { steps: ScriptStep[]; weight: number; scriptId?: string }[] | null;
  followUpEnabled: boolean;
  followUpDelayHours: number;
  rmktWaves: { dayOffset: number; templates: { scriptId?: string }[] }[] | null;
  noReplyDays: number | null;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
};

type InstanceOption = { id: string; label: string };
type ScriptOption = { id: string; name: string; steps: ScriptStep[] };
type CampaignSetup = { scripts: ScriptOption[]; audienceOptions: AudienceOptions };
type PreviewPosition = { top: number; left: number; maxHeight: number };
type ScriptPreview = { script: BulkScriptOption; messages: string[] } & PreviewPosition;

/** Ordem da lista: o que está acontecendo AGORA no topo (ver sortAndFilter
 * abaixo). Antes a ordem era só por data de criação, então uma campanha
 * rodando agora podia aparecer embaixo de uma pausada de ontem. */
const STATUS_ORDER: Record<CampaignStatus, number> = { RUNNING: 0, PAUSED: 1, DRAFT: 2, DONE: 3 };

/** Rótulo + cor + ícone de cada status. Usa `Badge` (components/badge.tsx) em
 * vez de tom próprio — é a paleta única de etiquetas de todo o sistema, então
 * "Rodando" aqui tem exatamente o mesmo verde que "em dia" em qualquer outra
 * tela. */
const STATUS_META: Record<CampaignStatus, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  DRAFT: { label: "Rascunho", tone: "neutral", icon: Hourglass },
  RUNNING: { label: "Rodando", tone: "success", icon: Radio },
  PAUSED: { label: "Pausada", tone: "warning", icon: Pause },
  DONE: { label: "Concluída", tone: "slate", icon: CircleCheckBig },
};

function createPreviewMessages(script: BulkScriptOption): string[] {
  return script.steps.map((step) => (step.text.trim() ? renderSamplePreview(step.text) : "(mensagem vazia)"));
}

const NUMBER_FORMAT = new Intl.NumberFormat("pt-BR");
/** 21082 → "21.082". Números de campanha passam de dezenas de milhares e sem
 * separador de milhar ninguém lê "35018" como trinta e cinco mil. */
function fmtNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** Percentual "humano": inteiro, mas com 1 casa quando é pequeno e não-zero —
 * campanha de 21.082 destinatários com 35 enviados era 0% arredondado, o que
 * lia como "nada saiu" mesmo tendo saído. */
function fmtPercent(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  const value = (part / total) * 100;
  const text = value < 1 ? value.toFixed(1) : String(Math.round(value));
  return `${text.replace(".", ",")}%`;
}

/** Minúsculo + sem acento, só pra comparar na busca — mesmo critério do Select
 * (components/select.tsx), pra "prospeccao" achar "Prospecção". */
function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** PIPELINE_BULK/LEAD_CAPTURE sem filtro de público de verdade (lista montada
 * por seleção manual, ver DuplicateCampaignButton) — "Nenhum critério
 * definido" (o que describeAudienceFilter devolve nesse caso) lê como um
 * erro/campo esquecido; isso aqui deixa claro que é intencional. */
function hasAudienceFilter(f: AudienceFilter): boolean {
  return f.jobTitles.length > 0 || f.tags.length > 0 || f.cities.length > 0;
}

function audienceDisplay(c: Pick<Campaign, "audienceFilter" | "audienceLabel">): string {
  return hasAudienceFilter(c.audienceFilter) ? c.audienceLabel : "Lista selecionada manualmente";
}

/** "Rodando" com tudo já enviado (0 pendente) confunde — parece travada, mas
 * campanha com remarketing (RMKT: ondas + noReplyDays, ver source
 * LEAD_CAPTURE) só vira DONE quando TODO destinatário responde ou expira
 * (até noReplyDays depois do envio inicial, ver lib/campaigns/engine.ts) —
 * pode ficar assim por dias/semanas de propósito, só tocando reenvio de
 * onda/expiração, nunca mais envio inicial novo. Pedido explícito do
 * usuário depois de estranhar exatamente essa tela. */
function isInFollowUpPhase(c: Pick<Campaign, "status">, pending: number, total: number): boolean {
  return c.status === "RUNNING" && total > 0 && pending === 0;
}

/** Barra de progresso com DUAS faixas: enviados e falhados. Antes era uma
 * barra só de enviados — 22 falhas em 35 enviados apareciam apenas como um
 * texto vermelho ao lado, invisível de relance. Agora a proporção de problema
 * aparece na própria barra.
 *
 * A cor dos enviados segue o status (não é sempre verde): verde para
 * concluída, roxo da marca para o que está rodando agora, âmbar para pausada
 * — dá pra saber o estado da campanha só pela barra, sem ler a etiqueta. */
function CampaignProgressBar({
  sent,
  failed,
  total,
  status,
}: {
  sent: number;
  failed: number;
  total: number;
  status: CampaignStatus;
}) {
  const sentPct = total > 0 ? (sent / total) * 100 : 0;
  const failedPct = total > 0 ? (failed / total) * 100 : 0;
  const sentColor =
    status === "DONE"
      ? "bg-emerald-500 dark:bg-emerald-400"
      : status === "PAUSED"
        ? "bg-amber-400 dark:bg-amber-500"
        : status === "DRAFT"
          ? "bg-neutral-300 dark:bg-neutral-600"
          : "bg-brand";

  return (
    <div className="flex h-2 w-full min-w-16 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
      {/* Math.max(2, …) garante que 1 envio em 20.000 ainda vira um traço
          visível — com 0,005% de largura a barra ficaria vazia e pareceria
          que nada aconteceu. */}
      {sent > 0 && (
        <div
          className={`h-full transition-all duration-300 ${sentColor}`}
          style={{ width: `${Math.max(2, sentPct)}%` }}
        />
      )}
      {failed > 0 && (
        <div
          className="h-full bg-red-400 transition-all duration-300 dark:bg-red-500"
          style={{ width: `${Math.max(2, failedPct)}%` }}
        />
      )}
    </div>
  );
}

export function CampaignsTable({
  initialCampaigns,
  instances,
}: {
  initialCampaigns: Campaign[];
  instances: InstanceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<RawCampaign | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [preparingEdit, setPreparingEdit] = useState(false);
  const [setup, setSetup] = useState<CampaignSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const setupRef = useRef<CampaignSetup | null>(null);
  const setupPromiseRef = useRef<Promise<CampaignSetup> | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  // "Parar" (vira DONE de vez) é diferente de "Pausar" (PAUSED, reversível
  // com "Retomar") — precisa de confirmação porque, ao contrário de pausar,
  // não tem volta: destinatário ainda PENDING fica pra sempre sem ser
  // enviado (pedido explícito do usuário).
  const [campaignToStop, setCampaignToStop] = useState<Campaign | null>(null);
  // Histórico: "Ativas" (o que ainda tem trabalho a fazer ou espera revisão)
  // é o padrão — Concluída some da visão principal sozinha, senão a lista
  // só cresce pra sempre com campanha que já terminou há meses. "Todas" e
  // "Concluídas" ficam a um clique pra quem quer rever o que já rodou.
  const [statusFilter, setStatusFilter] = useState<"active" | "done" | "all">("active");
  const [search, setSearch] = useState("");
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  // Cópia local da lista, só pra dar resposta IMEDIATA ao clique (ver
  // setStatus/deleteCampaign abaixo). O servidor continua sendo a verdade:
  // quando um payload novo chegar (router.refresh, navegação, RSC cache novo),
  // a cópia é trocada por ele no PRÓPRIO render — não num effect, porque avisar
  // um setState dentro de effect obriga um render extra só pra isso (a guarda
  // de baixo é o padrão sugerido em react.dev/you-might-not-need-an-effect).
  const [rows, setRows] = useState(initialCampaigns);
  const [lastPayload, setLastPayload] = useState(initialCampaigns);
  if (lastPayload !== initialCampaigns) {
    setLastPayload(initialCampaigns);
    setRows(initialCampaigns);
  }
  // Id da campanha com uma ação em andamento — desabilita TODOS os botões
  // daquele card, não só o clicado: sem isso, dois cliques rápidos em "Parar"
  // disparavam dois PATCH (e dois recarregamentos de página) em sequência.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Digitar na busca continua instantâneo mesmo numa lista grande: o campo
  // atualiza com `search` na hora, e a filtragem/ordenação roda com o valor
  // adiado (useDeferredValue), sem segurar o caractere digitado.
  const deferredSearch = useDeferredValue(search);

  /** Aplica a mudança na tela ANTES de confirmar no servidor.
   *
   * Antes: clique → espera o PATCH (~0,6s, são 2 idas ao banco para achar e
   * atualizar a linha) → espera o recarregamento da página inteira (~0,6-0,9s,
   * porque a lista refaz 3 consultas a cada carga) → só então a etiqueta
   * mudava. Quase 1,5s com a tela ainda dizendo "Rodando" depois de a pessoa
   * clicar em "Pausar".
   *
   * Agora a etiqueta muda no mesmo quadro do clique. O `router.refresh()`
   * continua sendo chamado, mas depois da resposta e sem `await` — ele só
   * mantém o cache de navegação correto; nesse intervalo quem manda na tela é
   * o estado local. Se a requisição falhar, a linha volta ao que era e o
   * motivo aparece no aviso acima da lista. */
  async function setStatus(campaign: Campaign, status: CampaignStatus) {
    setActionError(null);
    setBusyId(campaign.id);
    setRows((current) => current.map((c) => (c.id === campaign.id ? { ...c, status } : c)));

    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);

    setBusyId(null);
    if (!res?.ok) {
      setRows((current) => current.map((c) => (c.id === campaign.id ? { ...c, status: campaign.status } : c)));
      // O servidor recusa com o motivo quando sabe (ex.: "o WhatsApp de fulano está desconectado").
      const data = await res?.json().catch(() => null);
      setActionError(data?.error ?? `Não foi possível alterar "${campaign.name}" agora. Tente de novo.`);
      return;
    }
    trackUse(status === "RUNNING" ? "campanhas.iniciar" : status === "PAUSED" ? "campanhas.pausar" : "campanhas.parar");
    router.refresh();
  }

  async function deleteCampaign(campaign: Campaign) {
    setActionError(null);
    setBusyId(campaign.id);
    setRows((current) => current.filter((c) => c.id !== campaign.id));

    const res = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" }).catch(() => null);

    setBusyId(null);
    if (!res?.ok) {
      // Devolve a linha solta: a posição não precisa ser reconstruída aqui
      // porque a ordenação roda de novo a cada render (ver visibleCampaigns).
      setRows((current) => [...current, campaign]);
      const data = await res?.json().catch(() => null);
      setActionError(data?.error ?? `Não foi possível excluir "${campaign.name}". Tente de novo.`);
      return;
    }
    router.refresh();
  }

  async function loadSetup(): Promise<CampaignSetup | null> {
    if (setupRef.current) return setupRef.current;
    if (!setupPromiseRef.current) {
      setSetupLoading(true);
      setSetupError(null);
      setupPromiseRef.current = fetch("/api/campaigns/setup")
        .then(async (res) => {
          if (!res.ok) throw new Error("setup");
          return (await res.json()) as CampaignSetup;
        });
    }

    try {
      const loaded = await setupPromiseRef.current;
      setupRef.current = loaded;
      setSetup(loaded);
      return loaded;
    } catch {
      setSetupError("Não foi possível carregar as opções da campanha.");
      return null;
    } finally {
      setupPromiseRef.current = null;
      setSetupLoading(false);
    }
  }

  function openCreate() {
    setEditCampaign(null);
    setPreparingEdit(false);
    setOpen(true);
    void loadSetup();
  }

  async function openEdit(id: string) {
    setLoadingEditId(id);
    setPreparingEdit(true);
    setEditCampaign(null);
    setOpen(true);
    try {
      const [res, loadedSetup] = await Promise.all([fetch(`/api/campaigns/${id}`), loadSetup()]);
      if (!res.ok) {
        setActionError("Não foi possível abrir esta campanha.");
        setOpen(false);
        return;
      }
      if (!loadedSetup) {
        // Sem as opções não dá pra editar — fecha em vez de deixar o "Tentar
        // novamente" do modal de carga, que reabriria como campanha NOVA.
        setActionError("Não foi possível abrir esta campanha.");
        setOpen(false);
        return;
      }
      setEditCampaign((await res.json()) as RawCampaign);
    } catch {
      setActionError("Não foi possível abrir esta campanha.");
      setOpen(false);
    } finally {
      setLoadingEditId(null);
      setPreparingEdit(false);
    }
  }

  const doneCount = useMemo(() => rows.filter((c) => c.status === "DONE").length, [rows]);

  /** Filtro de aba + busca + ordenação + totais numa ÚNICA passada.
   *
   * Antes eram três laços sobre a mesma lista (filtrar, ordenar, depois somar)
   * em dois `useMemo` encadeados — o segundo só podia rodar depois de o
   * primeiro terminar, e cada tecla digitada refazia os dois. Agora é um
   * `filter` + um `sort` + um laço de soma, e o resultado já sai com os
   * números do topo.
   *
   * A ordenação por STATUS_ORDER (ver topo do arquivo) é o que põe o que está
   * rodando agora no topo, independente de quando foi criada; dentro do mesmo
   * status, a mais recente primeiro. `createdAt` é ISO 8601 em UTC com o mesmo
   * formato em todas as linhas, então comparar texto dá a mesma ordem que
   * comparar data — sem criar dois `new Date()` a cada comparação. */
  const { visibleCampaigns, summary } = useMemo(() => {
    const term = foldForSearch(deferredSearch.trim());
    const filtered = rows.filter((c) => {
      if (statusFilter === "done" && c.status !== "DONE") return false;
      if (statusFilter === "active" && c.status === "DONE") return false;
      if (!term) return true;
      const haystack = foldForSearch(`${c.name} ${audienceDisplay(c)} ${c.instanceName} ${c.createdByName}`);
      return haystack.includes(term);
    });

    filtered.sort((a, b) => {
      const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (byStatus !== 0) return byStatus;
      return b.createdAt.localeCompare(a.createdAt);
    });

    let running = 0;
    for (const c of filtered) {
      if (c.status === "RUNNING") running += 1;
    }

    return {
      visibleCampaigns: filtered,
      summary: { running },
    };
  }, [rows, statusFilter, deferredSearch]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Campanhas</h1>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
            {summary.running > 0
              ? `${fmtNumber(summary.running)} ${summary.running === 1 ? "campanha enviando" : "campanhas enviando"}`
              : "Envios em massa pelo WhatsApp"}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary"
          disabled={instances.length === 0}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Nova campanha
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Histórico: filtro de status — Ativas some Concluída da visão
            principal sozinha, sem esconder o histórico de vez (ver
            statusFilter acima). A contagem aparece nas TRÊS abas (antes só
            "Concluídas" tinha número) — sem isso "Todas" não dizia quantas
            eram no total. */}
        <div className="grid grid-cols-3 rounded-md bg-neutral-100 p-0.5 dark:bg-neutral-900" role="tablist" aria-label="Filtrar campanhas">
          {(
            [
              ["active", "Ativas", rows.length - doneCount],
              ["done", "Concluídas", doneCount],
              ["all", "Todas", rows.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={`rounded px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === value
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      {instances.length === 0 && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Nenhum WhatsApp conectado — conecte um em Configurações → Perfil antes de criar uma campanha.
        </p>
      )}

      {/* Falha de ação (ver setStatus/deleteCampaign): a linha já voltou ao que
          era, isto aqui é o único sinal de que o clique não pegou. */}
      {actionError && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300"
        >
          {actionError}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <EmptyState
            icon={Megaphone}
            title="Nenhuma campanha criada ainda"
            description="Crie uma campanha e escolha quem vai receber."
            action={
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={instances.length === 0}
                onClick={openCreate}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Criar primeira campanha
              </button>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <div className="border-b border-neutral-100 p-3 dark:border-neutral-800/70">
            <div className="relative min-w-[200px] sm:max-w-sm">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
                strokeWidth={2}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar campanha pelo nome"
                className="field-input py-2 pl-8 text-sm"
              />
            </div>
          </div>

          {visibleCampaigns.length === 0 ? (
            <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">
              {deferredSearch.trim()
                ? `Nenhuma campanha encontrada para "${deferredSearch.trim()}".`
                : statusFilter === "done"
                  ? "Nenhuma campanha concluída ainda."
                  : "Nenhuma campanha nesse filtro."}
            </p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800/70">
              {visibleCampaigns.map((campaign) => {
                const total = campaign.counts.pending + campaign.counts.sent + campaign.counts.failed + campaign.counts.skipped;
                const { sent, pending, failed, skipped, replied } = campaign.counts;
                const meta = STATUS_META[campaign.status];
                const StatusIcon = meta.icon;
                const expanded = expandedCampaignId === campaign.id;
                const replyRate = sent > 0 ? fmtPercent(replied, sent) : "0%";

                return (
                  <article key={campaign.id} className="p-4 transition-colors hover:bg-neutral-50/60 dark:hover:bg-neutral-900/30">
                    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(300px,1fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/whatsapp/campanhas/${campaign.id}`} className="min-w-0 truncate font-semibold text-neutral-900 hover:text-brand dark:text-neutral-100">
                            {campaign.name}
                          </Link>
                          <Badge tone={meta.tone}>
                            <StatusIcon className="h-3 w-3" strokeWidth={2.5} />
                            {meta.label}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
                          Para: {audienceDisplay(campaign)}
                        </p>
                        {campaign.status === "PAUSED" && campaign.pausedReason && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400" title={PAUSE_REASON_BADGE[campaign.pausedReason].hint}>
                            <Unplug className="h-3 w-3" strokeWidth={2.5} />
                            {PAUSE_REASON_BADGE[campaign.pausedReason].label}
                          </p>
                        )}
                        {isInFollowUpPhase(campaign, pending, total) && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-brand">
                            <Clock className="h-3 w-3" strokeWidth={2.5} />
                            Aguardando reenvio
                          </p>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <CampaignProgressBar sent={sent} failed={failed} total={total} status={campaign.status} />
                          <span className="w-11 shrink-0 text-right text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                            {fmtPercent(sent, total)}
                          </span>
                        </div>
                        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                          {total > 0 ? (
                            <span><strong className="font-semibold text-neutral-800 dark:text-neutral-200">{fmtNumber(sent)}</strong> de {fmtNumber(total)} receberam</span>
                          ) : (
                            <span>Nenhum contato selecionado</span>
                          )}
                          {replied > 0 && <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtNumber(replied)} responderam</span>}
                          {failed > 0 && <span className="font-medium text-red-600 dark:text-red-400">{fmtNumber(failed)} não enviados</span>}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {campaign.canManage && (campaign.status === "DRAFT" || campaign.status === "PAUSED") && (
                          <button
                            type="button"
                            disabled={busyId === campaign.id}
                            onClick={() => setStatus(campaign, "RUNNING")}
                            className="btn-secondary btn-sm"
                          >
                            <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
                            {campaign.status === "PAUSED" ? "Retomar" : "Iniciar"}
                          </button>
                        )}
                        {campaign.canManage && campaign.status === "RUNNING" && (
                          <button
                            type="button"
                            disabled={busyId === campaign.id}
                            onClick={() => setStatus(campaign, "PAUSED")}
                            className="btn-secondary btn-sm"
                          >
                            <Pause className="h-3.5 w-3.5" strokeWidth={2.5} />
                            Pausar
                          </button>
                        )}
                        <Link href={`/whatsapp/campanhas/${campaign.id}`} className="btn-secondary btn-sm">
                          <Eye className="h-3.5 w-3.5" strokeWidth={2} />
                          Abrir
                        </Link>
                        <button
                          type="button"
                          onClick={() => setExpandedCampaignId((current) => (current === campaign.id ? null : campaign.id))}
                          className="btn-ghost btn-sm min-w-36"
                          aria-expanded={expanded}
                          aria-controls={`campaign-information-${campaign.id}`}
                        >
                          {expanded ? "Ocultar" : "Ver informações"}
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} />
                        </button>
                        {busyId === campaign.id && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-label="Salvando" />}
                      </div>
                    </div>

                    {expanded && (
                      <div id={`campaign-information-${campaign.id}`} className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                          <section>
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Resultados</h3>
                            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-5 xl:grid-cols-2">
                              {[
                                ["Enviadas", fmtNumber(sent)],
                                ["Pendentes", fmtNumber(pending)],
                                ["Respostas", `${fmtNumber(replied)} · ${replyRate}`],
                                ["Falhas", fmtNumber(failed)],
                                ["Ignorados", fmtNumber(skipped)],
                              ].map(([label, value]) => (
                                <div key={label}>
                                  <dt className="text-xs text-neutral-500 dark:text-neutral-400">{label}</dt>
                                  <dd className="mt-0.5 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{value}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>

                          <section>
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Configuração</h3>
                            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">WhatsApp</dt>
                                <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">{campaign.instanceName}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Criada por</dt>
                                <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">{campaign.createdByName}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Intervalo entre envios</dt>
                                <dd className="mt-0.5 font-medium tabular-nums text-neutral-800 dark:text-neutral-200">{campaign.delayMinSec}s a {campaign.delayMaxSec}s</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Horário</dt>
                                <dd className="mt-0.5 font-medium tabular-nums text-neutral-800 dark:text-neutral-200">{campaign.windowStartHour}h às {campaign.windowEndHour}h</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Dias</dt>
                                <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">{campaign.allowedWeekdays.map((day) => WEEKDAY_LABELS[day]).join(", ")}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Limite diário</dt>
                                <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">{campaign.dailyCap ? fmtNumber(campaign.dailyCap) : "Sem limite"}</dd>
                              </div>
                              <div>
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Reenvio</dt>
                                <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">{campaign.followUpEnabled ? `Após ${campaign.followUpDelayHours}h` : "Desativado"}</dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs text-neutral-500 dark:text-neutral-400">Público</dt>
                                <dd className="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">{audienceDisplay(campaign)}</dd>
                              </div>
                            </dl>
                          </section>
                        </div>

                        {campaign.canManage && (
                          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                            {campaign.status === "DRAFT" && (
                              <button type="button" disabled={loadingEditId === campaign.id} onClick={() => openEdit(campaign.id)} className="icon-btn-labeled">
                                {loadingEditId === campaign.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                                Editar
                              </button>
                            )}
                            <DuplicateCampaignButton
                              campaignId={campaign.id}
                              hasAudienceFilter={hasAudienceFilter(campaign.audienceFilter)}
                              labeled
                              size="sm"
                              onDuplicated={() => router.refresh()}
                            />
                            <span className="ml-auto" />
                            {(campaign.status === "RUNNING" || campaign.status === "PAUSED") && (
                              <button type="button" disabled={busyId === campaign.id} onClick={() => setCampaignToStop(campaign)} className="icon-btn-labeled text-red-500 hover:text-red-600 dark:text-red-400">
                                <StopCircle className="h-3.5 w-3.5" />
                                Parar definitivamente
                              </button>
                            )}
                            <button type="button" disabled={busyId === campaign.id} onClick={() => setCampaignToDelete(campaign)} className="icon-btn text-red-500 hover:text-red-600 dark:text-red-400" aria-label="Excluir campanha" title="Excluir campanha">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {open && (!setup || preparingEdit) && (
        <Modal
          onClose={() => {
            setOpen(false);
            setPreparingEdit(false);
          }}
          maxWidth="max-w-sm"
        >
          <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
            {setupLoading || preparingEdit ? (
              <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
            ) : (
              <TriangleAlert className="h-5 w-5 text-amber-500" aria-hidden="true" />
            )}
            <div>
              <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
                {preparingEdit ? "Abrindo campanha" : setupError ? "Não foi possível abrir" : "Preparando campanha"}
              </h2>
              {setupError && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{setupError}</p>}
            </div>
            {setupError && !setupLoading && !preparingEdit && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => void loadSetup()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Tentar novamente
              </button>
            )}
          </div>
        </Modal>
      )}

      {open && setup && !preparingEdit && (
        <CampaignDialog
          instances={instances}
          scripts={setup.scripts}
          audienceOptions={setup.audienceOptions}
          editCampaign={editCampaign}
          onClose={() => {
            setOpen(false);
            setPreparingEdit(false);
          }}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}

      {campaignToDelete && (
        <ConfirmDialog
          title={`Excluir "${campaignToDelete.name}"?`}
          description="Apaga a campanha e a lista de destinatários. Mensagens já enviadas continuam no histórico da conversa, só a campanha em si some."
          confirmLabel="Excluir"
          onClose={() => setCampaignToDelete(null)}
          onConfirm={async () => {
            const target = campaignToDelete;
            setCampaignToDelete(null);
            await deleteCampaign(target);
          }}
        />
      )}

      {campaignToStop && (
        <ConfirmDialog
          title={`Parar "${campaignToStop.name}" de vez?`}
          description="Isso termina a campanha permanentemente, mesmo que ainda faltem destinatários pendentes — eles NUNCA serão enviados. Diferente de pausar, não tem como retomar depois. Se for só uma parada temporária, use Pausar em vez disso."
          confirmLabel="Parar campanha"
          onClose={() => setCampaignToStop(null)}
          onConfirm={async () => {
            const target = campaignToStop;
            setCampaignToStop(null);
            await setStatus(target, "DONE");
          }}
        />
      )}
    </div>
  );
}

/** Campo de lista (cargos/tags/cidades) — digita e aperta Enter/vírgula pra adicionar um chip. */
function ChipInput({
  label,
  values,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  options: string[];
}) {
  const [input, setInput] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  function add(raw: string) {
    const clean = raw.trim();
    if (clean && !values.includes(clean)) onChange([...values, clean]);
    setInput("");
  }

  const availableOptions = options.filter(
    (option) =>
      !values.some((value) => value.localeCompare(option, undefined, { sensitivity: "accent" }) === 0) &&
      option.toLocaleLowerCase("pt-BR").includes(input.trim().toLocaleLowerCase("pt-BR")),
  );

  return (
    <div
      className="relative space-y-1"
      onFocusCapture={() => setSuggestionsOpen(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (input) add(input);
        setSuggestionsOpen(false);
      }}
    >
      <label className="field-label">{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 p-1.5 dark:border-neutral-700">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label={`Remover ${v}`}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onClick={() => setSuggestionsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            }
          }}
          onBlur={() => input && add(input)}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[100px] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
        />
      </div>
      {suggestionsOpen && availableOptions.length > 0 && (
        <div className="scrollbar-thin absolute top-full z-30 mt-1 flex max-h-32 w-full flex-wrap gap-1 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {availableOptions.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                add(option);
                setSuggestionsOpen(false);
              }}
              className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-600 transition-colors hover:border-brand/40 hover:bg-brand/5 hover:text-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-brand/50 dark:hover:bg-brand/10"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bloco com ícone+título em maiúsculas pequenas — agrupa visualmente o
 * formulário de campanha (antes era uma lista achatada de campos, um atrás
 * do outro, sem nenhuma hierarquia). `right` é pra um indicador ao lado do
 * título (ex.: badge de "N contatos" no bloco de Público). */
function DialogSection({
  icon: Icon,
  title,
  right,
  children,
}: {
  icon: typeof Users;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 dark:border-neutral-800 dark:bg-neutral-800/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function scriptRefsFromTemplates(
  templates: { steps: ScriptStep[]; weight: number; scriptId?: string }[] | null | undefined,
  availableScripts: ScriptOption[],
): { ids: string[]; weights: Record<string, string> } {
  const ids: string[] = [];
  const weights: Record<string, string> = {};
  for (const t of templates ?? []) {
    if (!t.scriptId || !availableScripts.some((s) => s.id === t.scriptId)) continue;
    ids.push(t.scriptId);
    weights[t.scriptId] = String(t.weight);
  }
  return { ids, weights };
}

function rmktRowsFromCampaign(raw: RawCampaign["rmktWaves"]): WaveRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((wave) => {
    const scriptId = wave.templates[0]?.scriptId;
    return scriptId ? [{ dayOffset: String(wave.dayOffset), scriptId }] : [];
  });
}

function CampaignDialog({
  instances,
  scripts,
  audienceOptions,
  editCampaign,
  onClose,
  onSaved,
}: {
  instances: InstanceOption[];
  scripts: ScriptOption[];
  audienceOptions: AudienceOptions;
  editCampaign: RawCampaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const isEdit = !!editCampaign;
  const initialScriptRefs = useMemo(
    () => scriptRefsFromTemplates(editCampaign?.messageTemplates, scripts),
    [editCampaign, scripts],
  );
  const initialFollowUpRefs = useMemo(
    () => scriptRefsFromTemplates(editCampaign?.followUpTemplates, scripts),
    [editCampaign, scripts],
  );

  const [name, setName] = useState(editCampaign?.name ?? "");
  const [jobTitles, setJobTitles] = useState<string[]>(editCampaign?.audienceFilter.jobTitles ?? []);
  const [tags, setTags] = useState<string[]>(editCampaign?.audienceFilter.tags ?? []);
  const [cities, setCities] = useState<string[]>(editCampaign?.audienceFilter.cities ?? []);
  const [instanceId, setInstanceId] = useState(editCampaign?.instanceId ?? instances[0]?.id ?? "");
  const [selectedScriptIds, setSelectedScriptIds] = useState<string[]>(initialScriptRefs.ids);
  const [schedule, setSchedule] = useState<BulkCampaignSchedule>({
    delayMinSec: editCampaign?.delayMinSec ?? 120,
    delayMaxSec: editCampaign?.delayMaxSec ?? 1200,
    dailyCap: editCampaign?.dailyCap ? String(editCampaign.dailyCap) : "",
    allowedWeekdays: editCampaign?.allowedWeekdays ?? [1, 2, 3, 4, 5],
    windowStartHour: String(editCampaign?.windowStartHour ?? 9),
    windowEndHour: String(editCampaign?.windowEndHour ?? 18),
  });
  const initialRmktWaves = useMemo(() => {
    const configuredWaves = rmktRowsFromCampaign(editCampaign?.rmktWaves ?? null);
    if (configuredWaves.length > 0) return configuredWaves;
    if (!editCampaign?.followUpEnabled) return [];
    return [{ dayOffset: String(Math.max(1, Math.ceil(editCampaign.followUpDelayHours / 24))), scriptId: initialFollowUpRefs.ids[0] ?? initialScriptRefs.ids[0] ?? "" }];
  }, [editCampaign, initialFollowUpRefs.ids, initialScriptRefs.ids]);
  const rmkt = useRmktWaves({
    automaticNoReplyDays: true,
    initialEnabled: initialRmktWaves.length > 0,
    initialWaves: initialRmktWaves,
  });

  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [scriptPreview, setScriptPreview] = useState<ScriptPreview | null>(null);
  const previewOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAnchorRef = useRef<HTMLElement | null>(null);

  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audienceSelected = hasAudienceFilter({ jobTitles, tags, cities });
  const [audienceFailed, setAudienceFailed] = useState(false);

  // Prévia do público — debounced, evita disparar uma consulta a cada tecla.
  // Todo o trabalho (inclusive ligar o "carregando") roda dentro do timeout,
  // nunca direto no corpo do efeito. Sem critério nenhum, a mensagem exibida
  // já cobre esse caso olhando pra audienceSelected, sem precisar de fetch.
  useEffect(() => {
    if (!audienceSelected) return;

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setAudienceLoading(true);
      setAudienceCount(null);
      setAudienceFailed(false);
      try {
        const res = await fetch("/api/campaigns/audience-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audienceFilter: { jobTitles, tags, cities } }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        // Falhou: avisa em vez de ficar "Calculando..." pra sempre.
        if (!res.ok) return setAudienceFailed(true);
        const data = await res.json();
        if (!controller.signal.aborted) setAudienceCount(data.count);
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[campaigns] falha ao calcular público", err);
          setAudienceFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setAudienceLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [jobTitles, tags, cities, audienceSelected]);

  function toggleScript(scriptId: string) {
    setSelectedScriptIds((prev) =>
      prev.includes(scriptId) ? prev.filter((id) => id !== scriptId) : [...prev, scriptId],
    );
  }

  function getPreviewPosition(anchor: HTMLElement): PreviewPosition {
    const gutter = 12;
    const preferredWidth = 360;
    const preferredHeight = 420;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(preferredWidth, Math.max(0, window.innerWidth - gutter * 2));
    const maxLeft = Math.max(gutter, window.innerWidth - gutter - width);
    const left = rect.right + gutter + width <= window.innerWidth - gutter
      ? rect.right + gutter
      : Math.min(maxLeft, Math.max(gutter, rect.left - gutter - width));
    const maxHeight = Math.min(preferredHeight, Math.max(0, window.innerHeight - gutter * 2));
    const top = rect.top + maxHeight <= window.innerHeight - gutter
      ? Math.max(gutter, rect.top)
      : rect.bottom - maxHeight >= gutter
        ? rect.bottom - maxHeight
        : gutter;
    return { top, left, maxHeight };
  }

  function showScriptPreview(script: BulkScriptOption, anchor: HTMLElement) {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
    if (previewAnchorRef.current !== anchor) setScriptPreview(null);
    previewAnchorRef.current = anchor;
    previewOpenTimer.current = setTimeout(() => {
      if (previewAnchorRef.current === anchor) {
        setScriptPreview({ script, messages: createPreviewMessages(script), ...getPreviewPosition(anchor) });
      }
    }, 250);
  }

  function hideScriptPreviewSoon() {
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
    if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
    previewCloseTimer.current = setTimeout(() => setScriptPreview(null), 120);
  }

  function refreshScriptPreview() {
    setScriptPreview((current) => current ? { ...current, messages: createPreviewMessages(current.script) } : null);
  }

  useEffect(() => {
    if (!scriptPreview) return;
    const reposition = () => {
      const anchor = previewAnchorRef.current;
      if (!anchor || !document.documentElement.contains(anchor)) return setScriptPreview(null);
      setScriptPreview((current) => current ? { ...current, ...getPreviewPosition(anchor) } : null);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [scriptPreview]);

  useEffect(() => () => {
    if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
    if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
  }, []);

  // Prévia: sorteia um dos scripts marcados e resolve spintax + variáveis com
  // um contato de exemplo, pra ver exatamente o que vai chegar pro lead antes
  // de disparar de verdade — uma bolha por mensagem da sequência.
  const previewSteps = useMemo(() => {
    const candidates: WeightedScript[] = selectedScriptIds
      .map((id) => scripts.find((s) => s.id === id))
      .filter((s): s is ScriptOption => !!s)
      .map((s) => ({ steps: s.steps, weight: 1 }));
    if (candidates.length === 0) return [];
    const chosen = pickWeighted(candidates);
    return renderSteps(
      chosen.steps,
      { ...SAMPLE_CONTACT_VARS, cargo: jobTitles[0] || SAMPLE_CONTACT_VARS.cargo, cidade: cities[0] || SAMPLE_CONTACT_VARS.cidade },
      "Boa tarde",
    );
  }, [selectedScriptIds, scripts, jobTitles, cities]);

  async function sendTest() {
    if (previewSteps.length === 0 || !instanceId || !testPhone.trim()) return;
    setTestSending(true);
    setTestResult(null);
    const res = await fetch("/api/campaigns/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, phone: testPhone, steps: previewSteps }),
    }).catch(() => null);
    setTestSending(false);
    if (!res) return setTestResult("Sem conexão. Tente de novo.");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setTestResult(data.error ?? "Erro ao enviar teste");
      return;
    }
    setTestResult("Teste enviado!");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      name,
      audienceFilter: { jobTitles, tags, cities },
      instanceId,
      scripts: selectedScriptIds.map((id) => ({ scriptId: id, weight: 1 })),
      ...rmkt.serialize(),
      delayMinSec: schedule.delayMinSec,
      delayMaxSec: schedule.delayMaxSec,
      dailyCap: schedule.dailyCap ? Number(schedule.dailyCap) : null,
      allowedWeekdays: schedule.allowedWeekdays,
      windowStartHour: Number(schedule.windowStartHour),
      windowEndHour: Number(schedule.windowEndHour),
    };

    const res = await fetch(isEdit ? `/api/campaigns/${editCampaign!.id}` : "/api/campaigns", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    setLoading(false);

    // Sem rede o botão ficava em "salvando" pra sempre.
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar campanha");
      return;
    }

    if (!isEdit) trackUse("campanhas.criar");
    onSaved();
  }

  const canSubmit =
    !!name.trim() &&
    audienceSelected &&
    !!instanceId &&
    selectedScriptIds.length > 0 &&
    rmkt.valid &&
    schedule.delayMaxSec >= schedule.delayMinSec &&
    schedule.allowedWeekdays.length > 0;

  const audienceBadge = audienceSelected ? (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
        audienceLoading || audienceCount === null
          ? "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          : audienceCount === 0
            ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
      }`}
    >
      {audienceFailed && !audienceLoading
        ? "Sem contagem"
        : audienceLoading || audienceCount === null
        ? "Calculando..."
        : `${audienceCount} contato${audienceCount === 1 ? "" : "s"}`}
    </span>
  ) : undefined;

  return (
    <>
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-light)] text-[var(--brand)] dark:bg-[var(--brand-subtle)]">
          <Megaphone className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {isEdit ? "Editar campanha" : "Nova campanha"}
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Defina o público, as mensagens e o ritmo de envio.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="field-label">Nome</label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Prospecção Advogados CG"
              className="field-input"
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Enviar por</label>
            <Select
              value={instanceId}
              onChange={setInstanceId}
              options={instances.map((i) => ({ value: i.id, label: i.label }))}
            />
          </div>
        </div>

        <DialogSection icon={Users} title="Público" right={audienceBadge}>
          <ChipInput label="Cargo (um ou mais)" values={jobTitles} onChange={setJobTitles} placeholder="Ex.: Advogado — Enter pra adicionar" options={audienceOptions.jobTitles} />
          <ChipInput label="Tags do contato" values={tags} onChange={setTags} placeholder="Ex.: lead-quente" options={audienceOptions.tags} />
          <ChipInput label="Cidade" values={cities} onChange={setCities} placeholder="Ex.: Campo Grande" options={audienceOptions.cities} />
          {!audienceSelected && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Defina ao menos um critério pra ver quantos contatos batem.</p>
          )}
          {audienceSelected && audienceCount === 0 && !audienceLoading && (
            <p className="text-xs text-red-600 dark:text-red-400">Nenhum contato encontrado com esse público.</p>
          )}
        </DialogSection>

        <BulkScriptPicker
          scripts={scripts}
          selectedIds={selectedScriptIds}
          onToggle={toggleScript}
          onCreateScript={() => router.push("/whatsapp/scripts")}
          onPreview={showScriptPreview}
          onPreviewEnd={hideScriptPreviewSoon}
        />

        {previewSteps.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="field-label">Teste de envio</p>
            <div className="space-y-1">
              {previewSteps.map((s, i) => (
                <div key={i} className="max-w-[85%] rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm whitespace-pre-wrap text-neutral-800 dark:bg-emerald-500/10 dark:text-neutral-200">
                  {s.text}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="Seu número p/ testar (com DDD)"
                className="field-input w-56"
              />
              <button
                type="button"
                disabled={testSending || !testPhone.trim() || !instanceId}
                onClick={sendTest}
                className="btn-ghost"
              >
                {testSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <Send className="h-3.5 w-3.5" strokeWidth={2} />}
                Enviar teste
              </button>
              {testResult && <span className="text-xs text-neutral-500 dark:text-neutral-400">{testResult}</span>}
            </div>
          </div>
        )}

        <RmktWavesFields rmkt={rmkt} scripts={scripts} showNoReplyDays={false} />

        <BulkCampaignScheduleFields value={schedule} onChange={setSchedule} />

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
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
              "Criar campanha"
            )}
          </button>
        </div>
      </form>
    </Modal>
    {scriptPreview &&
      typeof document !== "undefined" &&
      createPortal(
        <div
          onMouseEnter={() => {
            if (previewCloseTimer.current) clearTimeout(previewCloseTimer.current);
            if (previewOpenTimer.current) clearTimeout(previewOpenTimer.current);
          }}
          onMouseLeave={hideScriptPreviewSoon}
          className="animate-pop-in scrollbar-thin fixed z-[70] max-h-[420px] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-neutral-200 bg-[#efeae2] shadow-xl motion-reduce:animate-none dark:border-neutral-700 dark:bg-[#0b141a]"
          style={{ top: scriptPreview.top, left: scriptPreview.left, maxHeight: scriptPreview.maxHeight }}
        >
          <div className="flex items-center justify-between gap-3 bg-[#075e54] px-3 py-2.5 text-white dark:bg-[#202c33]">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">M</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{SAMPLE_CONTACT_VARS.nome}</p>
                <p className="text-[11px] text-white/70">Prévia de envio</p>
              </div>
            </div>
            <button
              type="button"
              onClick={refreshScriptPreview}
              title="Gerar outra prévia"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              Mudar prévia
            </button>
          </div>
          <div className="space-y-2.5 p-3">
            {scriptPreview.script.steps.map((step, index) => (
              <div key={index}>
                {index > 0 && (
                  <p className="mb-2 text-center text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                    {stepDelayLabel(scriptPreview.script.steps[index - 1].delayAfterSec)}
                  </p>
                )}
                <div className="ml-auto max-w-[88%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm leading-snug whitespace-pre-wrap text-neutral-800 shadow-sm dark:bg-[#005c4b] dark:text-neutral-100">
                  {(step.type === "IMAGE" || step.type === "VIDEO") && (
                    <span className="mb-1.5 flex h-20 items-center justify-center rounded-md bg-black/10 text-[11px] text-neutral-600 dark:bg-white/10 dark:text-neutral-200">
                      {step.type === "VIDEO" ? (
                        <>
                          <Video className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} /> Vídeo
                        </>
                      ) : (
                        <>
                          <ImageIcon className="mr-1.5 h-3.5 w-3.5" strokeWidth={2} /> Imagem
                        </>
                      )}
                    </span>
                  )}
                  <p>{scriptPreview.messages[index]}</p>
                  <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-500 dark:text-neutral-300">
                    agora <CheckCheck className="h-3.5 w-3.5 text-sky-500 dark:text-sky-300" strokeWidth={2} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
