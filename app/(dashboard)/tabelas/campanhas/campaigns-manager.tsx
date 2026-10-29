"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarRange, Check, Download, Eye, ImagePlus, Loader2, Pencil, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Switch } from "@/components/switch";
import { CampaignBand } from "@/components/servopa-tables/sheet-header";
import { requestJson } from "@/lib/client-request";
import type { ServopaCampaignView } from "@/lib/servopa-tables/campaigns";
import {
  describeServopaCampaignWindow,
  overlappingServopaCampaigns,
  servopaMonthRange,
  SERVOPA_CAMPAIGN_NAME_MAX,
  type ServopaCampaignArtSlot,
  type ServopaCampaignSegment,
} from "@/lib/servopa-tables/campaign-rules";

type CampaignsResponse = { campaigns: ServopaCampaignView[]; createdId?: string };
type SampleTables = Partial<Record<ServopaCampaignSegment, string>>;
type TextColor = "WHITE" | "BLACK";

/** Faixa de 210 × 52 mm a 300 dpi — o mesmo tamanho do molde para o designer. */
const ART_SIZE = "2480 × 614 px";
const TEMPLATE_URL = "/servopa-campanha-molde.png";
const MAX_ART_BYTES = 10 * 1024 * 1024;
const ART_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** Grupo de exemplo nas prévias (o PDF de verdade mostra o grupo da tabela). */
const SAMPLE = { groupNumber: "1568", termMonths: 120 };

function brDate(key: string) {
  return key.split("-").reverse().join("/");
}

// ─── Prévia da faixa ─────────────────────────────────────────────────────────

/**
 * A faixa é desenhada no tamanho real (210 mm) — exatamente o componente do
 * PDF — e só reduzida visualmente para caber na largura disponível.
 */
function BandPreview({ artUrl, textColor }: { artUrl: string; textColor: TextColor }) {
  const box = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = band.current;
    if (!outer || !inner) return;
    const observer = new ResizeObserver(() => setScale(outer.clientWidth / inner.offsetWidth));
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="relative aspect-[210/52] w-full overflow-hidden rounded-md bg-neutral-900 ring-1 ring-inset ring-black/10">
      <div ref={band} className="absolute left-0 top-0 w-[210mm] origin-top-left" style={{ transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}>
        <CampaignBand artUrl={artUrl} textColor={textColor} groupNumber={SAMPLE.groupNumber} termMonths={SAMPLE.termMonths} />
      </div>
    </div>
  );
}

/**
 * Cor dos logos/texto pela claridade média da arte nas áreas onde eles ficam
 * (faixa do meio para baixo e o centro de cima): arte clara → texto preto.
 */
async function suggestTextColor(url: string): Promise<TextColor | null> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 210;
    canvas.height = 52;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    // Mesmo enquadramento da folha (object-fit: cover, centralizado).
    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    const areas = [[90, 6, 30, 18], [10, 26, 190, 20]] as const;
    let sum = 0;
    let count = 0;
    for (const [x, y, w, h] of areas) {
      const { data } = context.getImageData(x, y, w, h);
      for (let i = 0; i < data.length; i += 4) {
        sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        count += 1;
      }
    }
    return sum / count > 0.6 ? "BLACK" : "WHITE";
  } catch {
    return null;
  }
}

// ─── Lista ───────────────────────────────────────────────────────────────────

function statusOf(campaign: ServopaCampaignView): { label: string; tone: "green" | "blue" | "amber" | "neutral" } {
  if (campaign.overriddenBy) return { label: `Em espera: nestes dias vale "${campaign.overriddenBy}"`, tone: "amber" };
  switch (campaign.status) {
    case "ACTIVE": return { label: campaign.endsOn ? `No ar agora, até ${brDate(campaign.endsOn)}` : "No ar agora", tone: "green" };
    case "SCHEDULED": return { label: `Programada para ${brDate(campaign.startsOn!)}`, tone: "blue" };
    case "NO_ART": return { label: "Falta enviar a arte", tone: "amber" };
    case "DISABLED": return { label: "Desligada", tone: "neutral" };
    case "ENDED": return { label: `Encerrada em ${brDate(campaign.endsOn!)}`, tone: "neutral" };
  }
}

const TONES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  neutral: "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-300",
};

function StatusBadge({ campaign }: { campaign: ServopaCampaignView }) {
  const { label, tone } = statusOf(campaign);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {tone === "green" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {label}
    </span>
  );
}

function periodLabel(campaign: Pick<ServopaCampaignView, "startsOn" | "endsOn">) {
  if (campaign.startsOn && campaign.endsOn) return `${brDate(campaign.startsOn)} a ${brDate(campaign.endsOn)}`;
  if (campaign.startsOn) return `A partir de ${brDate(campaign.startsOn)}`;
  if (campaign.endsOn) return `Até ${brDate(campaign.endsOn)}`;
  return "Sem data";
}

function PreviewLinks({ campaign, sampleTables }: { campaign: ServopaCampaignView; sampleTables: SampleTables }) {
  const links = ([
    ["REAL_ESTATE", "Imóvel", campaign.realEstateArtUrl ?? campaign.artUrl],
    ["MOVABLE", "Automóvel", campaign.movableArtUrl ?? campaign.artUrl],
  ] as const).filter(([segment, , art]) => sampleTables[segment] && art);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs text-neutral-500"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Ver o PDF de verdade:</span>
      {links.map(([segment, label]) => (
        <a key={segment} href={`/tabela-servopa/${sampleTables[segment]}?campanha=${campaign.id}`} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">{label}</a>
      ))}
    </div>
  );
}

export function CampaignsManager({ initialCampaigns, sampleTables, today }: { initialCampaigns: ServopaCampaignView[]; sampleTables: SampleTables; today: string }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<ServopaCampaignView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggle(campaign: ServopaCampaignView, enabled: boolean) {
    setToggling(campaign.id);
    const result = await requestJson<CampaignsResponse>(`/api/servopa-tables/campaigns/${campaign.id}`, { method: "PATCH", json: { enabled } });
    setToggling(null);
    if (result.ok) setCampaigns(result.data.campaigns);
  }

  async function remove() {
    if (!deleting) return;
    setDeleteError(null);
    const result = await requestJson<CampaignsResponse>(`/api/servopa-tables/campaigns/${deleting.id}`, { method: "DELETE" }, { silent: true });
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setCampaigns(result.data.campaigns);
    setDeleting(null);
  }

  const editingCampaign = editing?.id ? campaigns.find((campaign) => campaign.id === editing.id) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Arte para o designer: <strong className="font-medium text-neutral-700 dark:text-neutral-200">{ART_SIZE}</strong>.{" "}
          <a href={TEMPLATE_URL} download="molde-faixa-campanha.png" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><Download className="h-3.5 w-3.5" aria-hidden="true" />Baixar molde</a>
        </p>
        <button type="button" onClick={() => setEditing({ id: null })} className="btn-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nova campanha</button>
      </div>

      {campaigns.length === 0 ? (
        <button
          type="button"
          onClick={() => setEditing({ id: null })}
          className="w-full rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center transition-colors hover:border-brand hover:bg-brand/5 dark:border-neutral-700"
        >
          <CalendarRange className="mx-auto h-8 w-8 text-neutral-300 dark:text-neutral-600" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-200">Nenhuma campanha ainda</p>
          <p className="mt-1 text-sm text-neutral-500">Clique para criar a primeira, por exemplo &ldquo;Black November&rdquo;.</p>
        </button>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((campaign) => {
            const art = campaign.artUrl ?? campaign.realEstateArtUrl ?? campaign.movableArtUrl;
            return (
              <li key={campaign.id} className={`flex flex-col gap-3 rounded-lg border bg-white p-3 dark:bg-neutral-950 ${campaign.status === "ACTIVE" && !campaign.overriddenBy ? "border-emerald-300 dark:border-emerald-800" : "border-neutral-200 dark:border-neutral-800"}`}>
                <button type="button" onClick={() => setEditing({ id: campaign.id })} className="block w-full text-left" aria-label={`Editar ${campaign.name}`}>
                  {art ? (
                    <BandPreview artUrl={art} textColor={campaign.textColor} />
                  ) : (
                    <div className="flex aspect-[210/52] items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 text-sm text-neutral-500 dark:border-neutral-700"><ImagePlus className="h-4 w-4" aria-hidden="true" />Clique para enviar a arte</div>
                  )}
                </button>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{campaign.name}</p>
                    <p className="mt-0.5 text-sm text-neutral-500">{periodLabel(campaign)}</p>
                    <div className="mt-1.5"><StatusBadge campaign={campaign} /></div>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                    {campaign.enabled ? "Ligada" : "Desligada"}
                    <Switch checked={campaign.enabled} disabled={toggling === campaign.id} onChange={(value) => void toggle(campaign, value)} label={`Ligar a campanha ${campaign.name}`} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  <PreviewLinks campaign={campaign} sampleTables={sampleTables} />
                  <div className="ml-auto flex gap-2">
                    <button type="button" onClick={() => setEditing({ id: campaign.id })} className="btn-secondary btn-sm"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Editar</button>
                    <button type="button" onClick={() => { setDeleteError(null); setDeleting(campaign); }} className="btn-secondary btn-sm text-red-600 dark:text-red-400" aria-label={`Apagar ${campaign.name}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <CampaignEditor
          key={editing.id ?? "new"}
          campaign={editingCampaign}
          campaigns={campaigns}
          today={today}
          onListChanged={(data) => setCampaigns(data.campaigns)}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Apagar a campanha "${deleting.name}"?`}
          description="As artes dela também são apagadas do armazenamento. Os PDFs gerados a partir de agora saem sem esta faixa."
          error={deleteError}
          confirmLabel="Apagar campanha"
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// ─── Criar / editar ──────────────────────────────────────────────────────────

/** saved = já está no R2; file = escolhida agora, sobe ao salvar; null = sem arte. */
type ArtDraft = { kind: "saved"; url: string } | { kind: "file"; file: File; url: string } | null;

function savedArt(url: string | null): ArtDraft {
  return url ? { kind: "saved", url } : null;
}

const SLOT_LABEL: Record<ServopaCampaignArtSlot, string> = { ALL: "a arte", REAL_ESTATE: "a arte de imóveis", MOVABLE: "a arte de automóveis" };

function CampaignEditor({
  campaign,
  campaigns,
  today,
  onListChanged,
  onClose,
}: {
  campaign: ServopaCampaignView | null;
  campaigns: ServopaCampaignView[];
  today: string;
  onListChanged: (data: CampaignsResponse) => void;
  onClose: () => void;
}) {
  // Campanha nova já criada neste formulário (o envio da arte pode falhar depois):
  // o próximo "Salvar" continua nela em vez de criar outra.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const campaignId = campaign?.id ?? createdId;
  const [name, setName] = useState(campaign?.name ?? "");
  const [startsOn, setStartsOn] = useState(campaign?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(campaign?.endsOn ?? "");
  const [enabled, setEnabled] = useState(campaign?.enabled ?? true);
  const [textColor, setTextColor] = useState<TextColor>(campaign?.textColor ?? "WHITE");
  const [colorIsAuto, setColorIsAuto] = useState(!campaign);
  const [arts, setArts] = useState<Record<ServopaCampaignArtSlot, ArtDraft>>({
    ALL: savedArt(campaign?.artUrl ?? null),
    REAL_ESTATE: savedArt(campaign?.realEstateArtUrl ?? null),
    MOVABLE: savedArt(campaign?.movableArtUrl ?? null),
  });
  const [split, setSplit] = useState(!!(campaign?.realEstateArtUrl || campaign?.movableArtUrl));
  const [previewSlot, setPreviewSlot] = useState<ServopaCampaignArtSlot>("ALL");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Libera da memória as imagens escolhidas e descartadas.
  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const saving = progress !== null;
  const months = [servopaMonthRange(today, 0), servopaMonthRange(today, 1)];
  const periodError = startsOn && endsOn && startsOn > endsOn ? "A data de fim não pode ser antes da data de início." : null;
  const overlaps = enabled ? overlappingServopaCampaigns(campaigns, { id: campaignId, startsOn: startsOn || null, endsOn: endsOn || null }) : [];
  const slots: ServopaCampaignArtSlot[] = split ? ["ALL", "REAL_ESTATE", "MOVABLE"] : ["ALL"];
  const previewArt = arts[previewSlot] ?? arts.ALL;

  async function chooseArt(slot: ServopaCampaignArtSlot, file: File) {
    if (!ART_TYPES.includes(file.type)) {
      setError("Use uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > MAX_ART_BYTES) {
      setError("A imagem passa de 10 MB. Peça ao designer uma versão mais leve (JPEG costuma resolver).");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setArts((current) => ({ ...current, [slot]: { kind: "file", file, url } }));
    setPreviewSlot(slot);
    if (colorIsAuto) {
      const suggested = await suggestTextColor(url);
      if (suggested) setTextColor(suggested);
    }
  }

  function pickPeriod(range: { startsOn: string; endsOn: string } | null) {
    setStartsOn(range?.startsOn ?? "");
    setEndsOn(range?.endsOn ?? "");
  }

  async function save() {
    if (!name.trim()) {
      setError("Dê um nome para a campanha.");
      return;
    }
    if (periodError) return;
    setError(null);
    const fields = { name: name.trim(), startsOn: startsOn || null, endsOn: endsOn || null, enabled, textColor };
    let id = campaignId;
    let list = campaigns;
    const saved = () => list.find((item) => item.id === id) ?? null;
    const fail = (message: string) => {
      setProgress(null);
      setError(message);
    };

    const before = saved();
    setProgress(before ? "Salvando…" : "Criando a campanha…");
    const fieldsChanged = !before
      || fields.name !== before.name || fields.startsOn !== before.startsOn || fields.endsOn !== before.endsOn
      || fields.enabled !== before.enabled || fields.textColor !== before.textColor;
    if (fieldsChanged) {
      const result = await requestJson<CampaignsResponse>(
        id ? `/api/servopa-tables/campaigns/${id}` : "/api/servopa-tables/campaigns",
        { method: id ? "PATCH" : "POST", json: fields },
        { silent: true },
      );
      if (!result.ok) return fail(result.error);
      list = result.data.campaigns;
      onListChanged(result.data);
      if (result.data.createdId) {
        id = result.data.createdId;
        setCreatedId(id);
      }
    }
    if (!id) return fail("Não foi possível criar a campanha.");

    const urlOf = (slot: ServopaCampaignArtSlot) => {
      const record = saved();
      return slot === "ALL" ? record?.artUrl ?? null : slot === "REAL_ESTATE" ? record?.realEstateArtUrl ?? null : record?.movableArtUrl ?? null;
    };
    for (const slot of ["ALL", "REAL_ESTATE", "MOVABLE"] as const) {
      const art = slot === "ALL" || split ? arts[slot] : null;
      if (art?.kind === "file") {
        setProgress(`Enviando ${SLOT_LABEL[slot]}…`);
        const body = new FormData();
        body.append("file", art.file);
        const result = await requestJson<CampaignsResponse>(`/api/servopa-tables/campaigns/${id}/art?slot=${slot}`, { method: "POST", body }, { silent: true });
        if (!result.ok) return fail(`${result.error} (${SLOT_LABEL[slot]})`);
        list = result.data.campaigns;
        onListChanged(result.data);
        // Já está no R2: um novo "Salvar" depois de outra falha não reenvia esta.
        setArts((current) => ({ ...current, [slot]: savedArt(urlOf(slot)) }));
      } else if (!art && urlOf(slot)) {
        setProgress(`Removendo ${SLOT_LABEL[slot]}…`);
        const result = await requestJson<CampaignsResponse>(`/api/servopa-tables/campaigns/${id}/art?slot=${slot}`, { method: "DELETE" }, { silent: true });
        if (!result.ok) return fail(result.error);
        list = result.data.campaigns;
        onListChanged(result.data);
      }
    }

    setProgress(null);
    onClose();
  }

  return (
    <Modal onClose={saving ? () => {} : onClose} maxWidth="max-w-3xl">
      <div className="space-y-6">
        <header>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{campaign ? `Editar "${campaign.name}"` : "Nova campanha"}</h2>
          <p className="text-sm text-neutral-500">A arte aparece no topo do PDF das tabelas, só nos dias escolhidos.</p>
        </header>

        {/* 1. Arte, com a prévia do jeito que sai no PDF */}
        <section className="space-y-3">
          <StepTitle number={1} title="Arte da faixa" />
          {split && (
            <div className="flex gap-1 rounded-md bg-neutral-100 p-1 text-sm dark:bg-neutral-900">
              {slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setPreviewSlot(slot)}
                  className={`flex-1 rounded px-2 py-1.5 font-medium transition-colors ${previewSlot === slot ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
                >
                  {slot === "ALL" ? "Principal" : slot === "REAL_ESTATE" ? "Imóveis" : "Automóveis"}
                  {arts[slot] && <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600" aria-label="com arte" />}
                </button>
              ))}
            </div>
          )}
          <ArtDropzone
            slot={previewSlot}
            art={arts[previewSlot]}
            fallback={previewSlot !== "ALL" ? arts.ALL : null}
            textColor={textColor}
            disabled={saving}
            onChoose={(file) => void chooseArt(previewSlot, file)}
            onRemove={() => setArts((current) => ({ ...current, [previewSlot]: null }))}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600 dark:text-neutral-300">Logos e texto em</span>
              <div className="flex gap-1 rounded-md bg-neutral-100 p-1 dark:bg-neutral-900">
                {([["WHITE", "Branco"], ["BLACK", "Preto"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setTextColor(value); setColorIsAuto(false); }}
                    className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors ${textColor === value ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
                  >
                    <span className={`h-3 w-3 rounded-full ring-1 ring-neutral-300 ${value === "WHITE" ? "bg-white" : "bg-neutral-900"}`} />
                    {label}
                  </button>
                ))}
              </div>
              {colorIsAuto && previewArt && <span className="inline-flex items-center gap-1 text-xs text-neutral-500"><Wand2 className="h-3.5 w-3.5" aria-hidden="true" />escolhido pela arte</span>}
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <Switch checked={split} disabled={saving} onChange={(value) => { setSplit(value); setPreviewSlot("ALL"); }} label="Arte diferente para imóveis e automóveis" />
              Arte diferente para imóveis e automóveis
            </label>
          </div>
        </section>

        {/* 2. Nome e período */}
        <section className="space-y-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
          <StepTitle number={2} title="Nome e período" />
          <input
            autoFocus={!campaign}
            value={name}
            maxLength={SERVOPA_CAMPAIGN_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome da campanha, ex.: Black November"
            aria-label="Nome da campanha"
            className="field-input"
          />
          <div className="flex flex-wrap gap-2">
            {months.map((range) => {
              const active = startsOn === range.startsOn && endsOn === range.endsOn;
              return (
                <button key={range.startsOn} type="button" onClick={() => pickPeriod(range)} className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-brand bg-brand/10 text-brand" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"}`}>
                  {range.label} inteiro
                </button>
              );
            })}
            <button type="button" onClick={() => pickPeriod(null)} className={`rounded-full border px-3 py-1 text-sm transition-colors ${!startsOn && !endsOn ? "border-brand bg-brand/10 text-brand" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"}`}>
              Sem data
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Começa em</span>
              <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="field-input" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Termina em (o dia conta)</span>
              <input type="date" value={endsOn} min={startsOn || undefined} onChange={(event) => setEndsOn(event.target.value)} className="field-input" />
            </label>
          </div>

          <div className="rounded-md bg-neutral-50 px-3 py-2.5 text-sm dark:bg-neutral-900/60">
            <div className="flex items-center justify-between gap-3">
              <p className={enabled ? "text-neutral-800 dark:text-neutral-100" : "text-neutral-500"}>
                {periodError ?? (enabled ? describeServopaCampaignWindow(startsOn || null, endsOn || null, today) : "Desligada: não aparece em nenhum PDF.")}
              </p>
              <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                {enabled ? "Ligada" : "Desligada"}
                <Switch checked={enabled} onChange={setEnabled} label="Campanha ligada" />
              </label>
            </div>
            {!arts.ALL && !(split && (arts.REAL_ESTATE || arts.MOVABLE)) && enabled && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Sem arte, nada aparece. Dá para salvar agora e enviar a arte depois.</p>
            )}
            {overlaps.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Coincide com {overlaps.map((other) => `"${other.name}"`).join(", ")}. Nos dias em comum, vale a que começa por último.
              </p>
            )}
          </div>
        </section>

        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          {progress && <span className="mr-auto inline-flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{progress}</span>}
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={saving || !!periodError} className="btn-primary min-w-32">
            {campaignId ? "Salvar" : "Criar campanha"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StepTitle({ number, title }: { number: number; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-xs text-brand">{number}</span>
      {title}
    </h3>
  );
}

function ArtDropzone({
  slot,
  art,
  fallback,
  textColor,
  disabled,
  onChoose,
  onRemove,
}: {
  slot: ServopaCampaignArtSlot;
  art: ArtDraft;
  /** Arte principal, mostrada (apagada) quando o segmento ainda não tem a própria. */
  fallback: ArtDraft;
  textColor: TextColor;
  disabled: boolean;
  onChoose: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file && !disabled) onChoose(file);
      }}
      className={`rounded-lg transition-shadow ${dragging ? "ring-2 ring-brand ring-offset-2 dark:ring-offset-neutral-950" : ""}`}
    >
      <input
        ref={input}
        type="file"
        accept={ART_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onChoose(file);
        }}
      />
      {art ? (
        <div className="space-y-2">
          <BandPreview artUrl={art.url} textColor={textColor} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-neutral-500">
              {art.kind === "file" ? `${art.file.name}: é enviada ao salvar.` : "Assim fica o topo do PDF (grupo de exemplo)."}
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="btn-secondary btn-sm"><Upload className="h-3.5 w-3.5" aria-hidden="true" />Trocar arte</button>
              <button type="button" disabled={disabled} onClick={onRemove} className="btn-secondary btn-sm text-red-600 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remover</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="relative block aspect-[210/52] w-full overflow-hidden rounded-md border-2 border-dashed border-neutral-300 transition-colors hover:border-brand dark:border-neutral-700"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fallback?.url ?? TEMPLATE_URL} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
          <span className="relative flex h-full flex-col items-center justify-center gap-1 bg-white/40 px-4 text-center dark:bg-neutral-950/40">
            <ImagePlus className="h-6 w-6 text-brand" aria-hidden="true" />
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {slot === "ALL" ? "Arraste a arte aqui ou clique para escolher" : `Arraste a arte só para ${slot === "REAL_ESTATE" ? "imóveis" : "automóveis"}`}
            </span>
            <span className="text-xs text-neutral-600 dark:text-neutral-300">
              {slot === "ALL" ? `PNG, JPEG ou WebP de até 10 MB, de preferência ${ART_SIZE}` : "Opcional: sem ela, estas tabelas usam a arte principal"}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
