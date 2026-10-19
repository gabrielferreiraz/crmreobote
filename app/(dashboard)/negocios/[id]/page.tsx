import { Suspense } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { USER_PUBLIC_SELECT } from "@/lib/user-public";
import { resolveAvatarUrlMap } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { scopeWhere } from "@/lib/team-scope";
import { getSharedScope } from "@/lib/share-groups";
import { listProposalsForDeal } from "@/lib/proposals/queries";
import { getOrCreateThreadForContact } from "@/lib/whatsapp/threads";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { findOpenCentralThreadForContact } from "@/lib/whatsapp/central-access";
import type { CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { DealDetail } from "./deal-detail";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const userId = session!.user.id;
  const { id } = await params;

  return runWithTenant(organizationId, async () => {
    const scope = await getSharedScope(organizationId, userId, session!.user.role, "shareDeals");
    const dealRaw = await prisma.deal.findFirst({
      where: { id, organizationId, ...scopeWhere(scope) },
      include: {
        contact: {
          include: {
            qualifiedBy: { select: { name: true } },
            // Pedido explícito: mostrar/editar o responsável do contato
            // direto no card "Dados do contato", mesmo padrão de
            // Origem/Cargo logo abaixo (ver responsavelOptions em
            // deal-detail.tsx).
            responsavel: { select: { name: true } },
          },
        },
        owner: { select: USER_PUBLIC_SELECT },
        stage: true,
        pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
        // 200 mais recentes — um negócio de relacionamento longo (anos,
        // trocando de etapa toda semana) pode acumular milhares de
        // atividades (inclusive automáticas, tipo SYSTEM a cada mudança de
        // etapa); a timeline da página não precisa do histórico inteiro de
        // uma vez.
        activities: { orderBy: { createdAt: "desc" }, include: { user: { select: USER_PUBLIC_SELECT } }, take: 200 },
        tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] },
        lossReason: true,
        // Administradora escolhida no "Marcar como ganho" (Comissões) —
        // mostrada só pra leitura nos Dados do negócio.
        administrator: { select: { name: true } },
      },
    });

    if (!dealRaw) notFound();

    const canSendAsSelf =
      ["OWNER", "MANAGER", "SUPERVISOR"].includes(session!.user.role ?? "") &&
      dealRaw.ownerId !== session!.user.id;

    // Fotos, metadados dos formularios e conexoes do WhatsApp nao dependem
    // entre si. Comecam juntas depois que o negocio e a permissao existem.
    const [
      avatarMap,
      [membersRaw, lossReasons, customFields, creditTypes, jobTitles, sources, unreadCount, proposals, orgProposalSettings],
      ownerInstance,
      myInstance,
    ] = await Promise.all([
      resolveAvatarUrlMap([
        ...dealRaw.activities.map((a) => a.user.image),
        dealRaw.owner.image,
      ]),
      Promise.all([
        prisma.organizationUser.findMany({
          where: { organizationId, active: true },
          orderBy: { createdAt: "asc" },
          select: { user: { select: { id: true, name: true } } },
        }),
        prisma.lossReason.findMany({
          where: { organizationId, selectable: true },
          orderBy: { order: "asc" },
          select: { id: true, label: true },
        }),
        prisma.customFieldDefinition.findMany({
          where: { organizationId, entityType: "DEAL" },
          orderBy: { order: "asc" },
        }),
        prisma.creditType.findMany({
          where: { organizationId },
          orderBy: { order: "asc" },
          select: { id: true, label: true },
        }),
        prisma.jobTitle.findMany({
          where: { organizationId },
          orderBy: { order: "asc" },
          select: { id: true, label: true },
        }),
        prisma.leadSource.findMany({
          where: { organizationId },
          orderBy: { order: "asc" },
          select: { id: true, label: true },
        }),
        prisma.whatsAppMessage.count({
          where: { organizationId, thread: { contactId: dealRaw.contactId }, direction: "INBOUND", read: false },
        }),
        listProposalsForDeal(organizationId, dealRaw.id),
        prisma.organization.findUnique({
          where: { id: organizationId },
          select: { defaultProposalDescription: true },
        }),
      ]),
      resolveConnectedInstance(organizationId, dealRaw.ownerId),
      canSendAsSelf
        ? resolveConnectedInstance(organizationId, session!.user.id)
        : Promise.resolve(null),
    ]);

    const deal = {
      ...dealRaw,
      value: dealRaw.value ? Number(dealRaw.value) : null,
      grossValue: dealRaw.grossValue ? Number(dealRaw.grossValue) : null,
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

    const members = membersRaw.map((m) => m.user);
    // Garante que o responsável atual apareça no seletor mesmo se tiver sido
    // desativado depois de ser atribuído ao negócio.
    if (!members.some((m) => m.id === deal.owner.id)) {
      members.push({ id: deal.owner.id, name: `${deal.owner.name} (inativo)` });
    }

    // A conversa PADRÃO é sempre a do vendedor responsável pelo negócio — é
    // o número dele que troca mensagem com esse contato, e é isso que
    // precisa aparecer pra quem quer que esteja olhando (o próprio
    // responsável dá no mesmo; Dono/Gerente/Supervisor olhando o negócio de
    // outro vendedor precisam ver EXATAMENTE essa conversa, nunca uma
    // conversa própria — e quase sempre vazia — que por acaso exista com o
    // mesmo contato). Pedido explícito: o conteúdo mostrado é sempre "o
    // mesmo do celular do dono do lead". Sem instância conectada, não tem
    // como abrir chat aqui.
    const dealOwnerThread =
      ownerInstance?.status === "CONNECTED"
        ? await getOrCreateThreadForContact({ organizationId, instance: ownerInstance, contact: dealRaw.contact })
        : null;

    // Atendimento aberto na Central e de quem está vendo: o chat do negócio
    // é o da Central (o cliente nunca recebe por dois números; o envio pelo
    // pessoal é barrado no backend enquanto ele existir).
    const openCentral = await findOpenCentralThreadForContact(organizationId, dealRaw.contact.id);
    const centralIsMine = openCentral?.assigneeId === session!.user.id;
    const whatsappThread = centralIsMine ? { id: openCentral!.id } : dealOwnerThread;

    // "Enviar como você": Dono, Gerente ou Supervisor vendo o negócio de
    // outra pessoa (nunca o Consultor — ele só vê as próprias conversas,
    // regra explícita) ganham a opção de trocar pro PRÓPRIO número na hora
    // de enviar, quando quiserem falar pessoalmente com o lead em vez de
    // responder pelo número do responsável. O padrão continua sendo a
    // conversa do responsável (acima) — isso só oferece a alternativa,
    // nunca troca sozinho. Só aparece quando o próprio Dono/Gerente/
    // Supervisor TEM WhatsApp conectado (sem isso não haveria pra onde
    // trocar) e existe mesmo uma conversa do responsável pra servir de
    // padrão.
    let sendAsAlternate: { threadId: string; label: string; defaultLabel: string } | null = null;
    if (
      canSendAsSelf &&
      dealOwnerThread &&
      !openCentral
    ) {
      const myThread =
        myInstance?.status === "CONNECTED"
          ? await getOrCreateThreadForContact({ organizationId, instance: myInstance, contact: dealRaw.contact })
          : null;
      if (myThread) {
        sendAsAlternate = { threadId: myThread.id, label: "você", defaultLabel: dealRaw.owner.name };
      }
    }

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
          sources={sources.map((s) => ({ id: s.id, label: s.label }))}
          hasUnreadWhatsApp={unreadCount > 0}
          whatsappThreadId={whatsappThread?.id ?? null}
          isWhatsAppConnected={!!whatsappThread}
          sendAsAlternate={sendAsAlternate}
          canEditDetails={canEditDetails}
          currentUserRole={session!.user.role}
          currentUserId={userId}
          proposals={proposals}
          defaultProposalDescription={orgProposalSettings?.defaultProposalDescription ?? ""}
        />
      </Suspense>
    );
  });
}
