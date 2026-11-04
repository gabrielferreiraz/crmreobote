import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, MessageSquare, Phone, Building2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/avatar";
import { EditContactDialog } from "@/components/edit-contact-dialog";
import { runWithTenant } from "@/lib/tenant-context";
import { getOrCreateThreadForContact } from "@/lib/whatsapp/threads";
import { resolveConnectedInstance } from "@/lib/whatsapp/send";
import { stringifyCustomFieldValue, type CustomFieldValue } from "@/lib/custom-fields";
import { isoToBirthDateMask } from "@/lib/birth-date";
import { ContactTabs } from "./contact-tabs";
import { findOpenCentralThreadForContact } from "@/lib/whatsapp/central-access";

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

  const responsibleUserId = contact.responsavelId ?? session!.user.id;
  const canSendAsSelf =
    ["OWNER", "MANAGER", "SUPERVISOR"].includes(session!.user.role ?? "") &&
    !!contact.responsavelId &&
    contact.responsavelId !== session!.user.id &&
    !!contact.responsavel;

  const [
    [sources, jobTitles, customFields, membersRaw, pipelinesRaw, creditTypes],
    responsibleInstance,
    myInstance,
  ] = await Promise.all([
    Promise.all([
      prisma.leadSource.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        select: { id: true, label: true },
      }),
      prisma.jobTitle.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        select: { id: true, label: true },
      }),
      prisma.customFieldDefinition.findMany({
        where: { organizationId, entityType: "CONTACT" },
        orderBy: { order: "asc" },
      }),
      prisma.organizationUser.findMany({
        where: { organizationId, active: true },
        orderBy: { createdAt: "asc" },
        select: { user: { select: { id: true, name: true } } },
      }),
      prisma.pipeline.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          stages: { orderBy: { order: "asc" }, select: { id: true, name: true } },
        },
      }),
      prisma.creditType.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
        select: { id: true, label: true },
      }),
    ]),
    resolveConnectedInstance(organizationId, responsibleUserId),
    canSendAsSelf
      ? resolveConnectedInstance(organizationId, session!.user.id)
      : Promise.resolve(null),
  ]);
  const members = membersRaw.map((m) => m.user);
  const pipelines = pipelinesRaw.map((p) => ({ id: p.id, name: p.name, stages: p.stages }));
  const customFieldValues = (contact.customFieldValues as Record<string, CustomFieldValue>) ?? {};

  // A conversa PADRÃO é sempre a do responsável pelo contato — é o número
  // dele que troca mensagem de verdade com esse cliente. Se EU sou o
  // responsável (ou não há responsável definido), minha própria conversa já
  // É a certa, sem diferença nenhuma; senão (Dono/Gerente/Supervisor abrindo
  // o cliente de outro consultor), isso evita mostrar uma conversa própria
  // — quase sempre vazia — que por acaso exista com o mesmo contato. Pedido
  // explícito: o conteúdo mostrado é sempre "o mesmo do celular do dono do
  // lead".
  // Atendimento aberto na Central e de quem está vendo: o chat do perfil é o
  // da Central (o envio pelo pessoal é barrado no backend enquanto ele existir).
  const openCentral = await findOpenCentralThreadForContact(organizationId, contact.id);
  const whatsappThread =
    openCentral?.assigneeId === session!.user.id
      ? { id: openCentral.id }
      : responsibleInstance?.status === "CONNECTED"
        ? await getOrCreateThreadForContact({ organizationId, instance: responsibleInstance, contact })
        : null;

  // "Enviar como você": Dono, Gerente ou Supervisor vendo o cliente de outro
  // consultor (nunca o Consultor — ele só vê as próprias conversas, regra
  // explícita) ganham a opção de trocar pro PRÓPRIO número na hora de
  // enviar, quando quiserem falar pessoalmente com o lead em vez de
  // responder pelo número do responsável. O padrão continua sendo a
  // conversa do responsável (acima) — isso só oferece a alternativa, nunca
  // troca sozinho.
  let sendAsAlternate: { threadId: string; label: string; defaultLabel: string } | null = null;
  if (
    whatsappThread &&
    canSendAsSelf &&
    contact.responsavel &&
    !openCentral
  ) {
    const myThread =
      myInstance?.status === "CONNECTED"
        ? await getOrCreateThreadForContact({ organizationId, instance: myInstance, contact })
        : null;
    if (myThread) {
      sendAsAlternate = { threadId: myThread.id, label: "você", defaultLabel: contact.responsavel.name };
    }
  }

  return (
    <div className="contact-detail mx-auto w-full max-w-[1440px] space-y-4 lg:space-y-5">
      <Link
        href={fromDeal ? `/negocios/${fromDeal}` : "/clientes"}
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {fromDeal ? "Negócio" : "Clientes"}
      </Link>

      <div className="space-y-4 lg:space-y-5">
        <section className="contact-mobile-summary border-b border-neutral-200 pb-5 dark:border-neutral-800">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3.5 lg:items-center">
              <Avatar name={contact.name} size="lg" className="shrink-0 ring-2 ring-brand/30" />
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="line-clamp-2 text-xl font-bold text-neutral-900 dark:text-neutral-100 lg:truncate lg:text-2xl">
                  {contact.name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                  <span className="inline-flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />
                    {contact.company || contact.source || "Origem não informada"}
                  </span>
                  {contact.responsavel && (
                    <span className="text-neutral-500 dark:text-neutral-400">
                      Responsável: <strong className="font-medium text-neutral-700 dark:text-neutral-300">{contact.responsavel.name}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="contact-quick-actions flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800 lg:shrink-0 lg:border-0 lg:pt-0">
              {contact.whatsapp && (
                <Link
                  href={`/whatsapp/conversas?contactId=${contact.id}`}
                  className="contact-quick-action btn-secondary btn-sm text-emerald-700 dark:text-emerald-400"
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>WhatsApp</span>
                </Link>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="contact-quick-action btn-secondary btn-sm">
                  <Phone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={2.2} />
                  <span>Ligar</span>
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="contact-quick-action btn-secondary btn-sm">
                  <Mail className="h-3.5 w-3.5 text-brand" strokeWidth={2.2} />
                  <span>E-mail</span>
                </a>
              )}
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
                  birthDate: contact.birthDate,
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
                triggerClassName="contact-quick-action btn-secondary btn-sm"
              />
            </div>
          </div>
        </section>

        <ContactTabs
          contactId={contact.id}
          contactName={contact.name}
          deals={contact.deals.map((deal) => ({
            id: deal.id,
            name: deal.name,
            status: deal.status,
            value: deal.value ? Number(deal.value) : null,
            stageName: deal.stage.name,
            stageColor: deal.stage.color,
          }))}
          pipelines={pipelines}
          members={members}
          creditTypes={creditTypes.map((c) => ({ id: c.id, label: c.label }))}
          // Mesmo critério de canBulkDelete em pipeline/page.tsx — apagar é
          // destrutivo, só Dono/Gerente, não todo mundo que enxerga o negócio/contato.
          // A API de apagar CONTATO já é OWNER/MANAGER-only por conta própria
          // (ver app/api/contacts/[id]/route.ts) — isso aqui só evita mostrar
          // um botão que ia dar 403 pra quem não pode.
          canDeleteDeals={["OWNER", "MANAGER"].includes(session!.user.role ?? "")}
          canDeleteContact={["OWNER", "MANAGER"].includes(session!.user.role ?? "")}
          infoRows={[
            { label: "E-mail", value: contact.email ?? "—" },
            { label: "Celular", value: contact.phone ?? "—" },
            { label: "WhatsApp", value: contact.whatsapp ?? "—" },
            { label: "Empresa", value: contact.company ?? "—" },
            { label: "Cargo", value: contact.jobTitle ?? "—" },
            { label: "Data de nascimento", value: isoToBirthDateMask(contact.birthDate) || "—" },
            { label: "Origem", value: contact.source ?? "—" },
            { label: "Responsável", value: contact.responsavel?.name ?? "—" },
            // Data/hora real de cadastro — vem certa até pra quem migrou do
            // Agendor (ver scripts/agendor/import-pessoas.ts, que já grava o
            // createdAt real da planilha antiga, não a data desta importação).
            {
              label: "Cadastrado em",
              value: contact.createdAt.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
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
                  sendAsAlternate,
                }
              : null
          }
        />
      </div>
    </div>
  );
  });
}
