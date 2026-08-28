import type { NextAuthConfig } from "next-auth";

// Só fazem sentido pra quem NÃO está logado — quem já tem sessão é
// redirecionado de volta pro painel se tentar abrir uma dessas.
const AUTH_ONLY_PATHS = ["/login", "/register"];
// Acessíveis com ou sem sessão, sem redirecionar em nenhum dos casos —
// documentação pública da API, pensada pra quem vai integrar (Make/Zapier/
// gerador de leads) e nunca vai logar no CRM.
//
// "/t/" (com barra no fim, não só "/t") é o link público (sem login) do
// dashboard da TV (ver app/t/[code]/page.tsx, lib/require-tv-link.ts) —
// SEM isto aqui, o proxy (ver proxy.ts, o antigo middleware.ts nesta
// versão do Next) barra a requisição ANTES dela sequer chegar na página,
// redirecionando pra /login mesmo com o código certo — foi exatamente o
// bug relatado ("o link público ainda assim pede login"): a página em si
// nunca teve chance de rodar. A barra no fim evita casar por prefixo com
// alguma rota futura que comece com "t" (ex.: "/tarefas") sem querer — a
// segurança de verdade continua sendo o código em si (hash + rate limit em
// lib/require-tv-link.ts), isto aqui só destranca o proxy pra deixar a
// página decidir.
const PUBLIC_PATHS = ["/docs", "/t/"];

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
