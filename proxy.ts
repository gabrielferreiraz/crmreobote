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
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)"],
};
