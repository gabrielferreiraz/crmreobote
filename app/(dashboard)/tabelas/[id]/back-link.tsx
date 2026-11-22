"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "Voltar" pra lista de tabelas. Filtro/busca/ordenação ficam na URL via
 * history.replaceState (ver writeUrl em tables-browser.tsx) — não criam uma
 * entrada nova no histórico, só atualizam a existente. Então voltar de
 * verdade (router.back) cai na MESMA entrada já com o estado mais recente,
 * em vez de um <Link href="/tabelas"> fixo que sempre reiniciava os
 * filtros. Só quando não há pra onde voltar (aba nova, link direto) cai no
 * fallback simples.
 */
export function BackToTablesLink() {
  const router = useRouter();
  return (
    <Link
      href="/tabelas"
      onClick={(event) => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          event.preventDefault();
          router.back();
        }
      }}
      className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      Todas as tabelas
    </Link>
  );
}
