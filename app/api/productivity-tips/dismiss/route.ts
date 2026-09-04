import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { markTipDismissed } from "@/lib/productivity-tips/engine";
import type { ProductivityTipType } from "@/lib/productivity-tips/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { organizationId, userId } = await requireSession();
  if (!organizationId || !userId) {
    return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { tipType, scope = "GLOBAL", forever = false } = body as {
      tipType?: ProductivityTipType;
      scope?: string;
      forever?: boolean;
    };
    if (!tipType) return NextResponse.json({ ok: false, error: "tipType faltando" }, { status: 400 });

    await markTipDismissed({ organizationId, userId, tipType, scope, forever: !!forever });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[productivity-tips] dismiss error", err);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
