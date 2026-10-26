import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { requireProcessAccess, processScopeWhere } from "@/lib/processes/access";
import { resolveAvatarUrl } from "@/lib/r2";
import { ProcessDetail } from "./process-detail";

export default async function ProcessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProcessAccess();
  if (!access.ok) notFound();

  return runWithTenant(access.organizationId, async () => {
    const processRaw = await prisma.process.findFirst({
      where: { id, organizationId: access.organizationId, ...processScopeWhere(access) },
      include: {
        contact: true,
        owner: { select: { id: true, name: true, image: true } },
        stage: true,
        pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
        deal: { select: { id: true, name: true, value: true, creditType: true, closedAt: true } },
      },
    });
    if (!processRaw) notFound();

    const ownerPhotoUrl = await resolveAvatarUrl(processRaw.owner.image);

    const process = {
      id: processRaw.id,
      pipelineId: processRaw.pipelineId,
      stageId: processRaw.stageId,
      stage: {
        id: processRaw.stage.id,
        name: processRaw.stage.name,
        color: processRaw.stage.color,
        slaBusinessDays: processRaw.stage.slaBusinessDays,
      },
      pipeline: {
        stages: processRaw.pipeline.stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          isFinal: s.isFinal,
          slaBusinessDays: s.slaBusinessDays,
        })),
      },
      documentStatus: processRaw.documentStatus,
      quotaNumber: processRaw.quotaNumber,
      groupNumber: processRaw.groupNumber,
      // Decimal do Prisma não atravessa a fronteira servidor->cliente como
      // número: vira objeto e quebra a formatação de moeda.
      value: processRaw.value != null ? Number(processRaw.value) : null,
      stageEnteredAt: processRaw.stageEnteredAt,
      createdAt: processRaw.createdAt,
      // null em processo avulso (ver contactId/clientName no model Process) —
      // nesse caso só existe o nome, em `displayName` logo abaixo.
      contact: processRaw.contact
        ? {
            id: processRaw.contact.id,
            name: processRaw.contact.name,
            email: processRaw.contact.email,
            phone: processRaw.contact.phone,
            whatsapp: processRaw.contact.whatsapp,
            company: processRaw.contact.company,
            city: processRaw.contact.city,
            address: processRaw.contact.address,
            addressNumber: processRaw.contact.addressNumber,
            addressComplement: processRaw.contact.addressComplement,
            neighborhood: processRaw.contact.neighborhood,
            state: processRaw.contact.state,
            zipCode: processRaw.contact.zipCode,
          }
        : null,
      displayName: processRaw.contact?.name ?? processRaw.clientName ?? "Sem nome",
      owner: { id: processRaw.owner.id, name: processRaw.owner.name, photoUrl: ownerPhotoUrl },
      // null em processo sem negócio neste CRM (ver dealId no model Process).
      deal: processRaw.deal
        ? {
            id: processRaw.deal.id,
            name: processRaw.deal.name,
            value: processRaw.deal.value != null ? Number(processRaw.deal.value) : null,
            creditType: processRaw.deal.creditType,
            closedAt: processRaw.deal.closedAt,
          }
        : null,
    };

    return <ProcessDetail process={process} isAdmin={access.isAdmin} />;
  });
}
