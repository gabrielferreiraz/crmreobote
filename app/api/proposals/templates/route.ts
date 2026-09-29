import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 4000;

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  return runWithTenant(access.organizationId, async () => {
    const templates = await prisma.proposalTemplate.findMany({
      where: { organizationId: access.organizationId, OR: [{ createdById: access.userId }, { createdById: null }] },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      select: { id: true, name: true, description: true },
    });
    return NextResponse.json(templates);
  });
}

export async function POST(req: Request) {
  const access = await requireRole(["OWNER", "MANAGER", "SUPERVISOR", "MEMBER"]);
  if (!access.ok) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!name || name.length > MAX_NAME) return NextResponse.json({ error: `Informe um nome de até ${MAX_NAME} caracteres` }, { status: 400 });
  if (!description || description.length > MAX_DESCRIPTION) return NextResponse.json({ error: "Informe um texto de até 4.000 caracteres" }, { status: 400 });

  return runWithTenant(access.organizationId, async () => {
    const exists = await prisma.proposalTemplate.findFirst({
      where: { organizationId: access.organizationId, createdById: access.userId, name },
      select: { id: true },
    });
    if (exists) return NextResponse.json({ error: "Já existe um template com esse nome" }, { status: 409 });

    try {
      const template = await prisma.proposalTemplate.create({
        data: { organizationId: access.organizationId, createdById: access.userId, name, description },
        select: { id: true, name: true, description: true },
      });
      return NextResponse.json(template, { status: 201 });
    } catch (error) {
      // A second request can pass the existence check before the first insert
      // commits; turn the unique constraint into the same friendly response.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return NextResponse.json({ error: "Já existe um template com esse nome" }, { status: 409 });
      }
      throw error;
    }
  });
}
