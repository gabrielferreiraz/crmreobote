"use client";

import { Printer } from "lucide-react";

/** "Salvar como PDF" — o diálogo de impressão do navegador já oferece; a página só esconde este botão no papel. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary">
      <Printer className="h-4 w-4" strokeWidth={2} />
      Imprimir / salvar em PDF
    </button>
  );
}
