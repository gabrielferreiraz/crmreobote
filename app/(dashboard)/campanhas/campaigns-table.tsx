"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Loader2, Trash2, Play, Pause, X } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";

type CampaignStatus = "DRAFT" | "RUNNING" | "PAUSED" | "DONE";

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  audienceJobTitle: string | null;
  instanceName: string;
  createdByName: string;
  delayMinSec: number;
  delayMaxSec: number;
  dailyCap: number | null;
  allowedWeekdays: number[];
  windowStartHour: number;
  windowEndHour: number;
  createdAt: string;
  counts: { pending: number; sent: number; failed: number; skipped: number; replied: number };
};

type InstanceOption = { id: string; label: string };

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

export function CampaignsTable({
  initialCampaigns,
  instances,
}: {
  initialCampaigns: Campaign[];
  instances: InstanceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="btn-primary" disabled={instances.length === 0}>
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
            description="Filtre um público pelo cargo cadastrado nos contatos e mande uma prospecção com variação de mensagem e intervalo seguro entre envios."
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
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
                    <td className="px-4 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{c.name}</td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{c.audienceJobTitle}</td>
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
      )}

      {open && (
        <NewCampaignDialog
          instances={instances}
          onClose={() => setOpen(false)}
          onCreated={() => {
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

type TemplateDraft = { text: string; weight: string };

function NewCampaignDialog({
  instances,
  onClose,
  onCreated,
}: {
  instances: InstanceOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [audienceJobTitle, setAudienceJobTitle] = useState("");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [templates, setTemplates] = useState<TemplateDraft[]>([{ text: "", weight: "1" }]);
  const [delayMinSec, setDelayMinSec] = useState("30");
  const [delayMaxSec, setDelayMaxSec] = useState("90");
  const [dailyCap, setDailyCap] = useState("");
  const [allowedWeekdays, setAllowedWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [windowStartHour, setWindowStartHour] = useState("9");
  const [windowEndHour, setWindowEndHour] = useState("18");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleWeekday(day: number) {
    setAllowedWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function updateTemplate(index: number, field: "text" | "weight", value: string) {
    setTemplates((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }

  function removeTemplate(index: number) {
    setTemplates((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        audienceJobTitle,
        instanceId,
        messageTemplates: templates.map((t) => ({ text: t.text, weight: Number(t.weight) || 1 })),
        delayMinSec: Number(delayMinSec) || 30,
        delayMaxSec: Number(delayMaxSec) || 90,
        dailyCap: dailyCap ? Number(dailyCap) : null,
        allowedWeekdays,
        windowStartHour: Number(windowStartHour),
        windowEndHour: Number(windowEndHour),
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar campanha");
      return;
    }

    onCreated();
  }

  const canSubmit =
    !!name.trim() &&
    !!audienceJobTitle.trim() &&
    !!instanceId &&
    templates.length > 0 &&
    templates.every((t) => t.text.trim()) &&
    allowedWeekdays.length > 0;

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Nova campanha</h2>
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

        <div className="space-y-1">
          <label className="field-label">Cargo (público-alvo)</label>
          <input
            required
            value={audienceJobTitle}
            onChange={(e) => setAudienceJobTitle(e.target.value)}
            placeholder="Ex.: Advogados CG"
            className="field-input"
          />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Precisa bater exatamente com o campo &quot;Cargo&quot; já cadastrado nos contatos.
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
          <label className="field-label">Variantes de mensagem</label>
          {templates.map((t, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <textarea
                required
                value={t.text}
                onChange={(e) => updateTemplate(i, "text", e.target.value)}
                rows={2}
                placeholder="Ex.: {saudacao} {primeiro_nome}! {[Tudo bem|Como vai]}? Vi que você atua como {cargo}..."
                className="field-input flex-1"
              />
              <input
                type="number"
                min={1}
                value={t.weight}
                onChange={(e) => updateTemplate(i, "weight", e.target.value)}
                title="Peso (frequência relativa desta variante)"
                className="field-input w-14 shrink-0 px-2"
              />
              {templates.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTemplate(i)}
                  className="icon-btn mt-1 shrink-0"
                  aria-label="Remover variante"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTemplates((prev) => [...prev, { text: "", weight: "1" }])}
            className="btn-ghost btn-sm"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Adicionar variante
          </button>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Use <code>{"{[opção 1|opção 2]}"}</code> pra variar trechos, e <code>{"{nome}"}</code>/<code>{"{primeiro_nome}"}</code>/
            <code>{"{cargo}"}</code>/<code>{"{saudacao}"}</code> pra personalizar. Cada envio sorteia uma variante (proporcional ao peso).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
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

        <div className="grid grid-cols-2 gap-3">
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
              "Criar campanha"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
