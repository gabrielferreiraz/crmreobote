"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Loader2, KeyRound, Camera, UserX, UserCheck, Trash2, Pencil, History } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PasswordInput } from "@/components/password-input";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";

type Member = {
  id: string;
  role: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
  active: boolean;
  canManageProcesses: boolean;
  area: "VENDAS" | "ADMINISTRATIVO";
  user: { id: string; name: string; email: string; birthDate: Date | string | null };
  team: { id: string; name: string } | null;
  photoUrl: string | null;
  lastActiveAt: Date | string | null;
  whatsappConnected: boolean;
  whatsappPhone: string | null;
};

/** "2026-07-12" → "12/07" (dia/mês, sem ano — pra mostrar sob o e-mail na tabela, ver aniversário). */
function formatBirthDateShort(value: Member["user"]["birthDate"]): string | null {
  if (!value) return null;
  const d = new Date(value);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-07-12T00:00:00.000Z" → "2026-07-12", o formato que <input type="date"> espera. */
function toDateInputValue(value: Member["user"]["birthDate"]): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

const ROLE_LABELS: Record<Member["role"], string> = {
  OWNER: "Dono",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  MEMBER: "Membro",
};

// Mesma lista de colunas no cabeçalho e em cada linha — é o que garante que
// select, badge, checkbox ou nada (célula vazia) sempre caem exatamente sob
// a coluna certa, em vez de empurrar o resto da linha quando um campo não
// se aplica (ex.: Dono não tem Papel/Área pra escolher).
const GRID_COLS = "lg:grid-cols-[minmax(0,1fr)_110px_100px_120px_140px_100px_140px]";

// Espelha ONLINE_THRESHOLD_MS de lib/user-activity.ts — não importa direto
// de lá porque esse módulo puxa o client do Prisma, que não pode entrar no
// bundle do navegador.
const ONLINE_THRESHOLD_MS = 2 * 60_000;

function isOnline(lastActiveAt: Member["lastActiveAt"]) {
  if (!lastActiveAt) return false;
  return Date.now() - new Date(lastActiveAt).getTime() < ONLINE_THRESHOLD_MS;
}

/** "17/07/2026 14:32" — data/hora cheia do último heartbeat, pra "Acessado pela última vez em". */
function lastSeenFull(lastActiveAt: Member["lastActiveAt"]) {
  if (!lastActiveAt) return null;
  return new Date(lastActiveAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const [area, setNewMemberArea] = useState<Member["area"]>("VENDAS");
  // Só o Dono cria usuário, e SEMPRE digitando a senha aqui — nunca mais
  // gerada pelo sistema (ver POST /api/org/members). O botão "Adicionar
  // usuário" abaixo já é isOwner-only, então este campo só existe pra quem
  // pode preenchê-lo.
  const [createPassword, setCreatePassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [memberToDeactivate, setMemberToDeactivate] = useState<Member | null>(null);
  const [memberToReset, setMemberToReset] = useState<Member | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccessName, setResetSuccessName] = useState<string | null>(null);
  const [memberToRename, setMemberToRename] = useState<Member | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  // "de nascimento" — mesmo diálogo de editar nome, ver renameMember abaixo
  // (nome "rename" ficou curto pro que o diálogo faz agora, mas não vale o
  // risco de renomear função/estado usados em vários lugares só por isso).
  const [newBirthDate, setNewBirthDate] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);
  const [presence, setPresence] = useState<Record<string, string | null>>({});

  // Atualiza os pontinhos de "online" sozinho, sem re-render da página
  // inteira (router.refresh() re-buscaria tudo do servidor à toa).
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const res = await fetch("/api/presence/status");
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (cancelled || !data?.members) return;
      const next: Record<string, string | null> = {};
      for (const m of data.members as { userId: string; lastActiveAt: string | null }[]) {
        next[m.userId] = m.lastActiveAt;
      }
      setPresence(next);
    }

    poll();
    const interval = setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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
      body: JSON.stringify({ name, email, role, area, password: createPassword }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Erro ao adicionar usuário");
      return;
    }

    setOpen(false);
    setName("");
    setEmail("");
    setRole("MEMBER");
    setNewMemberArea("VENDAS");
    setCreatePassword("");
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

  async function setCanManageProcesses(userId: string, canManageProcesses: boolean) {
    const res = await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canManageProcesses }),
    });
    if (res.ok) router.refresh();
  }

  async function setArea(userId: string, area: Member["area"]) {
    const res = await fetch(`/api/org/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area }),
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
      body: JSON.stringify({ name: newName, email: newEmail, birthDate: newBirthDate || null }),
    });
    const data = await res.json().catch(() => ({}));
    setRenameLoading(false);

    if (!res.ok) {
      setRenameError(data.error ?? "Erro ao salvar perfil");
      return;
    }

    setMemberToRename(null);
    setNewName("");
    setNewBirthDate("");
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
        {/* Só o Dono cria usuário — é quem também define a senha na hora
            (ver formulário abaixo), então Gerente nunca chega a abrir este
            diálogo. Reforçado também no servidor (POST /api/org/members é
            OWNER-only), esta checagem aqui é só pra não oferecer um botão
            que ia devolver 403. */}
        {isOwner && (
          <button onClick={() => setOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Adicionar usuário
          </button>
        )}
      </div>

      {visibleMembers.length === 0 ? (
        <div className="card px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          {tab === "active" ? "Nenhum usuário ativo." : "Nenhum usuário inativo."}
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100 overflow-hidden dark:divide-neutral-800">
          <div className={`hidden gap-4 px-4 py-2.5 text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500 lg:grid lg:items-center ${GRID_COLS}`}>
            <span>Usuário</span>
            <span>Papel</span>
            <span>Equipe</span>
            <span>WhatsApp</span>
            <span>Área</span>
            <span>Processos</span>
            <span />
          </div>
          {visibleMembers.map((m) => {
            const effectiveLastActiveAt = m.user.id in presence ? presence[m.user.id] : m.lastActiveAt;
            const online = isOnline(effectiveLastActiveAt);
            const seenFull = lastSeenFull(effectiveLastActiveAt);
            const hasImplicitProcessAccess = m.role === "OWNER" || m.area === "ADMINISTRATIVO";

            return (
            <div
              key={m.id}
              className={`grid grid-cols-1 gap-3 p-4 transition-colors lg:items-center lg:gap-4 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 ${GRID_COLS} ${!m.active ? "opacity-60" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {isOwner ? (
                  <button
                    onClick={() => triggerPhotoUpload(m.user.id)}
                    className="group relative shrink-0"
                    title="Alterar foto"
                    disabled={uploadingId === m.user.id}
                  >
                    <Avatar name={m.user.name} src={m.photoUrl} size="sm" />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 coarse:opacity-100">
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
                  <p className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    <span className="min-w-0 truncate">{m.user.name}</span>
                    {!m.active && (
                      <Badge tone="neutral" className="shrink-0">
                        Inativo
                      </Badge>
                    )}
                    {/* Só um pontinho — a legenda "Online agora"/"Acessado pela última
                        vez..." logo abaixo já diz o mesmo com texto; repetir isso aqui
                        numa pílula cheia só disputava espaço com o nome à toa. */}
                    {m.active && (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          online ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"
                        }`}
                        title={online ? "Online" : "Offline"}
                      />
                    )}
                  </p>
                  {/* Sem truncate de propósito — diferente do nome/status acima, o
                      e-mail é informação que às vezes precisa ser copiada/conferida
                      de verdade; break-all deixa quebrar linha em vez de esconder
                      atrás de reticências. */}
                  <p className="text-xs break-all text-neutral-500 dark:text-neutral-400">{m.user.email}</p>
                  {formatBirthDateShort(m.user.birthDate) && (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">🎂 {formatBirthDateShort(m.user.birthDate)}</p>
                  )}
                  {m.active && (
                    <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                      {online
                        ? "Online agora"
                        : seenFull
                          ? `Acessado pela última vez em ${seenFull}`
                          : "Ainda não acessou"}
                    </p>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                {isOwner && m.user.id !== currentUserId ? (
                  <Select
                    value={m.role}
                    onChange={(v) => changeRole(m.user.id, v as Member["role"])}
                    className="w-full py-1.5 text-xs"
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

              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{m.team?.name ?? "—"}</p>

              <div className="min-w-0">
                {/* Mesmo selo (cor/pontinho) que "Atividade por vendedor" em
                    relatorios/page.tsx já usa pro mesmo status — pensado pra
                    o Dono/Gerente bater o olho em quem está com o número
                    caído sem precisar abrir Relatórios. */}
                <span
                  title={m.whatsappConnected && m.whatsappPhone ? `Conectado — ${m.whatsappPhone}` : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    m.whatsappConnected
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.whatsappConnected ? "bg-emerald-500" : "bg-neutral-400"}`} />
                  {m.whatsappConnected ? "Conectado" : "Desconectado"}
                </span>
              </div>

              <div className="min-w-0">
                {m.role === "OWNER" ? (
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">—</span>
                ) : isOwner ? (
                  <div
                    title="Área de atuação — Administrativo troca a tela inicial e os relatórios pra pós-venda, tira o acesso ao CRM de vendas e dá acesso total a Processos (todos os clientes ganhos da organização)"
                  >
                    <Select
                      value={m.area}
                      onChange={(v) => setArea(m.user.id, v as Member["area"])}
                      className="w-full py-1.5 text-xs"
                      options={[
                        { value: "VENDAS", label: "Vendas" },
                        { value: "ADMINISTRATIVO", label: "Administrativo" },
                      ]}
                    />
                  </div>
                ) : (
                  <Badge tone={m.area === "ADMINISTRATIVO" ? "accent" : "neutral"}>
                    {m.area === "ADMINISTRATIVO" ? "Administrativo" : "Vendas"}
                  </Badge>
                )}
              </div>

              <div className="min-w-0">
                {hasImplicitProcessAccess ? (
                  <span title="Acesso total a Processos — automático pra Dono e área Administrativo">
                    <Badge tone="accent">Total</Badge>
                  </span>
                ) : isOwner ? (
                  <label
                    className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"
                    title="Acesso administrativo ao Processos (pós-venda) mesmo sendo da área Vendas — edita etapas e move cards de todos os clientes ganhos"
                  >
                    <input
                      type="checkbox"
                      checked={m.canManageProcesses}
                      onChange={(e) => setCanManageProcesses(m.user.id, e.target.checked)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-neutral-300 dark:border-neutral-700"
                    />
                    {m.canManageProcesses ? "Sim" : "Não"}
                  </label>
                ) : (
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">{m.canManageProcesses ? "Sim" : "—"}</span>
                )}
              </div>

              {isOwner ? (
                <div className="flex shrink-0 items-center gap-1 lg:justify-self-end">
                  <button
                    onClick={() => {
                      setMemberToRename(m);
                      setNewName(m.user.name);
                      setNewEmail(m.user.email);
                      setNewBirthDate(toDateInputValue(m.user.birthDate));
                    }}
                    className="icon-btn"
                    title="Editar perfil"
                    aria-label={`Editar perfil de ${m.user.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <Link
                    href={`/configuracoes/usuarios/${m.user.id}/whatsapp-backup`}
                    className="icon-btn"
                    title="Backup de mensagens WhatsApp"
                    aria-label={`Ver backup de mensagens de WhatsApp de ${m.user.name}`}
                  >
                    <History className="h-3.5 w-3.5" strokeWidth={2} />
                  </Link>
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
                      {/* Separa "gerenciar perfil" (nome, backup, senha) das ações que
                          afetam o acesso da pessoa — um respiro visual antes do que
                          precisa de mais atenção antes de clicar. */}
                      <span className="mx-0.5 h-4 w-px shrink-0 bg-neutral-200 dark:bg-neutral-800" />
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
              ) : (
                <span className="hidden lg:block" />
              )}
            </div>
            );
          })}
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
              <label className="field-label">Senha (se ainda não existir)</label>
              <PasswordInput value={createPassword} onChange={setCreatePassword} minLength={8} />
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Só o Dono define essa senha — a pessoa nunca cria a própria. Se o e-mail já for de um usuário
                existente (de outra organização), este campo é ignorado — a senha dele continua a mesma.
              </p>
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
            {role !== "OWNER" && (
              <div className="space-y-1">
                <label className="field-label">Área</label>
                <Select
                  value={area}
                  onChange={(v) => setNewMemberArea(v as Member["area"])}
                  options={[
                    { value: "VENDAS", label: "Vendas" },
                    { value: "ADMINISTRATIVO", label: "Administrativo (pós-venda)" },
                  ]}
                />
              </div>
            )}

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
            setNewEmail("");
            setNewBirthDate("");
            setRenameError(null);
          }}
        >
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Editar perfil de {memberToRename.user.name}
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
            <div className="space-y-1">
              <label className="field-label">E-mail</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="field-input"
              />
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                É o login da pessoa — trocar aqui muda com o que ela entra no CRM.
              </p>
            </div>
            <div className="space-y-1">
              <label className="field-label">Data de nascimento (opcional)</label>
              <input
                type="date"
                value={newBirthDate}
                onChange={(e) => setNewBirthDate(e.target.value)}
                className="field-input"
              />
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                Usada pra mostrar os aniversariantes do mês no dashboard da TV.
              </p>
            </div>

            {renameError && <p className="text-sm text-red-600 dark:text-red-400">{renameError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMemberToRename(null);
                  setNewName("");
                  setNewEmail("");
                  setNewBirthDate("");
                  setRenameError(null);
                }}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button type="submit" disabled={renameLoading || !newName.trim() || !newEmail.trim()} className="btn-primary">
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
