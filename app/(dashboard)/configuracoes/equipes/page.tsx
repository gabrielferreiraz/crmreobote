import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { canManageShareGroups } from "@/lib/share-groups";
import { TeamManager } from "./team-manager";
import { ShareGroupManager } from "./share-group-manager";

export default async function EquipesSettingsPage() {
  const session = await auth();
  // Supervisor entra aqui também (diferente de antes, só Dono/Gerente) —
  // precisa alcançar o compartilhamento entre consultores pra própria
  // equipe (ver seção abaixo). A própria gestão de Equipes continua restrita
  // a criar/editar por Dono só (ver TeamManager, isOwner) — Gerente/
  // Supervisor só visualizam, igual já era pro Gerente antes desta mudança.
  if (!canManageShareGroups(session?.user.role)) {
    redirect("/configuracoes");
  }

  const organizationId = session.user.organizationId!;
  const userId = session.user.id;
  const role = session.user.role;
  const isOwner = role === "OWNER";

  return runWithTenant(organizationId, async () => {
    // Nenhuma depende da outra — rodam em paralelo.
    const [teamsRaw, members, shareGroups, scope] = await Promise.all([
      prisma.team.findMany({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        include: {
          leader: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true } },
          members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
        },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.shareGroup.findMany({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        include: {
          createdBy: { select: { id: true, name: true } },
          members: { include: { user: { select: { id: true, name: true } } } },
        },
      }),
      // Só quem EU já enxergo (getDealScope) pode entrar num grupo de
      // compartilhamento que EU crio/edito — ver validateShareGroupMemberIds,
      // a mesma regra do servidor, aqui só pra não oferecer no dropdown
      // alguém que a API rejeitaria de qualquer jeito.
      getDealScope(organizationId, userId, role),
    ]);

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

    const eligibleMembers =
      scope.type === "all"
        ? members.map((m) => m.user)
        : members.filter((m) => scope.ownerIds.includes(m.userId)).map((m) => m.user);

    return (
      // max-w-4xl (não mais 2xl) — pedido explícito: os cards de equipe
      // viram grade de 2 colunas (ver team-manager.tsx), e 2xl (672px) só
      // dava ~330px por card, apertado demais pro conteúdo de cada um
      // (Líder/Gerente já em sub-grade de 2 colunas, lista de membros,
      // linha de adicionar). ShareGroupManager abaixo (continua 1 coluna)
      // só ganha mais respiro lateral com isso, nada quebra.
      <div className="mx-auto max-w-4xl space-y-8">
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
          isOwner={isOwner}
        />

        <div className="space-y-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Compartilhamento entre consultores
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Crie grupos que passam a ver (e mexer, como coautores) a agenda e/ou os negócios uns dos outros —
              pensado pra setores internos (ex.: marketing digital) ou times que trabalham os mesmos negócios
              juntos, independente das equipes acima. Nunca afeta Relatórios. Clientes já é visível pra organização
              inteira hoje, então não entra aqui.
            </p>
          </div>
          <ShareGroupManager
            initialGroups={shareGroups}
            allMembers={members.map((m) => m.user)}
            eligibleMembers={eligibleMembers}
            currentUserId={userId}
            isOwner={isOwner}
          />
        </div>
      </div>
    );
  });
}
