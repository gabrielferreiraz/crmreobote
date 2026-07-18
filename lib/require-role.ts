import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export async function requireRole(roles: Array<"OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER">) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return { ok: false as const, session: null, organizationId: null };
  }

  // Roda a checagem de bootstrap dentro de runWithTenant (storage.run), não
  // setTenant/enterWith — enterWith não garante que o contexto sobreviva até
  // esta consulta ser de fato executada, o que já causou checagens de "está
  // ativo?" falharem silenciosamente (RLS bloqueia tudo sem contexto).
  //
  // Busca `active` E `role` direto no banco (não confia no JWT pra nenhum dos
  // dois) — a sessão JWT só é atualizada no login (ver callback jwt() em
  // lib/auth.ts), então um papel trocado (ex.: rebaixar um MANAGER pra
  // MEMBER via PATCH /api/org/members/[userId]) só valeria na próxima vez
  // que a pessoa logasse de novo, até 30 dias depois (maxAge padrão do
  // NextAuth), se a checagem confiasse em session.user.role.
  const membership = await runWithTenant(session.user.organizationId, () =>
    prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: {
          organizationId: session.user.organizationId!,
          userId: session.user.id,
        },
      },
      select: { active: true, role: true },
    }),
  );
  if (!membership?.active) {
    return { ok: false as const, session: null, organizationId: null };
  }

  if (!roles.includes(membership.role)) {
    return { ok: false as const, session, organizationId: session.user.organizationId };
  }

  return {
    ok: true as const,
    session,
    organizationId: session.user.organizationId,
    userId: session.user.id,
    role: membership.role,
  };
}
