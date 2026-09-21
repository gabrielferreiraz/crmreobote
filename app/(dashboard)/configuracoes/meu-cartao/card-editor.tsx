"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X, Camera, Trash2, Copy, Check, ExternalLink, Maximize2, ChevronLeft, ChevronRight, GripVertical, Power, Users } from "lucide-react";
import { Select } from "@/components/select";
import { Avatar } from "@/components/avatar";
import { DigitalCardView, type DigitalCardData } from "@/components/digital-card/digital-card-view";
import { PhonePreviewFrame } from "@/components/digital-card/phone-preview-frame";
import { displayPhone } from "@/lib/phone-normalize";
import { AVAILABLE_PARTNER_LOGOS, DEFAULT_SELECTED_LOGOS } from "@/lib/digital-cards/logos";
import { ImageCropModal } from "@/components/image-crop-modal";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import type { getOrCreateOwnCard } from "@/lib/digital-cards/queries";

type Card = Awaited<ReturnType<typeof getOrCreateOwnCard>>;
type LinkRow = { id: string; type: string; label: string; url: string };

const LINK_TYPE_OPTIONS = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "WEBSITE", label: "Site" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "OTHER", label: "Outro" },
];

/**
 * Formulário + preview ao vivo (pedido explícito: "o usuário deve
 * conseguir visualizar como o cartão ficará antes de publicar") — a
 * pré-visualização usa DigitalCardView com `interactive={false}` (editar o
 * próprio cartão nunca conta como visita/clique de verdade).
 *
 * Redesenhado a pedido explícito: "muito mais intuitiva e com foco em
 * mensagens diretas, campos mais diretos pro consultor ler e entender na
 * hora". Passou por 2 rodadas:
 *
 * 1. "Ativo/inativo" virou uma ação IMEDIATA (PATCH próprio + router.refresh,
 *    igual às fotos), não mais um checkbox que só vale depois de rolar até
 *    o fim e clicar "Salvar" — é a decisão de maior consequência da página
 *    (se o cartão existe pro mundo ou não) e não devia ficar misturada com
 *    "salvei o cargo errado por engano".
 * 2. O botão "Salvar" mostra se há algo pendente (hasUnsavedChanges) —
 *    antes ficava sempre clicável, sem dar nenhum sinal de "isso aqui já
 *    foi salvo" ou "isso aqui ainda não".
 *
 * Primeira rodada também tinha adicionado uma legenda embaixo de CADA
 * campo explicando onde ele aparece no cartão ("Vira o botão verde de
 * destaque", "Aparece embaixo do seu nome"...) — pedido explícito de
 * volta atrás: "não precisa de tantas descrições para os campos, só o
 * nome dos campos mesmo". Removidas: o rótulo do campo + a pré-visualização
 * ao vivo (sempre visível ao lado) já bastam. Ficaram só as explicações que
 * NÃO são sobre "onde aparece" (arrastar pra reordenar logo, o que salva
 * sozinho vs. o que precisa do botão Salvar).
 *
 * Seções em cards (mesmo padrão de configuracoes/perfil/page.tsx).
 */
const DEFAULT_ADDRESS = "Av. Toros Puxian, 1019 - Vila Morumbi, Campo Grande - MS, 79052-030";
const DEFAULT_BIO = "Inteligência em Consórcios";
const DEFAULT_COMPANY = "Reobote Consórcios";
const DEFAULT_JOB_TITLE = "Consultor de Vendas";

const JOB_TITLE_OPTIONS = [
  "Consultor de Vendas",
  "Supervisor de Vendas",
  "Gerente de Vendas",
];

/** Payload "normalizado" pro Salvar em lote — usado tanto pra montar o body
 * do PATCH quanto (via JSON.stringify comparado) pra saber se há algo
 * pendente de salvar. `active` fica de FORA de propósito (ver comentário
 * acima do componente — agora é uma ação própria, imediata). */
type SavedFields = {
  jobTitle: string | null;
  bio: string | null;
  companyName: string | null;
  emailOverride: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  showPortfolioValue: boolean;
  portfolioValueDisplay: string | null;
  selectedLogos: string[];
  links: { type: string; label: string; url: string }[];
};

export function CardEditor({
  card,
  publicUrl,
  isOwner,
  orgDefaultsSet,
}: {
  card: NonNullable<Card>;
  publicUrl: string;
  /** Controla o botão "Manter padrão para todos" (capa/fundo — nunca a foto de perfil, ver lib/digital-cards/config.ts) — OWNER-only, mesmo motivo de qualquer configuração que afeta o cartão de todo mundo de uma vez. */
  isOwner: boolean;
  /** Se capa/fundo da ORGANIZAÇÃO já têm um padrão definido agora (ver lib/digital-cards/org-defaults.ts) — decide "Manter padrão" vs. "Remover padrão da equipe". */
  orgDefaultsSet: { cover: boolean; background: boolean };
}) {
  const router = useRouter();
  const [active, setActive] = useState(card.active);
  const [activeSaving, setActiveSaving] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState(card.jobTitle ?? DEFAULT_JOB_TITLE);
  const [bio, setBio] = useState(card.bio ?? DEFAULT_BIO);
  const [companyName, setCompanyName] = useState(card.companyName ?? DEFAULT_COMPANY);
  // Vazio por padrão (não pré-preenchido com card.user.email) de propósito:
  // salvar com o campo assim intocado NÃO deve gravar um override — e-mail
  // é o único campo aqui com fonte de verdade externa (User.email, ver
  // comentário em lib/digital-cards/queries.ts), então precisa continuar
  // acompanhando a pessoa trocar de e-mail no perfil até que ela digite
  // algo diferente aqui de propósito. O e-mail real aparece só como
  // placeholder (ver input abaixo), nunca como valor pré-preenchido.
  const [emailOverride, setEmailOverride] = useState(card.emailOverride ?? "");
  const [phone, setPhone] = useState(card.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(card.whatsapp ?? "");
  const [address, setAddress] = useState(card.address ?? DEFAULT_ADDRESS);
  const [showPortfolioValue, setShowPortfolioValue] = useState(card.showPortfolioValue);
  const [portfolioValueDisplay, setPortfolioValueDisplay] = useState(card.portfolioValueDisplay ?? "");
  // card.selectedLogos vazio = nunca configurado (ou usuário escolheu
  // "todas, ordem padrão" — ver comentário em getActivePartnerLogos,
  // lib/digital-cards/logos.ts, que trata [] do mesmo jeito) — mesmo
  // fallback usado na renderização pública.
  const [selectedLogos, setSelectedLogos] = useState<string[]>(
    card.selectedLogos.length > 0 ? card.selectedLogos : DEFAULT_SELECTED_LOGOS,
  );
  const [links, setLinks] = useState<LinkRow[]>(card.links.map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url })));
  const [photoUrl, setPhotoUrl] = useState(card.photoUrl);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(card.coverPhotoUrl);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [backgroundPhotoUrl, setBackgroundPhotoUrl] = useState(card.backgroundPhotoUrl);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  // "Manter padrão para todos" (só OWNER, só capa/fundo — ver
  // lib/digital-cards/config.ts pro porquê da foto de perfil ficar de fora)
  // — mesmo espírito de handleToggleActive acima: ação PRÓPRIA e imediata,
  // não depende do botão "Salvar alterações" lá embaixo.
  const [orgDefaultCover, setOrgDefaultCover] = useState(orgDefaultsSet.cover);
  const [orgDefaultBackground, setOrgDefaultBackground] = useState(orgDefaultsSet.background);
  const [settingDefaultField, setSettingDefaultField] = useState<"cover" | "background" | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);
  useLockBodyScroll(showFullscreenPreview);

  function buildSavedFields(): SavedFields {
    return {
      jobTitle: jobTitle.trim() || null,
      bio: bio.trim() || null,
      companyName: companyName.trim() || null,
      emailOverride: emailOverride.trim() || null,
      phone: phone.trim() || null,
      whatsapp: whatsapp.trim() || null,
      address: address.trim() || null,
      showPortfolioValue,
      portfolioValueDisplay: portfolioValueDisplay.trim() || null,
      selectedLogos,
      links: links.filter((l) => l.label.trim() && l.url.trim()).map((l) => ({ type: l.type, label: l.label.trim(), url: l.url.trim() })),
    };
  }

  // Snapshot do que já está salvo de verdade no banco — computado uma vez
  // (a partir do próprio `card`, então bate exatamente com buildSavedFields()
  // no primeiro render) e atualizado de novo só depois de um Salvar bem
  // sucedido. `hasUnsavedChanges` é só comparar os dois — mais simples e
  // menos propenso a erro do que rastrear "sujeira" campo por campo.
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(buildSavedFields()));
  const hasUnsavedChanges = JSON.stringify(buildSavedFields()) !== savedSnapshot;

  /**
   * Ativar/desativar é uma ação PRÓPRIA e imediata (mesmo espírito das
   * fotos abaixo) — não fica esperando o consultor lembrar de rolar até o
   * fim e clicar "Salvar". router.refresh() reflete a mudança nas seções
   * que só aparecem com o cartão ativo (QR Code/Estatísticas, ver page.tsx
   * — Server Component, não sabe sozinho que o PATCH abaixo aconteceu).
   */
  async function handleToggleActive() {
    const next = !active;
    setActiveSaving(true);
    setActiveError(null);
    setActive(next);
    const res = await fetch(`/api/digital-cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    setActiveSaving(false);
    if (!res.ok) {
      setActive(!next);
      const data = await res.json().catch(() => ({}));
      setActiveError(data.error ?? "Não deu pra mudar agora — tenta de novo.");
      return;
    }
    router.refresh();
  }

  function moveLogoLeft(index: number) {
    if (index <= 0) return;
    setSelectedLogos((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  }

  function moveLogoRight(index: number) {
    if (index >= selectedLogos.length - 1) return;
    setSelectedLogos((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  }

  function toggleLogo(key: string) {
    if (key === "reobote") return; // Logo da Reobote é obrigatória e sempre fixa
    setSelectedLogos((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      } else {
        return [...prev, key];
      }
    });
  }

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, targetIndex: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    setSelectedLogos((prev) => {
      const next = [...prev];
      const draggedItem = next[draggedIndex];
      next.splice(draggedIndex, 1);
      next.splice(targetIndex, 0, draggedItem);
      return next;
    });
    setDraggedIndex(targetIndex);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
  }

  function handleTouchStart(index: number) {
    setDraggedIndex(index);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (draggedIndex === null) return;
    const touch = e.touches[0];
    if (!touch) return;

    const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
    const itemCard = targetElement?.closest("[data-logo-index]") as HTMLElement | null;

    if (itemCard) {
      const targetIndex = Number(itemCard.getAttribute("data-logo-index"));
      if (!isNaN(targetIndex) && targetIndex !== draggedIndex) {
        setSelectedLogos((prev) => {
          const next = [...prev];
          const draggedItem = next[draggedIndex];
          next.splice(draggedIndex, 1);
          next.splice(targetIndex, 0, draggedItem);
          return next;
        });
        setDraggedIndex(targetIndex);
      }
    }
  }

  function handleTouchEnd() {
    setDraggedIndex(null);
  }

  function addLink() {
    setLinks((prev) => [...prev, { id: `new-${Date.now()}`, type: "INSTAGRAM", label: "", url: "" }]);
  }
  function updateLink(id: string, patch: Partial<LinkRow>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  // Estado do Modal de Corte Profissional
  const [cropModal, setCropModal] = useState<{
    open: boolean;
    type: "photo" | "cover" | "background" | null;
    imageSrc: string | null;
    aspectRatio: number;
    title: string;
  }>({
    open: false,
    type: null,
    imageSrc: null,
    aspectRatio: 2.5,
    title: "Ajustar Foto",
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, type: "photo" | "cover" | "background") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCropModal({
          open: true,
          type,
          imageSrc: reader.result,
          aspectRatio: type === "photo" ? 1 : type === "cover" ? 2.5 : 9 / 16,
          title:
            type === "photo"
              ? "Corte Profissional — Foto de Perfil"
              : type === "cover"
              ? "Corte Profissional — Foto de Capa"
              : "Corte Profissional — Foto de Fundo",
        });
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleCroppedUpload(blob: Blob) {
    if (!cropModal.type) return;
    const type = cropModal.type;
    setCropModal((prev) => ({ ...prev, open: false }));

    const file = new File([blob], `${type}-cropped.jpg`, { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);

    if (type === "photo") {
      setUploadingPhoto(true);
      setError(null);
      const res = await fetch(`/api/digital-cards/${card.id}/photo`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      setUploadingPhoto(false);
      if (!res.ok) setError(data.error ?? "Erro ao enviar foto de perfil");
      else setPhotoUrl(data.photoUrl);
    } else if (type === "cover") {
      setUploadingCover(true);
      setError(null);
      const res = await fetch(`/api/digital-cards/${card.id}/cover`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      setUploadingCover(false);
      if (!res.ok) setError(data.error ?? "Erro ao enviar foto de capa");
      else setCoverPhotoUrl(data.coverPhotoUrl);
    } else if (type === "background") {
      setUploadingBackground(true);
      setError(null);
      const res = await fetch(`/api/digital-cards/${card.id}/background`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      setUploadingBackground(false);
      if (!res.ok) setError(data.error ?? "Erro ao enviar foto de fundo");
      else setBackgroundPhotoUrl(data.backgroundPhotoUrl);
    }
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFileSelect(e, "photo");
  }

  async function handleRemovePhoto() {
    setUploadingPhoto(true);
    setError(null);
    const res = await fetch(`/api/digital-cards/${card.id}/photo`, { method: "DELETE" });
    setUploadingPhoto(false);
    if (res.ok) setPhotoUrl(null);
  }

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFileSelect(e, "cover");
  }

  async function handleRemoveCover() {
    setUploadingCover(true);
    setError(null);
    const res = await fetch(`/api/digital-cards/${card.id}/cover`, { method: "DELETE" });
    setUploadingCover(false);
    if (res.ok) setCoverPhotoUrl(null);
  }

  function handleBackgroundChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFileSelect(e, "background");
  }

  async function handleRemoveBackground() {
    setUploadingBackground(true);
    setError(null);
    const res = await fetch(`/api/digital-cards/${card.id}/background`, { method: "DELETE" });
    setUploadingBackground(false);
    if (res.ok) setBackgroundPhotoUrl(null);
  }

  /** Promove a foto ATUAL de capa/fundo deste cartão a padrão de quem ainda não subiu uma própria (ver POST em app/api/digital-cards/org-defaults/[field]/route.ts). */
  async function handleSetOrgDefault(field: "cover" | "background") {
    setSettingDefaultField(field);
    setDefaultError(null);
    const res = await fetch(`/api/digital-cards/org-defaults/${field}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setSettingDefaultField(null);
    if (!res.ok) {
      setDefaultError(data.error ?? "Não foi possível definir como padrão agora.");
      return;
    }
    if (field === "cover") setOrgDefaultCover(true);
    else setOrgDefaultBackground(true);
  }

  /** Deixa de ser o padrão da equipe — não apaga a foto do SEU cartão, só o compartilhamento com quem ainda não subiu uma própria. */
  async function handleClearOrgDefault(field: "cover" | "background") {
    setSettingDefaultField(field);
    setDefaultError(null);
    const res = await fetch(`/api/digital-cards/org-defaults/${field}`, { method: "DELETE" });
    setSettingDefaultField(null);
    if (!res.ok) {
      setDefaultError("Não foi possível remover o padrão agora.");
      return;
    }
    if (field === "cover") setOrgDefaultCover(false);
    else setOrgDefaultBackground(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const fields = buildSavedFields();
    const res = await fetch(`/api/digital-cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, links: links.map((l, i) => ({ type: l.type, label: l.label, url: l.url, order: i })) }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao salvar");
      return;
    }
    setSavedSnapshot(JSON.stringify(fields));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // sem fallback melhor sem um input visível
    }
  }

  const previewData: DigitalCardData = {
    slug: card.slug,
    displayName: card.displayName,
    jobTitle: jobTitle.trim() || null,
    companyName: companyName.trim() || null,
    bio: bio.trim() || null,
    photoUrl,
    coverPhotoUrl,
    backgroundPhotoUrl,
    phone: displayPhone(phone.trim() || null),
    whatsapp: displayPhone(whatsapp.trim() || null),
    displayEmail: emailOverride.trim() || card.user.email,
    address: address.trim() || null,
    showPortfolioValue,
    portfolioValueDisplay: portfolioValueDisplay.trim() || null,
    selectedLogos,
    links: links.filter((l) => l.label.trim() && l.url.trim()),
    publicUrl,
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_345px] lg:items-start">
      <div className="space-y-4">
        {/* Status do cartão — a decisão mais importante da página, por isso
            fica sozinha no topo, com linguagem direta ("está no ar" / "não
            está visível") em vez de um checkbox técnico "ativo". Ação
            imediata (ver handleToggleActive) — nunca depende do botão
            Salvar lá embaixo. */}
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <span className="relative mt-0.5 flex h-2.5 w-2.5 shrink-0">
              {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${active ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {active ? "Seu cartão está no ar" : "Seu cartão ainda não está visível"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                {active
                  ? "Qualquer pessoa com o link ou o QR Code consegue ver — desative se precisar tirar do ar."
                  : "Ninguém consegue acessar ainda, nem quem já tem o link. Ative quando estiver pronto pra mostrar."}
              </p>
              {activeError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{activeError}</p>}
            </div>
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={activeSaving}
              className={active ? "btn-secondary btn-sm shrink-0" : "btn-primary btn-sm shrink-0"}
            >
              {activeSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <Power className="h-3.5 w-3.5" strokeWidth={2.5} />}
              {active ? "Desativar" : "Ativar cartão"}
            </button>
          </div>

          {active && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
              <span className="min-w-0 flex-1 truncate">{publicUrl}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={handleCopyLink} title="Copiar link" className="icon-btn h-6 w-6">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir cartão"
                  className="icon-btn flex h-6 w-6 items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Fotos — as 3 juntas num único bloco (antes eram 3 cards
            separados, ocupando a tela toda de rolagem) com o que cada uma
            faz explicado de cara. Sobem na hora do upload — nenhuma delas
            depende do botão "Salvar" lá embaixo. */}
        <div className="card p-4 space-y-4">
          <p className="field-label text-sm font-semibold">Fotos do cartão</p>

          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <Avatar name={card.displayName} src={photoUrl} size="lg" />
              {uploadingPhoto && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" strokeWidth={2} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Sua foto</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="h-3.5 w-3.5" strokeWidth={2} />
                  {photoUrl ? "Trocar" : "Adicionar"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingPhoto} onChange={handlePhotoChange} />
                </label>
                {photoUrl && (
                  <button type="button" onClick={handleRemovePhoto} disabled={uploadingPhoto} className="btn-ghost btn-sm">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-neutral-100 dark:border-neutral-800" />

          <div className="flex items-center gap-3">
            <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
              {coverPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverPhotoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-neutral-400 dark:text-neutral-500">Sem capa</div>
              )}
              {uploadingCover && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" strokeWidth={2} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Capa</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="h-3.5 w-3.5" strokeWidth={2} />
                  {coverPhotoUrl ? "Trocar" : "Adicionar"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingCover} onChange={handleCoverChange} />
                </label>
                {coverPhotoUrl && (
                  <button type="button" onClick={handleRemoveCover} disabled={uploadingCover} className="btn-ghost btn-sm">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    Remover
                  </button>
                )}
              </div>
              {isOwner && (
                <OrgDefaultControl
                  field="cover"
                  hasOwnPhoto={!!coverPhotoUrl}
                  isDefault={orgDefaultCover}
                  busy={settingDefaultField === "cover"}
                  onSet={() => handleSetOrgDefault("cover")}
                  onClear={() => handleClearOrgDefault("cover")}
                />
              )}
            </div>
          </div>

          <div className="border-t border-neutral-100 dark:border-neutral-800" />

          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
              {backgroundPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={backgroundPhotoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-neutral-400 dark:text-neutral-500">Sem fundo</div>
              )}
              {uploadingBackground && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" strokeWidth={2} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Fundo</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="h-3.5 w-3.5" strokeWidth={2} />
                  {backgroundPhotoUrl ? "Trocar" : "Adicionar"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingBackground} onChange={handleBackgroundChange} />
                </label>
                {backgroundPhotoUrl && (
                  <button type="button" onClick={handleRemoveBackground} disabled={uploadingBackground} className="btn-ghost btn-sm">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    Remover
                  </button>
                )}
              </div>
              {isOwner && (
                <OrgDefaultControl
                  field="background"
                  hasOwnPhoto={!!backgroundPhotoUrl}
                  isDefault={orgDefaultBackground}
                  busy={settingDefaultField === "background"}
                  onSet={() => handleSetOrgDefault("background")}
                  onClear={() => handleClearOrgDefault("background")}
                />
              )}
            </div>
          </div>

          {isOwner && defaultError && <p className="text-xs text-red-600 dark:text-red-400">{defaultError}</p>}
        </div>

        {/* Como você aparece — cargo/empresa/bio. Pedido explícito: "não
            precisa de tantas descrições para os campos, só o nome dos
            campos mesmo" — a pré-visualização ao vivo ao lado já mostra
            onde cada campo aparece, sem precisar de legenda explicando. */}
        <div className="card space-y-4 p-4">
          <p className="field-label text-sm font-semibold">Como você aparece</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="field-label">Seu cargo</label>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Consultor de Vendas" className="field-input" />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {JOB_TITLE_OPTIONS.map((title) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => setJobTitle(title)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                      jobTitle === title
                        ? "bg-[#00aeee]/15 border-[#00aeee] text-[#00aeee]"
                        : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    }`}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Empresa</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="field-input" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="field-label">Uma frase sua (opcional)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              className="field-input italic"
              placeholder="Inteligência em Consórcios"
            />
          </div>
        </div>

        {/* Logos parceiras (Administradoras) */}
        <div className="card space-y-4 p-4">
          <div>
            <p className="field-label text-sm font-semibold">Logos das administradoras</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Toque numa marca pra ligar/desligar. Arraste (ou use as setas) pra mudar a ordem que elas aparecem no cartão.
            </p>
          </div>

          {/* Lista ordenada atual (apenas administradoras parceiras) */}
          <div className="space-y-2">
            {(() => {
              const adminLogos = selectedLogos.filter((k) => k !== "reobote");
              return (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Aparecem no cartão, nesta ordem ({adminLogos.length})
                  </p>
                  {adminLogos.length === 0 ? (
                    <p className="text-xs text-neutral-400 italic py-2">Nenhuma administradora selecionada — escolha abaixo pra mostrar no cartão.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {adminLogos.map((key, index) => {
                        const logoInfo = AVAILABLE_PARTNER_LOGOS.find((l) => l.key === key);
                        if (!logoInfo) return null;
                        const isDragging = draggedIndex === index;
                        return (
                          <div
                            key={key}
                            data-logo-index={index}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDragEnd={handleDragEnd}
                            onTouchStart={() => handleTouchStart(index)}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium cursor-grab active:cursor-grabbing transition-all select-none ${
                              isDragging
                                ? "border-[#00aeee] bg-[#00aeee]/20 shadow-lg ring-2 ring-[#00aeee]/40 scale-[1.02]"
                                : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-800/60 dark:hover:border-neutral-700"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <GripVertical className="h-4 w-4 shrink-0 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-grab active:cursor-grabbing" />
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#00aeee]/15 text-[10px] font-bold text-[#00aeee]">
                                {index + 1}
                              </span>
                              <span className="font-semibold text-neutral-800 dark:text-neutral-200 truncate">{logoInfo.label}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => moveLogoLeft(index)}
                                disabled={index === 0}
                                title="Mover para frente"
                                className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveLogoRight(index)}
                                disabled={index === adminLogos.length - 1}
                                title="Mover para trás"
                                className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleLogo(key)}
                                title="Remover logo do cartão"
                                className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Seletor de logos disponíveis (apenas administradoras) */}
          <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Todas as marcas disponíveis</p>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_PARTNER_LOGOS.filter((l) => l.key !== "reobote").map((logo) => {
                const isSelected = selectedLogos.includes(logo.key);
                return (
                  <button
                    key={logo.key}
                    type="button"
                    onClick={() => toggleLogo(logo.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-all ${
                      isSelected
                        ? "border-[#00aeee] bg-[#00aeee]/15 text-[#00aeee] font-semibold"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
                    }`}
                  >
                    <span>{logo.label}</span>
                    {isSelected ? <Check className="h-3 w-3 text-[#00aeee]" /> : <Plus className="h-3 w-3 text-neutral-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Como o cliente fala com você */}
        <div className="card space-y-4 p-4">
          <p className="field-label text-sm font-semibold">Como o cliente fala com você</p>
          <div className="space-y-1.5">
            <label className="field-label">WhatsApp</label>
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(67) 99999-9999" className="field-input" />
          </div>



          <div className="space-y-1.5">
            <label className="field-label">E-mail</label>
            <input value={emailOverride} onChange={(e) => setEmailOverride(e.target.value)} placeholder={card.user.email} className="field-input" />
          </div>

          <div className="space-y-1.5">
            <label className="field-label">Endereço</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="field-input" />
          </div>
        </div>

        {/* Valor em carteira */}
        <div className="card space-y-2 p-4">
          <p className="field-label text-sm font-semibold">Carteira sob gestão (opcional)</p>
          <label className="flex items-center gap-2 pt-1 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={showPortfolioValue}
              onChange={(e) => setShowPortfolioValue(e.target.checked)}
              className="accent-neutral-900 dark:accent-white"
            />
            Mostrar esse destaque no cartão
          </label>
          {showPortfolioValue && (
            <input
              value={portfolioValueDisplay}
              onChange={(e) => setPortfolioValueDisplay(e.target.value)}
              placeholder="+R$ 5 milhões"
              className="field-input"
            />
          )}
        </div>

        {/* Links adicionais */}
        <div className="card space-y-2 p-4">
          <p className="field-label text-sm font-semibold">Redes sociais e outros links</p>
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-2 pt-1">
              <Select
                value={link.type}
                onChange={(v) => updateLink(link.id, { type: v })}
                options={LINK_TYPE_OPTIONS}
                className="w-32 shrink-0 py-1.5 text-sm"
              />
              <input
                value={link.label}
                onChange={(e) => updateLink(link.id, { label: e.target.value })}
                placeholder="Nome do botão"
                className="field-input min-w-0 flex-1 px-2 py-1.5 text-sm"
              />
              <input
                value={link.url}
                onChange={(e) => updateLink(link.id, { url: e.target.value })}
                placeholder="https://..."
                className="field-input min-w-0 flex-[1.5] px-2 py-1.5 text-sm"
              />
              <button type="button" onClick={() => removeLink(link.id)} className="icon-btn h-7 w-7 shrink-0" aria-label="Remover link">
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addLink}
            className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            Adicionar link
          </button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="button" onClick={handleSave} disabled={saving || (!hasUnsavedChanges && !saved)} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {saved ? "Salvo!" : saving ? "Salvando..." : hasUnsavedChanges ? "Salvar alterações" : "Tudo salvo"}
          </button>
          {hasUnsavedChanges && !saving && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Você tem alterações não salvas nesta seção.</span>
          )}
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          As fotos (acima) e o botão "Ativar cartão" (no topo) já salvam sozinhos, na hora — este botão é só pro resto: cargo, contato, logos, carteira e links.
        </p>
      </div>

      <div className="lg:sticky lg:top-4">
        <div className="mx-auto mb-3 flex w-fit items-center justify-center gap-2">
          <div className="flex items-center justify-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 backdrop-blur-md shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span>Pré-visualização ao vivo</span>
          </div>

          <button
            type="button"
            onClick={() => setShowFullscreenPreview(true)}
            className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 transition-colors"
            title="Expandir pré-visualização em tela cheia"
          >
            <Maximize2 className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
            <span>Tela Cheia</span>
          </button>
        </div>

        <div className="select-none">
          <PhonePreviewFrame>
            <DigitalCardView data={previewData} interactive={false} />
          </PhonePreviewFrame>
        </div>
      </div>

      {/* Modal de Pré-visualização em Tela Cheia */}
      {showFullscreenPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
          <div className="relative my-auto flex w-full max-w-sm flex-col items-center py-4">
            <button
              type="button"
              onClick={() => setShowFullscreenPreview(false)}
              className="mb-3 flex items-center gap-1.5 rounded-full bg-white/20 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/30 transition-colors shadow-lg backdrop-blur-md"
            >
              <X className="h-4 w-4" />
              <span>Fechar Tela Cheia</span>
            </button>
            <div className="w-full">
              {/* interactive=false — igual ao preview pequeno ao lado (é o
                  MESMO objetivo, só maior). Corrigido: estava true aqui,
                  então abrir "Tela Cheia" e tocar em qualquer botão navegava
                  de verdade pro vCard/WhatsApp/e-mail/mapa (perdendo edição
                  não salva) e gravava DigitalCardEvent reais contra o
                  próprio cartão — poluindo as estatísticas que deveriam
                  refletir só visitante de verdade. */}
              <PhonePreviewFrame>
                <DigitalCardView data={previewData} interactive={false} />
              </PhonePreviewFrame>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Recorte Profissional de Imagem */}
      <ImageCropModal
        isOpen={cropModal.open}
        imageSrc={cropModal.imageSrc}
        title={cropModal.title}
        aspectRatio={cropModal.aspectRatio}
        onClose={() => setCropModal((prev) => ({ ...prev, open: false }))}
        onCropComplete={handleCroppedUpload}
      />
    </div>
  );
}

/**
 * "Manter padrão para todos" — só OWNER (ver isOwner em CardEditor), só
 * capa/fundo (nunca a foto de perfil, ver lib/digital-cards/config.ts).
 * Duas linhas de texto pra deixar bem claro o que o botão faz antes de
 * clicar: quem ainda não subiu uma foto própria nesse campo passa a ver
 * ESTA aqui, no lugar do gradiente abstrato — pedido explícito: "a imagem
 * que eu escolher vira padrão".
 */
function OrgDefaultControl({
  field,
  hasOwnPhoto,
  isDefault,
  busy,
  onSet,
  onClear,
}: {
  field: "cover" | "background";
  hasOwnPhoto: boolean;
  isDefault: boolean;
  busy: boolean;
  onSet: () => void;
  onClear: () => void;
}) {
  if (isDefault) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1">É o padrão de quem ainda não subiu {field === "cover" ? "capa" : "fundo"} própria.</span>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="shrink-0 font-medium text-neutral-400 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-500 dark:hover:text-neutral-200"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} /> : "Remover"}
        </button>
      </div>
    );
  }

  if (!hasOwnPhoto) return null; // nada pra promover ainda — botão volta quando subir uma foto (ver hasOwnPhoto)

  return (
    <button
      type="button"
      onClick={onSet}
      disabled={busy}
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-100"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Users className="h-3.5 w-3.5" strokeWidth={2} />}
      Manter padrão para todos
    </button>
  );
}
