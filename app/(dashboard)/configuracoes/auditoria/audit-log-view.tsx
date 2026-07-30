"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { ShieldAlert } from "lucide-react";
import type { AuditAction } from "@/lib/audit-log";

type LogEntry = {
  id: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
};

const ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN_SUCCESS: "Login",
  LOGIN_FAILED: "Login falhou",
  API_KEY_CREATED: "Chave de API criada",
  API_KEY_REVOKED: "Chave de API revogada",
  MEMBER_INVITED: "Membro convidado",
  MEMBER_ROLE_CHANGED: "Papel de membro alterado",
  MEMBER_DEACTIVATED: "Membro desativado",
  MEMBER_REACTIVATED: "Membro reativado",
  MEMBER_REMOVED: "Membro removido",
  WHATSAPP_CONNECTED: "WhatsApp conectado",
  WHATSAPP_DISCONNECTED: "WhatsApp desconectado",
  META_ADS_CONNECTED: "Meta Ads conectado",
  META_ADS_DISCONNECTED: "Meta Ads desconectado",
  GOOGLE_CALENDAR_CONNECTED: "Google Agenda conectado",
  GOOGLE_CALENDAR_DISCONNECTED: "Google Agenda desconectado",
};

const ACTION_TONE: Record<AuditAction, "neutral" | "success" | "danger" | "warning"> = {
  LOGIN_SUCCESS: "neutral",
  LOGIN_FAILED: "danger",
  API_KEY_CREATED: "success",
  API_KEY_REVOKED: "warning",
  MEMBER_INVITED: "success",
  MEMBER_ROLE_CHANGED: "warning",
  MEMBER_DEACTIVATED: "danger",
  MEMBER_REACTIVATED: "success",
  MEMBER_REMOVED: "danger",
  WHATSAPP_CONNECTED: "success",
  WHATSAPP_DISCONNECTED: "warning",
  META_ADS_CONNECTED: "success",
  META_ADS_DISCONNECTED: "warning",
  GOOGLE_CALENDAR_CONNECTED: "success",
  GOOGLE_CALENDAR_DISCONNECTED: "warning",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

function actionTone(action: string): "neutral" | "success" | "danger" | "warning" {
  return ACTION_TONE[action as AuditAction] ?? "neutral";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

export function AuditLogView({ initialLogs }: { initialLogs: LogEntry[] }) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");

  const actions = useMemo(() => Array.from(new Set(initialLogs.map((l) => l.action))), [initialLogs]);

  // Busca inteiramente client-side sobre os últimos 500 eventos já
  // carregados (mesmo padrão do backup de WhatsApp) — instantânea, sem
  // round-trip pro servidor a cada tecla.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initialLogs.filter((l) => {
      if (actionFilter !== "ALL" && l.action !== actionFilter) return false;
      if (!term) return true;
      return (
        l.actorName.toLowerCase().includes(term) ||
        (l.detail ?? "").toLowerCase().includes(term) ||
        (l.ip ?? "").includes(term) ||
        actionLabel(l.action).toLowerCase().includes(term)
      );
    });
  }, [initialLogs, search, actionFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por pessoa, detalhe ou IP"
            className="field-input w-full py-1.5 pr-8 pl-8 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="field-input w-auto">
          <option value="ALL">Todas as ações</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={ShieldAlert} title="Nenhum evento encontrado" />
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {filtered.map((l) => (
            <div key={l.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={actionTone(l.action)}>{actionLabel(l.action)}</Badge>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{l.actorName}</span>
                </div>
                {l.detail && <p className="text-neutral-500 dark:text-neutral-400">{l.detail}</p>}
              </div>
              <div className="shrink-0 text-right text-xs text-neutral-400 dark:text-neutral-500">
                <p>{formatDateTime(l.createdAt)}</p>
                {l.ip && <p className="font-mono">{l.ip}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
