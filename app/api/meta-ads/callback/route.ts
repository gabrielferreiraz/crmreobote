import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { exchangeCodeForToken, exchangeForLongLivedToken } from "@/lib/meta-graph";
import { listOwnedPages, getMetaAdsRedirectUri, subscribePageToLeadgen } from "@/lib/meta-ads";
import { encryptSecret } from "@/lib/security/secret-crypto";

export const dynamic = "force-dynamic";

const REDIRECT_PATH = "/configuracoes/integracoes";

export async function GET(req: NextRequest) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.redirect(new URL("/login", req.url));

  const error = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("meta_ads_oauth_state")?.value;

  if (error) {
    console.log(`[meta-ads] usuário negou consentimento: ${error}`);
    return NextResponse.redirect(new URL(`${REDIRECT_PATH}?meta_ads=denied`, req.url));
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    console.warn("[meta-ads] callback com state ausente/divergente — possível CSRF ou cookie expirado");
    return NextResponse.redirect(new URL(`${REDIRECT_PATH}?meta_ads=error`, req.url));
  }

  try {
    const shortLivedToken = await exchangeCodeForToken(code, getMetaAdsRedirectUri());
    const { accessToken: userAccessToken } = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await listOwnedPages(userAccessToken);

    if (pages.length === 0) {
      console.warn("[meta-ads] login concluído mas nenhuma Página encontrada pro usuário");
      return NextResponse.redirect(new URL(`${REDIRECT_PATH}?meta_ads=no_pages`, req.url));
    }

    if (pages.length === 1) {
      const page = pages[0];
      await subscribePageToLeadgen(page.id, page.accessToken);

      await runWithTenant(access.organizationId, async () => {
        await prisma.metaAdsConnection.upsert({
          where: { organizationId: access.organizationId },
          create: {
            organizationId: access.organizationId,
            pageId: page.id,
            pageName: page.name,
            pageAccessTokenEncrypted: encryptSecret(page.accessToken),
            connectedById: access.userId,
          },
          update: {
            pageId: page.id,
            pageName: page.name,
            pageAccessTokenEncrypted: encryptSecret(page.accessToken),
            connectedById: access.userId,
          },
        });
      });

      const res = NextResponse.redirect(new URL(`${REDIRECT_PATH}?meta_ads=connected`, req.url));
      res.cookies.delete("meta_ads_oauth_state");
      return res;
    }

    // Mais de uma Página — deixa a pessoa escolher (ver /api/meta-ads/pages e
    // /api/meta-ads/pages/select). Guarda a lista (com os tokens de página)
    // num cookie curto e cifrado — nunca no banco antes de saber qual foi
    // escolhida, e nunca em texto puro (é credencial de verdade).
    const encryptedPages = encryptSecret(JSON.stringify(pages));
    const res = NextResponse.redirect(new URL(`${REDIRECT_PATH}?meta_ads=select_page`, req.url));
    res.cookies.delete("meta_ads_oauth_state");
    res.cookies.set("meta_ads_pending_pages", encryptedPages, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("[meta-ads] falha ao trocar código por token / listar páginas", err);
    return NextResponse.redirect(new URL(`${REDIRECT_PATH}?meta_ads=error`, req.url));
  }
}
