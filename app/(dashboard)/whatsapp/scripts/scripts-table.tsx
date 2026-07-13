"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingDots } from "@/components/loading-dots";

type Script = {
  id: string;
  name: string;
  text: string;
  createdByName: string;
  createdAt: string;
};

export function ScriptsTable({ initialScripts }: { initialScripts: Script[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Script | "new" | null>(null);
  const [scriptToDelete, setScriptToDelete] = useState<Script | null>(null);

  async function deleteScript(id: string) {
    await fetch(`/api/message-scripts/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setEditing("new")} className="btn-primary">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Novo script
        </button>
      </div>

      {initialScripts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={FileText}
            title="Nenhum script criado ainda"
            description="Escreva uma variante de mensagem de prospecção uma vez e reaproveite em quantas campanhas quiser. Suporta spintax {[opção 1|opção 2]} e variáveis {nome}/{primeiro_nome}/{cargo}/{saudacao}."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {initialScripts.map((s) => (
            <div key={s.id} className="card space-y-2 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{s.name}</h3>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setEditing(s)} className="icon-btn" aria-label="Editar">
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
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
              <p className="whitespace-pre-wrap text-neutral-500 dark:text-neutral-400">{s.text}</p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">Criado por {s.createdByName}</p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ScriptDialog
          script={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
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

function ScriptDialog({
  script,
  onClose,
  onSaved,
}: {
  script: Script | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(script?.name ?? "");
  const [text, setText] = useState(script?.text ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(script ? `/api/message-scripts/${script.id}` : "/api/message-scripts", {
      method: script ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, text }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao salvar script");
      return;
    }

    onSaved();
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {script ? "Editar script" : "Novo script"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Nome</label>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Abertura — cargo jurídico"
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Texto</label>
          <textarea
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Ex.: {saudacao} {primeiro_nome}! {[Tudo bem|Como vai]}? Vi que você atua como {cargo}..."
            className="field-input"
          />
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            <code>{"{[opção 1|opção 2]}"}</code> varia trechos; <code>{"{nome}"}</code>/<code>{"{primeiro_nome}"}</code>
            /<code>{"{cargo}"}</code>/<code>{"{saudacao}"}</code> personalizam por contato.
          </p>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !name.trim() || !text.trim()} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Salvar"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
