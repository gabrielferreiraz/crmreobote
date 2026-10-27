"use client";

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { downloadServopaTablePdf } from "@/lib/servopa-tables/export-pdf";

/**
 * "Baixar PDF" gera o arquivo pronto (uma página A4, igual em qualquer
 * computador ou celular) — é o caminho principal para mandar ao cliente.
 * "Imprimir" abre o diálogo do navegador para quem vai pôr no papel.
 */
export function PrintButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await downloadServopaTablePdf();
    } catch {
      setError("Não foi possível gerar o PDF. Tente de novo ou use Imprimir.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button type="button" onClick={() => window.print()} className="btn-secondary">
          <Printer className="h-4 w-4" strokeWidth={2} />
          Imprimir
        </button>
        <button type="button" onClick={() => void download()} disabled={downloading} className="btn-primary">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" strokeWidth={2} />}
          Baixar PDF
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
