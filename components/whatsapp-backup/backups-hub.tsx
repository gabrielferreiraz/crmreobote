"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  Clock3,
  Database,
  MessageSquare,
  MessagesSquare,
  Search,
  SearchX,
  ShieldCheck,
  Snowflake,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { BackupExportMenu } from "@/components/whatsapp-backup/export-menu";
import type { BackupMember } from "@/lib/whatsapp/backup";
import { formatCount, formatDayShort, formatPeriod, timeAgo } from "@/lib/whatsapp/backup-format";

type Filter = "all" | "active" | "inactive";
type Sort = "recent" | "messages" | "name";

const ROLE_LABEL: Record<BackupMember["role"], string> = {
  OWNER: "Dono",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  MEMBER: "Consultor",
};

function roleLabel(m: BackupMember): string {
  if (m.role === "MEMBER" && m.area === "ADMINISTRATIVO") return "Administrativo";
  return ROLE_LABEL[m.role];
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function StatTile({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string; hint?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light/60 text-brand dark:bg-white/[0.06]">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
        <p className="text-xl leading-tight font-semibold tracking-tight text-neutral-900 tabular-nums dark:text-neutral-100">{value}</p>
        {hint && <p className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * Página-hub do backup: todos os consultores que têm histórico guardado, com a
 * escolha de abrir as conversas ou exportar direto. Filtro e ordenação rodam em
 * memória sobre a lista já carregada (poucas dezenas de pessoas).
 */
export function BackupsHub({ members, withoutBackup }: { members: BackupMember[]; withoutBackup: number }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");

  const totals = useMemo(() => {
    const first = members.reduce<string | null>((min, m) => (m.firstMessageAt && (!min || m.firstMessageAt < min) ? m.firstMessageAt : min), null);
    return {
      people: members.length,
      threads: members.reduce((s, m) => s + m.threads, 0),
      messages: members.reduce((s, m) => s + m.messages, 0),
      first,
      inactive: members.filter((m) => !m.active).length,
    };
  }, [members]);

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    const list = members.filter((m) => {
      if (filter === "active" && !m.active) return false;
      if (filter === "inactive" && m.active) return false;
      return !term || normalize(`${m.name} ${m.email}`).includes(term);
    });
    const sorted = [...list];
    if (sort === "messages") sorted.sort((a, b) => b.messages - a.messages);
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    else sorted.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    return sorted;
  }, [members, search, filter, sort]);

  const chips: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "Todos", count: members.length },
    { value: "active", label: "Ativos", count: members.length - totals.inactive },
    { value: "inactive", label: "Desativados", count: totals.inactive },
  ];

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="Nenhum backup ainda"
        description="Assim que um consultor conversar pelo WhatsApp do CRM, o histórico dele passa a ser guardado aqui."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Users} label="Consultores com backup" value={formatCount(totals.people)} hint={totals.inactive ? `${totals.inactive} desativado(s)` : "Todos ativos"} />
        <StatTile icon={MessagesSquare} label="Conversas guardadas" value={formatCount(totals.threads)} />
        <StatTile icon={MessageSquare} label="Mensagens guardadas" value={formatCount(totals.messages)} />
        <StatTile icon={CalendarClock} label="Histórico desde" value={totals.first ? formatDayShort(totals.first) : "—"} hint="Mensagem mais antiga" />
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3.5 py-2.5 text-sm text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07] dark:text-emerald-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <p>
          Só o <strong className="font-semibold">Dono</strong> vê esta página. Quem sai da empresa continua aqui, com o histórico congelado no dia da desativação.
          Toda exportação fica registrada na Auditoria.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar consultor por nome ou e-mail"
            className="field-input w-full py-2 pr-9 pl-9 text-sm"
            aria-label="Buscar consultor"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div role="tablist" aria-label="Situação" className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
            {chips.map((c) => (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={filter === c.value}
                onClick={() => setFilter(c.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  filter === c.value
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {c.label} <span className="tabular-nums opacity-60">{c.count}</span>
              </button>
            ))}
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="field-input w-auto py-2 text-sm"
            aria-label="Ordenar por"
          >
            <option value="recent">Mais recentes</option>
            <option value="messages">Mais mensagens</option>
            <option value="name">Nome (A–Z)</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={SearchX} title="Ninguém encontrado" description="Tente outro nome ou mude o filtro de situação." />
      ) : (
        <ul className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => (
            <li key={m.userId} className="card group relative flex flex-col p-0">
              <Link
                href={`/configuracoes/usuarios/${m.userId}/whatsapp-backup`}
                className="flex flex-1 flex-col gap-4 rounded-t-[inherit] p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={m.name} src={m.image} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{m.name}</p>
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{m.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {roleLabel(m)}
                      </span>
                      {m.active ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          <Snowflake className="h-3 w-3" strokeWidth={2.25} /> Desativado
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand dark:text-neutral-600"
                    strokeWidth={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
                    <p className="text-lg leading-tight font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCount(m.threads)}</p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {m.threads === 1 ? "conversa" : "conversas"}
                      {m.archivedThreads > 0 && m.archivedThreads < m.threads ? ` · ${m.archivedThreads} congelada(s)` : ""}
                    </p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
                    <p className="text-lg leading-tight font-semibold text-neutral-900 tabular-nums dark:text-neutral-100">{formatCount(m.messages)}</p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{m.messages === 1 ? "mensagem" : "mensagens"}</p>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <p className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    {m.lastMessageAt ? `Última mensagem ${timeAgo(m.lastMessageAt)}` : "—"}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    {formatPeriod(m.firstMessageAt, m.lastMessageAt)}
                  </p>
                </div>
              </Link>

              <div className="flex items-center gap-2 border-t border-neutral-100 p-3 dark:border-neutral-800">
                <Link href={`/configuracoes/usuarios/${m.userId}/whatsapp-backup`} className="btn-primary btn-sm flex-1">
                  Ver conversas
                </Link>
                <BackupExportMenu userId={m.userId} label="Exportar" align="right" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {withoutBackup > 0 && (
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          {withoutBackup} {withoutBackup === 1 ? "pessoa da equipe ainda não tem" : "pessoas da equipe ainda não têm"} conversas guardadas.
        </p>
      )}
    </div>
  );
}
