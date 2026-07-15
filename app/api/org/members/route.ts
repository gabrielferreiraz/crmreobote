import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { generateTempPassword } from "@/lib/generate-temp-password";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  return runWithTenant(access.organizationId, async () => {
    const members = await prisma.organizationUser.findMany({
      where: { organizationId: access.organizationId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return NextResponse.json(members);
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, email, role } = body as {
    name?: string;
    email?: string;
    role?: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
  };

  const access = await requireRole(["OWNER", "MANAGER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!email || !role) {
    return NextResponse.json({ error: "email e role são obrigatórios" }, { status: 400 });
  }
  // Gerente convida só papéis abaixo do próprio (Supervisor/Consultor) — sem
  // isso, um Gerente podia se auto-promover em dobro criando outro Gerente
  // (ou até um Dono) via convite, contornando a regra que a edição de papel
  // existente já aplica (PATCH em [userId]/route.ts é OWNER-only).
  if ((role === "OWNER" || role === "MANAGER") && access.role !== "OWNER") {
    return NextResponse.json({ error: "Apenas o dono pode convidar com esse papel" }, { status: 403 });
  }

  return runWithTenant(access.organizationId, async () => {
    let user = await prisma.user.findUnique({ where: { email } });
    let tempPassword: string | undefined;

    if (user) {
      const existingMembership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId: access.organizationId, userId: user.id } },
      });
      if (existingMembership) {
        return NextResponse.json({ error: "Usuário já faz parte da organização" }, { status: 409 });
      }
    } else {
      if (!name) return NextResponse.json({ error: "Nome é obrigatório para novo usuário" }, { status: 400 });
      tempPassword = generateTempPassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      user = await prisma.user.create({ data: { name, email, password: hashedPassword } });
    }

    const membership = await prisma.organizationUser.create({
      data: { organizationId: access.organizationId, userId: user.id, role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return NextResponse.json({ membership, tempPassword }, { status: 201 });
  });
}
