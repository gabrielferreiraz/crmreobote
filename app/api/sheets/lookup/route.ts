import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { rateLimitOrResponse } from "@/lib/rate-limit";
import { requireSheetsAccess } from "@/lib/sheets/access";

export const dynamic = "force-dynamic";

/**
 * Busca para as colunas Cliente/Negócio/Membro (?type=CONTACT|DEAL|USER&q=).
 * Organização inteira de propósito: o Administrativo cuida do pós-venda de
 * todo mundo — a busca global (/api/search) limita consultor à própria carteira.
 */
export async function GET(req: Request) {
  const auth = await requireSheetsAccess();
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const limited = rateLimitOrResponse(`sheets:lookup:${access.organizationId}:${access.userId}`, 240, 60_000);
  if (limited) return limited;

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const organizationId = access.organizationId;
  const digits = q.replace(/\D/g, "");

  const items = await runWithTenant(organizationId, async () => {
    if (type === "USER") {
      // ?all=1: a equipe inteira (o "De → Para" da conversão casa nomes com todo mundo de uma vez).
      // Inativos entram também (planilha de vendas antigas tem consultor que já saiu), depois dos ativos.
      const all = sp.get("all") === "1";
      const members = await prisma.organizationUser.findMany({
        where: { organizationId, ...(q ? { user: { name: { contains: q, mode: "insensitive" } } } : {}) },
        select: { userId: true, active: true, user: { select: { name: true, email: true } } },
        take: all ? 1_000 : 20,
        orderBy: [{ active: "desc" }, { user: { name: "asc" } }],
      });
      return members.map((m) => ({
        id: m.userId,
        label: m.user.name ?? m.user.email ?? "Membro",
        hint: m.active ? (m.user.email ?? null) : `Inativo${m.user.email ? ` · ${m.user.email}` : ""}`,
        inactive: !m.active,
      }));
    }
    if (type === "CONTACT") {
      const contacts = await prisma.contact.findMany({
        where: {
          organizationId,
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  ...(digits.length >= 4 ? [{ phoneNormalized: { contains: digits } }, { whatsappNormalized: { contains: digits } }] : []),
                ],
              }
            : {}),
        },
        select: { id: true, name: true, phone: true, whatsapp: true, email: true },
        take: 20,
        orderBy: { updatedAt: "desc" },
      });
      return contacts.map((c) => ({ id: c.id, label: c.name, hint: c.whatsapp ?? c.phone ?? c.email ?? null }));
    }
    if (type === "DEAL") {
      const deals = await prisma.deal.findMany({
        where: { organizationId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { contact: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
        select: { id: true, name: true, contact: { select: { name: true } } },
        take: 20,
        orderBy: { updatedAt: "desc" },
      });
      return deals.map((d) => ({ id: d.id, label: d.name, hint: d.contact?.name ?? null }));
    }
    return null;
  });
  if (!items) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  return NextResponse.json({ items });
}
