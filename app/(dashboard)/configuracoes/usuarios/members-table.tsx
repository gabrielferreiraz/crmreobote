"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, KeyRound, Camera, UserX, UserCheck, Trash2, Pencil } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TempPasswordDialog } from "@/components/temp-password-dialog";
import { PasswordInput } from "@/components/password-input";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";

type Member = {
  id: string;
  role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
  active: boolean;
  user: { id: string; name: string; email: string };
  team: { id: string; name: string } | null;
  photoUrl: string | null;
};

const ROLE_LABELS: Record<Member["role"], string> = {
  OWNER: "Dono",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  MEMBER: "Membro",
};

export function MembersTable({
  initialMembers,
  currentUserId,
  isOwner,
}: {
  initialMembers: Member[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [memberToDeactivate, setMemberToDeactivate] = useState<Member | null>(null);
  const [memberToReset, setMemberToReset] = useState<Member | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccessName, setResetSuccessName] = useState<string | null>(null);
  const [memberToRename, setMemberToRename] = useState<Member | null>(null);
  const [newName, setNewName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);

  const activeMembers = useMemo(() => initialMembers.filter((m) => m.active), [initialMembers]);
  const inactiveMembers = useMemo(() => initialMembers.filter((m) => !m.active), [initialMembers]);
  const visibleMembers = tab === "active" ? activeMembers : inactiveMembers;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/org/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao adicionar usuário");
      return;
    }

    if (data.tempPassword) {
      setTempPassword(data.tempPassword);
    } else {
      setOpen(false);
    }
    setName("");
    setEmail("");
    setRole("MEMBER");
    router.refresh();
  }

  async function changeRole(userId: string, newRole: Member["role"]) {
    const res = await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) router.refresh();
  }

  async function removeMember(userId: string) {
    const res = await fetch(`/api/org/members/${userId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  async function setActive(userId: string, active: boolean) {
    const res = await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (res.ok) router.refresh();
  }

  function triggerPhotoUpload(userId: string) {
    uploadTargetId.current = userId;
    fileInputRef.current?.click();
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const userId = uploadTargetId.current;
    e.target.value = "";
    if (!file || !userId) return;

    setUploadingId(userId);
    setAvatarError(null);
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`/api/org/members/${userId}/avatar`, { method: "POST", body: formData });
    setUploadingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAvatarError(data.error ?? "Erro ao enviar foto");
      return;
    }

    router.refresh();
  }

  async function resetMemberPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!memberToReset) return;
    setResetLoading(true);
    setResetError(null);

    const res = await fetch(`/api/org/members/${memberToReset.user.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setResetLoading(false);

    if (!res.ok) {
      setResetError(data.error ?? "Erro ao trocar senha");
      return;
    }

    setResetSuccessName(memberToReset.user.name);
    setMemberToReset(null);
    setNewPassword("");
  }

  async function renameMember(e: React.FormEvent) {
    e.preventDefault();
    if (!memberToRename) return;
    setRenameLoading(true);
    setRenameError(null);

    const res = await fetch(`/api/org/members/${memberToRename.user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json().catch(() => ({}));
    setRenameLoading(false);

    if (!res.ok) {
      setRenameError(data.error ?? "Erro ao alterar nome");
      return;
    }

    setMemberToRename(null);
    setNewName("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handlePhotoSelected}
      />

      {avatarError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
          {avatarError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 p-0.5">
          <button
            onClick={() => setTab("active")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "active"
                ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            Ativos ({activeMembers.length})
          </button>
          <button
            onClick={() => setTab("inactive")}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "inactive"
                ? "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-sm"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            Inativos ({inactiveMembers.length})
          </button>
        </div>
        <button onClick={() => setOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Adicionar usuário
        </button>
      </div>

      {visibleMembers.length === 0 ? (
        <div className="card px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          {tab === "active" ? "Nenhum usuário ativo." : "Nenhum usuário inativo."}
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">
          {visibleMembers.map((m) => (
            <div
              key={m.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${!m.active ? "opacity-60" : ""}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {isOwner ? (
                  <button
                    onClick={() => triggerPhotoUpload(m.user.id)}
                    className="group relative shrink-0"
                    title="Alterar foto"
                    disabled={uploadingId === m.user.id}
                  >
                    <Avatar name={m.user.name} src={m.photoUrl} size="sm" />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      {uploadingId === m.user.id ? (
                        <Loader2 className="h-3 w-3 animate-spin text-white" strokeWidth={2} />
                      ) : (
                        <Camera className="h-3 w-3 text-white" strokeWidth={2} />
                      )}
                    </span>
                  </button>
                ) : (
                  <Avatar name={m.user.name} src={m.photoUrl} size="sm" />
                )}
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {m.user.name}
                    {!m.active && <Badge tone="neutral">Inativo</Badge>}
                  </p>
                  <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{m.user.email}</p>
                </div>
              </div>

              <div className="shrink-0">
                {isOwner && m.user.id !== currentUserId ? (
                  <Select
                    value={m.role}
                    onChange={(v) => changeRole(m.user.id, v as Member["role"])}
                    className="min-w-[110px] py-1.5 text-xs"
                    options={[
                      { value: "OWNER", label: "Dono" },
                      { value: "MANAGER", label: "Gerente" },
                      { value: "SUPERVISOR", label: "Supervisor" },
                      { value: "MEMBER", label: "Membro" },
                    ]}
                  />
                ) : (
                  <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                )}
              </div>

              <p className="hidden w-24 shrink-0 truncate text-xs text-neutral-500 dark:text-neutral-400 sm:block">
                {m.team?.name ?? "—"}
              </p>

              {isOwner && (
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => {
                      setMemberToRename(m);
                      setNewName(m.user.name);
                    }}
                    className="icon-btn"
                    title="Alterar nome"
                    aria-label={`Alterar nome de ${m.user.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  {m.active ? (
                    <button
                      onClick={() => setMemberToReset(m)}
                      className="icon-btn"
                      title="Trocar senha"
                      aria-label={`Trocar senha de ${m.user.name}`}
                    >
                      <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : (
                    <button
                      onClick={() => setActive(m.user.id, true)}
                      className="icon-btn hover:text-emerald-600 dark:hover:text-emerald-400"
                      title="Reativar"
                      aria-label={`Reativar ${m.user.name}`}
                    >
                      <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  )}
                  {m.user.id !== currentUserId && (
                    <>
                      {m.active && (
                        <button
                          onClick={() => setMemberToDeactivate(m)}
                          className="icon-btn hover:text-amber-600 dark:hover:text-amber-400"
                          title="Desativar"
                          aria-label={`Desativar ${m.user.name}`}
                        >
                          <UserX className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      )}
                      <button
                        onClick={() => setMemberToRemove(m)}
                        className="icon-btn hover:text-red-600 dark:hover:text-red-400"
                        title="Remover"
                        aria-label={`Remover ${m.user.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Adicionar usuário</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">E-mail</label>
              <input
                autoFocus
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field-input"
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Nome (se ainda não existir)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="field-input" />
            </div>
            <div className="space-y-1">
              <label className="field-label">Papel</label>
              <Select
                value={role}
                onChange={(v) => setRole(v as Member["role"])}
                options={[
                  { value: "MEMBER", label: "Membro" },
                  { value: "SUPERVISOR", label: "Supervisor" },
                  { value: "MANAGER", label: "Gerente" },
                  ...(isOwner ? [{ value: "OWNER", label: "Dono" }] : []),
                ]}
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading || !email.trim()} className="btn-primary">
                {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    Adicionando
                    <LoadingDots />
                  </span>
                ) : (
                  "Adicionar"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {tempPassword && (
        <TempPasswordDialog
          title="Usuário criado"
          description="Compartilhe a senha temporária abaixo — ela não será mostrada novamente."
          password={tempPassword}
          onClose={() => {
            setTempPassword(null);
            setOpen(false);
          }}
        />
      )}

      {memberToRemove && (
        <ConfirmDialog
          title={`Remover ${memberToRemove.user.name}?`}
          description="A pessoa perde acesso imediatamente a esta organização. Essa ação não pode ser desfeita."
          confirmLabel="Remover"
          onClose={() => setMemberToRemove(null)}
          onConfirm={async () => {
            await removeMember(memberToRemove.user.id);
            setMemberToRemove(null);
          }}
        />
      )}

      {memberToDeactivate && (
        <ConfirmDialog
          title={`Desativar ${memberToDeactivate.user.name}?`}
          description="A pessoa perde acesso imediatamente (sessões ativas são encerradas) e a foto de perfil é apagada. Ela fica na aba de inativos e pode ser reativada depois."
          confirmLabel="Desativar"
          onClose={() => setMemberToDeactivate(null)}
          onConfirm={async () => {
            await setActive(memberToDeactivate.user.id, false);
            setMemberToDeactivate(null);
          }}
        />
      )}

      {memberToReset && (
        <Modal
          onClose={() => {
            setMemberToReset(null);
            setNewPassword("");
            setResetError(null);
          }}
        >
          <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Trocar a senha de {memberToReset.user.name}
          </h2>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
            Defina a nova senha. A senha atual deixará de funcionar imediatamente.
          </p>
          <form onSubmit={resetMemberPassword} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Nova senha</label>
              <PasswordInput value={newPassword} onChange={setNewPassword} required minLength={8} />
            </div>

            {resetError && <p className="text-sm text-red-600 dark:text-red-400">{resetError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMemberToReset(null);
                  setNewPassword("");
                  setResetError(null);
                }}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button type="submit" disabled={resetLoading || newPassword.length < 8} className="btn-primary">
                {resetLoading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {resetLoading ? (
                  <span className="inline-flex items-center gap-1">
                    Trocando
                    <LoadingDots />
                  </span>
                ) : (
                  "Trocar senha"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {memberToRename && (
        <Modal
          onClose={() => {
            setMemberToRename(null);
            setNewName("");
            setRenameError(null);
          }}
        >
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Alterar nome de {memberToRename.user.name}
          </h2>
          <form onSubmit={renameMember} className="space-y-3">
            <div className="space-y-1">
              <label className="field-label">Nome</label>
              <input
                autoFocus
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="field-input"
              />
            </div>

            {renameError && <p className="text-sm text-red-600 dark:text-red-400">{renameError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMemberToRename(null);
                  setNewName("");
                  setRenameError(null);
                }}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button type="submit" disabled={renameLoading || !newName.trim()} className="btn-primary">
                {renameLoading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {renameLoading ? (
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
      )}

      {resetSuccessName && (
        <Modal onClose={() => setResetSuccessName(null)}>
          <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Senha alterada
          </h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            A senha de {resetSuccessName} foi alterada com sucesso.
          </p>
          <div className="flex justify-end">
            <button onClick={() => setResetSuccessName(null)} className="btn-primary">
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
