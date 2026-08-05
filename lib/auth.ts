import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { rateLimit, resetRateLimit, getClientIp } from "@/lib/rate-limit";
import { runWithTenant, runWithTenantUser } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";

/**
 * Acha a organização mais relevante pra atribuir um evento de login a essa
 * pessoa — ativa em primeiro lugar (é a que o próprio login usa), mas cai
 * pra qualquer filiação (mesmo inativa) pra login FALHO ainda deixar rastro
 * em alguma organização em vez de sumir sem log nenhum. `null` só quando a
 * pessoa não tem filiação alguma.
 */
async function resolveOrgForAuditLog(userId: string): Promise<string | null> {
  const membership = await runWithTenantUser(userId, () =>
    prisma.organizationUser.findFirst({
      where: { userId },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      select: { organizationId: true },
    }),
  );
  return membership?.organizationId ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials, request) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const ip = getClientIp(request);

        const key = `login:${email.toLowerCase()}`;
        const { allowed, retryAfterMs } = rateLimit(key, 5, 15 * 60 * 1000);
        if (!allowed) {
          console.warn(`[auth] login bloqueado por rate limit: ${email} (tenta de novo em ${Math.ceil(retryAfterMs / 1000)}s)`);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.password) {
          console.warn(`[auth] login falhou: ${email} não encontrado ou sem senha cadastrada`);
          return null;
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          console.warn(`[auth] login falhou: senha incorreta para ${email}`);
          const orgId = await resolveOrgForAuditLog(user.id);
          if (orgId) {
            await logAudit({
              organizationId: orgId,
              actorUserId: user.id,
              actorName: user.name,
              action: "LOGIN_FAILED",
              detail: "Senha incorreta",
              ip,
            });
          }
          return null;
        }

        const hasActiveMembership = await runWithTenantUser(user.id, () =>
          prisma.organizationUser.findFirst({
            where: { userId: user.id, active: true },
            select: { id: true, organizationId: true },
          }),
        );
        if (!hasActiveMembership) {
          console.warn(`[auth] login falhou: ${email} não tem nenhuma organização ativa`);
          const orgId = await resolveOrgForAuditLog(user.id);
          if (orgId) {
            await logAudit({
              organizationId: orgId,
              actorUserId: user.id,
              actorName: user.name,
              action: "LOGIN_FAILED",
              detail: "Sem organização ativa",
              ip,
            });
          }
          return null;
        }

        resetRateLimit(key);
        await logAudit({
          organizationId: hasActiveMembership.organizationId,
          actorUserId: user.id,
          actorName: user.name,
          action: "LOGIN_SUCCESS",
          ip,
        });
        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        const membership = await runWithTenantUser(user.id, () =>
          prisma.organizationUser.findFirst({
            where: { userId: user.id!, active: true },
            orderBy: { createdAt: "asc" },
          }),
        );
        if (membership) {
          token.organizationId = membership.organizationId;
          token.role = membership.role;
        }
      } else if (token.id) {
        // Sem `user` (toda requisição depois do login) — tenta atualizar o
        // papel/organização. Primeiro, busca uma membership dentro da MESMA
        // organização já fixada no token (comportamento original).
        if (token.organizationId) {
          const membership = await runWithTenant(token.organizationId as string, () =>
            prisma.organizationUser.findUnique({
              where: {
                organizationId_userId: {
                  organizationId: token.organizationId as string,
                  userId: token.id as string,
                },
              },
              select: { role: true, active: true },
            }),
          );
          if (membership?.active) {
            token.role = membership.role;
          } else {
            // Membership atual não existe mais ou foi desativada — tenta
            // encontrar QUALQUER outra organização ativa que esse usuário
            // faça parte. Se encontrar, troca pra ela; se não, remove o
            // organizationId do token (usuário fica sem acesso até ser
            // reconvidado, sem precisar de logout manual).
            const anyActive = await runWithTenantUser(token.id as string, () =>
              prisma.organizationUser.findFirst({
                where: { userId: token.id as string, active: true },
                orderBy: { createdAt: "asc" },
              }),
            );
            if (anyActive) {
              console.warn(
                `[auth] usuário ${token.id} teve membership em org ${token.organizationId} desativada/removida — migrando automaticamente para org ${anyActive.organizationId}`,
              );
              token.organizationId = anyActive.organizationId;
              token.role = anyActive.role;
            } else {
              console.warn(
                `[auth] usuário ${token.id} não tem nenhuma organização ativa — removendo organizationId do token`,
              );
              delete token.organizationId;
              delete token.role;
            }
          }
        } else {
          // Token sem organizationId (ou porque o usuário acabou de ficar sem
          // nenhuma org ativa na rodada acima) — tenta recuperar caso uma
          // membership tenha sido recriada. Sem isso, o usuário teria que
          // relogar mesmo após ser reconvidado.
          const anyActive = await runWithTenantUser(token.id as string, () =>
            prisma.organizationUser.findFirst({
              where: { userId: token.id as string, active: true },
              orderBy: { createdAt: "asc" },
            }),
          );
          if (anyActive) {
            token.organizationId = anyActive.organizationId;
            token.role = anyActive.role;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.organizationId = token.organizationId as string | undefined;
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
});
