import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

// manifest.webmanifest (app/manifest.ts) e sw.js (public/, service worker
// das notificações push — ver lib/use-push-subscription.ts) são buscados
// pelo NAVEGADOR sozinho, sem sessão nenhuma garantida (o manifest é lido
// em toda navegação, pra saber ícone/nome de "instalar app"; o service
// worker precisa do arquivo JS de verdade pra registrar, nunca de uma
// página de login). Sem excluir os dois aqui, o proxy tratava os dois como
// rota protegida — `authorized` (ver lib/auth.config.ts) barrava quem não
// tinha sessão e redirecionava pro /login, o que devolvia HTML no lugar do
// manifest/script esperado (o registro do service worker falha silencioso;
// o navegador loga barulho de menos, não mais, então passou despercebido
// até aparecer nos logs do dev server).
//
// theme-init.js (public/, aplica o tema escuro antes da primeira pintura —
// ver app/layout.tsx) é o mesmo caso: carregado como <script src> em TODA
// página, inclusive /login e o cartão público, onde não há sessão. Sem
// excluir aqui, o script vira um redirect pro /login (HTML no lugar de JS,
// bloqueado pelo navegador) e o tema escuro volta a piscar branco antes de
// carregar exatamente pra quem ainda não entrou.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|theme-init.js).*)"],
};
