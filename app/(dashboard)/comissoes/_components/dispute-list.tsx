"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { requestJson } from "@/lib/client-request";
import { formatCurrency } from "@/lib/format";
import { brazilDateKey } from "@/lib/timezone";
import { formatMonthLong } from "@/lib/commissions/engine";
import type { OpenDispute } from "@/lib/commissions/queries";

const QUICK_ANSWERS = ["Conferi e o valor está certo.", "Você tem razão — já corrigi.", "Vou verificar com a administradora e te aviso."];

/** Contestações esperando resposta — cada uma numa frase, com "Responder" ao lado. */
export function DisputeList({ disputes }: { disputes: OpenDispute[] }) {
  const [answering, setAnswering] = useState<OpenDispute | null>(null);
  if (disputes.length === 0) return null;

  return (
    <section className="card space-y-3 p-5 ring-1 ring-red-500/20">
      <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
        <MessageCircleQuestion className="h-5 w-5 text-red-500" strokeWidth={2} />
        {disputes.length === 1 ? "1 pessoa está esperando sua resposta" : `${disputes.length} pessoas estão esperando sua resposta`}
      </h2>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {disputes.map((d) => (
          <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1 space-y-1 text-sm text-neutral-700 dark:text-neutral-300">
              <p>
                <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{d.requesterName}</strong> contestou a {d.entry.what}
                {d.entry.clientName ? ` da venda de ${d.entry.clientName}` : ""} ({formatCurrency(d.entry.amount)}, {formatMonthLong(d.entry.paymentMonth).toLowerCase()}) em{" "}
                {brazilDateKey(new Date(d.createdAt)).split("-").reverse().join("/")}:
              </p>
              <p className="italic text-neutral-900 dark:text-neutral-100">“{d.message}”</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {d.entry.saleId && (
                <Link href={`/comissoes/vendas?venda=${d.entry.saleId}`} className="btn-ghost btn-sm">
                  Ver a venda
                </Link>
              )}
              <button type="button" className="btn-primary btn-sm" onClick={() => setAnswering(d)}>
                Responder
              </button>
            </div>
          </li>
        ))}
      </ul>
      {answering && <AnswerDialog dispute={answering} onClose={() => setAnswering(null)} />}
    </section>
  );
}

function AnswerDialog({ dispute, onClose }: { dispute: OpenDispute; onClose: () => void }) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!response.trim()) return;
    setSaving(true);
    const res = await requestJson(`/api/commissions/disputes/${dispute.id}/resolve`, { method: "POST", json: { response: response.trim() } }, { silent: true });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal onClose={() => !saving && onClose()} maxWidth="max-w-md">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Responder {dispute.requesterName}</h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">“{dispute.message}”</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_ANSWERS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setResponse(a)}
              className={`rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors ${
                response === a
                  ? "border-brand bg-brand-light text-brand"
                  : "border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <textarea
          className="field-input min-h-24"
          value={response}
          maxLength={500}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Escreva a resposta — o consultor recebe no celular"
          aria-label="Resposta"
        />
        {error && <p className="field-error text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !response.trim()}>
            {saving ? <LoadingDots /> : "Enviar resposta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
