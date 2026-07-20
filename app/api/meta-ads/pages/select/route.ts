import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { encryptSecret, decryptSecret } from "@/lib/security/secret-crypto";
import { subscribePageToLeadgen, type FacebookPage } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

/** Finaliza a escolha de Página (ver /api/meta-ads/pages) — inscreve no evento leadgen e persiste a conexão. */
export async function POST(req: NextRequest) {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const { pageId } = (await req.json().catch(() => ({}))) as { pageId?: string };
  if (!pageId) return NextResponse.json({ error: "pageId é obrigatório" }, { status: 400 });

  const encrypted = req.cookies.get("meta_ads_pending_pages")?.value;
  if (!encrypted) return NextResponse.json({ error: "Sessão de conexão expirada — comece de novo" }, { status: 400 });

  let pages: FacebookPage[];
  try {
    pages = JSON.parse(decryptSecret(encrypted)) as FacebookPage[];
  } catch {
    return NextResponse.json({ error: "Sessão de conexão inválida — comece de novo" }, { status: 400 });
  }

  const page = pages.find((p) => p.id === pageId);
  if (!page) return NextResponse.json({ error: "Página não encontrada nesta sessão de conexão" }, { status: 400 });

  try {
    await subscribePageToLeadgen(page.id, page.accessToken);
  } catch (err) {
    console.error(`[meta-ads] falha ao inscrever a página ${page.id} no evento leadgen`, err);
    return NextResponse.json({ error: "Não foi possível concluir a conexão com o Facebook. Tente novamente." }, { status: 502 });
  }

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

  const res = NextResponse.json({ ok: true, pageName: page.name });
  res.cookies.delete("meta_ads_pending_pages");
  return res;
}
