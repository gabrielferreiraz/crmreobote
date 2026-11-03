"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { Check, Crop as CropIcon, RefreshCcw, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Modal } from "@/components/modal";

type ImageCropModalProps = {
  isOpen: boolean;
  imageSrc: string | null;
  title?: string;
  description?: string;
  aspectRatio?: number;
  fixedAspect?: boolean;
  outputWidth?: number;
  outputHeight?: number;
  outputType?: "image/jpeg" | "image/png" | "image/webp";
  outputQuality?: number;
  confirmLabel?: string;
  onClose: () => void;
  onCropComplete: (croppedBlob: Blob) => void;
};

const ASPECT_OPTIONS = [
  { label: "Cartão", value: 1.6 },
  { label: "16:9", value: 16 / 9 },
  { label: "Capa", value: 2.5 },
];

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.crossOrigin = "anonymous";
    image.src = url;
  });
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function rotatedSize(width: number, height: number, rotation: number) {
  const angle = radians(rotation);
  return {
    width: Math.abs(Math.cos(angle) * width) + Math.abs(Math.sin(angle) * height),
    height: Math.abs(Math.sin(angle) * width) + Math.abs(Math.cos(angle) * height),
  };
}

async function getCroppedImage(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  output: { width?: number; height?: number; type: string; quality: number },
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const bounds = rotatedSize(image.naturalWidth, image.naturalHeight, rotation);
  const sourceCanvas = document.createElement("canvas");
  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) throw new Error("Nao foi possivel preparar a imagem.");

  sourceCanvas.width = Math.ceil(bounds.width);
  sourceCanvas.height = Math.ceil(bounds.height);
  sourceContext.translate(sourceCanvas.width / 2, sourceCanvas.height / 2);
  sourceContext.rotate(radians(rotation));
  sourceContext.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
  sourceContext.drawImage(image, 0, 0);

  const outputCanvas = document.createElement("canvas");
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("Nao foi possivel finalizar a imagem.");

  outputCanvas.width = output.width ?? Math.round(pixelCrop.width);
  outputCanvas.height = output.height ?? Math.round(pixelCrop.height);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(
    sourceCanvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );

  return new Promise((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar a imagem ajustada."))),
      output.type,
      output.quality,
    );
  });
}

export function ImageCropModal({
  isOpen,
  imageSrc,
  title = "Ajustar imagem",
  description = "Arraste a imagem para escolher o que aparecerá no enquadramento.",
  aspectRatio = 1.6,
  fixedAspect = false,
  outputWidth,
  outputHeight,
  outputType = "image/jpeg",
  outputQuality = 0.94,
  confirmLabel = "Aplicar enquadramento",
  onClose,
  onCropComplete,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [currentAspect, setCurrentAspect] = useState(aspectRatio);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setCurrentAspect(aspectRatio);
      setCroppedAreaPixels(null);
      setError(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [aspectRatio, imageSrc, isOpen]);

  const handleCropComplete = useCallback((_area: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  async function handleSave() {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      setProcessing(true);
      setError(null);
      const blob = await getCroppedImage(imageSrc, croppedAreaPixels, rotation, {
        width: outputWidth,
        height: outputHeight,
        type: outputType,
        quality: outputQuality,
      });
      onCropComplete(blob);
    } catch (cause) {
      console.error("Erro ao ajustar a imagem:", cause);
      setError("Nao foi possivel ajustar esta imagem. Tente outro arquivo.");
    } finally {
      setProcessing(false);
    }
  }

  function reset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setCurrentAspect(aspectRatio);
  }

  if (!isOpen || !imageSrc) return null;

  const outputLabel = outputWidth && outputHeight ? `${outputWidth} x ${outputHeight} px` : null;

  return (
    <Modal
      onClose={processing ? () => {} : onClose}
      maxWidth="max-w-4xl"
      panelClassName="!overflow-hidden !p-0 !pb-0"
    >
      <div className="bg-white dark:bg-neutral-950">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <CropIcon className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-neutral-950 dark:text-white">{title}</h2>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={processing} className="btn-ghost h-9 w-9 shrink-0 p-0" aria-label="Fechar editor">
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </header>

        <div className="relative h-[320px] w-full bg-neutral-950 sm:h-[420px]">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={currentAspect}
            minZoom={1}
            maxZoom={4}
            zoomSpeed={0.15}
            onCropChange={setCrop}
            onCropComplete={handleCropComplete}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            showGrid
            style={{
              cropAreaStyle: {
                border: "2px solid var(--brand)",
                boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.72)",
              },
            }}
          />
          <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
            Arraste para mover
          </div>
          {outputLabel && (
            <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
              Saída: {outputLabel}
            </div>
          )}
        </div>

        <div className="space-y-4 border-t border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label className="flex min-w-0 items-center gap-3">
              <ZoomOut className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
              <span className="sr-only">Zoom</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 accent-brand dark:bg-neutral-700"
              />
              <ZoomIn className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
              <span className="w-10 text-right text-xs tabular-nums text-neutral-500">{Math.round(zoom * 100)}%</span>
            </label>

            <div className="flex items-center gap-1 rounded-md border border-neutral-200 p-1 dark:border-neutral-800">
              <button type="button" onClick={() => setRotation((value) => value - 90)} className="btn-ghost h-9 w-9 p-0" title="Girar para a esquerda" aria-label="Girar para a esquerda">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={reset} className="btn-ghost h-9 w-9 p-0" title="Restaurar imagem" aria-label="Restaurar imagem">
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setRotation((value) => value + 90)} className="btn-ghost h-9 w-9 p-0" title="Girar para a direita" aria-label="Girar para a direita">
                <RotateCw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {!fixedAspect && aspectRatio !== 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium text-neutral-600 dark:text-neutral-300">Formato</span>
              {ASPECT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCurrentAspect(option.value)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    Math.abs(currentAspect - option.value) < 0.05
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button type="button" onClick={onClose} disabled={processing} className="btn-secondary">Cancelar</button>
            <button type="button" onClick={() => void handleSave()} disabled={processing || !croppedAreaPixels} className="btn-primary min-w-48">
              {processing ? (
                "Preparando imagem..."
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {confirmLabel}
                </>
              )}
            </button>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
