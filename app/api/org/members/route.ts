import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit-log";
import { getClientIp } from "@/lib/rate-limit";

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
  const { name, email, role, area, password } = body as {
    name?: string;
    email?: string;
    role?: "OWNER" | "MANAGER" | "SUPERVISOR" | "MEMBER";
    area?: "VENDAS" | "ADMINISTRATIVO";
    password?: string;
  };

  // Só o Dono cria usuário — não é só "quem pode convidar com qual papel"
  // (isso já era restrito abaixo), é a própria senha: a pessoa criada nunca
  // define a senha dela, só o Dono, na hora da criação (nunca mais gerada
  // pelo sistema, ver validação de `password` abaixo). Gerente não tem mais
  // esse botão na UI (ver members-table.tsx) — reforça aqui pra não
  // depender só do frontend escondendo o botão.
  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!email || !role) {
    return NextResponse.json({ error: "email e role são obrigatórios" }, { status: 400 });
  }
  if (area !== undefined && area !== "VENDAS" && area !== "ADMINISTRATIVO") {
    return NextResponse.json({ error: "area inválida" }, { status: 400 });
  }

  return runWithTenant(access.organizationId, async () => {
    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const existingMembership = await prisma.organizationUser.findUnique({
        where: { organizationId_userId: { organizationId: access.organizationId, userId: user.id } },
      });
      if (existingMembership) {
        return NextResponse.json({ error: "Usuário já faz parte da organização" }, { status: 409 });
      }
      // E-mail já é de um usuário existente (de outra organização, ou
      // convidado antes e removido) — a senha dele já existe, não é criada
      // agora, então `password` (se veio) é ignorado de propósito aqui.
    } else {
      if (!name) return NextResponse.json({ error: "Nome é obrigatório para novo usuário" }, { status: 400 });
      // Mesmo mínimo de PasswordInput/"Trocar senha" (ver reset-password/route.ts)
      // — a senha É o que o Dono digitou no formulário, nunca gerada aqui.
      if (!password || password.length < 8) {
        return NextResponse.json({ error: "Senha é obrigatória (mínimo 8 caracteres)" }, { status: 400 });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await prisma.user.create({ data: { name, email, password: hashedPassword } });
    }

    const membership = await prisma.organizationUser.create({
      data: { organizationId: access.organizationId, userId: user.id, role, area },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await logAudit({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      actorName: access.session.user.name ?? access.session.user.email ?? "?",
      action: "MEMBER_INVITED",
      targetType: "User",
      targetId: user.id,
      detail: `${membership.user.name} (${membership.user.email}) · papel ${role}`,
      ip: getClientIp(req),
    });

    return NextResponse.json({ membership }, { status: 201 });
  });
}
