import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export async function requireRole(roles: Array<"OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER">) {
  const session = await auth();
  if (!session?.user?.organizationId || !session.user.role) {
    return { ok: false as const, session: null, organizationId: null };
  }

  // Roda a checagem de bootstrap dentro de runWithTenant (storage.run), não
  // setTenant/enterWith — enterWith não garante que o contexto sobreviva até
  // esta consulta ser de fato executada, o que já causou checagens de "está
  // ativo?" falharem silenciosamente (RLS bloqueia tudo sem contexto).
  //
  // Verifica direto no banco (não confia só no JWT) para que uma desativação
  // tenha efeito imediato, mesmo com uma sessão já emitida.
  const membership = await runWithTenant(session.user.organizationId, () =>
    prisma.organizationUser.findUnique({
      where: {
        organizationId_userId: {
          organizationId: session.user.organizationId!,
          userId: session.user.id,
        },
      },
      select: { active: true },
    }),
  );
  if (!membership?.active) {
    return { ok: false as const, session: null, organizationId: null };
  }

  if (!roles.includes(session.user.role as "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER")) {
    return { ok: false as const, session, organizationId: session.user.organizationId };
  }

  return {
    ok: true as const,
    session,
    organizationId: session.user.organizationId,
    userId: session.user.id,
    role: session.user.role as "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER",
  };
}
