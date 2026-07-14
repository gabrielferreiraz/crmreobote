"use client";

import { useMemo, useState } from "react";

type RecipientStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

type Recipient = {
  id: string;
  contactName: string;
  contactPhone: string | null;
  contactJobTitle: string | null;
  status: RecipientStatus;
  sentAt: string | null;
  repliedAt: string | null;
  followUpSentAt: string | null;
  scriptName: string | null;
  followUpScriptName: string | null;
  error: string | null;
};

const STATUS_LABELS: Record<RecipientStatus, string> = {
  PENDING: "Pendente",
  SENT: "Enviada",
  FAILED: "Falhou",
  SKIPPED: "Pulada",
};

const STATUS_TONE: Record<RecipientStatus, string> = {
  PENDING: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  SENT: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  SKIPPED: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function RecipientsTable({ recipients }: { recipients: Recipient[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | "ALL">("ALL");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return recipients.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (term && !r.contactName.toLowerCase().includes(term) && !(r.contactPhone ?? "").includes(term)) return false;
      return true;
    });
  }, [recipients, search, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="field-input max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RecipientStatus | "ALL")}
          className="field-input w-auto"
        >
          <option value="ALL">Todos os status</option>
          <option value="PENDING">Pendente</option>
          <option value="SENT">Enviada</option>
          <option value="FAILED">Falhou</option>
          <option value="SKIPPED">Pulada</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
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
            {filtered.map((r) => (
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
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                  {r.error && <p className="mt-0.5 text-xs text-red-500">{r.error}</p>}
                </td>
                <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{formatDateTime(r.sentAt)}</td>
                <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{formatDateTime(r.repliedAt)}</td>
                <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{formatDateTime(r.followUpSentAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-neutral-400 dark:text-neutral-500">
                  Nenhum destinatário encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
