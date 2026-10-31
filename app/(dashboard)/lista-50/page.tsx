import type { Metadata } from "next";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { getLista50Config, getLista50OwnWeekCount, getLista50Progress, lista50IsLive } from "@/lib/lista-50";
import { Lista50Form } from "./lista-50-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lista dos 50" };

const SUPERVISOR_ROLES = new Set(["OWNER", "MANAGER", "SUPERVISOR"]);

export default async function Lista50Page() {
  // O nome do vendedor já vem preenchido com quem está logado — é sempre a
  // própria pessoa entregando a lista dela.
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return (
      <Lista50Form vendedorPadrao="" enabled={false} campaignEnabled={false} scheduledFor={null} weeklyGoal={50} ownWeek={null} progress={null} canManageCampaign={false} />
    );
  }

  const { organizationId, userId, role } = membership;
  const { config, live, ownWeek, progress } = await runWithTenant(organizationId, async () => {
    const config = await getLista50Config(organizationId);
    const live = lista50IsLive(config);
    // Ligada mas com `startsOn` no futuro (Dono agendou com antecedência) não
    // é "no ar" ainda — ninguém deve conseguir entregar leads que ficariam
    // fora de qualquer janela de semana válida (ver lista50IsLive).
    if (!live) return { config, live, ownWeek: null, progress: null };

    // Independentes entre si — em paralelo em vez de uma esperar a outra.
    const [ownWeek, progress] = await Promise.all([
      getLista50OwnWeekCount(organizationId, userId),
      SUPERVISOR_ROLES.has(role)
        ? getDealScope(organizationId, userId, role).then((scope) => getLista50Progress(organizationId, scope))
        : Promise.resolve(null),
    ]);
    return { config, live, ownWeek, progress };
  });

  return (
    <Lista50Form
      vendedorPadrao={membership.session.user.name ?? ""}
      enabled={live}
      campaignEnabled={config.enabled}
      scheduledFor={config.enabled && !live ? config.startsOn : null}
      weeklyGoal={config.weeklyGoal}
      ownWeek={ownWeek}
      progress={progress}
      canManageCampaign={role === "OWNER"}
    />
  );
}
