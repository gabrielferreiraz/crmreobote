import { getCurrentMembership } from "@/lib/current-membership";

export type ServopaTablesAccess =
  | { ok: false }
  | {
      ok: true;
      organizationId: string;
      userId: string;
      actorName: string;
      /** Só donos, gerentes e a área Administrativo mexem no desconto/acréscimo (e só eles). */
      canAdjust: boolean;
      /** Opera o robô: somente Dono e área Administrativo. */
      canOperate: boolean;
    };

/** Qualquer pessoa ativa da organização vê e imprime as tabelas; quem pode ajustar a taxa é restrito. */
export async function getServopaTablesAccess(): Promise<ServopaTablesAccess> {
  const m = await getCurrentMembership();
  if (!m?.active) return { ok: false };
  return {
    ok: true,
    organizationId: m.organizationId,
    userId: m.userId,
    actorName: m.session.user.name ?? "Usuário",
    canAdjust: m.role === "OWNER" || m.role === "MANAGER" || m.area === "ADMINISTRATIVO",
    canOperate: m.role === "OWNER" || m.area === "ADMINISTRATIVO",
  };
}
