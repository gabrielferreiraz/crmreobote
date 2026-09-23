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
//
// "/c/" é o mesmo tipo de liberação, pro Cartão Digital público (ver
// app/c/[slug]/page.tsx, lib/require-digital-card.ts) — slug não é
// segredo (feito pra ser compartilhado), a "segurança" aqui é só
// active=true na policy de RLS + rate limit por IP.
//
// "/partner-logos/" — os arquivos estáticos das logos parceiras (ver
// lib/digital-cards/logos.ts) moram em public/partner-logos/, FORA da
// raiz de public/. A página do cartão (/c/[slug]) já é pública, mas cada
// <img src="/partner-logos/x.svg"> nela é uma requisição HTTP à parte —
// sem isto aqui, o proxy barrava essa requisição (raiz de public/ não
// tem liberação nenhuma) e redirecionava pro /login antes do arquivo
// estático ser servido, então a logo nunca aparecia pra quem visse o
// cartão deslogado (todo mundo, exceto o próprio consultor logado).
//
// "/card-defaults/" — mesmo motivo exato, pro avatar/capa/fundo padrão do
// Cartão Digital (ver lib/digital-cards/config.ts, DEFAULT_AVATAR_URL
// etc.) — também fica fora da raiz de public/, então precisa da mesma
// liberação.
//
// "/images/" — 3º caso do mesmo bug: a logo da Reobote na TV (ver
// app/tv/tv-view.tsx, `<img src="/images/LOGO-BRANCA.png">`) nunca é vista
// por quem abre o link público (/t/[código], já liberado acima) porque É
// UMA REQUISIÇÃO HTTP À PARTE — sem sessão nenhuma (a TV física NUNCA loga,
// é um aparelho pendurado na parede), o proxy barrava essa 2ª requisição e
// devolvia a página de /login (HTML) no lugar do PNG, então a logo nunca
// carregava — mas só nessa TV real, nunca no PC de quem estava testando já
// logado no CRM no mesmo navegador (a sessão passava escondida pra essa
// requisição também). Relatado como "a logo não aparece só na TV" antes de
// se descobrir a causa.
const PUBLIC_PATHS = ["/docs", "/t/", "/c/", "/partner-logos/", "/card-defaults/", "/images/"];

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
