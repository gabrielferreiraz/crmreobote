"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, X, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";

type MemberInfo = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
  teamId: string | null;
};

type Team = {
  id: string;
  name: string;
  leaderId: string | null;
  leader: { id: string; name: string } | null;
  managerId: string | null;
  manager: { id: string; name: string } | null;
  members: {
    id: string;
    userId: string;
    user: { id: string; name: string; email: string; photoUrl: string | null };
  }[];
};

export function TeamManager({
  initialTeams,
  members,
  isOwner,
}: {
  initialTeams: Team[];
  members: MemberInfo[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);

  const supervisors = members.filter((m) => m.role === "SUPERVISOR");
  const managers = members.filter((m) => m.role === "MANAGER");

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar equipe");
      return;
    }

    setNewName("");
    router.refresh();
  }

  async function renameTeam(teamId: string, name: string) {
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    router.refresh();
  }

  async function setLeader(teamId: string, leaderId: string) {
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaderId: leaderId || null }),
    });
    router.refresh();
  }

  async function setManager(teamId: string, managerId: string) {
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ managerId: managerId || null }),
    });
    router.refresh();
  }

  async function assignMember(userId: string, teamId: string | null) {
    await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    router.refresh();
  }

  async function deleteTeam(teamId: string) {
    const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {initialTeams.length === 0 ? (
        <div className="card">
          <EmptyState icon={Users} title="Nenhuma equipe criada" description="Crie a primeira equipe abaixo." />
        </div>
      ) : (
        <div className="space-y-3">
          {initialTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              members={members}
              supervisors={supervisors}
              managers={managers}
              isOwner={isOwner}
              onRename={renameTeam}
              onSetLeader={setLeader}
              onSetManager={setManager}
              onAssignMember={assignMember}
              onDelete={() => setTeamToDelete(team)}
            />
          ))}
        </div>
      )}

      {isOwner && (
        <form onSubmit={createTeam} className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nova equipe"
            className="field-input flex-1"
          />
          <button type="submit" disabled={creating || !newName.trim()} className="btn-primary">
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            )}
            Adicionar
          </button>
        </form>
      )}

      {teamToDelete && (
        <ConfirmDialog
          title={`Excluir a equipe "${teamToDelete.name}"?`}
          description="Os membros continuam na organização, só deixam de fazer parte da equipe."
          confirmLabel="Excluir"
          onClose={() => setTeamToDelete(null)}
          onConfirm={async () => {
            await deleteTeam(teamToDelete.id);
            setTeamToDelete(null);
          }}
        />
      )}
    </div>
  );
}

function TeamCard({
  team,
  members,
  supervisors,
  managers,
  isOwner,
  onRename,
  onSetLeader,
  onSetManager,
  onAssignMember,
  onDelete,
}: {
  team: Team;
  members: MemberInfo[];
  supervisors: MemberInfo[];
  managers: MemberInfo[];
  isOwner: boolean;
  onRename: (teamId: string, name: string) => void;
  onSetLeader: (teamId: string, leaderId: string) => void;
  onSetManager: (teamId: string, managerId: string) => void;
  onAssignMember: (userId: string, teamId: string | null) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [addMemberId, setAddMemberId] = useState("");

  const availableToAdd = members.filter((m) => m.teamId !== team.id);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <input
          value={name}
          disabled={!isOwner}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== team.name) onRename(team.id, name.trim());
          }}
          className="flex-1 rounded bg-transparent px-1 text-sm font-medium text-neutral-900 dark:text-neutral-100 outline-none focus:bg-neutral-50 dark:focus:bg-neutral-800 disabled:opacity-100"
        />
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{team.members.length} membros</span>
        {isOwner && (
          <button onClick={onDelete} className="icon-btn hover:text-red-600 dark:hover:text-red-400" title="Excluir equipe">
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-500 dark:text-neutral-400">Líder</span>
        {isOwner ? (
          <Select
            value={team.leaderId ?? ""}
            onChange={(v) => onSetLeader(team.id, v)}
            className="w-auto py-1 text-xs"
            options={[
              { value: "", label: "Nenhum líder" },
              ...supervisors.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        ) : (
          <Badge tone="accent">{team.leader?.name ?? "Nenhum líder"}</Badge>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-500 dark:text-neutral-400">Gerente</span>
        {isOwner ? (
          <Select
            value={team.managerId ?? ""}
            onChange={(v) => onSetManager(team.id, v)}
            className="w-auto py-1 text-xs"
            options={[
              { value: "", label: "Nenhum gerente" },
              ...managers.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        ) : (
          <Badge tone="neutral">{team.manager?.name ?? "Nenhum gerente"}</Badge>
        )}
      </div>

      <div className="space-y-1.5">
        {team.members.length === 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">Nenhum membro nesta equipe ainda.</p>
        )}
        {team.members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 text-sm">
            <Avatar name={m.user.name} src={m.user.photoUrl} size="xs" />
            <span className="flex-1 text-neutral-800 dark:text-neutral-200">{m.user.name}</span>
            {m.user.id === team.leaderId && <Badge tone="accent">Líder</Badge>}
            {m.user.id === team.managerId && <Badge tone="neutral">Gerente</Badge>}
            {isOwner && (
              <button
                onClick={() => onAssignMember(m.user.id, null)}
                className="icon-btn hover:text-red-600 dark:hover:text-red-400"
                aria-label="Remover da equipe"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
      </div>

      {isOwner && availableToAdd.length > 0 && (
        <div className="flex gap-2 pt-1">
          <div className="flex-1">
            <Select
              value={addMemberId}
              onChange={setAddMemberId}
              className="w-full py-1.5 text-xs"
              options={[
                { value: "", label: "Adicionar membro..." },
                ...availableToAdd.map((m) => ({
                  value: m.id,
                  label: `${m.name}${m.teamId ? " (troca de equipe)" : ""}`,
                })),
              ]}
            />
          </div>
          <button
            disabled={!addMemberId}
            onClick={() => {
              onAssignMember(addMemberId, team.id);
              setAddMemberId("");
            }}
            className="btn-secondary py-1.5 text-xs"
          >
            Adicionar
          </button>
        </div>
      )}
    </div>
  );
}
