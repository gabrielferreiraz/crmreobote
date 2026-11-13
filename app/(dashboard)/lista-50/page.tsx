import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-membership";
import { prisma } from "@/lib/prisma";
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
      <Lista50Form
        vendedorPadrao=""
        enabled={false}
        campaignEnabled={false}
        scheduledFor={null}
        totalDelivered={0}
        weeklyGoal={50}
        ownWeek={null}
        progress={null}
        canManageCampaign={false}
      />
    );
  }

  // Administrativo não participa da campanha (quem vende é que entrega a lista).
  if (membership.area !== "VENDAS" && membership.role !== "OWNER") redirect("/");

  const { organizationId, userId, role } = membership;
  const canManageCampaign = role === "OWNER";
  const { config, live, totalDelivered, ownWeek, progress } = await runWithTenant(organizationId, async () => {
    const config = await getLista50Config(organizationId);
    const live = lista50IsLive(config);
    // Só o Dono vê o controle que usa isto (confirmação de "Desligar
    // campanha") — nos outros casos nem vale a consulta extra.
    const totalDeliveredPromise = canManageCampaign
      ? prisma.deal.count({ where: { organizationId, lista50: true } })
      : Promise.resolve(0);

    // Ligada mas com `startsOn` no futuro (Dono agendou com antecedência) não
    // é "no ar" ainda — ninguém deve conseguir entregar leads que ficariam
    // fora de qualquer janela de semana válida (ver lista50IsLive).
    if (!live) {
      const totalDelivered = await totalDeliveredPromise;
      return { config, live, totalDelivered, ownWeek: null, progress: null };
    }

    // Independentes entre si — em paralelo em vez de uma esperar a outra.
    const [totalDelivered, ownWeek, progress] = await Promise.all([
      totalDeliveredPromise,
      getLista50OwnWeekCount(organizationId, userId),
      SUPERVISOR_ROLES.has(role)
        ? getDealScope(organizationId, userId, role).then((scope) => getLista50Progress(organizationId, scope))
        : Promise.resolve(null),
    ]);
    return { config, live, totalDelivered, ownWeek, progress };
  });

  return (
    <Lista50Form
      vendedorPadrao={membership.session.user.name ?? ""}
      enabled={live}
      campaignEnabled={config.enabled}
      scheduledFor={config.enabled && !live ? config.startsOn : null}
      totalDelivered={totalDelivered}
      weeklyGoal={config.weeklyGoal}
      ownWeek={ownWeek}
      progress={progress}
      canManageCampaign={canManageCampaign}
    />
  );
}
