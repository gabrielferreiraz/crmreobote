import { NextResponse } from "next/server";
import { prisma, prismaRaw } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { runWithTenant, setTenantOnTx } from "@/lib/tenant-context";
import { bodyErrorResponse, readJson } from "@/lib/read-body";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const access = await requireProcessAccess();
  if (!access.ok || !access.isAdmin) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: { categoryIds?: string[] };
  try {
    body = await readJson(req);
  } catch (err) {
    const response = bodyErrorResponse(err);
    if (response) return response;
    throw err;
  }
  const { categoryIds } = body;

  return runWithTenant(access.organizationId, async () => {
    const categories = await prisma.processCategory.findMany({ where: { organizationId: access.organizationId } });
    const validIds = new Set(categories.map((c) => c.id));
    if (!Array.isArray(categoryIds) || categoryIds.some((cid) => !validIds.has(cid))) {
      return NextResponse.json({ error: "categoryIds inválido" }, { status: 400 });
    }

    await prismaRaw.$transaction(async (tx) => {
      await setTenantOnTx(tx, access.organizationId);
      for (const [index, categoryId] of categoryIds.entries()) {
        await tx.processCategory.update({ where: { id: categoryId }, data: { order: index } });
      }
    });

    return NextResponse.json({ ok: true });
  });
}
