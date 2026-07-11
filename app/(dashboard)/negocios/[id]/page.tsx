import { Suspense } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { DealDetail } from "./deal-detail";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { id } = await params;

  return runWithTenant(organizationId, async () => {
    const dealRaw = await prisma.deal.findFirst({
      where: { id, organizationId },
      include: {
        contact: true,
        owner: true,
        stage: true,
        pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
        activities: { orderBy: { createdAt: "desc" }, include: { user: true } },
        tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] },
        lossReason: true,
      },
    });

    if (!dealRaw) notFound();

    const avatarMap = await resolveAvatarUrlMap([
      ...dealRaw.activities.map((a) => a.user.image),
      dealRaw.owner.image,
      session!.user.image,
    ]);
    const currentUserPhotoUrl = session!.user.image ? (avatarMap.get(session!.user.image) ?? null) : null;

    const deal = {
      ...dealRaw,
      value: dealRaw.value ? Number(dealRaw.value) : null,
      owner: {
        id: dealRaw.owner.id,
        name: dealRaw.owner.name,
        photoUrl: dealRaw.owner.image ? (avatarMap.get(dealRaw.owner.image) ?? null) : null,
      },
      activities: dealRaw.activities.map((a) => ({
        ...a,
        user: {
          name: a.user.name,
          photoUrl: a.user.image ? (avatarMap.get(a.user.image) ?? null) : null,
        },
      })),
    };

    const membersRaw = await prisma.organizationUser.findMany({
      where: { organizationId, active: true },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true } } },
    });

    const members = membersRaw.map((m) => m.user);
    // Garante que o responsável atual apareça no seletor mesmo se tiver sido
    // desativado depois de ser atribuído ao negócio.
    if (!members.some((m) => m.id === deal.owner.id)) {
      members.push({ id: deal.owner.id, name: `${deal.owner.name} (inativo)` });
    }

    const lossReasons = await prisma.lossReason.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    return (
      <Suspense fallback={null}>
        <DealDetail
          deal={deal}
          members={members}
          lossReasons={lossReasons}
          currentUserName={session!.user.name ?? undefined}
          currentUserPhotoUrl={currentUserPhotoUrl}
        />
      </Suspense>
    );
  });
}
