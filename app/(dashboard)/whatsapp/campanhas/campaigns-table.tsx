"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Megaphone, Plus, Loader2, Trash2, Play, Pause, Copy, ListChecks, Send, Pencil, X, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { renderSteps, pickWeighted, type WeightedScript, type ScriptStep } from "@/lib/campaigns/spintax";

type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "DONE";
type AudienceFilter = { jobTitles: string[]; tags: string[]; cities: string[] };

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
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
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
};

type InstanceOption = { id: string; label: string };
type ScriptOption = { id: string; name: string; steps: ScriptStep[] };

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Rascunho",
  RUNNING: "Rodando",
  PAUSED: "Pausada",
  DONE: "Concluída",
};

const STATUS_TONE: Record<CampaignStatus, string> = {
  DRAFT: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  RUNNING: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  DONE: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
};

const SAMPLE_VARS = { nome: "Maria Silva", cargo: "Advogada", empresa: "Empresa Exemplo", cidade: "Sua Cidade" };

export function CampaignsTable({
  initialCampaigns,
  instances,
  scripts,
}: {
  initialCampaigns: Campaign[];
  instances: InstanceOption[];
  scripts: ScriptOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<RawCampaign | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  async function setStatus(campaign: Campaign, status: CampaignStatus) {
    setTogglingId(campaign.id);
    await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setTogglingId(null);
    router.refresh();
  }

  async function deleteCampaign(id: string) {
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function duplicateCampaign(id: string) {
    setDuplicatingId(id);
    const res = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" });
    setDuplicatingId(null);
    if (res.ok) router.refresh();
  }

  async function openEdit(id: string) {
    setLoadingEditId(id);
    const res = await fetch(`/api/campaigns/${id}`);
    setLoadingEditId(null);
    if (!res.ok) return;
    const raw: RawCampaign = await res.json();
    setEditCampaign(raw);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => {
            setEditCampaign(null);
            setOpen(true);
          }}
          className="btn-primary"
          disabled={instances.length === 0}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Nova campanha
        </button>
      </div>

      {instances.length === 0 && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          Nenhum WhatsApp conectado — conecte um em Configurações → Perfil antes de criar uma campanha.
        </p>
      )}

      {initialCampaigns.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Megaphone}
            title="Nenhuma campanha criada ainda"
            description="Filtre um público (cargo, tag ou cidade) e mande uma prospecção com variação de mensagem e intervalo seguro entre envios."
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-2 lg:hidden">
            {initialCampaigns.map((c) => {
              const total = c.counts.pending + c.counts.sent + c.counts.failed + c.counts.skipped;
              return (
                <div key={c.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/whatsapp/campanhas/${c.id}`} className="min-w-0 truncate font-medium text-neutral-900 hover:underline dark:text-neutral-100">
                      {c.name}
                    </Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                    <p>Público: {c.audienceLabel}</p>
                    <p>Envia por: {c.instanceName}</p>
                    <p className="tabular-nums">
                      Progresso: {c.counts.sent}/{total}
                      {c.counts.failed > 0 && <span className="ml-1 text-red-500">({c.counts.failed} falhas)</span>}
                    </p>
                    <p className="tabular-nums">Respostas: {c.counts.replied}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                    {(c.status === "DRAFT" || c.status === "PAUSED") && (
                      <button
                        type="button"
                        disabled={togglingId === c.id}
                        onClick={() => setStatus(c, "RUNNING")}
                        className="icon-btn"
                        aria-label="Iniciar"
                        title="Iniciar"
                      >
                        <Play className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                    {c.status === "RUNNING" && (
                      <button
                        type="button"
                        disabled={togglingId === c.id}
                        onClick={() => setStatus(c, "PAUSED")}
                        className="icon-btn"
                        aria-label="Pausar"
                        title="Pausar"
                      >
                        <Pause className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                    {c.status === "DRAFT" && (
                      <button
                        type="button"
                        disabled={loadingEditId === c.id}
                        onClick={() => openEdit(c.id)}
                        className="icon-btn"
                        aria-label="Editar campanha"
                        title="Editar campanha"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                    <Link href={`/whatsapp/campanhas/${c.id}`} className="icon-btn" aria-label="Ver destinatários" title="Ver destinatários">
                      <ListChecks className="h-3.5 w-3.5" strokeWidth={2} />
                    </Link>
                    <button
                      type="button"
                      disabled={duplicatingId === c.id}
                      onClick={() => duplicateCampaign(c.id)}
                      className="icon-btn"
                      aria-label="Duplicar campanha"
                      title="Duplicar campanha"
                    >
                      <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCampaignToDelete(c)}
                      className="icon-btn"
                      aria-label="Excluir campanha"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className="card hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                  <th className="px-4 py-2 font-medium">Nome</th>
                  <th className="px-4 py-2 font-medium">Público</th>
                  <th className="px-4 py-2 font-medium">Envia por</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Progresso</th>
                  <th className="px-4 py-2 font-medium">Respostas</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {initialCampaigns.map((c) => {
                  const total = c.counts.pending + c.counts.sent + c.counts.failed + c.counts.skipped;
                  return (
                    <tr key={c.id} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">
                        <Link href={`/whatsapp/campanhas/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{c.audienceLabel}</td>
                      <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{c.instanceName}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[c.status]}`}>
                          {STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-neutral-500 dark:text-neutral-400">
                        {c.counts.sent}/{total}
                        {c.counts.failed > 0 && <span className="ml-1 text-red-500">({c.counts.failed} falhas)</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-neutral-500 dark:text-neutral-400">{c.counts.replied}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(c.status === "DRAFT" || c.status === "PAUSED") && (
                            <button
                              type="button"
                              disabled={togglingId === c.id}
                              onClick={() => setStatus(c, "RUNNING")}
                              className="icon-btn"
                              aria-label="Iniciar"
                              title="Iniciar"
                            >
                              <Play className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          )}
                          {c.status === "RUNNING" && (
                            <button
                              type="button"
                              disabled={togglingId === c.id}
                              onClick={() => setStatus(c, "PAUSED")}
                              className="icon-btn"
                              aria-label="Pausar"
                              title="Pausar"
                            >
                              <Pause className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          )}
                          {c.status === "DRAFT" && (
                            <button
                              type="button"
                              disabled={loadingEditId === c.id}
                              onClick={() => openEdit(c.id)}
                              className="icon-btn"
                              aria-label="Editar campanha"
                              title="Editar campanha"
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          )}
                          <Link href={`/whatsapp/campanhas/${c.id}`} className="icon-btn" aria-label="Ver destinatários" title="Ver destinatários">
                            <ListChecks className="h-3.5 w-3.5" strokeWidth={2} />
                          </Link>
                          <button
                            type="button"
                            disabled={duplicatingId === c.id}
                            onClick={() => duplicateCampaign(c.id)}
                            className="icon-btn"
                            aria-label="Duplicar campanha"
                            title="Duplicar campanha"
                          >
                            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCampaignToDelete(c)}
                            className="icon-btn"
                            aria-label="Excluir campanha"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <CampaignDialog
          instances={instances}
          scripts={scripts}
          editCampaign={editCampaign}
          onClose={() => setOpen(false)}
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
            await deleteCampaign(campaignToDelete.id);
            setCampaignToDelete(null);
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
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  function add(raw: string) {
    const clean = raw.trim();
    if (clean && !values.includes(clean)) onChange([...values, clean]);
    setInput("");
  }

  return (
    <div className="space-y-1">
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
    </div>
  );
}

function ScriptPicker({
  scripts,
  selectedIds,
  weightById,
  onToggle,
  onWeightChange,
}: {
  scripts: ScriptOption[];
  selectedIds: string[];
  weightById: Record<string, string>;
  onToggle: (scriptId: string) => void;
  onWeightChange: (scriptId: string, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {scripts.map((s) => {
        const checked = selectedIds.includes(s.id);
        return (
          <div
            key={s.id}
            className={`flex items-start gap-2 rounded-md border p-2.5 text-sm transition-colors ${
              checked ? "border-neutral-900 dark:border-white" : "border-neutral-200 dark:border-neutral-800"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(s.id)}
              className="mt-0.5 accent-neutral-900 dark:accent-white"
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-neutral-900 dark:text-neutral-100">
                {s.name}
                {s.steps.length > 1 && (
                  <span className="ml-1.5 text-xs font-normal text-neutral-400 dark:text-neutral-500">
                    · {s.steps.length} mensagens
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{s.steps[0]?.text}</p>
            </div>
            {checked && (
              <input
                type="number"
                min={1}
                value={weightById[s.id] ?? "1"}
                onChange={(e) => onWeightChange(s.id, e.target.value)}
                title="Peso (frequência relativa deste script)"
                className="field-input w-14 shrink-0 px-2"
              />
            )}
          </div>
        );
      })}
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

function CampaignDialog({
  instances,
  scripts,
  editCampaign,
  onClose,
  onSaved,
}: {
  instances: InstanceOption[];
  scripts: ScriptOption[];
  editCampaign: RawCampaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const [weightByScript, setWeightByScript] = useState<Record<string, string>>(initialScriptRefs.weights);
  const [delayMinSec, setDelayMinSec] = useState(String(editCampaign?.delayMinSec ?? 30));
  const [delayMaxSec, setDelayMaxSec] = useState(String(editCampaign?.delayMaxSec ?? 90));
  const [dailyCap, setDailyCap] = useState(editCampaign?.dailyCap ? String(editCampaign.dailyCap) : "");
  const [allowedWeekdays, setAllowedWeekdays] = useState<number[]>(editCampaign?.allowedWeekdays ?? [1, 2, 3, 4, 5]);
  const [windowStartHour, setWindowStartHour] = useState(String(editCampaign?.windowStartHour ?? 9));
  const [windowEndHour, setWindowEndHour] = useState(String(editCampaign?.windowEndHour ?? 18));

  const [followUpEnabled, setFollowUpEnabled] = useState(editCampaign?.followUpEnabled ?? false);
  const [followUpDelayHours, setFollowUpDelayHours] = useState(String(editCampaign?.followUpDelayHours ?? 24));
  const [followUpScriptIds, setFollowUpScriptIds] = useState<string[]>(initialFollowUpRefs.ids);
  const [followUpWeightByScript, setFollowUpWeightByScript] = useState<Record<string, string>>(initialFollowUpRefs.weights);

  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAudienceFilter = jobTitles.length > 0 || tags.length > 0 || cities.length > 0;

  // Prévia do público — debounced, evita disparar uma consulta a cada tecla.
  // Todo o trabalho (inclusive ligar o "carregando") roda dentro do timeout,
  // nunca direto no corpo do efeito. Sem critério nenhum, a mensagem exibida
  // já cobre esse caso olhando pra hasAudienceFilter, sem precisar de fetch.
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!hasAudienceFilter) return;
      setAudienceLoading(true);
      const res = await fetch("/api/campaigns/audience-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audienceFilter: { jobTitles, tags, cities } }),
      });
      setAudienceLoading(false);
      if (res.ok) {
        const data = await res.json();
        setAudienceCount(data.count);
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [jobTitles, tags, cities, hasAudienceFilter]);

  function toggleWeekday(day: number) {
    setAllowedWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function toggleScript(scriptId: string) {
    setSelectedScriptIds((prev) =>
      prev.includes(scriptId) ? prev.filter((id) => id !== scriptId) : [...prev, scriptId],
    );
    setWeightByScript((prev) => (prev[scriptId] ? prev : { ...prev, [scriptId]: "1" }));
  }

  function toggleFollowUpScript(scriptId: string) {
    setFollowUpScriptIds((prev) =>
      prev.includes(scriptId) ? prev.filter((id) => id !== scriptId) : [...prev, scriptId],
    );
    setFollowUpWeightByScript((prev) => (prev[scriptId] ? prev : { ...prev, [scriptId]: "1" }));
  }

  // Prévia: sorteia um dos scripts marcados e resolve spintax + variáveis com
  // um contato de exemplo, pra ver exatamente o que vai chegar pro lead antes
  // de disparar de verdade — uma bolha por mensagem da sequência.
  const previewSteps = useMemo(() => {
    const candidates: WeightedScript[] = selectedScriptIds
      .map((id) => scripts.find((s) => s.id === id))
      .filter((s): s is ScriptOption => !!s)
      .map((s) => ({ steps: s.steps, weight: Number(weightByScript[s.id]) || 1 }));
    if (candidates.length === 0) return [];
    const chosen = pickWeighted(candidates);
    return renderSteps(
      chosen.steps,
      { nome: SAMPLE_VARS.nome, cargo: jobTitles[0] || SAMPLE_VARS.cargo, empresa: SAMPLE_VARS.empresa, cidade: cities[0] || SAMPLE_VARS.cidade },
      "Boa tarde",
    );
  }, [selectedScriptIds, weightByScript, scripts, jobTitles, cities]);

  async function sendTest() {
    if (previewSteps.length === 0 || !instanceId || !testPhone.trim()) return;
    setTestSending(true);
    setTestResult(null);
    const res = await fetch("/api/campaigns/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, phone: testPhone, steps: previewSteps }),
    });
    setTestSending(false);
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
      scripts: selectedScriptIds.map((id) => ({ scriptId: id, weight: Number(weightByScript[id]) || 1 })),
      delayMinSec: Number(delayMinSec) || 30,
      delayMaxSec: Number(delayMaxSec) || 90,
      dailyCap: dailyCap ? Number(dailyCap) : null,
      allowedWeekdays,
      windowStartHour: Number(windowStartHour),
      windowEndHour: Number(windowEndHour),
      followUpEnabled,
      followUpDelayHours: Number(followUpDelayHours) || 24,
      followUpScripts: followUpEnabled
        ? followUpScriptIds.map((id) => ({ scriptId: id, weight: Number(followUpWeightByScript[id]) || 1 }))
        : undefined,
    };

    const res = await fetch(isEdit ? `/api/campaigns/${editCampaign!.id}` : "/api/campaigns", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar campanha");
      return;
    }

    onSaved();
  }

  const canSubmit =
    !!name.trim() && hasAudienceFilter && !!instanceId && selectedScriptIds.length > 0 && allowedWeekdays.length > 0;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {isEdit ? "Editar campanha" : "Nova campanha"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
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

        <div className="space-y-2 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
          <ChipInput label="Cargo (um ou mais)" values={jobTitles} onChange={setJobTitles} placeholder="Ex.: Advogado — Enter pra adicionar" />
          <ChipInput label="Tags do contato" values={tags} onChange={setTags} placeholder="Ex.: lead-quente" />
          <ChipInput label="Cidade" values={cities} onChange={setCities} placeholder="Ex.: Campo Grande" />
          <p className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            {!hasAudienceFilter
              ? "Defina ao menos um critério pra ver quantos contatos batem."
              : audienceLoading || audienceCount === null
                ? "Calculando público..."
                : audienceCount === 0
                  ? "Nenhum contato encontrado com esse público."
                  : `${audienceCount} contato${audienceCount === 1 ? "" : "s"} encontrado${audienceCount === 1 ? "" : "s"}.`}
          </p>
        </div>

        <div className="space-y-1">
          <label className="field-label">Enviar pelo WhatsApp de</label>
          <Select
            value={instanceId}
            onChange={setInstanceId}
            options={instances.map((i) => ({ value: i.id, label: i.label }))}
          />
        </div>

        <div className="space-y-1.5">
          <label className="field-label">Scripts (variantes de mensagem)</label>
          {scripts.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Nenhum script cadastrado ainda —{" "}
              <Link href="/whatsapp/scripts" className="underline">
                crie um na aba Scripts
              </Link>{" "}
              antes de montar a campanha.
            </p>
          ) : (
            <ScriptPicker
              scripts={scripts}
              selectedIds={selectedScriptIds}
              weightById={weightByScript}
              onToggle={toggleScript}
              onWeightChange={(id, value) => setWeightByScript((prev) => ({ ...prev, [id]: value }))}
            />
          )}
          <p className="text-xs text-neutral-400 dark:text-neutral-500">Cada envio sorteia um dos scripts marcados, proporcional ao peso.</p>
        </div>

        {previewSteps.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
            <p className="field-label">Prévia (com dados de exemplo)</p>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="field-label">Delay mínimo (segundos)</label>
            <input
              type="number"
              min={1}
              value={delayMinSec}
              onChange={(e) => setDelayMinSec(e.target.value)}
              className="field-input"
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Delay máximo (segundos)</label>
            <input
              type="number"
              min={1}
              value={delayMaxSec}
              onChange={(e) => setDelayMaxSec(e.target.value)}
              className="field-input"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="field-label">Teto diário (opcional)</label>
          <input
            type="number"
            min={1}
            value={dailyCap}
            onChange={(e) => setDailyCap(e.target.value)}
            placeholder="Sem limite"
            className="field-input"
          />
        </div>

        <div className="space-y-1">
          <label className="field-label">Dias permitidos</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleWeekday(day)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  allowedWeekdays.includes(day)
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="field-label">Horário inicial</label>
            <input
              type="number"
              min={0}
              max={23}
              value={windowStartHour}
              onChange={(e) => setWindowStartHour(e.target.value)}
              className="field-input"
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Horário final</label>
            <input
              type="number"
              min={0}
              max={23}
              value={windowEndHour}
              onChange={(e) => setWindowEndHour(e.target.value)}
              className="field-input"
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-neutral-200 p-2.5 dark:border-neutral-800">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            <input
              type="checkbox"
              checked={followUpEnabled}
              onChange={(e) => setFollowUpEnabled(e.target.checked)}
              className="accent-neutral-900 dark:accent-white"
            />
            Reenvio automático pra quem não responder (remarketing)
          </label>

          {followUpEnabled && (
            <div className="space-y-2 pt-1">
              <div className="space-y-1">
                <label className="field-label">Esperar quantas horas sem resposta</label>
                <input
                  type="number"
                  min={1}
                  value={followUpDelayHours}
                  onChange={(e) => setFollowUpDelayHours(e.target.value)}
                  className="field-input w-32"
                />
              </div>
              <div className="space-y-1.5">
                <label className="field-label">Scripts do reenvio (opcional)</label>
                {scripts.length > 0 && (
                  <ScriptPicker
                    scripts={scripts}
                    selectedIds={followUpScriptIds}
                    weightById={followUpWeightByScript}
                    onToggle={toggleFollowUpScript}
                    onWeightChange={(id, value) => setFollowUpWeightByScript((prev) => ({ ...prev, [id]: value }))}
                  />
                )}
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Se nenhum for marcado, o reenvio usa os mesmos scripts do envio inicial.
                </p>
              </div>
            </div>
          )}
        </div>

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
  );
}
