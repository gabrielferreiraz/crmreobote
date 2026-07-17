import { notFound } from "next/navigation";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { EditContactDialog } from "@/components/edit-contact-dialog";
import { WhatsAppChat } from "@/components/whatsapp-chat";
import { resolveAvatarUrl } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateThreadForContact } from "@/lib/whatsapp/threads";
import { stringifyCustomFieldValue, type CustomFieldValue } from "@/lib/custom-fields";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

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

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { id } = await params;

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
  const myInstance = await prisma.whatsAppInstance.findUnique({
    where: { organizationId_userId: { organizationId, userId: session!.user.id } },
  });
  const whatsappThread =
    myInstance?.status === "CONNECTED"
      ? await getOrCreateThreadForContact({ organizationId, instance: myInstance, contact })
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Avatar name={contact.name} size="lg" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{contact.name}</h1>
          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{contact.source ?? "Origem não informada"}</p>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Negócios</h2>
          {contact.deals.length === 0 ? (
            <div className="card">
              <EmptyState icon={Inbox} title="Nenhum negócio vinculado" />
            </div>
          ) : (
            contact.deals.map((deal) => (
              <Link
                key={deal.id}
                href={`/negocios/${deal.id}`}
                className="card block p-3 text-sm hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</span>
                  <Badge tone={STATUS_LABEL[deal.status].tone}>{STATUS_LABEL[deal.status].label}</Badge>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{deal.stage.name}</span>
                  <span className="tabular-nums">{formatCurrency(deal.value ? Number(deal.value) : null)}</span>
                </div>
              </Link>
            ))
          )}
        </div>

        <div className="card space-y-2 p-4 text-sm">
          <h3 className="font-medium text-neutral-800 dark:text-neutral-200">Dados de contato</h3>
          <Row label="E-mail" value={contact.email ?? "—"} />
          <Row label="Celular" value={contact.phone ?? "—"} />
          <Row label="WhatsApp" value={contact.whatsapp ?? "—"} />
          <Row label="Empresa" value={contact.company ?? "—"} />
          <Row label="Cargo" value={contact.jobTitle ?? "—"} />
          <Row label="Origem" value={contact.source ?? "—"} />
          <Row label="Responsável" value={contact.responsavel?.name ?? "—"} />
          {formatAddress(contact) && (
            <div className="space-y-0.5">
              <span className="text-neutral-500 dark:text-neutral-400">Endereço</span>
              <p className="text-right text-neutral-800 dark:text-neutral-200">{formatAddress(contact)}</p>
            </div>
          )}
          {customFields.map((def) => {
            const value = stringifyCustomFieldValue(def, customFieldValues[def.id] ?? null);
            if (!value) return null;
            return <Row key={def.id} label={def.label} value={value} />;
          })}
          {contact.tags.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">Tags</span>
              <div className="flex flex-wrap justify-end gap-1">
                {contact.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {whatsappThread && (
            <WhatsAppChat
              threadId={whatsappThread.id}
              contactId={contact.id}
              contactName={contact.name}
              contactPhone={contact.whatsapp || contact.phone}
              currentUserName={session!.user.name ?? undefined}
              currentUserPhotoUrl={currentUserPhotoUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="text-right text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}
