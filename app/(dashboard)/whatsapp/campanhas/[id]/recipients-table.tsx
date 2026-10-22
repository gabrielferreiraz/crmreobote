"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Briefcase, Loader2, MessageCircle, Search } from "lucide-react";
import { useDesktopViewport } from "@/lib/use-desktop-viewport";

type RecipientStatus = "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";

type Recipient = {
  id: string;
  contactName: string;
  contactPhone: string | null;
  contactJobTitle: string | null;
  status: RecipientStatus;
  /** Setado quando enviado (ver CampaignRecipient.threadId no schema) — liga
   * pra conversa em /whatsapp/conversas?threadId=... (ver RepliedAtCell abaixo). */
  threadId: string | null;
  /** Negócio de quem respondeu, já filtrado pelo que quem está vendo consegue abrir (ver getCampaignDetail) — liga pra /negocios/[id]. */
  dealId: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  followUpSentAt: string | null;
  /** Quando a última onda de RMKT foi enviada — null se a campanha não usa ondas, ou nenhuma saiu ainda. */
  lastWaveSentAt: string | null;
  /** Número (1-based) da onda que lastWaveSentAt registra. */
  lastWaveNumber: number | null;
  /** Previsão de quando o próximo reenvio/onda deve sair — null quando já foi reenviado/não tem mais onda, já respondeu, ou não está na fila. */
  nextFollowUpAt: string | null;
  scriptName: string | null;
  followUpScriptName: string | null;
  error: string | null;
};

type RecipientPage = {
  items: Recipient[];
  total: number;
  offset: number;
  limit: number;
};

const STATUS_LABELS: Record<RecipientStatus, string> = {
  PENDING: "Pendente",
  SENDING: "Enviando",
  SENT: "Enviada",
  FAILED: "Falhou",
  SKIPPED: "Pulada",
};

const STATUS_TONE: Record<RecipientStatus, string> = {
  PENDING: "text-neutral-600 dark:text-neutral-400",
  SENDING: "text-blue-700 dark:text-blue-400",
  SENT: "text-emerald-700 dark:text-emerald-400",
  FAILED: "text-red-700 dark:text-red-400",
  SKIPPED: "text-amber-700 dark:text-amber-400",
};

const STATUS_DOT: Record<RecipientStatus, string> = {
  PENDING: "bg-neutral-400",
  SENDING: "bg-blue-500",
  SENT: "bg-emerald-500",
  FAILED: "bg-red-500",
  SKIPPED: "bg-amber-500",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Data de resposta + links logo abaixo — pedidos explícitos: "colocar um
 * link indo direto para a conversa do WhatsApp de quem respondeu" e, depois,
 * "Ver negócio" também. Cada link só aparece quando há de fato o que abrir:
 * conversa (threadId, gravado no envio — ver CampaignRecipient.threadId no
 * schema) e negócio (dealId, já filtrado pelo que quem vê consegue abrir).
 * Sem resposta ainda, mostra só "—", sem link nenhum. */
function RepliedAtCell({
  repliedAt,
  threadId,
  dealId,
}: {
  repliedAt: string | null;
  threadId: string | null;
  dealId: string | null;
}) {
  if (!repliedAt) return <>—</>;
  return (
    <>
      {formatDateTime(repliedAt)}
      {(threadId || dealId) && (
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {threadId && (
            <Link
              href={`/whatsapp/conversas?threadId=${threadId}`}
              className="flex items-center gap-1 text-sm font-medium text-brand hover:underline"
            >
              <MessageCircle className="h-3 w-3" strokeWidth={2} />
              Ver conversa
            </Link>
          )}
          {dealId && (
            <Link href={`/negocios/${dealId}`} className="flex items-center gap-1 text-sm font-medium text-brand hover:underline">
              <Briefcase className="h-3 w-3" strokeWidth={2} />
              Ver negócio
            </Link>
          )}
        </span>
      )}
    </>
  );
}

/** "Reenvio" da linha. Três fatos possíveis, do mais concreto pro mais incerto:
 * 1) reenvio simples já saiu (followUpSentAt) — mostra a data, fim de história
 *    (campanha sem ondas não tem "onda 2" pra prever depois).
 * 2) campanha de ondas: mostra a ÚLTIMA onda que já saiu de verdade
 *    (lastWaveSentAt + lastWaveNumber — pedido explícito: "deve mostrar
 *    também quando foi enviado as ondas de rmkt") e, se ainda houver uma
 *    próxima prevista (nextAt), essa previsão some junto, sem confundir uma
 *    com a outra.
 * 3) nada saiu ainda, só previsão (nextAt) — itálico + "Previsto:" pra nunca
 *    ser lida como já confirmada — pedido explícito: "não mostra quando vai
 *    começar a fase de follow-up".
 */
function FollowUpCell({
  sentAt,
  lastWaveSentAt,
  lastWaveNumber,
  nextAt,
}: {
  sentAt: string | null;
  lastWaveSentAt: string | null;
  lastWaveNumber: number | null;
  nextAt: string | null;
}) {
  if (sentAt) return <>{formatDateTime(sentAt)}</>;
  if (lastWaveSentAt) {
    return (
      <>
        Onda {lastWaveNumber} enviada: {formatDateTime(lastWaveSentAt)}
        {nextAt && (
          <span className="block text-xs text-neutral-400 italic dark:text-neutral-500">
            Próxima prevista: {formatDateTime(nextAt)}
          </span>
        )}
      </>
    );
  }
  if (nextAt) return <span className="text-neutral-400 italic dark:text-neutral-500">Previsto: {formatDateTime(nextAt)}</span>;
  return <>—</>;
}

export function RecipientsTable({
  campaignId,
  initialPage,
  repliedTotal,
  initialStatusFilter = "ALL",
  initialOnlyReplied = false,
}: {
  campaignId: string;
  initialPage: RecipientPage;
  repliedTotal: number;
  initialStatusFilter?: RecipientStatus | "ALL";
  initialOnlyReplied?: boolean;
}) {
  const desktop = useDesktopViewport();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | "ALL">(initialStatusFilter);
  const [onlyReplied, setOnlyReplied] = useState(initialOnlyReplied);
  const [recipients, setRecipients] = useState(initialPage.items);
  const [total, setTotal] = useState(initialPage.total);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstQuery = useRef(true);
  const activeQuery = useRef("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queryKey = `${debouncedSearch}\n${statusFilter}\n${onlyReplied ? "1" : "0"}`;

  useEffect(() => {
    activeQuery.current = queryKey;
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ offset: "0", limit: String(initialPage.limit) });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (onlyReplied) params.set("replied", "1");

    setLoading(true);
    setError(null);
    fetch(`/api/campaigns/${campaignId}/recipients?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("recipients");
        return (await res.json()) as RecipientPage;
      })
      .then((page) => {
        setRecipients(page.items);
        setTotal(page.total);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("Não foi possível carregar os destinatários.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [campaignId, debouncedSearch, initialPage.limit, onlyReplied, queryKey, statusFilter]);

  async function loadMore() {
    const key = queryKey;
    const params = new URLSearchParams({ offset: String(recipients.length), limit: String(initialPage.limit) });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (onlyReplied) params.set("replied", "1");

    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recipients?${params.toString()}`);
      if (!res.ok) throw new Error("recipients");
      const page = (await res.json()) as RecipientPage;
      if (activeQuery.current !== key) return;
      setRecipients((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch {
      if (activeQuery.current === key) setError("Não foi possível carregar mais destinatários.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome ou telefone"
            className="field-input w-full pl-9 text-base"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RecipientStatus | "ALL")}
          className="field-input w-auto text-base"
        >
          <option value="ALL">Todos os status</option>
          <option value="PENDING">Pendente</option>
          <option value="SENDING">Enviando</option>
          <option value="SENT">Enviada</option>
          <option value="FAILED">Falhou</option>
          <option value="SKIPPED">Pulada</option>
        </select>
        <button
          type="button"
          onClick={() => setOnlyReplied((v) => !v)}
          aria-pressed={onlyReplied}
          className={`rounded-md border px-3 py-2 text-base font-medium transition-colors ${
            onlyReplied
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
              : "border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          Só quem respondeu ({repliedTotal})
        </button>
      </div>

      {error && <p className="text-base text-red-600 dark:text-red-400">{error}</p>}

      {loading && (
        <div className="flex items-center gap-2 text-base text-neutral-500 dark:text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Atualizando destinatarios
        </div>
      )}

      {recipients.length === 0 && !loading ? (
        <div className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-base text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          Nenhum destinatário encontrado.
        </div>
      ) : (
        <>
          {desktop === null && (
            <div className="card min-h-48 animate-pulse bg-neutral-100 dark:bg-neutral-900" />
          )}
          {/* Mobile: cards */}
          {desktop === false && (
          <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">
            {recipients.map((r) => (
              <article key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{r.contactName}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${STATUS_TONE[r.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden="true" />
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
                {r.error && <p className="mt-0.5 text-sm text-red-500">{r.error}</p>}
                <div className="mt-2 space-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                  <p>Cargo: {r.contactJobTitle ?? "—"}</p>
                  <p>Telefone: {r.contactPhone ?? "—"}</p>
                  <p>
                    Script: {r.scriptName ?? "—"}
                    {r.followUpScriptName && (
                      <span className="block text-xs text-neutral-400 dark:text-neutral-500">Reenvio: {r.followUpScriptName}</span>
                    )}
                  </p>
                  <p>Enviada em: {formatDateTime(r.sentAt)}</p>
                  <p>
                    Respondeu em: <RepliedAtCell repliedAt={r.repliedAt} threadId={r.threadId} dealId={r.dealId} />
                  </p>
                  <p>
                    Reenvio:{" "}
                    <FollowUpCell
                      sentAt={r.followUpSentAt}
                      lastWaveSentAt={r.lastWaveSentAt}
                      lastWaveNumber={r.lastWaveNumber}
                      nextAt={r.nextFollowUpAt}
                    />
                  </p>
                </div>
              </article>
            ))}
          </div>
          )}

          {/* Desktop: table */}
          {desktop === true && (
          <div className="card overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
                  <th className="px-4 py-2 font-medium">Contato</th>
                  <th className="px-4 py-2 font-medium">Cargo</th>
                  <th className="px-4 py-2 font-medium">Telefone</th>
                  <th className="px-4 py-2 font-medium">Script</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Enviada em</th>
                  <th className="px-4 py-2 font-medium">Respondeu em</th>
                  <th className="px-4 py-2 font-medium">Reenvio</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-800 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-neutral-900 dark:text-neutral-100">{r.contactName}</td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{r.contactJobTitle ?? "—"}</td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{r.contactPhone ?? "—"}</td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">
                      {r.scriptName ?? "—"}
                      {r.followUpScriptName && (
                        <p className="text-xs text-neutral-400 dark:text-neutral-500">Reenvio: {r.followUpScriptName}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${STATUS_TONE[r.status]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[r.status]}`} aria-hidden="true" />
                        {STATUS_LABELS[r.status]}
                      </span>
                      {r.error && <p className="mt-0.5 text-sm text-red-500">{r.error}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{formatDateTime(r.sentAt)}</td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">
                      <RepliedAtCell repliedAt={r.repliedAt} threadId={r.threadId} dealId={r.dealId} />
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">
                      <FollowUpCell
                        sentAt={r.followUpSentAt}
                        lastWaveSentAt={r.lastWaveSentAt}
                        lastWaveNumber={r.lastWaveNumber}
                        nextAt={r.nextFollowUpAt}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {recipients.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <span>
            Exibindo {recipients.length} de {total}
          </span>
          {recipients.length < total && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => void loadMore()} disabled={loadingMore || loading}>
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Mostrar mais
            </button>
          )}
        </div>
      )}
    </div>
  );
}
