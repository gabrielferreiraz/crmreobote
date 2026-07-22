import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/avatar";
import { EditContactDialog } from "@/components/edit-contact-dialog";
import { resolveAvatarUrl } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateThreadForContact } from "@/lib/whatsapp/threads";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { stringifyCustomFieldValue, type CustomFieldValue } from "@/lib/custom-fields";
import { ContactTabs } from "./contact-tabs";

function formatAddress(contact: {
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}): string | null {
  const line1 = [
    contact.address,
    contact.addressNumber ? `nº ${contact.addressNumber}` : null,
    contact.addressComplement,
  ]
    .filter(Boolean)
    .join(", ");
  const line2 = [contact.neighborhood, [contact.city, contact.state].filter(Boolean).join(" - ")]
    .filter(Boolean)
    .join(", ");
  const line3 = contact.zipCode ? `CEP ${contact.zipCode}` : null;

  const lines = [line1, line2, line3].filter(Boolean);
  return lines.length > 0 ? lines.join(" · ") : null;
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fromDeal?: string }>;
}) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { id } = await params;
  const { fromDeal } = await searchParams;

  return runWithTenant(organizationId, async () => {
  const contact = await prisma.contact.findFirst({
    where: { id, organizationId },
    include: {
      deals: { include: { stage: true }, orderBy: { createdAt: "desc" } },
      responsavel: { select: { id: true, name: true } },
    },
  });

  if (!contact) notFound();

  const [sources, jobTitles, customFields, membersRaw] = await Promise.all([
    prisma.leadSource.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.jobTitle.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
    prisma.customFieldDefinition.findMany({
      where: { organizationId, entityType: "CONTACT" },
      orderBy: { order: "asc" },
    }),
    prisma.organizationUser.findMany({
      where: { organizationId, active: true },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const members = membersRaw.map((m) => m.user);
  const customFieldValues = (contact.customFieldValues as Record<string, CustomFieldValue>) ?? {};

  const currentUserPhotoUrl = await resolveAvatarUrl(session!.user.image);

  // Mesma regra do envio: a conversa aberta aqui é sempre a de quem está
  // logado (cada um manda pelo próprio número conectado).
  const myInstance = await resolveConnectedInstance(organizationId, session!.user.id);
  const whatsappThread =
    myInstance?.status === "CONNECTED"
      ? await getOrCreateThreadForContact({ organizationId, instance: myInstance, contact })
      : null;

  // "Enviar como consultor" — só pro Dono, e só quando o cliente tem um
  // responsável diferente dele com WhatsApp próprio conectado. Preserva o
  // padrão de sempre mandar como o próprio usuário (whatsappThread acima);
  // isso só oferece a alternativa, nunca troca sozinho.
  let sendAsAlternate: { threadId: string; label: string } | null = null;
  if (
    whatsappThread &&
    session!.user.role === "OWNER" &&
    contact.responsavelId &&
    contact.responsavelId !== session!.user.id &&
    contact.responsavel
  ) {
    const consultantInstance = await resolveConnectedInstance(organizationId, contact.responsavelId);
    const consultantThread =
      consultantInstance?.status === "CONNECTED"
        ? await getOrCreateThreadForContact({ organizationId, instance: consultantInstance, contact })
        : null;
    if (consultantThread) {
      sendAsAlternate = { threadId: consultantThread.id, label: contact.responsavel.name };
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href={fromDeal ? `/negocios/${fromDeal}` : "/clientes"}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {fromDeal ? "Negócio" : "Clientes"}
      </Link>

      <div className="flex items-center gap-3">
        <Avatar name={contact.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{contact.name}</h1>
          <p className="mt-0.5 truncate text-sm text-neutral-500 dark:text-neutral-400">{contact.source ?? "Origem não informada"}</p>
        </div>
        <EditContactDialog
          contact={{
            id: contact.id,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            whatsapp: contact.whatsapp,
            source: contact.source,
            company: contact.company,
            jobTitle: contact.jobTitle,
            address: contact.address,
            addressNumber: contact.addressNumber,
            addressComplement: contact.addressComplement,
            neighborhood: contact.neighborhood,
            city: contact.city,
            state: contact.state,
            zipCode: contact.zipCode,
            tags: contact.tags,
            responsavelId: contact.responsavelId,
            customFieldValues,
          }}
          sources={sources}
          jobTitles={jobTitles}
          members={members}
          customFields={customFields}
        />
      </div>

      <ContactTabs
        deals={contact.deals.map((deal) => ({
          id: deal.id,
          name: deal.name,
          status: deal.status,
          value: deal.value ? Number(deal.value) : null,
          stageName: deal.stage.name,
        }))}
        infoRows={[
          { label: "E-mail", value: contact.email ?? "—" },
          { label: "Celular", value: contact.phone ?? "—" },
          { label: "WhatsApp", value: contact.whatsapp ?? "—" },
          { label: "Empresa", value: contact.company ?? "—" },
          { label: "Cargo", value: contact.jobTitle ?? "—" },
          { label: "Origem", value: contact.source ?? "—" },
          { label: "Responsável", value: contact.responsavel?.name ?? "—" },
          ...customFields
            .map((def) => ({ label: def.label, value: stringifyCustomFieldValue(def, customFieldValues[def.id] ?? null) }))
            .filter((row) => row.value),
        ]}
        addressLines={formatAddress(contact)}
        tags={contact.tags}
        whatsapp={
          whatsappThread
            ? {
                threadId: whatsappThread.id,
                contactId: contact.id,
                contactName: contact.name,
                contactPhone: contact.whatsapp || contact.phone,
                currentUserName: session!.user.name ?? undefined,
                currentUserPhotoUrl,
                sendAsAlternate,
              }
            : null
        }
      />
    </div>
  );
  });
}
