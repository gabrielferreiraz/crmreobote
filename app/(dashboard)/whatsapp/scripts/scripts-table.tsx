"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Plus, Pencil, Trash2, Copy, Search, MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";

type ScriptStep = { text: string; delayAfterSec: number };
type ScriptUsage = { campaignId: string; campaignName: string; status: "DRAFT" | "RUNNING" | "PAUSED" | "DONE" };

type Script = {
  id: string;
  name: string;
  steps: ScriptStep[];
  tags: string[];
  createdByName: string;
  createdAt: string;
  usage: ScriptUsage[];
};

const STATUS_LABELS: Record<ScriptUsage["status"], string> = {
  DRAFT: "Rascunho",
  RUNNING: "Rodando",
  PAUSED: "Pausada",
  DONE: "Concluída",
};

export function ScriptsTable({ initialScripts }: { initialScripts: Script[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [scriptToDelete, setScriptToDelete] = useState<Script | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of initialScripts) for (const t of s.tags) set.add(t);
    return Array.from(set).sort();
  }, [initialScripts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initialScripts.filter((s) => {
      if (tagFilter && !s.tags.includes(tagFilter)) return false;
      if (term) {
        const haystack = `${s.name} ${s.steps.map((st) => st.text).join(" ")}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [initialScripts, search, tagFilter]);

  async function deleteScript(id: string) {
    await fetch(`/api/message-scripts/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou texto"
              className="field-input py-1.5 pl-8 text-sm"
            />
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  tagFilter === null
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                Todas
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag === tagFilter ? null : tag)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    tagFilter === tag
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-300 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <Link href="/whatsapp/scripts/novo" className="btn-primary shrink-0">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Novo script
        </Link>
      </div>

      {initialScripts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FileText}
            title="Nenhum script criado ainda"
            description="Escreva uma sequência de mensagens de prospecção uma vez e reaproveite em quantas campanhas quiser. Suporta spintax {[opção 1|opção 2]}, variáveis {nome}/{primeiro_nome}/{cargo}/{empresa}/{cidade}/{saudacao} e mais de uma mensagem com delay entre elas."
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="p-4 text-center text-sm text-neutral-400 dark:text-neutral-500">Nenhum script encontrado.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((s) => {
            const totalChars = s.steps.reduce((sum, st) => sum + st.text.length, 0);
            return (
              <div key={s.id} className="card space-y-2 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{s.name}</h3>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link href={`/whatsapp/scripts/novo?duplicate=${s.id}`} className="icon-btn" aria-label="Duplicar">
                      <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                    </Link>
                    <Link href={`/whatsapp/scripts/${s.id}`} className="icon-btn" aria-label="Editar">
                      <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setScriptToDelete(s)}
                      className="icon-btn"
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {s.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <p className="line-clamp-2 whitespace-pre-wrap text-neutral-500 dark:text-neutral-400">
                  {s.steps[0]?.text}
                </p>
                <div className="flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
                  {s.steps.length > 1 && (
                    <span className="inline-flex items-center gap-1">
                      <MessagesSquare className="h-3 w-3" strokeWidth={2} />
                      {s.steps.length} mensagens
                    </span>
                  )}
                  <span>{totalChars} caracteres</span>
                </div>

                {s.usage.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                    {s.usage.map((u) => (
                      <Link
                        key={u.campaignId}
                        href={`/whatsapp/campanhas/${u.campaignId}`}
                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                        title={`Campanha: ${u.campaignName}`}
                      >
                        {u.campaignName} · {STATUS_LABELS[u.status]}
                      </Link>
                    ))}
                  </div>
                )}

                <p className="text-xs text-neutral-400 dark:text-neutral-500">Criado por {s.createdByName}</p>
              </div>
            );
          })}
        </div>
      )}

      {scriptToDelete && (
        <ConfirmDialog
          title={`Excluir "${scriptToDelete.name}"?`}
          description="Campanhas que já usaram esse script continuam com o texto que já foi copiado pra elas — só o script em si some da lista."
          confirmLabel="Excluir"
          onClose={() => setScriptToDelete(null)}
          onConfirm={async () => {
            await deleteScript(scriptToDelete.id);
            setScriptToDelete(null);
          }}
        />
      )}
    </div>
  );
}
