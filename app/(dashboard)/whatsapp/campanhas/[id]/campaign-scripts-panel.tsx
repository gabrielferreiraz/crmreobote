"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import type { CampaignScriptRow } from "@/lib/campaigns/list";

const KIND_LABEL: Record<CampaignScriptRow["kind"], string> = {
  initial: "Envio inicial",
  followUp: "Reenvio",
  wave: "Onda de RMKT",
};

const STATE_LABEL: Record<CampaignScriptRow["state"], string> = {
  "in-sync": "Atualizado",
  outdated: "Atualização disponível",
  missing: "Indisponível na biblioteca",
};

const STATE_TONE: Record<CampaignScriptRow["state"], string> = {
  "in-sync": "text-emerald-700 dark:text-emerald-400",
  outdated: "text-amber-700 dark:text-amber-400",
  missing: "text-neutral-500 dark:text-neutral-400",
};

/**
 * Scripts que ESTA campanha usa (envio inicial, reenvio, ondas de RMKT) e se
 * a cópia de texto que ela carrega está igual à biblioteca. A campanha guarda
 * uma cópia congelada do script (ver Campaign.messageTemplates no schema) —
 * este painel é o jeito de mexer nisso no meio da campanha:
 *  - "Editar" abre o script na biblioteca; ao salvar, o editor pergunta se
 *    aplica o texto novo nesta campanha (e se é correção ou nova versão).
 *  - "Usar versão da biblioteca" puxa o texto/versão ATUAIS pra cá quando a
 *    biblioteca mudou e a campanha não recebeu.
 * Campanha encerrada aparece só pra consulta (não vai mais enviar nada).
 */
export function CampaignScriptsPanel({
  campaignId,
  scripts,
  editable,
}: {
  campaignId: string;
  scripts: CampaignScriptRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (scripts.length === 0) return null;

  const outdatedIds = Array.from(new Set(scripts.filter((s) => s.state === "outdated").map((s) => s.scriptId)));

  async function sync(scriptId: string | null, key: string) {
    setBusyKey(key);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/sync-scripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scriptId ? { scriptId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Não foi possível atualizar o script" });
        return;
      }
      setMessage({ tone: "ok", text: "Texto atualizado para os próximos envios." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Falha de conexão. Tente novamente." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950" aria-labelledby="campaign-scripts-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="campaign-scripts-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Mensagens da campanha</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {editable ? "Textos usados nos próximos envios." : "Campanha encerrada."}
          </p>
        </div>
        {editable && outdatedIds.length > 1 && (
          <button type="button" disabled={busyKey !== null} onClick={() => sync(null, "all")} className="btn-secondary btn-sm">
            {busyKey === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />}
            Atualizar todos
          </button>
        )}
      </div>

      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {message.text}
        </p>
      )}

      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {scripts.map((s) => (
          <div key={s.key} className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-base font-medium text-neutral-900 dark:text-neutral-100">{s.name}</span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {s.waveLabel ?? KIND_LABEL[s.kind]}
                </span>
                {s.sharePct !== null && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {s.sharePct}% dos envios
                  </span>
                )}
                <span className={`text-sm font-medium ${STATE_TONE[s.state]}`}>
                  {STATE_LABEL[s.state]}
                  {s.state === "outdated" && s.libraryVersion !== null && s.libraryVersion !== s.copyVersion ? ` (v${s.libraryVersion})` : ""}
                </span>
              </div>
              {s.preview && <p className="mt-1 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">{s.preview}</p>}
            </div>

            {editable && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {s.state === "outdated" && (
                  <button type="button" disabled={busyKey !== null} onClick={() => sync(s.scriptId, s.key)} className="btn-secondary btn-sm">
                    {busyKey === s.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />}
                    Atualizar texto
                  </button>
                )}
                {s.state !== "missing" && (
                  <Link href={`/whatsapp/scripts/${s.scriptId}?campanha=${campaignId}`} className="btn-ghost btn-sm">
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                    Editar
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
