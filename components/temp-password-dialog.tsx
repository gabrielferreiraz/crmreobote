"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Modal } from "./modal";

export function TempPasswordDialog({
  title,
  description,
  password,
  onClose,
}: {
  title: string;
  description: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
      <div className="flex items-start gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 py-2">
        <p className="min-w-0 flex-1 break-all font-mono text-sm text-neutral-900 dark:text-neutral-100">{password}</p>
        <button type="button" onClick={copy} className="icon-btn shrink-0" aria-label="Copiar senha">
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="btn-primary">
          Fechar
        </button>
      </div>
    </Modal>
  );
}
