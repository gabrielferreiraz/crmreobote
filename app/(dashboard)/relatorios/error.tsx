"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";

export default function ReportsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[relatorios] falha ao renderizar", { digest: error.digest });
  }, [error.digest]);

  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl items-center px-4 py-12">
      <div className="w-full border-y border-neutral-200 py-8 text-center dark:border-neutral-800">
        <TriangleAlert className="mx-auto h-6 w-6 text-amber-500" strokeWidth={1.8} />
        <h1 className="mt-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Não foi possível carregar os relatórios
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Os dados não foram alterados. Tente carregar novamente.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={() => retry()} className="btn-primary btn-sm inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
            Tentar novamente
          </button>
          <Link href="/" className="btn-secondary btn-sm inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            Voltar ao início
          </Link>
        </div>
        {error.digest && <p className="mt-4 text-[11px] text-neutral-400">Código: {error.digest}</p>}
      </div>
    </div>
  );
}
