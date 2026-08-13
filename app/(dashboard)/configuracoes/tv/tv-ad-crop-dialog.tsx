"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { TV_AD_ASPECT_RATIO } from "./tv-ad-aspect";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("Não foi possível ler a imagem.")));
    img.src = src;
  });
}

/** Recorta a área escolhida direto no canvas, no tamanho de pixel real do
 * corte (não do preview na tela) — usa os próprios pixels da imagem
 * original, então o resultado sai na resolução cheia, não a resolução
 * reduzida que o navegador usou só pra desenhar o preview. Sempre exporta
 * como JPEG (independente do formato enviado) — imagem de propaganda não
 * precisa de transparência, e JPEG fica bem menor que PNG pro mesmo
 * tamanho, o que importa aqui: a TV baixa essa imagem de novo a cada vez
 * que troca de organização/reinicia. */
async function cropImageToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width);
  canvas.height = Math.round(area.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas não suportado.");
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar a imagem cortada."))),
      "image/jpeg",
      0.92,
    );
  });
}

/**
 * Ferramenta de corte pro upload de propaganda da TV — abre ANTES do envio
 * (ver tv-config-form.tsx), trava a proporção do corte na área real da TV
 * (TV_AD_ASPECT_RATIO, ver tv-ad-aspect.ts), pra quem está montando a
 * propaganda já ver exatamente como ela vai aparecer, em vez de descobrir
 * depois que ficou cortada estranho num pedaço importante da imagem.
 */
export function TvAdCropDialog({
  imageSrc,
  onCancel,
  onConfirm,
}: {
  imageSrc: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropImageToBlob(imageSrc, croppedAreaPixels);
      // onConfirm (uploadCroppedAd, em tv-config-form.tsx) lança erro em vez
      // de engolir — a mensagem de verdade (ex.: "Arquivo maior que 10MB")
      // chega até aqui e aparece dentro do próprio diálogo, que é o único
      // lugar visível enquanto o Modal estiver por cima da tela inteira.
      await onConfirm(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cortar/enviar a imagem. Tente novamente.");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onCancel} maxWidth="max-w-2xl">
      <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Ajustar propaganda</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        A área marcada é exatamente o formato da tela de propaganda na TV — arraste pra reposicionar e use o zoom
        pra ajustar o enquadramento.
      </p>

      <div className="relative mt-4 h-[420px] w-full overflow-hidden rounded-md bg-neutral-900">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={TV_AD_ASPECT_RATIO}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={handleCropComplete}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1 accent-blue-600"
        />
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || !croppedAreaPixels}
          className="btn-primary"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "Enviando..." : "Cortar e enviar"}
        </button>
      </div>
    </Modal>
  );
}
