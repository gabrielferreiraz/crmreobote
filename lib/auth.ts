import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { rateLimit, resetRateLimit, peekRateLimit, getClientIp } from "@/lib/rate-limit";
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

/**
 * Login barrado por excesso de tentativas. Subclasse de CredentialsSignin só pra
 * levar um `code` até a tela (o next-auth v5 devolve `res.code` no signIn do
 * cliente) — assim quem foi bloqueado vê "muitas tentativas" em vez de "e-mail
 * ou senha inválidos" (que fazia o bloqueio parecer que nada acontecia). Não
 * revela nada sobre a conta: o limite vale pra QUALQUER e-mail digitado, exista
 * ou não, e é checado antes de consultar o banco.
 */
class LoginRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Por e-mail: 5 tentativas / 15 min (conta TODA tentativa, zera no sucesso).
const LOGIN_EMAIL_LIMIT = 5;
// Por IP: 30 FALHAS / 15 min — pega quem testa uma senha comum em muitos
// e-mails (password spraying), que o limite por e-mail sozinho não vê. Só
// falha conta (ver peekRateLimit): o escritório todo sai pelo mesmo IP.
const LOGIN_IP_FAILURE_LIMIT = 30;

// Hash bcrypt de um valor aleatório, calculado uma vez: gasta o MESMO tempo de
// CPU quando o e-mail não existe. Sem isto, e-mail inexistente respondia em
// ~1ms e e-mail real em ~100ms (bcrypt) — o tempo de resposta denunciava quais
// contas existem, mesmo com a mensagem de erro genérica.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(`dummy-${Math.random().toString(36)}-${Date.now()}`, 10);

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
        // Sem cabeçalho de proxy o IP vem "unknown" (dev/conexão direta) — todos
        // dividiriam a mesma chave e um bloquearia todos, então não limita por IP.
        const ipKey = ip !== "unknown" ? `login-ip:${ip}` : null;
        const recordIpFailure = () => {
          if (ipKey) rateLimit(ipKey, LOGIN_IP_FAILURE_LIMIT, LOGIN_WINDOW_MS);
        };

        if (ipKey) {
          const ipState = peekRateLimit(ipKey, LOGIN_IP_FAILURE_LIMIT);
          if (ipState.blocked) {
            console.warn(`[auth] login bloqueado por excesso de falhas do IP ${ip} (tenta de novo em ${Math.ceil(ipState.retryAfterMs / 1000)}s)`);
            throw new LoginRateLimited();
          }
        }

        const key = `login:${email.toLowerCase()}`;
        const { allowed, retryAfterMs } = rateLimit(key, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS);
        if (!allowed) {
          console.warn(`[auth] login bloqueado por rate limit: ${email} (tenta de novo em ${Math.ceil(retryAfterMs / 1000)}s)`);
          throw new LoginRateLimited();
        }

        // Único ponto que precisa do hash — `omit: { password: false }` desfaz o omit
        // global de lib/prisma-omit.ts, de propósito e só aqui.
        const user = await prisma.user.findUnique({ where: { email }, omit: { password: false } });
        if (!user?.password) {
          console.warn(`[auth] login falhou: ${email} não encontrado ou sem senha cadastrada`);
          // Mesmo custo de CPU do caminho "e-mail existe" (ver DUMMY_PASSWORD_HASH).
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          recordIpFailure();
          return null;
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          console.warn(`[auth] login falhou: senha incorreta para ${email}`);
          recordIpFailure();
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
          recordIpFailure();
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
