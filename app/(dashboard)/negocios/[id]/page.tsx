import { Suspense } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { getDealScope, scopeWhere } from "@/lib/team-scope";
import { getOrCreateThreadForContact } from "@/lib/whatsapp/threads";
import type { CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { DealDetail } from "./deal-detail";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const { id } = await params;

  return runWithTenant(organizationId, async () => {
    const scope = await getDealScope(organizationId, userId, session!.user.role);
    const dealRaw = await prisma.deal.findFirst({
      where: { id, organizationId, ...scopeWhere(scope) },
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
      customFieldValues: dealRaw.customFieldValues as CustomFieldFormValues | null,
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

    const customFields = await prisma.customFieldDefinition.findMany({
      where: { organizationId, entityType: "DEAL" },
      orderBy: { order: "asc" },
    });

    const creditTypes = await prisma.creditType.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    const jobTitles = await prisma.jobTitle.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
    });

    // Não lida: soma de qualquer conversa deste contato, não só a de quem
    // está vendo a página agora (o lead pode ter respondido pra outro
    // vendedor que já trocou mensagem com ele antes).
    const unreadCount = await prisma.whatsAppMessage.count({
      where: { organizationId, thread: { contactId: deal.contactId }, direction: "INBOUND", read: false },
    });

    // A conversa é sempre a do vendedor responsável pelo negócio — é o
    // número dele que troca mensagem com esse contato. Pra quem está vendo o
    // próprio negócio dá no mesmo; pra dono/admin abrindo o negócio de outro
    // vendedor, é isso que deixa ver e ajudar na conversa mesmo sem ter um
    // WhatsApp próprio conectado. Sem instância conectada, não tem como
    // abrir chat aqui.
    const ownerInstance = await prisma.whatsAppInstance.findUnique({
      where: { organizationId_userId: { organizationId, userId: dealRaw.ownerId } },
    });
    const whatsappThread =
      ownerInstance?.status === "CONNECTED"
        ? await getOrCreateThreadForContact({ organizationId, instance: ownerInstance, contact: dealRaw.contact })
        : null;

    // Edição inline (lápis) dos campos do negócio/contato: só quem é dono do
    // negócio (o vendedor responsável) ou dono da conta (OWNER) pode editar
    // por aqui — os demais só visualizam.
    const canEditDetails = session!.user.id === dealRaw.ownerId || session!.user.role === "OWNER";

    return (
      <Suspense fallback={null}>
        <DealDetail
          deal={deal}
          members={members}
          lossReasons={lossReasons}
          customFields={customFields}
          creditTypes={creditTypes.map((c) => ({ id: c.id, label: c.label }))}
          jobTitles={jobTitles.map((j) => ({ id: j.id, label: j.label }))}
          currentUserName={session!.user.name ?? undefined}
          currentUserPhotoUrl={currentUserPhotoUrl}
          hasUnreadWhatsApp={unreadCount > 0}
          whatsappThreadId={whatsappThread?.id ?? null}
          canEditDetails={canEditDetails}
        />
      </Suspense>
    );
  });
}
