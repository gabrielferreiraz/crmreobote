import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { runWithTenant } from "@/lib/tenant-context";
import { centralLeadsEnabled } from "@/lib/whatsapp/central-config";
import { centralAssigneeIds, getCentralAccess } from "@/lib/whatsapp/central-access";
import {
  countCentralInbox,
  getCentralInboxItem,
  listCentralInbox,
  type CentralInboxTab,
} from "@/lib/whatsapp/central-inbox";

const TABS = new Set<CentralInboxTab>(["mine", "team", "unassigned", "closed"]);

/**
 * Lista da Central para a aba pedida + badges + estado do número.
 * - `selected`: devolve também essa conversa (a aberta na tela), mesmo fora da aba.
 * - `withUsers=1`: inclui para quem o gestor pode transferir (só na 1ª carga —
 *   não muda a cada mensagem, não precisa vir em todo recarregamento).
 */
export async function GET(request: Request) {
  const { session, organizationId, userId } = await requireSession();
  if (!organizationId || !userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const url = new URL(request.url);
  const requestedTab = url.searchParams.get("tab") as CentralInboxTab | null;
  const tab = requestedTab && TABS.has(requestedTab) ? requestedTab : "mine";
  const search = url.searchParams.get("search")?.slice(0, 80) ?? undefined;
  const selectedId = url.searchParams.get("selected");
  const withUsers = url.searchParams.get("withUsers") === "1";

  if (!centralLeadsEnabled()) return NextResponse.json({ enabled: false, items: [] });

  try {
    return await runWithTenant(organizationId, async () => {
      const access = await getCentralAccess(organizationId, userId, session!.user.role);
      const visibleIds = centralAssigneeIds(access);
      const [items, counts, selected, instance, assignableUsers] = await Promise.all([
        listCentralInbox({ organizationId, access, tab, search }),
        countCentralInbox(organizationId, access),
        selectedId ? getCentralInboxItem(organizationId, access, selectedId) : Promise.resolve(null),
        prisma.whatsAppInstance.findFirst({
          where: { organizationId, kind: "CENTRAL" },
          select: { status: true, distributionPoolId: true },
        }),
        withUsers && access.canManageQueue
          ? prisma.organizationUser.findMany({
              where: {
                organizationId,
                active: true,
                ...(visibleIds === null ? {} : { userId: { in: visibleIds } }),
              },
              orderBy: { user: { name: "asc" } },
              select: { user: { select: { id: true, name: true } } },
            })
          : Promise.resolve(null),
      ]);
      return NextResponse.json({
        enabled: true,
        canManageQueue: access.canManageQueue,
        // "missing" = ninguém conectou ainda; "noPool" = conectada sem rodízio
        // (tudo cai em "Sem responsável"); senão o status do número.
        central: !instance ? "missing" : !instance.distributionPoolId ? "noPool" : instance.status,
        items,
        counts,
        selected,
        ...(assignableUsers ? { assignableUsers: assignableUsers.map((row) => row.user) } : {}),
      });
    });
  } catch (error) {
    console.error("[wa:central] falha ao listar conversas", error);
    return NextResponse.json({ error: "Não foi possível carregar a Central." }, { status: 500 });
  }
}
