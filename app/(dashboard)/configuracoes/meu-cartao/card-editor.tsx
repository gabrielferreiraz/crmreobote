"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Plus,
  X,
  Camera,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Maximize2,
  ChevronUp,
  ChevronDown,
  Users,
  Eye,
  Share2,
  UserRound,
  Phone,
  Images,
  Palette,
  Building2,
  Link2,
  Award,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { DigitalCardView, type DigitalCardData } from "@/components/digital-card/digital-card-view";
import { PhonePreviewFrame } from "@/components/digital-card/phone-preview-frame";
import { displayPhone, isValidPhoneInput } from "@/lib/phone-normalize";
import { AVAILABLE_PARTNER_LOGOS, DEFAULT_SELECTED_LOGOS } from "@/lib/digital-cards/logos";
import { CARD_THEMES, type CardTheme } from "@/lib/digital-cards/themes";
import { ImageCropModal } from "@/components/image-crop-modal";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { requestJson } from "@/lib/client-request";
import type { getOrCreateOwnCard } from "@/lib/digital-cards/queries";
import { REOBOTE_CARD_ADDRESS } from "@/lib/digital-cards/config";
import { EditorSection, Switch, LINK_TYPES, LINK_TYPE_ORDER, normalizeLinkUrl, isValidLinkUrl } from "./editor-ui";

type Card = Awaited<ReturnType<typeof getOrCreateOwnCard>>;
type LinkRow = { id: string; type: string; label: string; url: string };
type PhotoKind = "photo" | "cover" | "background";

const DEFAULT_BIO = "Inteligência em Consórcios";
const DEFAULT_COMPANY = "Reobote Consórcios";
const DEFAULT_JOB_TITLE = "Consultor de Vendas";
const JOB_TITLE_OPTIONS = ["Consultor de Vendas", "Supervisor de Vendas", "Gerente de Vendas"];
const MAX_COVERS = 4;
const MAX_LINKS = 12;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

const THEME_NAMES: Record<CardTheme, string> = { DARK: "Escuro", LIGHT: "Claro", PHOTO: "Foto" };

const CROP: Record<PhotoKind, { aspect: number; title: string }> = {
  photo: { aspect: 1, title: "Sua foto" },
  cover: { aspect: 1.6, title: "Capa" },
  background: { aspect: 9 / 16, title: "Foto do fundo" },
};

/** Tudo que vai no botão Salvar (fotos e "no ar" salvam sozinhos, na hora). */
type SavedFields = {
  jobTitle: string | null;
  bio: string | null;
  companyName: string | null;
  displayNameOverride: string | null;
  emailOverride: string | null;
  phone: string | null;
  whatsapp: string | null;
  showPortfolioValue: boolean;
  portfolioValueDisplay: string | null;
  selectedLogos: string[];
  links: { type: string; label: string; url: string }[];
  theme: CardTheme | null;
};

const noopSubscribe = () => () => {};

/** Botões do "no ar" (QR, Copiar, Enviar, Abrir) — nunca sobra um sozinho numa linha. */
const ACTION_GRID: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };

/**
 * Edição do Cartão Digital — formulário + prévia ao vivo (a prévia usa o
 * MESMO DigitalCardView da página pública, com `interactive={false}`: editar
 * nunca conta como visita/clique).
 *
 * Redesenhado (10/2026) pra quem não é de tecnologia, celular primeiro:
 * - títulos de uma palavra, sem frase explicando campo — a prévia mostra;
 * - no celular a prévia sai da lateral (ficava no FIM da página, depois de
 *   tudo) e vira o botão "Ver" da barra de baixo, junto do Salvar;
 * - link aceita do jeito que a pessoa anota ("@perfil", "site.com.br");
 * - toque em vez de arrastar (logos) e botões sempre visíveis (a lixeira da
 *   capa só aparecia no hover — no celular não existia).
 */
export function CardEditor({
  card,
  publicUrl,
  isOwner,
  orgDefaultsSet,
  qrButton,
}: {
  card: NonNullable<Card>;
  publicUrl: string;
  /** Dono: capa, fundo e estilo dele valem pra equipe toda (ver org-defaults). */
  isOwner: boolean;
  orgDefaultsSet: { theme?: CardTheme | null };
  /** Botão do QR Code (ver qr-code-panel.tsx) — só existe com o cartão no ar. */
  qrButton?: React.ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = useState(card.active);
  const [activeSaving, setActiveSaving] = useState(false);
  const [jobTitle, setJobTitle] = useState(card.jobTitle ?? DEFAULT_JOB_TITLE);
  const [bio, setBio] = useState(card.bio ?? DEFAULT_BIO);
  const companyName = card.companyName ?? DEFAULT_COMPANY;
  const [displayNameOverride, setDisplayNameOverride] = useState(card.displayNameOverride ?? "");
  // Vazio = segue o e-mail do perfil (User.email). O e-mail real aparece só
  // como placeholder — pré-preencher gravaria um override sem querer.
  const [emailOverride, setEmailOverride] = useState(card.emailOverride ?? "");
  const phone = card.phone ?? "";
  const [whatsapp, setWhatsapp] = useState(card.whatsapp ?? "");
  const [showPortfolioValue, setShowPortfolioValue] = useState(card.showPortfolioValue);
  const [portfolioValueDisplay, setPortfolioValueDisplay] = useState(card.portfolioValueDisplay ?? "");
  // [] = nunca configurado — mesmo fallback da página pública (getActivePartnerLogos).
  const [selectedLogos, setSelectedLogos] = useState<string[]>(
    card.selectedLogos.length > 0 ? card.selectedLogos : DEFAULT_SELECTED_LOGOS,
  );
  const [links, setLinks] = useState<LinkRow[]>(card.links.map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url })));
  const [themeChoice, setThemeChoice] = useState<CardTheme | null>(card.theme ?? null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(card.photoUrl);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(card.coverPhotoUrl);
  const [coverPhotoUrls, setCoverPhotoUrls] = useState<string[]>(card.coverPhotoUrls ?? (card.coverPhotoUrl ? [card.coverPhotoUrl] : []));
  const [ownCoverPhotoUrls, setOwnCoverPhotoUrls] = useState<string[]>(card.coverPhotoKey ? (card.coverPhotoUrls ?? []) : []);
  const [backgroundPhotoUrl, setBackgroundPhotoUrl] = useState<string | null>(card.backgroundPhotoUrl);
  const [hasOwnBackgroundPhoto, setHasOwnBackgroundPhoto] = useState(!!card.backgroundPhotoKey);
  const [uploading, setUploading] = useState<PhotoKind | null>(null);
  const [crop, setCrop] = useState<{ kind: PhotoKind; src: string; append: boolean } | null>(null);

  const [orgDefaultTheme, setOrgDefaultTheme] = useState<CardTheme | null>(orgDefaultsSet.theme ?? null);
  const [teamThemeSaving, setTeamThemeSaving] = useState(false);

  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  useLockBodyScroll(showPreview);

  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  function buildSavedFields(): SavedFields {
    return {
      jobTitle: jobTitle.trim() || null,
      bio: bio.trim() || null,
      companyName: companyName.trim() || null,
      displayNameOverride: displayNameOverride.trim() || null,
      emailOverride: emailOverride.trim() || null,
      phone: phone.trim() || null,
      whatsapp: whatsapp.trim() || null,
      showPortfolioValue,
      portfolioValueDisplay: portfolioValueDisplay.trim() || null,
      selectedLogos,
      // Linha sem link é ignorada (antes ia pro servidor e travava o Salvar
      // inteiro com "cada link precisa de título e URL"); sem nome, o botão
      // leva o nome do tipo ("Instagram").
      links: links
        .filter((l) => l.url.trim())
        .map((l) => ({
          type: l.type,
          label: l.label.trim() || LINK_TYPES[l.type]?.label || "Link",
          url: normalizeLinkUrl(l.type, l.url),
        })),
      theme: themeChoice,
    };
  }

  // O que está salvo no banco — comparado com o formulário pra saber se há
  // algo pendente, e usado pelo "Desfazer" pra voltar tudo de uma vez.
  const [savedFields, setSavedFields] = useState<SavedFields>(() => buildSavedFields());
  const current = buildSavedFields();
  const dirty = JSON.stringify(current) !== JSON.stringify(savedFields);

  const whatsappInvalid = !!whatsapp.trim() && !isValidPhoneInput(whatsapp);
  const invalidLinkIds = new Set(
    links.filter((l) => l.url.trim() && !isValidLinkUrl(normalizeLinkUrl(l.type, l.url))).map((l) => l.id),
  );

  // Sair da página (fechar aba, recarregar) com alteração não salva pergunta antes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function restoreSaved() {
    setJobTitle(savedFields.jobTitle ?? "");
    setBio(savedFields.bio ?? "");
    setDisplayNameOverride(savedFields.displayNameOverride ?? "");
    setEmailOverride(savedFields.emailOverride ?? "");
    setWhatsapp(savedFields.whatsapp ?? "");
    setShowPortfolioValue(savedFields.showPortfolioValue);
    setPortfolioValueDisplay(savedFields.portfolioValueDisplay ?? "");
    setSelectedLogos(savedFields.selectedLogos);
    setLinks(savedFields.links.map((l, i) => ({ id: `saved-${i}`, ...l })));
    setThemeChoice(savedFields.theme);
    setError(null);
    setShowErrors(false);
  }

  async function handleSave() {
    if (whatsappInvalid || invalidLinkIds.size > 0) {
      setShowErrors(true);
      setError(whatsappInvalid ? "Confira o número do WhatsApp." : "Confira o link marcado em vermelho.");
      return;
    }
    setSaving(true);
    setError(null);
    const fields = current;
    const res = await requestJson(
      `/api/digital-cards/${card.id}`,
      { method: "PATCH", json: { ...fields, links: fields.links.map((l, i) => ({ ...l, order: i })) } },
      { silent: true, errorMessage: "Não deu pra salvar. Tente de novo." },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedFields(fields);
    setShowErrors(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2200);
  }

  // No ar / fora do ar salva NA HORA — é a decisão de maior consequência da
  // página e não pode depender de lembrar do Salvar. router.refresh() faz o
  // servidor mostrar (ou esconder) o QR Code e os Resultados.
  async function handleToggleActive(next: boolean) {
    setActiveSaving(true);
    setActive(next);
    const res = await requestJson(`/api/digital-cards/${card.id}`, { method: "PATCH", json: { active: next } }, { errorMessage: "Não deu pra mudar agora. Tente de novo." });
    setActiveSaving(false);
    if (!res.ok) {
      setActive(!next);
      return;
    }
    router.refresh();
  }

  // ─── Fotos (salvam sozinhas, logo depois do recorte) ──────────────────
  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>, kind: PhotoKind, append = false) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setCrop({ kind, src: reader.result, append });
    };
    reader.readAsDataURL(file);
  }

  async function uploadCropped(blob: Blob) {
    if (!crop) return;
    const { kind, append } = crop;
    setCrop(null);
    const formData = new FormData();
    formData.append("file", new File([blob], `${kind}.jpg`, { type: "image/jpeg" }));
    setUploading(kind);
    const path = kind === "photo" ? "photo" : kind === "cover" ? `cover${append ? "?append=true" : ""}` : "background";
    const res = await requestJson(`/api/digital-cards/${card.id}/${path}`, { method: "POST", body: formData }, { errorMessage: "Não deu pra enviar a foto. Tente outra." });
    setUploading(null);
    if (!res.ok) return;
    if (kind === "photo") setPhotoUrl(res.data.photoUrl);
    if (kind === "cover") applyCoverResponse(res.data);
    if (kind === "background") {
      setBackgroundPhotoUrl(res.data.backgroundPhotoUrl ?? null);
      setHasOwnBackgroundPhoto(true);
    }
  }

  function applyCoverResponse(data: { coverPhotoUrl?: string | null; coverPhotoUrls?: string[]; ownCoverPhotoUrls?: string[] }) {
    setCoverPhotoUrl(data.coverPhotoUrl ?? null);
    setCoverPhotoUrls(data.coverPhotoUrls ?? []);
    setOwnCoverPhotoUrls(data.ownCoverPhotoUrls ?? data.coverPhotoUrls ?? []);
  }

  async function removePhoto(kind: PhotoKind, coverIndex?: number) {
    setUploading(kind);
    const path =
      kind === "photo" ? "photo" : kind === "cover" ? `cover${coverIndex !== undefined ? `?index=${coverIndex}` : ""}` : "background";
    const res = await requestJson(`/api/digital-cards/${card.id}/${path}`, { method: "DELETE" }, { errorMessage: "Não deu pra remover. Tente de novo." });
    setUploading(null);
    if (!res.ok) return;
    if (kind === "photo") setPhotoUrl(null);
    if (kind === "cover") {
      setCoverPhotoUrl(res.data?.coverPhotoUrl ?? null);
      setCoverPhotoUrls(res.data?.coverPhotoUrls ?? []);
      setOwnCoverPhotoUrls(res.data?.ownCoverPhotoUrls ?? []);
    }
    if (kind === "background") {
      setBackgroundPhotoUrl(res.data?.backgroundPhotoUrl ?? null);
      setHasOwnBackgroundPhoto(false);
    }
  }

  // ─── Estilo da equipe (só o Dono) ──────────────────────────────────────
  async function setTeamTheme(theme: CardTheme | null) {
    setTeamThemeSaving(true);
    const res = await requestJson(
      "/api/digital-cards/org-defaults/theme",
      theme ? { method: "POST", json: { theme } } : { method: "DELETE" },
      { errorMessage: "Não deu pra mudar o estilo da equipe agora." },
    );
    setTeamThemeSaving(false);
    if (res.ok) setOrgDefaultTheme(theme);
  }

  // ─── Administradoras ──────────────────────────────────────────────────
  // A Reobote é fixa (sempre aparece, sempre primeiro) — a lista daqui é só
  // das parceiras. Antes as setas usavam a posição na lista SEM a Reobote
  // pra mexer na lista COM ela, e trocavam a logo errada.
  const partnerLogos = selectedLogos.filter((k) => k !== "reobote");
  function setPartners(next: string[]) {
    setSelectedLogos((prev) => [...(prev.includes("reobote") ? ["reobote"] : []), ...next]);
  }
  function movePartner(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= partnerLogos.length) return;
    const next = [...partnerLogos];
    [next[index], next[target]] = [next[target], next[index]];
    setPartners(next);
  }
  function togglePartner(key: string, on: boolean) {
    setPartners(on ? [...partnerLogos, key] : partnerLogos.filter((k) => k !== key));
  }
  const partnerRows = [
    ...partnerLogos.map((key) => AVAILABLE_PARTNER_LOGOS.find((l) => l.key === key)).filter((l) => !!l),
    ...AVAILABLE_PARTNER_LOGOS.filter((l) => l.key !== "reobote" && !partnerLogos.includes(l.key)),
  ];

  // ─── Links ─────────────────────────────────────────────────────────────
  const newLinkSeq = useRef(0);
  function addLink(type: string) {
    const id = `new-${++newLinkSeq.current}`;
    setLinks((prev) => [...prev, { id, type, label: "", url: "" }]);
    // Já abre o teclado no campo novo — um toque a menos no celular.
    requestAnimationFrame(() => document.getElementById(`link-url-${id}`)?.focus());
  }
  function updateLink(id: string, patch: Partial<LinkRow>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência — o link continua visível pra copiar à mão.
    }
  }

  async function handleShare() {
    try {
      await navigator.share({ title: displayNameOverride.trim() || card.displayName, url: publicUrl });
    } catch {
      // Cancelado pela pessoa — nada a fazer.
    }
  }

  const previewTheme = themeChoice ?? orgDefaultTheme ?? "DARK";
  const displayName = displayNameOverride.trim() || card.displayName;

  const previewData: DigitalCardData = {
    slug: card.slug,
    displayName,
    jobTitle: jobTitle.trim() || null,
    companyName: null,
    bio: bio.trim() || null,
    photoUrl,
    coverPhotoUrl,
    coverPhotoUrls,
    backgroundPhotoUrl,
    phone: displayPhone(phone.trim() || null),
    whatsapp: displayPhone(whatsapp.trim() || null),
    displayEmail: emailOverride.trim() || card.user.email,
    address: REOBOTE_CARD_ADDRESS,
    showPortfolioValue,
    portfolioValueDisplay: portfolioValueDisplay.trim() || null,
    selectedLogos,
    links: current.links.map((l, i) => ({ id: `preview-${i}`, ...l })),
    publicUrl,
    theme: previewTheme,
  };

  const companyCovers = ownCoverPhotoUrls.length === 0 ? coverPhotoUrls : [];
  const busyCover = uploading === "cover";

  return (
    <div className="grid grid-cols-1 gap-5 pb-24 lg:grid-cols-[minmax(0,1fr)_345px] lg:items-start lg:pb-0">
      <div className="min-w-0 space-y-4">
        {/* ─── No ar ─────────────────────────────────────────────── */}
        <section
          className={`rounded-2xl border p-4 sm:p-5 ${
            active
              ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/25 dark:bg-emerald-500/10"
              : "border-white/70 bg-white/75 shadow-[0_1px_3px_rgba(20,24,50,0.06)] dark:border-white/10 dark:bg-neutral-900/60"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{active ? "Cartão no ar" : "Cartão fora do ar"}</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{active ? "Quem tem o link consegue ver." : "Ninguém consegue ver ainda."}</p>
            </div>
            {active ? (
              <>
                {activeSaving && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />}
                <Switch checked onChange={handleToggleActive} disabled={activeSaving} label="Cartão no ar" />
              </>
            ) : (
              // Primeira vez: um interruptor desligado não diz "toque aqui" — botão diz.
              <button type="button" onClick={() => handleToggleActive(true)} disabled={activeSaving} className="btn-primary h-11 shrink-0 px-5">
                {activeSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Pôr no ar
              </button>
            )}
          </div>

          {active && (
            <>
              <p className="mt-4 truncate rounded-lg bg-white/80 px-3 py-2 text-sm text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-300">
                {publicUrl.replace(/^https?:\/\//, "")}
              </p>
              <div className={`mt-3 grid gap-2 ${ACTION_GRID[(qrButton ? 1 : 0) + (canShare ? 1 : 0) + 2]}`}>
                {qrButton}
                <button type="button" onClick={handleCopyLink} className="btn-secondary h-11 justify-center">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
                {canShare && (
                  <button type="button" onClick={handleShare} className="btn-secondary h-11 justify-center">
                    <Share2 className="h-4 w-4" />
                    Enviar
                  </button>
                )}
                <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary h-11 justify-center">
                  <ExternalLink className="h-4 w-4" />
                  Abrir
                </a>
              </div>
            </>
          )}
        </section>

        {/* ─── Você ──────────────────────────────────────────────── */}
        <EditorSection icon={UserRound} title="Você">
          <div className="flex items-center gap-4">
            <label className="relative shrink-0 cursor-pointer" aria-label={photoUrl ? "Trocar foto" : "Pôr foto"}>
              <Avatar name={displayName} src={photoUrl} size="xl" />
              <span className="absolute -right-0.5 -bottom-0.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-brand text-white dark:border-neutral-900">
                {uploading === "photo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </span>
              <input type="file" accept={IMAGE_ACCEPT} className="hidden" disabled={!!uploading} onChange={(e) => pickPhoto(e, "photo")} />
            </label>
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Sua foto</p>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Toque na foto pra trocar.</p>
              {photoUrl && (
                <button
                  type="button"
                  onClick={() => removePhoto("photo")}
                  disabled={!!uploading}
                  className="mt-1 text-sm text-neutral-500 underline-offset-2 hover:text-red-600 hover:underline dark:text-neutral-400"
                >
                  Remover
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Nome" htmlFor="card-name">
              <input
                id="card-name"
                value={displayNameOverride}
                onChange={(e) => setDisplayNameOverride(e.target.value)}
                placeholder={card.user.name}
                maxLength={120}
                autoComplete="name"
                className="field-input"
              />
            </Field>

            <Field label="Cargo" htmlFor="card-job">
              <div className="mb-2 flex flex-wrap gap-2">
                {JOB_TITLE_OPTIONS.map((title) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => setJobTitle(title)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      jobTitle === title
                        ? "border-brand bg-brand-light font-medium text-brand dark:bg-[var(--brand-subtle)]"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    }`}
                  >
                    {title.replace(" de Vendas", "")}
                  </button>
                ))}
              </div>
              <input id="card-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder={DEFAULT_JOB_TITLE} className="field-input" />
            </Field>

            <Field label="Frase" htmlFor="card-bio" optional>
              <input id="card-bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder={DEFAULT_BIO} maxLength={140} className="field-input" />
            </Field>
          </div>
        </EditorSection>

        {/* ─── Contato ───────────────────────────────────────────── */}
        <EditorSection icon={Phone} title="Contato">
          <div className="space-y-4">
            <Field label="WhatsApp" htmlFor="card-whatsapp" error={showErrors && whatsappInvalid ? "Número incompleto. Use DDD + número." : undefined}>
              <input
                id="card-whatsapp"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(67) 99999-9999"
                aria-invalid={showErrors && whatsappInvalid ? true : undefined}
                className="field-input"
              />
            </Field>
            <Field label="E-mail" htmlFor="card-email">
              <input
                id="card-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
                placeholder={card.user.email}
                className="field-input"
              />
            </Field>
          </div>
        </EditorSection>

        {/* ─── Capa ──────────────────────────────────────────────── */}
        <EditorSection
          icon={Images}
          title="Capa"
          aside={
            <span className="text-sm tabular-nums text-neutral-400 dark:text-neutral-500">
              {ownCoverPhotoUrls.length}/{MAX_COVERS}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {ownCoverPhotoUrls.map((url, idx) => (
              <div key={url} className="relative aspect-[1.6] overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Capa ${idx + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto("cover", idx)}
                  disabled={busyCover}
                  aria-label={`Tirar capa ${idx + 1}`}
                  className="absolute top-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-red-600 disabled:opacity-50"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {companyCovers.map((url) => (
              <div key={url} className="relative aspect-[1.6] overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Capa da empresa" className="h-full w-full object-cover opacity-80" />
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">Da empresa</span>
              </div>
            ))}
            {ownCoverPhotoUrls.length < MAX_COVERS && (
              <label className="flex aspect-[1.6] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 text-neutral-500 transition-colors hover:border-brand hover:text-brand dark:border-neutral-700 dark:text-neutral-400">
                {busyCover ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" strokeWidth={2.2} />}
                <span className="text-sm font-medium">{busyCover ? "Enviando" : "Foto"}</span>
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="hidden"
                  disabled={!!uploading}
                  onChange={(e) => pickPhoto(e, "cover", ownCoverPhotoUrls.length > 0)}
                />
              </label>
            )}
          </div>
          {(ownCoverPhotoUrls.length > 1 || (isOwner && ownCoverPhotoUrls.length > 0)) && (
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
              {ownCoverPhotoUrls.length > 1 && <span>As fotos passam sozinhas.</span>}
              {isOwner && ownCoverPhotoUrls.length > 0 && <TeamTag />}
            </p>
          )}
        </EditorSection>

        {/* ─── Estilo ────────────────────────────────────────────── */}
        <EditorSection icon={Palette} title="Estilo">
          <div className="grid grid-cols-3 gap-2.5">
            {CARD_THEMES.map((theme) => (
              <ThemeTile
                key={theme}
                theme={theme}
                selected={previewTheme === theme}
                photo={backgroundPhotoUrl ?? coverPhotoUrl}
                onClick={() => setThemeChoice(theme)}
              />
            ))}
          </div>

          {previewTheme !== "LIGHT" && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
              <div className="relative h-16 w-10 shrink-0 overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-700">
                {backgroundPhotoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={backgroundPhotoUrl} alt="Foto do fundo" className="h-full w-full object-cover" />
                )}
                {uploading === "background" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Foto do fundo</p>
                {previewTheme === "PHOTO" && !backgroundPhotoUrl ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">Escolha uma foto.</p>
                ) : (
                  isOwner && hasOwnBackgroundPhoto && <TeamTag />
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="h-4 w-4" />
                  {hasOwnBackgroundPhoto ? "Trocar" : "Pôr"}
                  <input type="file" accept={IMAGE_ACCEPT} className="hidden" disabled={!!uploading} onChange={(e) => pickPhoto(e, "background")} />
                </label>
                {hasOwnBackgroundPhoto && (
                  <button
                    type="button"
                    onClick={() => removePhoto("background")}
                    disabled={!!uploading}
                    aria-label="Tirar foto do fundo"
                    className="icon-btn h-9 w-9"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {(isOwner || themeChoice !== null) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {isOwner &&
                (orgDefaultTheme === previewTheme ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <Check className="h-4 w-4" />
                    Estilo da equipe
                    <button
                      type="button"
                      onClick={() => setTeamTheme(null)}
                      disabled={teamThemeSaving}
                      className="ml-1 text-neutral-400 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-200"
                    >
                      tirar
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTeamTheme(previewTheme)}
                    disabled={teamThemeSaving}
                    className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"
                  >
                    {teamThemeSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                    Usar na equipe toda
                  </button>
                ))}
              {!isOwner && themeChoice !== null && orgDefaultTheme && orgDefaultTheme !== themeChoice && (
                <button
                  type="button"
                  onClick={() => setThemeChoice(null)}
                  className="text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline dark:text-neutral-400"
                >
                  Voltar ao da empresa
                </button>
              )}
            </div>
          )}
        </EditorSection>

        {/* ─── Administradoras ───────────────────────────────────── */}
        <EditorSection icon={Building2} title="Administradoras">
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {partnerRows.map((logo) => {
              const position = partnerLogos.indexOf(logo.key);
              const on = position >= 0;
              return (
                <li key={logo.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={`w-5 shrink-0 text-center text-sm font-semibold tabular-nums ${on ? "text-brand" : "text-transparent"}`}>
                    {on ? position + 1 : "·"}
                  </span>
                  <span className={`flex h-10 w-20 shrink-0 items-center justify-center rounded-lg bg-white px-2 ring-1 ring-neutral-200 dark:ring-neutral-700 ${on ? "" : "opacity-50"}`}>
                    {typeof logo.src === "string" && logo.src.startsWith("/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo.src} alt="" className="max-h-6 max-w-full object-contain" />
                    ) : (
                      <span className="text-xs font-semibold text-neutral-600">{logo.label}</span>
                    )}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${on ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}>
                    {logo.label}
                  </span>
                  {on && partnerLogos.length > 1 && (
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => movePartner(position, -1)}
                        disabled={position === 0}
                        aria-label={`Subir ${logo.label}`}
                        className="icon-btn h-9 w-9 disabled:opacity-25"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePartner(position, 1)}
                        disabled={position === partnerLogos.length - 1}
                        aria-label={`Descer ${logo.label}`}
                        className="icon-btn h-9 w-9 disabled:opacity-25"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                  <Switch checked={on} onChange={(next) => togglePartner(logo.key, next)} label={`Mostrar ${logo.label}`} />
                </li>
              );
            })}
          </ul>
        </EditorSection>

        {/* ─── Links ─────────────────────────────────────────────── */}
        <EditorSection icon={Link2} title="Redes e links">
          {links.length > 0 && (
            <ul className="mb-4 space-y-3">
              {links.map((link) => {
                const meta = LINK_TYPES[link.type] ?? LINK_TYPES.OTHER;
                const Icon = meta.icon;
                const invalid = showErrors && invalidLinkIds.has(link.id);
                return (
                  <li key={link.id} className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-neutral-600 dark:text-neutral-300" />
                      <span className="min-w-0 flex-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">{meta.label}</span>
                      <button
                        type="button"
                        onClick={() => setLinks((prev) => prev.filter((l) => l.id !== link.id))}
                        aria-label={`Tirar ${meta.label}`}
                        className="icon-btn h-9 w-9"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 space-y-2">
                      {meta.needsName && (
                        <input
                          value={link.label}
                          onChange={(e) => updateLink(link.id, { label: e.target.value })}
                          placeholder={link.type === "WEBSITE" ? "Nome do botão. Ex.: Site Reobote" : "Nome do botão"}
                          aria-label="Nome do botão"
                          className="field-input"
                        />
                      )}
                      <input
                        id={`link-url-${link.id}`}
                        value={link.url}
                        onChange={(e) => updateLink(link.id, { url: e.target.value })}
                        placeholder={meta.placeholder}
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-label={`Link do ${meta.label}`}
                        aria-invalid={invalid ? true : undefined}
                        className="field-input"
                      />
                      {invalid && <p className="field-error">Esse link não parece certo.</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {links.length < MAX_LINKS && (
            <div className="flex flex-wrap gap-2">
              {LINK_TYPE_ORDER.map((type) => {
                const meta = LINK_TYPES[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addLink(type)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-sm text-neutral-700 transition-colors hover:border-brand hover:text-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          )}
        </EditorSection>

        {/* ─── Carteira ──────────────────────────────────────────── */}
        <EditorSection
          icon={Award}
          title="Carteira"
          aside={<Switch checked={showPortfolioValue} onChange={setShowPortfolioValue} label="Mostrar carteira no cartão" />}
        >
          {showPortfolioValue ? (
            <input
              value={portfolioValueDisplay}
              onChange={(e) => setPortfolioValueDisplay(e.target.value)}
              placeholder="Ex.: +R$ 5 milhões"
              aria-label="Valor da carteira"
              className="field-input"
            />
          ) : (
            <p className="-mt-2 text-sm text-neutral-500 dark:text-neutral-400">Mostre quanto você já tem sob gestão.</p>
          )}
        </EditorSection>

        {/* Barra de salvar — computador (no celular é a barra fixa de baixo). */}
        {(dirty || justSaved || saving) && (
          <div className="sticky bottom-4 z-30 hidden items-center gap-3 rounded-2xl border border-neutral-200 bg-white/95 p-3 pl-4 shadow-xl backdrop-blur-md lg:flex dark:border-neutral-700 dark:bg-neutral-900/95">
            <p className={`min-w-0 flex-1 text-sm ${error ? "text-red-600 dark:text-red-400" : "text-neutral-700 dark:text-neutral-300"}`}>
              {error ?? (justSaved && !dirty ? "Tudo salvo." : "Você mudou o cartão.")}
            </p>
            {dirty && !saving && (
              <button type="button" onClick={restoreSaved} className="btn-ghost">
                Desfazer
              </button>
            )}
            <SaveButton dirty={dirty} saving={saving} justSaved={justSaved} onClick={handleSave} />
          </div>
        )}
      </div>

      {/* ─── Prévia (computador) ─────────────────────────────────── */}
      <div className="hidden lg:sticky lg:top-4 lg:block">
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Como fica</span>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Ampliar
          </button>
        </div>
        <div className="select-none">
          <PhonePreviewFrame>
            <DigitalCardView data={previewData} interactive={false} />
          </PhonePreviewFrame>
        </div>
      </div>

      {/* ─── Barra fixa (celular): Ver + Salvar ──────────────────────
          Acima da navegação de baixo (mesma altura do botão "+" das outras
          telas). Sempre visível: a prévia no celular é por aqui. */}
      <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 lg:hidden">
        {error && (
          <p className="mb-2 rounded-xl bg-red-600 px-3 py-2 text-sm text-white shadow-lg">{error}</p>
        )}
        <div className="flex gap-2 rounded-2xl border border-neutral-200 bg-white/95 p-2 shadow-xl backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95">
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className={`btn-secondary h-12 justify-center ${dirty || saving || justSaved ? "px-4" : "flex-1"}`}
          >
            <Eye className="h-5 w-5" />
            {dirty || saving || justSaved ? "Ver" : "Ver como fica"}
          </button>
          {dirty && !saving && (
            <button type="button" onClick={restoreSaved} aria-label="Desfazer alterações" className="btn-ghost h-12 px-3">
              Desfazer
            </button>
          )}
          {(dirty || saving || justSaved) && (
            <SaveButton dirty={dirty} saving={saving} justSaved={justSaved} onClick={handleSave} className="h-12 flex-1 justify-center" />
          )}
        </div>
      </div>

      {/* ─── Prévia em tela cheia ───────────────────────────────── */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-4 backdrop-blur-md"
          onClick={() => setShowPreview(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Como fica o cartão"
        >
          <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-3 py-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-semibold text-white hover:bg-white/25"
            >
              <X className="h-4 w-4" />
              Fechar
            </button>
            {/* interactive=false: tocar num botão aqui não abre WhatsApp nem conta visita. */}
            <div className="w-full">
              <PhonePreviewFrame>
                <DigitalCardView data={previewData} interactive={false} />
              </PhonePreviewFrame>
            </div>
          </div>
        </div>
      )}

      <ImageCropModal
        isOpen={!!crop}
        imageSrc={crop?.src ?? null}
        title={crop ? CROP[crop.kind].title : ""}
        aspectRatio={crop ? CROP[crop.kind].aspect : 1}
        onClose={() => setCrop(null)}
        onCropComplete={uploadCropped}
      />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="field-label mb-1.5">
        {label}
        {optional && <span className="ml-1.5 font-normal text-neutral-400 dark:text-neutral-500">opcional</span>}
      </label>
      {children}
      {error && <p className="field-error mt-1.5">{error}</p>}
    </div>
  );
}

function TeamTag() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
      <Users className="h-4 w-4" />
      Vale pra equipe toda
    </span>
  );
}

function SaveButton({
  dirty,
  saving,
  justSaved,
  onClick,
  className = "",
}: {
  dirty: boolean;
  saving: boolean;
  justSaved: boolean;
  onClick: () => void;
  className?: string;
}) {
  const done = justSaved && !dirty;
  return (
    <button type="button" onClick={onClick} disabled={saving || done} className={`btn-primary ${className}`}>
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : null}
      {saving ? "Salvando" : done ? "Salvo" : "Salvar"}
    </button>
  );
}

/** Miniatura do estilo — um cartãozinho de verdade nas cores do tema, não só o nome. */
function ThemeTile({ theme, selected, photo, onClick }: { theme: CardTheme; selected: boolean; photo: string | null; onClick: () => void }) {
  const light = theme === "LIGHT";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`overflow-hidden rounded-xl border-2 text-left transition-colors ${
        selected ? "border-brand" : "border-transparent ring-1 ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-700"
      }`}
    >
      <div className={`relative flex h-24 flex-col items-center gap-1.5 overflow-hidden pt-3 ${light ? "bg-[#e8eef4]" : "bg-[#151a22]"}`}>
        {theme === "PHOTO" &&
          (photo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-0 bg-black/40" />
            </>
          ) : (
            <span className="absolute inset-0 bg-gradient-to-br from-slate-500 to-slate-800" />
          ))}
        <span className={`relative h-7 w-7 rounded-full ${light ? "bg-slate-300" : "bg-white/30"}`} />
        <span className={`relative h-1.5 w-12 rounded-full ${light ? "bg-slate-500/60" : "bg-white/70"}`} />
        <span className={`relative h-1 w-8 rounded-full ${light ? "bg-slate-400/50" : "bg-white/40"}`} />
        <span className="relative mt-1 h-3 w-14 rounded-md bg-emerald-500" />
      </div>
      <div className="flex items-center justify-between gap-1 bg-white px-2.5 py-2 dark:bg-neutral-900">
        <span className={`text-sm ${selected ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`}>
          {THEME_NAMES[theme]}
        </span>
        {selected && <Check className="h-4 w-4 text-brand" strokeWidth={2.5} />}
      </div>
    </button>
  );
}
