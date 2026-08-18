"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, X, Share2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";

type MemberInfo = { id: string; name: string };

type Group = {
  id: string;
  name: string;
  createdById: string;
  createdBy: { id: string; name: string };
  shareAgenda: boolean;
  shareDeals: boolean;
  members: { id: string; userId: string; user: MemberInfo }[];
};

/**
 * Grupos de compartilhamento entre consultores — mesmo padrão visual/
 * interativo de configuracoes/equipes/team-manager.tsx, adaptado pra um
 * grupo sem líder/gerente (só uma lista simétrica de membros) + 2
 * interruptores independentes (agenda / negócios).
 */
export function ShareGroupManager({
  initialGroups,
  allMembers,
  eligibleMembers,
  currentUserId,
  isOwner,
}: {
  initialGroups: Group[];
  /** Nomes de TODO mundo — pra resolver o nome de membros de grupos que outra pessoa criou (ver page.tsx). */
  allMembers: MemberInfo[];
  /** Só quem EU (usuário atual) já enxergo — quem posso adicionar num grupo novo ou num que eu criei. */
  eligibleMembers: MemberInfo[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMemberIds, setNewMemberIds] = useState<Set<string>>(new Set([currentUserId]));
  const [newShareAgenda, setNewShareAgenda] = useState(true);
  const [newShareDeals, setNewShareDeals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);

  function canEdit(group: Group) {
    return isOwner || group.createdById === currentUserId;
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || newMemberIds.size === 0 || (!newShareAgenda && !newShareDeals)) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/share-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        memberIds: Array.from(newMemberIds),
        shareAgenda: newShareAgenda,
        shareDeals: newShareDeals,
      }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar grupo");
      return;
    }

    setNewName("");
    setNewMemberIds(new Set([currentUserId]));
    setNewShareAgenda(true);
    setNewShareDeals(false);
    setShowCreateForm(false);
    router.refresh();
  }

  async function patchGroup(groupId: string, data: Record<string, unknown>) {
    await fetch(`/api/share-groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    router.refresh();
  }

  async function deleteGroup(groupId: string) {
    const res = await fetch(`/api/share-groups/${groupId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {initialGroups.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Share2}
            title="Nenhum grupo de compartilhamento"
            description="Crie o primeiro grupo abaixo — todo mundo dentro dele passa a ver (e mexer) o que foi ligado de todo mundo."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {initialGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              allMembers={allMembers}
              eligibleMembers={eligibleMembers}
              canEdit={canEdit(group)}
              onPatch={patchGroup}
              onDelete={() => setGroupToDelete(group)}
            />
          ))}
        </div>
      )}

      {showCreateForm ? (
        <form onSubmit={createGroup} className="card space-y-3 p-4">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do grupo (ex.: Marketing Digital)"
            className="field-input w-full"
          />
          <div className="space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">O que é compartilhado</p>
            <ShareToggles shareAgenda={newShareAgenda} shareDeals={newShareDeals} onChangeAgenda={setNewShareAgenda} onChangeDeals={setNewShareDeals} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
              Quem entra no grupo
            </p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {eligibleMembers.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                >
                  <input
                    type="checkbox"
                    checked={newMemberIds.has(m.id)}
                    onChange={() => {
                      setNewMemberIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      });
                    }}
                    className="accent-neutral-900 dark:accent-white"
                  />
                  <span className="text-neutral-800 dark:text-neutral-200">
                    {m.id === currentUserId ? `${m.name} (você)` : m.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || !newName.trim() || newMemberIds.size === 0 || (!newShareAgenda && !newShareDeals)}
              className="btn-primary"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
              Criar grupo
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setError(null);
              }}
              className="btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowCreateForm(true)} className="btn-secondary">
          <Plus className="h-4 w-4" strokeWidth={2} />
          Novo grupo
        </button>
      )}

      {groupToDelete && (
        <ConfirmDialog
          title={`Excluir o grupo "${groupToDelete.name}"?`}
          description="Os consultores voltam a ver só o que já viam antes (ou o que já tiverem por outro motivo, tipo equipe)."
          confirmLabel="Excluir"
          onClose={() => setGroupToDelete(null)}
          onConfirm={async () => {
            await deleteGroup(groupToDelete.id);
            setGroupToDelete(null);
          }}
        />
      )}
    </div>
  );
}

function ShareToggles({
  shareAgenda,
  shareDeals,
  onChangeAgenda,
  onChangeDeals,
}: {
  shareAgenda: boolean;
  shareDeals: boolean;
  onChangeAgenda: (v: boolean) => void;
  onChangeDeals: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip label="Agenda" checked={shareAgenda} onChange={onChangeAgenda} />
      <ToggleChip label="Negócios" checked={shareDeals} onChange={onChangeDeals} />
    </div>
  );
}

function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        checked
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}

function GroupCard({
  group,
  allMembers,
  eligibleMembers,
  canEdit,
  onPatch,
  onDelete,
}: {
  group: Group;
  allMembers: MemberInfo[];
  eligibleMembers: MemberInfo[];
  canEdit: boolean;
  onPatch: (groupId: string, data: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [addMemberId, setAddMemberId] = useState("");

  const currentMemberIds = group.members.map((m) => m.userId);
  // Só oferece pra adicionar quem eu já enxergo E ainda não está no grupo —
  // se o grupo já tem gente fora do meu alcance (montado por outra pessoa),
  // ela continua aparecendo na lista de membros abaixo normalmente, só não
  // entra nesse dropdown de "adicionar mais um".
  const availableToAdd = eligibleMembers.filter((m) => !currentMemberIds.includes(m.id));

  function resolveName(userId: string): string {
    return allMembers.find((m) => m.id === userId)?.name ?? group.members.find((m) => m.userId === userId)?.user.name ?? "?";
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <input
          value={name}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== group.name) onPatch(group.id, { name: name.trim() });
          }}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-base font-semibold text-neutral-900 outline-none transition-colors hover:bg-neutral-50 focus:bg-neutral-50 disabled:hover:bg-transparent dark:text-neutral-100 dark:hover:bg-neutral-800/60 dark:focus:bg-neutral-800/60"
        />
        <Badge tone="neutral" size="sm" className="shrink-0">
          {group.members.length} {group.members.length === 1 ? "membro" : "membros"}
        </Badge>
        {canEdit && (
          <button onClick={onDelete} className="icon-btn shrink-0 hover:text-red-600 dark:hover:text-red-400" title="Excluir grupo">
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">Criado por {group.createdBy.name}</p>

      <div className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">O que é compartilhado</p>
        {canEdit ? (
          <ShareToggles
            shareAgenda={group.shareAgenda}
            shareDeals={group.shareDeals}
            onChangeAgenda={(v) => onPatch(group.id, { shareAgenda: v })}
            onChangeDeals={(v) => onPatch(group.id, { shareDeals: v })}
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {group.shareAgenda && <Badge tone="accent">Agenda</Badge>}
            {group.shareDeals && <Badge tone="accent">Negócios</Badge>}
          </div>
        )}
      </div>

      <div className="space-y-0.5 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        {group.members.map((m) => (
          <div
            key={m.id}
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
          >
            <Avatar name={resolveName(m.userId)} size="xs" />
            <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">{resolveName(m.userId)}</span>
            {canEdit && (
              <button
                onClick={() => onPatch(group.id, { memberIds: currentMemberIds.filter((id) => id !== m.userId) })}
                className="icon-btn shrink-0 opacity-0 group-hover:opacity-100 coarse:opacity-100 hover:text-red-600 dark:hover:text-red-400"
                aria-label="Remover do grupo"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && availableToAdd.length > 0 && (
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Select
              value={addMemberId}
              onChange={setAddMemberId}
              className="w-full py-1.5 text-xs"
              options={[{ value: "", label: "Adicionar consultor..." }, ...availableToAdd.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
          <button
            disabled={!addMemberId}
            onClick={() => {
              onPatch(group.id, { memberIds: [...currentMemberIds, addMemberId] });
              setAddMemberId("");
            }}
            className="btn-secondary shrink-0 py-1.5 text-xs"
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  );
}
