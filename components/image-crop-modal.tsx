"use client";

import { useState, useCallback } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { ZoomIn, ZoomOut, RotateCcw, Check, X, Crop as CropIcon } from "lucide-react";

type ImageCropModalProps = {
  isOpen: boolean;
  imageSrc: string | null;
  title?: string;
  aspectRatio?: number;
  onClose: () => void;
  onCropComplete: (croppedBlob: Blob) => void;
};

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Não foi possível inicializar o contexto 2D");
  }

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Falha ao gerar a imagem cortada"));
        }
      },
      "image/jpeg",
      0.93
    );
  });
}

export function ImageCropModal({
  isOpen,
  imageSrc,
  title = "Ajustar e Cortar Imagem",
  aspectRatio = 2.5,
  onClose,
  onCropComplete,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [currentAspect, setCurrentAspect] = useState(aspectRatio);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleCropComplete = useCallback(
    (_croppedArea: Area, croppedPixels: Area) => {
      setCroppedAreaPixels(croppedPixels);
    },
    []
  );

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      setProcessing(true);
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      onCropComplete(blob);
    } catch (err) {
      console.error("Erro ao cortar a imagem:", err);
    } finally {
      setProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d131f] shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#00aeee]/15 text-[#00aeee]">
              <CropIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <p className="text-[11px] text-neutral-400">
                Arraste para posicionar e use o zoom para ajustar o enquadramento
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Área do Cropper */}
        <div className="relative h-72 w-full bg-black/60 sm:h-80">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={currentAspect}
            onCropChange={setCrop}
            onCropComplete={handleCropComplete}
            onZoomChange={setZoom}
            showGrid={true}
            style={{
              containerStyle: { width: "100%", height: "100%" },
              cropAreaStyle: {
                borderColor: "#00aeee",
                boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.7)",
                borderRadius: "8px",
              },
            }}
          />
        </div>

        {/* Controles de Zoom e Proporção */}
        <div className="space-y-3.5 border-t border-white/10 bg-[#090d16] p-4">
          <div className="flex items-center gap-3">
            <ZoomOut className="h-4 w-4 shrink-0 text-neutral-400" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-neutral-700 accent-[#00aeee]"
            />
            <ZoomIn className="h-4 w-4 shrink-0 text-neutral-400" />
            <button
              type="button"
              onClick={() => {
                setCrop({ x: 0, y: 0 });
                setZoom(1);
              }}
              title="Redefinir enquadramento"
              className="ml-1 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Seletores de proporção (se for foto de capa) */}
          {aspectRatio !== 1 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Formato do enquadramento:</span>
              <div className="flex items-center gap-1.5">
                {[
                  { label: "Capa Padrão (2.5:1)", value: 2.5 },
                  { label: "Widescreen (16:9)", value: 16 / 9 },
                  { label: "Panorâmico (3:1)", value: 3 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCurrentAspect(opt.value)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      currentAspect === opt.value
                        ? "bg-[#00aeee]/20 text-[#00aeee] border border-[#00aeee]/50"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rodapé com Ações */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={processing}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={processing}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#00aeee] to-cyan-500 px-4 py-2 text-xs font-bold text-black shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {processing ? (
                <span>Processando...</span>
              ) : (
                <>
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  <span>Aplicar Corte Profissional</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
