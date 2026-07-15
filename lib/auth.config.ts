import type { NextAuthConfig } from "next-auth";

// Só fazem sentido pra quem NÃO está logado — quem já tem sessão é
// redirecionado de volta pro painel se tentar abrir uma dessas.
const AUTH_ONLY_PATHS = ["/login", "/register"];
// Acessíveis com ou sem sessão, sem redirecionar em nenhum dos casos —
// documentação pública da API, pensada pra quem vai integrar (Make/Zapier/
// gerador de leads) e nunca vai logar no CRM.
const PUBLIC_PATHS = ["/docs"];

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isAuthOnly = AUTH_ONLY_PATHS.some((p) => path.startsWith(p));
      const isPublic = isAuthOnly || PUBLIC_PATHS.some((p) => path.startsWith(p));

      if (auth?.user && isAuthOnly) {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      if (!auth?.user && !isPublic) return false;
      return true;
    },
  },
} satisfies NextAuthConfig;
