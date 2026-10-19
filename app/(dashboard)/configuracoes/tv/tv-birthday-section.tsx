"use client";

import { useRef, useState } from "react";
import { Cake, Eye, Loader2, Trash2, Upload } from "lucide-react";
import { Modal } from "@/components/modal";
import { TvBirthdaySlide } from "@/app/tv/tv-birthday-slide";
import { saveTvBirthdayImage, saveTvBirthdayUseDefault } from "./actions";
import { TvAdCropDialog } from "./tv-ad-crop-dialog";
import { TV_AD_ASPECT_RATIO } from "./tv-ad-aspect";
import type { TvBirthdaySlideConfig } from "@/lib/tv-birthday";

type Member = { id: string; name: string; birthDay: number | null; birthMonth: number | null };

/** Xadrez atrás da foto recortada — deixa claro o que é transparente. */
const CHECKERBOARD = {
  backgroundImage:
    "linear-gradient(45deg,#e5e5e5 25%,transparent 25%),linear-gradient(-45deg,#e5e5e5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e5e5 75%),linear-gradient(-45deg,transparent 75%,#e5e5e5 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
};

async function uploadImage(file: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file, filename);
  const res = await fetch("/api/tv/ads", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Erro ao enviar imagem");
  return data.url as string;
}

/**
 * Aniversário na TV — no dia do aniversário (User.birthDate), o consultor
 * aparece como mais uma "foto" no carrossel de propagandas: a foto dele
 * recortada (PNG sem fundo) por cima do fundo padrão daqui. Cada envio salva
 * na hora (ver saveTvBirthdayImage).
 */
export function TvBirthdaySection({
  initial,
  members,
  todayDay,
  todayMonth,
}: {
  initial: TvBirthdaySlideConfig;
  members: Member[];
  /** Dia/mês de hoje no fuso de Campo Grande — marca quem faz aniversário hoje. */
  todayDay: number;
  todayMonth: number;
}) {
  const [backgroundUrl, setBackgroundUrl] = useState(initial.backgroundUrl);
  const [photos, setPhotos] = useState(initial.photos);
  const [useDefault, setUseDefault] = useState(initial.useDefaultBackground);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingBackground, setPendingBackground] = useState<string | null>(null);
  // Pré-visualização do slide (mesmo componente da TV) — qualquer dia, não só no aniversário.
  const [preview, setPreview] = useState<{ name: string; photoUrl: string } | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  async function save(userId: string | undefined, url: string | null) {
    const result = await saveTvBirthdayImage({ userId, url });
    if (!result.success) throw new Error(result.error);
  }

  // Fundo passa pelo mesmo corte das propagandas — sai exatamente no
  // formato do quadro da TV.
  async function confirmBackground(blob: Blob) {
    const url = await uploadImage(blob, "fundo-aniversario.jpg");
    await save(undefined, url);
    setBackgroundUrl(url);
    setUseDefault(false);
    closeBackgroundCrop();
  }

  function closeBackgroundCrop() {
    if (pendingBackground) URL.revokeObjectURL(pendingBackground);
    setPendingBackground(null);
  }

  async function toggleUseDefault(next: boolean) {
    setBusy("default");
    setError(null);
    setUseDefault(next);
    const result = await saveTvBirthdayUseDefault(next);
    if (!result.success) {
      setUseDefault(!next);
      setError(result.error);
    }
    setBusy(null);
  }

  async function removeBackground() {
    setBusy("background");
    setError(null);
    try {
      await save(undefined, null);
      setBackgroundUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover");
    } finally {
      setBusy(null);
    }
  }

  // Foto do consultor sobe SEM corte nem conversão: um recorte em JPEG
  // perderia a transparência, que é justamente o que faz ele "flutuar" sobre
  // o fundo.
  async function changePhoto(userId: string, file: File | undefined) {
    if (!file) return;
    setBusy(userId);
    setError(null);
    try {
      const url = await uploadImage(file, file.name);
      await save(userId, url);
      setPhotos((prev) => ({ ...prev, [userId]: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto(userId: string) {
    setBusy(userId);
    setError(null);
    try {
      await save(userId, null);
      setPhotos((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover");
    } finally {
      setBusy(null);
    }
  }

  // Quem tem aniversário cadastrado primeiro, na ordem do ano a partir de hoje.
  const daysUntil = (m: Member) => {
    if (!m.birthMonth || !m.birthDay) return Number.POSITIVE_INFINITY;
    const today = todayMonth * 100 + todayDay;
    const birthday = m.birthMonth * 100 + m.birthDay;
    return birthday >= today ? birthday - today : birthday + 1300 - today;
  };
  const sorted = [...members].sort((a, b) => daysUntil(a) - daysUntil(b) || a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <Cake className="h-5 w-5 text-neutral-500" />
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Aniversário na TV</h2>
        </div>
        <p className="-mt-4 text-sm text-neutral-500 dark:text-neutral-400">
          No dia do aniversário, o consultor aparece entre as propagandas, com a foto dele sobre o fundo.
        </p>

        {/* Fundo padrão */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Fundo</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              Usar fundo padrão
              <button
                type="button"
                role="switch"
                aria-checked={useDefault}
                disabled={busy === "default"}
                onClick={() => toggleUseDefault(!useDefault)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${useDefault ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-600"}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${useDefault ? "translate-x-[22px]" : "translate-x-0.5"}`} />
              </button>
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div
              style={{
                aspectRatio: TV_AD_ASPECT_RATIO,
                background: "radial-gradient(ellipse 55% 60% at 85% 0%, #49d6f7 0%, rgba(73,214,247,0) 70%), linear-gradient(180deg, #0b5a92 0%, #083563 48%, #05182f 78%, #030c19 100%)",
              }}
              className="relative w-44 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {!useDefault && backgroundUrl && <img src={backgroundUrl} alt="Fundo do aniversário" className="h-full w-full object-cover" />}
              <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {useDefault || !backgroundUrl ? "Padrão" : "Sua foto"}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => backgroundInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              >
                <Upload className="h-4 w-4" />
                {backgroundUrl ? "Trocar fundo" : "Enviar fundo"}
              </button>
              {backgroundUrl && (
                <button
                  type="button"
                  onClick={removeBackground}
                  disabled={busy === "background"}
                  aria-label="Remover fundo"
                  className="rounded px-2.5 py-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <input
              ref={backgroundInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) setPendingBackground(URL.createObjectURL(file));
              }}
            />
          </div>
          {!useDefault && !backgroundUrl && (
            <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">Sem foto enviada, a TV usa o fundo padrão.</p>
          )}
        </div>

        {/* Foto recortada de cada consultor */}
        <div>
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Fotos dos consultores</p>
          <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">PNG com o fundo já cortado · até 10MB.</p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {sorted.map((m) => {
              const photo = photos[m.id];
              const isToday = m.birthDay === todayDay && m.birthMonth === todayMonth;
              return (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <div
                    className="relative h-14 w-12 shrink-0 overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-700"
                    style={photo ? CHECKERBOARD : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photo && <img src={photo} alt={m.name} className="h-full w-full object-contain object-bottom" />}
                    {busy === m.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {m.name}
                      {isToday && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          Hoje
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {m.birthDay && m.birthMonth
                        ? `${String(m.birthDay).padStart(2, "0")}/${String(m.birthMonth).padStart(2, "0")}`
                        : "Sem data de nascimento"}
                    </p>
                  </div>
                  <label
                    className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 ${busy ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {photo ? "Trocar" : "Enviar"}
                    <input
                      type="file"
                      accept="image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        changePhoto(m.id, file);
                      }}
                    />
                  </label>
                  {photo && (
                    <button
                      type="button"
                      onClick={() => setPreview({ name: m.name, photoUrl: photo })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver
                    </button>
                  )}
                  {photo && (
                    <button
                      type="button"
                      onClick={() => removePhoto(m.id)}
                      disabled={!!busy}
                      aria-label={`Remover foto de ${m.name}`}
                      className="shrink-0 rounded p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
            A data de nascimento vem de Configurações → Usuários.
          </p>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {preview && (
        <Modal onClose={() => setPreview(null)} maxWidth="max-w-3xl">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Como aparece na TV</h3>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{preview.name}</p>
          </div>
          {/* Mesmo formato do quadro de propaganda da TV. */}
          <div className="relative w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700" style={{ aspectRatio: TV_AD_ASPECT_RATIO }}>
            <TvBirthdaySlide name={preview.name} photoUrl={preview.photoUrl} backgroundUrl={useDefault ? null : backgroundUrl} />
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setPreview(null)} className="btn-ghost">
              Fechar
            </button>
          </div>
        </Modal>
      )}

      {pendingBackground && <TvAdCropDialog imageSrc={pendingBackground} onCancel={closeBackgroundCrop} onConfirm={confirmBackground} />}
    </div>
  );
}
