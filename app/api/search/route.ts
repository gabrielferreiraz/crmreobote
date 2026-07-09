import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!q) return NextResponse.json({ contacts: [], deals: [] });

  return runWithTenant(organizationId, async () => {
    const [contacts, deals] = await Promise.all([
      prisma.contact.findMany({
        where: { organizationId, name: { contains: q, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
        take: 5,
      }),
      prisma.deal.findMany({
        where: { organizationId, name: { contains: q, mode: "insensitive" } },
        select: { id: true, name: true, contact: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    return NextResponse.json({ contacts, deals });
  });
}
