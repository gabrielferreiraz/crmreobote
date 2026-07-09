import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { runWithTenantUser } from "@/lib/tenant-context";

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
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

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
          return null;
        }

        const hasActiveMembership = await runWithTenantUser(user.id, () =>
          prisma.organizationUser.findFirst({
            where: { userId: user.id, active: true },
            select: { id: true },
          }),
        );
        if (!hasActiveMembership) {
          console.warn(`[auth] login falhou: ${email} não tem nenhuma organização ativa`);
          return null;
        }

        resetRateLimit(key);
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
