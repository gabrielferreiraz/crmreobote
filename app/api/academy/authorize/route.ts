import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCurrentMembership } from "@/lib/current-membership";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { safeInternalPath } from "@/lib/safe-redirect";
import {
  AUTH_CODE_TTL_MS,
  isKnownClientId,
  isValidState,
  isValidCodeChallenge,
  generateOpaqueSecret,
  getAcademyBaseUrl,
} from "@/lib/academy-oauth";

export const dynamic = "force-dynamic";

const PENDING_COOKIE = "academy_authorize_pending";
/** Só precisa sobreviver ao tempo de digitar a senha no login — bem mais folgado que isso de propósito. */
const PENDING_COOKIE_MAX_AGE_S = 600;

type PendingParams = { state: string; codeChallenge: string };

function badRequest(message: string) {
  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Erro</title></head><body><p>${message}</p></body></html>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function readPendingCookie(req: NextRequest): PendingParams | null {
  const raw = req.cookies.get(PENDING_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingParams>;
    // Revalida o formato mesmo vindo do próprio cookie que nós gravamos —
    // defesa em profundidade (mesmo espírito do google_oauth_redirect em
    // app/api/google-calendar/callback/route.ts revalidar o cookie dele).
    if (
      typeof parsed.state === "string" &&
      isValidState(parsed.state) &&
      typeof parsed.codeChallenge === "string" &&
      isValidCodeChallenge(parsed.codeChallenge)
    ) {
      return { state: parsed.state, codeChallenge: parsed.codeChallenge };
    }
    return null;
  } catch {
    return null;
  }
}

function clearPendingCookie(res: NextResponse) {
  res.cookies.delete(PENDING_COOKIE);
}

/**
 * GET /api/academy/authorize — endpoint de autorização OAuth 2.0
 * (Authorization Code + PKCE) pra Reobote Academy. Aberto pelo NAVEGADOR,
 * redirecionado pela própria Academy (ela inicia o fluxo em `/auth/start`,
 * ver botão "Treinamento" no header/menu/central de ajuda) — nunca chamado
 * direto pelo backend dela (essa troca é POST /api/academy/token).
 *
 * client_secret NÃO entra aqui — o navegador não deveria nunca ver um
 * segredo de cliente confidencial; só o client_id (não-secreto) e os
 * parâmetros PKCE públicos (code_challenge, nunca o code_verifier).
 *
 * Sem sessão: precisa logar primeiro e RETOMAR depois (spec explícito). O
 * destino de volta do login é só `/api/academy/authorize` SEM query string
 * — `state` pode ter até 512 caracteres (spec da Academy), o que estouraria
 * o limite de tamanho de safeInternalPath (lib/safe-redirect.ts) se fosse
 * tudo colado na URL de callbackUrl. Em vez disso, os parâmetros validados
 * ficam num cookie HttpOnly curto (mesmo padrão já usado em
 * app/api/google-calendar/{authorize,callback}, que guarda o destino de
 * volta em cookie em vez de query string) — lido de novo quando a pessoa
 * volta aqui já logada.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hasQuery = url.search.length > 0;

  let state: string;
  let codeChallenge: string;

  if (hasQuery) {
    const responseType = url.searchParams.get("response_type");
    const clientId = url.searchParams.get("client_id");
    const rawState = url.searchParams.get("state");
    const rawCodeChallenge = url.searchParams.get("code_challenge");
    const codeChallengeMethod = url.searchParams.get("code_challenge_method");

    // Validação ANTES de qualquer outra coisa, inclusive antes de checar
    // sessão — parâmetro inválido nunca deveria chegar a pedir login. Nunca
    // redireciona pra Academy nesse caso (só ela recebe `state` de volta, e
    // um state que não confere formato não é seguro de ecoar pra lugar nenhum).
    if (responseType !== "code") return badRequest("response_type inválido.");
    if (!clientId || !isKnownClientId(clientId)) return badRequest("client_id inválido.");
    if (!rawState || !isValidState(rawState)) return badRequest("state inválido.");
    if (!rawCodeChallenge || !isValidCodeChallenge(rawCodeChallenge)) return badRequest("code_challenge inválido.");
    if (codeChallengeMethod !== "S256") return badRequest("code_challenge_method precisa ser S256.");

    state = rawState;
    codeChallenge = rawCodeChallenge;
  } else {
    // Sem query: só faz sentido estar retomando depois do login (ver abaixo).
    const pending = readPendingCookie(req);
    if (!pending) return badRequest("Sessão de autorização expirada. Abra o treinamento novamente.");
    state = pending.state;
    codeChallenge = pending.codeChallenge;
  }

  const academyBase = getAcademyBaseUrl();
  if (!academyBase) return badRequest("A Reobote Academy não está disponível agora.");
  const callbackUrl = new URL("/auth/callback", academyBase);

  // Sem sessão nenhuma: guarda os parâmetros (já validados acima) num
  // cookie curto e manda pro login — ver safeInternalPath(/api/academy/
  // authorize), que SEMPRE valida, mesmo sendo um caminho fixo nosso.
  const session = await auth();
  if (!session?.user) {
    const safePath = safeInternalPath("/api/academy/authorize");
    const loginUrl = new URL("/login", url.origin);
    if (safePath) loginUrl.searchParams.set("callbackUrl", safePath);
    const res = NextResponse.redirect(loginUrl, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(PENDING_COOKIE, JSON.stringify({ state, codeChallenge }), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: PENDING_COOKIE_MAX_AGE_S,
      path: "/",
    });
    return res;
  }

  // getCurrentMembership() (não só `session`) porque precisa do vínculo
  // RECONFERIDO em banco — desativado com sessão do NextAuth ainda válida
  // (JWT não expirado) não pode ganhar um code.
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    callbackUrl.searchParams.set("error", "access_denied");
    callbackUrl.searchParams.set("state", state);
    const res = NextResponse.redirect(callbackUrl, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
    clearPendingCookie(res);
    return res;
  }

  const { value: code, hash: codeHash } = generateOpaqueSecret();
  await runWithTenant(membership.organizationId, () =>
    prisma.academyAuthCode.create({
      data: {
        organizationId: membership.organizationId,
        userId: membership.userId,
        codeHash,
        codeChallenge,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
      },
    }),
  );

  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("state", state);
  // Nunca logar esta URL (contém o `code`) — ver item de segurança do spec
  // da Academy. Nenhum console.log/console.error neste caminho de sucesso.
  const res = NextResponse.redirect(callbackUrl, {
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      // Header extra próprio (não pedido pela Academy, não custa nada):
      // reforça que este endpoint nunca deveria ser indexado.
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
  clearPendingCookie(res);
  return res;
}
