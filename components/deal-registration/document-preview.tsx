"use client";

import { useState } from "react";
import { Download, ExternalLink, Eye, FileText, ImageOff } from "lucide-react";
import { Modal } from "@/components/modal";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export function isImageFile(fileName: string): boolean {
  return IMAGE_EXT.test(fileName);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Miniatura do documento: a própria imagem (carregada pela rota protegida, com a
 * sessão de quem está logado) ou um ícone de PDF. Clicar abre o visualizador.
 */
export function DocumentThumb({
  src,
  fileName,
  onClick,
  className = "h-16 w-16",
}: {
  src: string;
  fileName: string;
  onClick: () => void;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const image = isImageFile(fileName) && !failed;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ver ${fileName}`}
      title="Clique para ver o documento"
      className={`group relative shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-neutral-700 dark:bg-neutral-800 ${className}`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-neutral-500 dark:text-neutral-400">
          {isImageFile(fileName) ? <ImageOff className="h-5 w-5" strokeWidth={1.75} /> : <FileText className="h-6 w-6" strokeWidth={1.75} />}
          {!isImageFile(fileName) && <span className="text-[10px] font-semibold tracking-wide">PDF</span>}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
        <Eye className="h-5 w-5" strokeWidth={2} />
      </span>
    </button>
  );
}

/** Visualizador em tela grande: imagem inteira ou PDF paginado, com baixar e abrir em outra aba. */
export function DocumentViewer({ src, fileName, onClose }: { src: string; fileName: string; onClose: () => void }) {
  const image = isImageFile(fileName);
  return (
    <Modal onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{fileName}</h2>
          <a href={`${src}?download=1`} download={fileName} className="btn-secondary btn-sm">
            <Download className="h-3.5 w-3.5" /> Baixar
          </a>
          <a href={src} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
            <ExternalLink className="h-3.5 w-3.5" /> Abrir em outra aba
          </a>
        </div>
        <div className="overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-950/60">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={fileName} className="mx-auto max-h-[72vh] w-auto max-w-full object-contain" />
          ) : (
            <iframe src={src} title={fileName} className="h-[72vh] w-full border-0" />
          )}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}
