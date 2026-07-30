import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/require-role";
import { runWithTenant } from "@/lib/tenant-context";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const body = await req.json().catch(() => ({}));
  const { password } = body as { password?: string };

  const access = await requireRole(["OWNER"]);
  if (!access.ok) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "A senha deve ter pelo menos 8 caracteres" },
      { status: 400 },
    );
  }

  return runWithTenant(access.organizationId, async () => {
    const membership = await prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId: access.organizationId, userId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!membership) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    const [owners, actor] = await Promise.all([
      prisma.organizationUser.findMany({
        where: { organizationId: access.organizationId, role: "OWNER", active: true },
        include: { user: { select: { email: true } } },
      }),
      prisma.user.findUnique({
        where: { id: access.userId },
        select: { name: true },
      }),
    ]);

    const ownerEmails = owners.map((o) => o.user.email).filter(Boolean);
    if (ownerEmails.length > 0) {
      const actorName = actor?.name ?? "Um proprietário";
      const targetName = membership.user.name;
      const targetEmail = membership.user.email;

      await sendEmail({
        to: ownerEmails,
        subject: "Alteração de senha realizada no CRM",
        html: `
          <div style="font-family: sans-serif; color: #171717; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e5e5; border-radius: 6px;">
            <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">Aviso de Segurança: Senha Alterada</h2>
            <p style="font-size: 14px; line-height: 20px;">Olá,</p>
            <p style="font-size: 14px; line-height: 20px;">Informamos que a senha do usuário <strong>${targetName}</strong> (${targetEmail}) foi alterada por <strong>${actorName}</strong>.</p>
            <hr style="border: 0; border-top: 1px solid #e5e5e5; margin: 20px 0;" />
            <p style="font-size: 12px; color: #737373;">Este é um e-mail automático do sistema de segurança do CRM Reobote. Se esta alteração não foi solicitada ou reconhecida por você, entre em contato imediatamente com o suporte ou realize uma auditoria de acessos.</p>
          </div>
        `,
      }).catch((err) => console.error("[reset-password] falha ao enviar notificação por e-mail", err));
    }

    return NextResponse.json({ ok: true });
  });
}
