"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { WhatsAppChat } from "@/components/whatsapp-chat";
import { formatCurrency } from "@/lib/format";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

type Deal = { id: string; name: string; status: "OPEN" | "WON" | "LOST"; value: number | null; stageName: string };
type InfoRow = { label: string; value: string };
type WhatsAppInfo = {
  threadId: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  currentUserName?: string;
  currentUserPhotoUrl?: string | null;
};

/**
 * Negócios e Dados de contato viviam lado a lado num grid 2/3 + 1/3 — numa
 * página que é, na prática, quase só isso, virava muita informação disputando
 * espaço ao mesmo tempo. Abas rápidas (troca local, sem navegação) separam
 * as duas visões sem perder a rapidez de alternar entre elas.
 */
export function ContactTabs({
  deals,
  infoRows,
  addressLines,
  tags,
  whatsapp,
}: {
  deals: Deal[];
  infoRows: InfoRow[];
  addressLines: string | null;
  tags: string[];
  whatsapp: WhatsAppInfo | null;
}) {
  const [tab, setTab] = useState<"deals" | "info">("deals");

  return (
    <div>
      <div className="relative mb-4 flex w-full max-w-[300px] rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-800 dark:bg-neutral-800">
        <div
          className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-neutral-900"
          style={{ transform: tab === "info" ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
        />
        <button
          type="button"
          onClick={() => setTab("deals")}
          className={`relative z-10 flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors active:scale-[0.97] ${
            tab === "deals" ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          Negócios{deals.length > 0 && <span className="ml-1 tabular-nums opacity-60">({deals.length})</span>}
        </button>
        <button
          type="button"
          onClick={() => setTab("info")}
          className={`relative z-10 flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors active:scale-[0.97] ${
            tab === "info" ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          Dados de contato
        </button>
      </div>

      {tab === "deals" ? (
        <div className="space-y-2">
          {deals.length === 0 ? (
            <div className="card">
              <EmptyState icon={Inbox} title="Nenhum negócio vinculado" />
            </div>
          ) : (
            deals.map((deal) => (
              <Link
                key={deal.id}
                href={`/negocios/${deal.id}`}
                className="card block p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</span>
                  <Badge tone={STATUS_LABEL[deal.status].tone} className="shrink-0">
                    {STATUS_LABEL[deal.status].label}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="min-w-0 truncate">{deal.stageName}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCurrency(deal.value)}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      ) : (
        <div className="card max-w-lg space-y-2 p-4 text-sm">
          {infoRows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
          {addressLines && (
            <div className="space-y-0.5">
              <span className="text-neutral-500 dark:text-neutral-400">Endereço</span>
              <p className="text-right text-neutral-800 dark:text-neutral-200">{addressLines}</p>
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">Tags</span>
              <div className="flex flex-wrap justify-end gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {whatsapp && (
            <WhatsAppChat
              threadId={whatsapp.threadId}
              contactId={whatsapp.contactId}
              contactName={whatsapp.contactName}
              contactPhone={whatsapp.contactPhone}
              currentUserName={whatsapp.currentUserName}
              currentUserPhotoUrl={whatsapp.currentUserPhotoUrl}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="min-w-0 truncate text-right text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}
