"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { DatePicker } from "@/components/date-picker";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";

/**
 * "Trazer vendas antigas" — negócios ganhos antes do início das comissões
 * entram "a conferir". Mostra quantas são ANTES de trazer, e traz em lotes
 * com o progresso na tela (são centenas; uma requisição só estouraria).
 */
export function LegacyDialog({ defaultFrom, maxDate, onClose, onDone }: { defaultFrom: string; maxDate: string; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(defaultFrom);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recontagem a cada data escolhida
    setCounting(true);
    setError(null);
    requestJson<{ count: number }>(`/api/commissions/sales/legacy?from=${from}`, { signal: controller.signal }, { silent: true }).then((res) => {
      if (res.aborted) return;
      setCounting(false);
      if (res.ok) setCount(res.data.count);
      else {
        setCount(null);
        setError(res.error);
      }
    });
    return () => controller.abort();
  }, [from]);

  async function run() {
    if (!count) return;
    setProgress({ done: 0, total: count });
    let done = 0;
    for (let guard = 0; guard < 100; guard++) {
      const res = await requestJson<{ imported: number; remaining: number }>(
        "/api/commissions/sales/legacy",
        { method: "POST", json: { from, first: guard === 0 } },
        { silent: true },
      );
      if (!res.ok) {
        // O que já veio fica (cada lote é gravado inteiro ou nada) — diz
        // quanto entrou e deixa continuar de onde parou.
        setError(done > 0 ? `${res.error} ${done} já vieram — clique em Trazer para continuar.` : res.error);
        if (done > 0) setCount((c) => (c != null ? Math.max(0, c - done) : c));
        break;
      }
      done += res.data.imported;
      setProgress({ done, total: done + res.data.remaining });
      if (res.data.remaining === 0 || res.data.imported === 0) {
        onDone();
        return;
      }
    }
    setProgress(null);
  }

  return (
    <Modal onClose={() => !progress && onClose()} maxWidth="max-w-md">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Trazer vendas antigas</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Entram para conferência antes do vendedor ver.
      </p>
      <div className="mt-5 space-y-2">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">A partir de que data?</p>
        <DatePicker value={from} onChange={setFrom} max={maxDate} disabled={!!progress} />
      </div>
      <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
        {counting ? (
          <LoadingDots />
        ) : count == null ? null : count === 0 ? (
          "Nenhuma venda nova nesse período."
        ) : (
          <>
            <strong className="font-semibold">{count} {count === 1 ? "venda" : "vendas"}</strong>. Meses passados entram como pagos.
          </>
        )}
      </p>
      {progress && (
        <div className="mt-3 space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Trazendo {progress.done} de {progress.total}…
          </p>
        </div>
      )}
      {error && <p className="field-error mt-2">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={!!progress}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" onClick={run} disabled={!!progress || counting || !count}>
          {progress ? <LoadingDots /> : count ? `Trazer ${count} ${count === 1 ? "venda" : "vendas"}` : "Trazer"}
        </button>
      </div>
    </Modal>
  );
}
