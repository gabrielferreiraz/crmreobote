import { NextResponse } from "next/server";
import { getServopaTablesAccess } from "@/lib/servopa-tables/access";
import { getServopaCampaignArtObject, isServopaCampaignArtKey } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Arte da campanha servida na MESMA origem da folha do PDF: o "Baixar PDF"
 * fotografa a página (html2canvas) e uma imagem de outro domínio sem CORS
 * sairia em branco. Qualquer membro da organização (quem imprime a tabela)
 * pode ver; só artes da própria organização. Cada envio gera uma chave nova,
 * então a resposta pode ficar em cache sem risco de mostrar a arte antiga.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const access = await getServopaTablesAccess();
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { key: parts } = await params;
  const key = parts.join("/");
  if (!isServopaCampaignArtKey(key, access.organizationId)) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const object = await getServopaCampaignArtObject(key);
  if (!object) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  return new NextResponse(new Blob([object.body.slice()]), {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
