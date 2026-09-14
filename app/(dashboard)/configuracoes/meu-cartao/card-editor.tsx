"use client";

import { useState } from "react";
import { Loader2, Plus, X, Camera, Trash2, Copy, Check, Maximize2 } from "lucide-react";
import { Select } from "@/components/select";
import { Avatar } from "@/components/avatar";
import { DigitalCardView, type DigitalCardData } from "@/components/digital-card/digital-card-view";
import { PhonePreviewFrame } from "@/components/digital-card/phone-preview-frame";
import { displayPhone } from "@/lib/phone-normalize";
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
 * Seções separadas em cards (mesmo padrão de configuracoes/perfil/page.tsx
 * — vários ".card p-4" empilhados, não um bloco único) e foto/e-mail/cargo
 * com o MESMO tratamento visual já usado no resto do CRM: componente
 * Avatar (components/avatar.tsx, cai pras iniciais coloridas sem foto —
 * nunca um círculo cinza vazio) + botão "Trocar/Adicionar foto" no mesmo
 * estilo de ProfileAvatarForm (configuracoes/perfil/profile-avatar-form.tsx).
 */
export function CardEditor({ card, publicUrl }: { card: NonNullable<Card>; publicUrl: string }) {
  const [active, setActive] = useState(card.active);
  const [jobTitle, setJobTitle] = useState(card.jobTitle ?? "");
  const [bio, setBio] = useState(card.bio ?? "");
  const [companyName, setCompanyName] = useState(card.companyName ?? "");
  const [emailOverride, setEmailOverride] = useState(card.emailOverride ?? "");
  const [phone, setPhone] = useState(card.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(card.whatsapp ?? "");
  const [address, setAddress] = useState(card.address ?? "");
  const [showPortfolioValue, setShowPortfolioValue] = useState(card.showPortfolioValue);
  const [portfolioValueDisplay, setPortfolioValueDisplay] = useState(card.portfolioValueDisplay ?? "");
  const [links, setLinks] = useState<LinkRow[]>(card.links.map((l) => ({ id: l.id, type: l.type, label: l.label, url: l.url })));
  const [photoUrl, setPhotoUrl] = useState(card.photoUrl);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [coverPhotoUrl, setCoverPhotoUrl] = useState(card.coverPhotoUrl);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);

  function addLink() {
    setLinks((prev) => [...prev, { id: `new-${Date.now()}`, type: "INSTAGRAM", label: "", url: "" }]);
  }
  function updateLink(id: string, patch: Partial<LinkRow>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/digital-cards/${card.id}/photo`, { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    setUploadingPhoto(false);
    if (!res.ok) {
      setError(data.error ?? "Erro ao enviar foto");
      return;
    }
    setPhotoUrl(data.photoUrl);
  }

  async function handleRemovePhoto() {
    setUploadingPhoto(true);
    setError(null);
    const res = await fetch(`/api/digital-cards/${card.id}/photo`, { method: "DELETE" });
    setUploadingPhoto(false);
    if (res.ok) setPhotoUrl(null);
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingCover(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/digital-cards/${card.id}/cover`, { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    setUploadingCover(false);
    if (!res.ok) {
      setError(data.error ?? "Erro ao enviar foto de capa");
      return;
    }
    setCoverPhotoUrl(data.coverPhotoUrl);
  }

  async function handleRemoveCover() {
    setUploadingCover(true);
    setError(null);
    const res = await fetch(`/api/digital-cards/${card.id}/cover`, { method: "DELETE" });
    setUploadingCover(false);
    if (res.ok) setCoverPhotoUrl(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const res = await fetch(`/api/digital-cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        active,
        jobTitle: jobTitle.trim() || null,
        bio: bio.trim() || null,
        companyName: companyName.trim() || null,
        emailOverride: emailOverride.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        address: address.trim() || null,
        showPortfolioValue,
        portfolioValueDisplay: portfolioValueDisplay.trim() || null,
        links: links.map((l, i) => ({ type: l.type, label: l.label, url: l.url, order: i })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao salvar");
      return;
    }
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
    phone: displayPhone(phone.trim() || null),
    whatsapp: displayPhone(whatsapp.trim() || null),
    displayEmail: emailOverride.trim() || card.user.email,
    address: address.trim() || null,
    showPortfolioValue,
    portfolioValueDisplay: portfolioValueDisplay.trim() || null,
    links: links.filter((l) => l.label.trim() && l.url.trim()),
    publicUrl,
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_345px] lg:items-start">
      <div className="space-y-4">
        {/* Ativação + link público */}
        <div className="card space-y-3 p-4">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">Cartão ativo</span>
              <span className="block text-xs text-neutral-400 dark:text-neutral-500">
                Desativado, o link público mostra "cartão não encontrado".
              </span>
            </span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-neutral-900 dark:accent-white"
            />
          </label>

          {active && (
            <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
              <span className="min-w-0 flex-1 truncate">{publicUrl}</span>
              <button type="button" onClick={handleCopyLink} className="icon-btn h-6 w-6 shrink-0">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          )}
        </div>

        {/* Foto — mesmo padrão visual do avatar de perfil (Avatar + botão Trocar/Remover). */}
        <div className="card p-4">
          <p className="field-label mb-3">Foto do cartão</p>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <Avatar name={card.displayName} src={photoUrl} size="xl" />
              {uploadingPhoto && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <Loader2 className="h-5 w-5 animate-spin text-white" strokeWidth={2} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Sem foto própria, o cartão usa a foto do seu perfil. JPEG, PNG ou WebP · até 10MB.
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Camera className="h-3.5 w-3.5" strokeWidth={2} />
                  {photoUrl ? "Trocar foto" : "Adicionar foto"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={uploadingPhoto}
                    onChange={handlePhotoChange}
                  />
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
        </div>

        {/* Foto de capa (banner do topo) — opcional, por cartão. Sem ela,
            cai pro padrão da organização (quando configurado, ver
            lib/digital-cards/config.ts) ou pro gradiente abstrato. */}
        <div className="card p-4">
          <p className="field-label mb-3">Foto de capa</p>
          <div className="space-y-3">
            <div className="relative h-24 w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
              {coverPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverPhotoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-neutral-400 dark:text-neutral-500">
                  Sem foto de capa
                </div>
              )}
              {uploadingCover && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-5 w-5 animate-spin text-white" strokeWidth={2} />
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Aparece como banner atrás da sua foto, com um filtro escuro por cima (pro nome continuar legível). JPEG, PNG ou
              WebP · até 10MB.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="btn-secondary btn-sm cursor-pointer">
                <Camera className="h-3.5 w-3.5" strokeWidth={2} />
                {coverPhotoUrl ? "Trocar capa" : "Adicionar capa"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploadingCover}
                  onChange={handleCoverChange}
                />
              </label>
              {coverPhotoUrl && (
                <button type="button" onClick={handleRemoveCover} disabled={uploadingCover} className="btn-ghost btn-sm">
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Remover
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dados exibidos no cartão */}
        <div className="card space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="field-label">Cargo</label>
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Diretor Comercial" className="field-input" />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Empresa</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="field-input" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="field-label">Bio / descrição (opcional)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              className="field-input"
              placeholder="Soluções em consórcio e planejamento patrimonial"
            />
          </div>
        </div>

        {/* Contato */}
        <div className="card space-y-4 p-4">
          <p className="field-label">Contato</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="field-label">Telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(67) 99999-9999" className="field-input" />
            </div>
            <div className="space-y-1.5">
              <label className="field-label">WhatsApp</label>
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(67) 99999-9999" className="field-input" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="field-label">E-mail (padrão: {card.user.email})</label>
            <input value={emailOverride} onChange={(e) => setEmailOverride(e.target.value)} placeholder={card.user.email} className="field-input" />
          </div>

          <div className="space-y-1.5">
            <label className="field-label">Endereço (alimenta o botão "Mapa")</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="field-input" />
          </div>
        </div>

        {/* Valor em carteira */}
        <div className="card space-y-2 p-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={showPortfolioValue}
              onChange={(e) => setShowPortfolioValue(e.target.checked)}
              className="accent-neutral-900 dark:accent-white"
            />
            Mostrar valor em carteira
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
          <label className="field-label">Links adicionais</label>
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-2">
              <Select
                value={link.type}
                onChange={(v) => updateLink(link.id, { type: v })}
                options={LINK_TYPE_OPTIONS}
                className="w-32 shrink-0 py-1.5 text-sm"
              />
              <input
                value={link.label}
                onChange={(e) => updateLink(link.id, { label: e.target.value })}
                placeholder="Título"
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

        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          {saved ? "Salvo!" : saving ? "Salvando..." : "Salvar"}
        </button>
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
              <PhonePreviewFrame>
                <DigitalCardView data={previewData} interactive={true} />
              </PhonePreviewFrame>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

