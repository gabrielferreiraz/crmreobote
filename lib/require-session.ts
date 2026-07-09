import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return { session: null, organizationId: null } as const;
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
    return { session: null, organizationId: null } as const;
  }

  return {
    session,
    organizationId: session.user.organizationId,
    userId: session.user.id,
  } as const;
}
