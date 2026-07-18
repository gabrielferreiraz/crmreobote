"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { formatDuration } from "@/lib/format";

export type TeamActivityMember = {
  id: string;
  name: string;
  photoUrl: string | null;
  online: boolean;
  lastActiveAt: Date | string | null;
  avgSecondsPerActiveDay: number;
};

function formatLastSeen(lastActiveAt: TeamActivityMember["lastActiveAt"]) {
  if (!lastActiveAt) return "Nunca acessou";
  return new Date(lastActiveAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Lista completa de usuários cadastrados fica recolhida por padrão — os
 * rankings acima já mostram quem mais se destaca; abrir todo mundo de cara
 * seria repetir informação e poluir a tela pra quem só quer o resumo.
 */
export function TeamActivityList({ members }: { members: TeamActivityMember[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card p-6">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 text-left">
        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Todos os usuários</h3>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            {members.length} usuário{members.length === 1 ? "" : "s"} cadastrado{members.length === 1 ? "" : "s"} — status, última visita e média por dia.
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="mt-4 overflow-x-auto border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                <th className="pb-2 font-medium">Usuário</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Última visita</th>
                <th className="pb-2 text-right font-medium">Média/dia</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.name} src={m.photoUrl} size="sm" />
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">{m.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${m.online ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
                      />
                      {m.online ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td className="py-2.5 text-neutral-600 dark:text-neutral-400">
                    {m.online ? "Agora" : formatLastSeen(m.lastActiveAt)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                    {m.avgSecondsPerActiveDay > 0 ? formatDuration(m.avgSecondsPerActiveDay * 1000) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
