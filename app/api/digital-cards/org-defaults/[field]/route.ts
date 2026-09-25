import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveAvatarUrl } from "@/lib/r2";
import { setOrgCardDefault, clearOrgCardDefault, setOrgCardTheme, clearOrgCardTheme, type DigitalCardDefaultsField } from "@/lib/digital-cards/org-defaults";
import { isCardTheme, CARD_THEME_LABELS } from "@/lib/digital-cards/themes";

export const dynamic = "force-dynamic";

// "photo" (avatar) de propósito NUNCA aceito aqui, mesmo vindo de um OWNER —
// mostrar o rosto de uma pessoa específica como "padrão" de quem ainda não
// subiu foto é enganoso (ver o comentário longo em DEFAULT_AVATAR_URL,
// lib/digital-cards/config.ts, decisão já revertida uma vez em produção por
// causa exatamente disso). Só capa/fundo — ambientação da empresa, não
// identidade de ninguém — podem ser promovidos a padrão compartilhado.
// "theme" também é aceito aqui, mas segue um caminho próprio no POST abaixo
// (valor vem no corpo, não é promovido de uma foto do cartão do dono).
function parseField(value: string): Exclude<DigitalCardDefaultsField, "photo"> | null {
  return value === "cover" || value === "background" || value === "theme" ? value : null;
}

/**
 * "Manter padrão para todos" — promove a foto que já está no PRÓPRIO
 * cartão do dono (Meu Cartão) a padrão de todo mundo que ainda não subiu
 * uma foto própria nesse campo (ver lib/digital-cards/org-defaults.ts).
 * OWNER-only: afeta o cartão de todo mundo de uma vez, mesma régua de
 * qualquer configuração nesse nível (ver lib/notification-settings.ts).
 *
 * `field=theme` (pedido: "se eu (login de dono) deixar como padrão vai para
 * todos os consultores") difere dos outros dois: não promove nada do cartão
 * do dono, o valor chega no corpo `{ theme: "DARK" | "LIGHT" | "PHOTO" }` —
 * assim o dono pode definir o padrão da equipe mesmo antes de salvar o tema
 * no próprio cartão. Passa a valer pra todo cartão cujo DigitalCard.theme
 * é null; escolha própria nunca é sobrescrita.
 */
export async function POST(req: Request, { params }: { params: Promise<{ field: string }> }) {
  const { field: rawField } = await params;
  const field = parseField(rawField);
  if (!field) return NextResponse.json({ error: "Campo inválido" }, { status: 400 });

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId, userId } = access;

  return runWithTenant(organizationId, async () => {
    if (field === "theme") {
      const body = (await req.json().catch(() => ({}))) as { theme?: unknown };
      if (!isCardTheme(body.theme)) {
        return NextResponse.json({ error: "Tema inválido" }, { status: 400 });
      }
      await setOrgCardTheme(organizationId, body.theme);
      return NextResponse.json({ theme: body.theme, label: CARD_THEME_LABELS[body.theme] });
    }

    const card = await prisma.digitalCard.findUnique({
      where: { userId },
      select: { photoKey: true, coverPhotoKey: true, backgroundPhotoKey: true },
    });
    // field só chega aqui como "cover" ou "background" (ver parseField acima).
    const key = field === "cover" ? card?.coverPhotoKey : card?.backgroundPhotoKey;
    if (!key) {
      return NextResponse.json(
        { error: "Suba uma foto nesse campo do seu próprio cartão antes de definir como padrão pra todo mundo." },
        { status: 400 },
      );
    }

    await setOrgCardDefault(organizationId, field, key);
    const url = await resolveAvatarUrl(key);
    return NextResponse.json({ url });
  });
}

/** Remove o padrão da organização pro campo (não apaga a foto do cartão de ninguém — só deixa de ser o padrão compartilhado; pro tema, volta ao DARK de fábrica pra quem nunca escolheu). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ field: string }> }) {
  const { field: rawField } = await params;
  const field = parseField(rawField);
  if (!field) return NextResponse.json({ error: "Campo inválido" }, { status: 400 });

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { organizationId } = access;

  return runWithTenant(organizationId, async () => {
    if (field === "theme") await clearOrgCardTheme(organizationId);
    else await clearOrgCardDefault(organizationId, field);
    return NextResponse.json({ ok: true });
  });
}
