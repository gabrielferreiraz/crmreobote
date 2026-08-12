import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/require-role";
import { decryptSecret } from "@/lib/security/secret-crypto";
import type { FacebookPage } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

/** Lista as Páginas pendentes de escolha (ver /api/meta-ads/callback, caso de mais de uma Página) — nunca devolve nenhum token, só id/nome pro seletor. */
export async function GET(req: NextRequest) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const encrypted = req.cookies.get("meta_ads_pending_pages")?.value;
  if (!encrypted) return NextResponse.json({ pages: [] });

  try {
    // Ver callback/route.ts: o cookie carrega { pages, userAccessToken }
    // desde que o resumo de gasto passou a existir — o token só é lido de
    // volta em pages/select/route.ts (pra terminar a auto-seleção de Ad
    // Account), nunca sai daqui.
    const { pages } = JSON.parse(decryptSecret(encrypted)) as { pages: FacebookPage[]; userAccessToken: string };
    return NextResponse.json({ pages: pages.map((p) => ({ id: p.id, name: p.name })) });
  } catch (err) {
    console.error("[meta-ads] falha ao ler cookie de páginas pendentes", err);
    return NextResponse.json({ pages: [] });
  }
}
