import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { MembersTable } from "./members-table";

export default async function UsuariosSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "MANAGER"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const membersRaw = await prisma.organizationUser.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, name: true, email: true, image: true, birthDate: true } },
        team: { select: { id: true, name: true } },
      },
    });

    const members = await Promise.all(
      membersRaw.map(async (m) => ({
        ...m,
        photoUrl: await resolveAvatarUrl(m.user.image),
      })),
    );

    return (
      // Sem teto de largura próprio (max-w-4xl antes) — diferente das outras
      // telas de Configurações (listas simples de texto, ficam bem numa
      // coluna estreita), esta é uma tabela de verdade com 6 colunas; deixar
      // ela usar o espaço que o layout já reserva (mx-auto max-w-[1500px] em
      // app/(dashboard)/layout.tsx) evita nome/e-mail comprimidos à toa numa
      // tela larga. No celular isso não muda nada — MembersTable já vira uma
      // lista de cards de uma coluna sozinha ali (ver GRID_COLS/grid-cols-1),
      // um teto de largura nunca fez diferença pra quem já está abaixo dele.
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Usuários</h1>
        <MembersTable
          initialMembers={members}
          currentUserId={session.user.id}
          isOwner={session.user.role === "OWNER"}
        />
      </div>
    );
  });
}
