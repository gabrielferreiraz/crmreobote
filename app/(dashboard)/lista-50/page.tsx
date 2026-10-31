import type { Metadata } from "next";
import { getCurrentMembership } from "@/lib/current-membership";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope } from "@/lib/team-scope";
import { getLista50Config, getLista50OwnWeekCount, getLista50Progress } from "@/lib/lista-50";
import { Lista50Form } from "./lista-50-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lista dos 50" };

const SUPERVISOR_ROLES = new Set(["OWNER", "MANAGER", "SUPERVISOR"]);

export default async function Lista50Page() {
  // O nome do vendedor já vem preenchido com quem está logado — é sempre a
  // própria pessoa entregando a lista dela.
  const membership = await getCurrentMembership();
  if (!membership?.active) {
    return <Lista50Form vendedorPadrao="" enabled={false} weeklyGoal={50} ownWeek={null} progress={null} canManageCampaign={false} />;
  }

  const { organizationId, userId, role } = membership;
  const { config, ownWeek, progress } = await runWithTenant(organizationId, async () => {
    const config = await getLista50Config(organizationId);
    if (!config.enabled) return { config, ownWeek: null, progress: null };

    const ownWeek = await getLista50OwnWeekCount(organizationId, userId);
    const progress = SUPERVISOR_ROLES.has(role)
      ? await getLista50Progress(organizationId, await getDealScope(organizationId, userId, role))
      : null;
    return { config, ownWeek, progress };
  });

  return (
    <Lista50Form
      vendedorPadrao={membership.session.user.name ?? ""}
      enabled={config.enabled}
      weeklyGoal={config.weeklyGoal}
      ownWeek={ownWeek}
      progress={progress}
      canManageCampaign={role === "OWNER"}
    />
  );
}
