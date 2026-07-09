import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { TeamManager } from "./team-manager";

export default async function EquipesSettingsPage() {
  const session = await auth();
  if (!session?.user.role || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;

  return runWithTenant(organizationId, async () => {
    const teamsRaw = await prisma.team.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        leader: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      },
    });

    const avatarMap = await resolveAvatarUrlMap(
      teamsRaw.flatMap((t) => t.members.map((m) => m.user.image)),
    );
    const teams = teamsRaw.map((team) => ({
      ...team,
      members: team.members.map((m) => ({
        ...m,
        user: {
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          photoUrl: m.user.image ? (avatarMap.get(m.user.image) ?? null) : null,
        },
      })),
    }));

    const members = await prisma.organizationUser.findMany({
      where: { organizationId, active: true },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Equipes</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Agrupe vendedores sob um supervisor. Supervisores só enxergam os negócios da própria
            equipe.
          </p>
        </div>
        <TeamManager
          initialTeams={teams}
          members={members.map((m) => ({ ...m.user, role: m.role, teamId: m.teamId }))}
          isOwner={session.user.role === "OWNER"}
        />
      </div>
    );
  });
}
