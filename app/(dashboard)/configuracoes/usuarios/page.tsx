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
        user: { select: { id: true, name: true, email: true, image: true } },
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
      <div className="max-w-4xl space-y-4">
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
