"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";

const FORMATS = [
  { format: "xlsx", label: "Excel (.xlsx)", hint: "Planilha com resumo e mensagens", icon: FileSpreadsheet },
  { format: "csv", label: "CSV (.csv)", hint: "Abre em qualquer planilha", icon: Table2 },
  { format: "txt", label: "Texto (.txt)", hint: "Igual ao “Exportar conversa” do WhatsApp", icon: FileText },
] as const;

/**
 * Botão "Exportar" com os três formatos. Cada opção é um link comum de download
 * (GET): o navegador baixa em fluxo e a exportação fica na auditoria no servidor.
 */
export function BackupExportMenu({
  userId,
  threadId,
  label = "Exportar",
  variant = "secondary",
  align = "right",
}: {
  userId: string;
  threadId?: string;
  label?: string;
  variant?: "primary" | "secondary";
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = (format: string) =>
    `/api/org/members/${userId}/whatsapp-backup/export?format=${format}${threadId ? `&threadId=${encodeURIComponent(threadId)}` : ""}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${variant === "primary" ? "btn-primary" : "btn-secondary"} gap-1.5 whitespace-nowrap`}
      >
        <Download className="h-4 w-4" strokeWidth={2} />
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-30 mt-1.5 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-lg shadow-black/10 dark:border-neutral-700 dark:bg-neutral-900 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {FORMATS.map(({ format, label: itemLabel, hint, icon: Icon }) => (
            <a
              key={format}
              role="menuitem"
              href={href(format)}
              download
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{itemLabel}</span>
                <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
