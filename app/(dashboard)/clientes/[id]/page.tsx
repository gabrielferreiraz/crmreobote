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

  const [sources, jobTitles, customFields, membersRaw, pipelinesRaw, creditTypes] = await Promise.all([
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
    // Pra "Novo negócio" direto desta tela (ver create-deal-for-contact-dialog.tsx)
    // — mesmo formato mínimo (id/nome + etapas em ordem) que pipeline/page.tsx já busca.
    prisma.pipeline.findMany({
      where: { organizationId },
      orderBy: { order: "asc" },
      include: { stages: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
    }),
    prisma.creditType.findMany({ where: { organizationId }, orderBy: { order: "asc" } }),
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
  const responsibleUserId = contact.responsavelId ?? session!.user.id;
  const responsibleInstance = await resolveConnectedInstance(organizationId, responsibleUserId);
  const whatsappThread =
    responsibleInstance?.status === "CONNECTED"
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
    ["OWNER", "MANAGER", "SUPERVISOR"].includes(session!.user.role ?? "") &&
    contact.responsavelId &&
    contact.responsavelId !== session!.user.id &&
    contact.responsavel
  ) {
    const myInstance = await resolveConnectedInstance(organizationId, session!.user.id);
    const myThread =
      myInstance?.status === "CONNECTED"
        ? await getOrCreateThreadForContact({ organizationId, instance: myInstance, contact })
        : null;
    if (myThread) {
      sendAsAlternate = { threadId: myThread.id, label: "você", defaultLabel: contact.responsavel.name };
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

      {/* Cabeçalho e abas compartilham a mesma largura/centro (max-w-xl
          mx-auto, acompanha o max-w-xl do cartão de "Dados de contato" em
          contact-tabs.tsx) — antes o cabeçalho ocupava a página inteira
          enquanto o cartão de baixo ficava estreito e colado à esquerda,
          deixando o lápis de editar solto, longe do cartão. Agora os dois
          formam uma coluna só, centralizada. */}
      <div className="mx-auto max-w-xl space-y-6">
        {/* Card Hero de Destaque do Cliente */}
        <div className="card p-5 bg-gradient-to-r from-neutral-900/95 via-neutral-900 to-neutral-950 border border-neutral-800/80 shadow-md space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3.5 min-w-0">
              <Avatar name={contact.name} size="lg" className="ring-2 ring-brand/40 shadow-sm shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="truncate text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 lg:text-2xl">
                  {contact.name}
                </h1>
                <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="inline-flex items-center gap-1 font-medium text-neutral-600 dark:text-neutral-300">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />
                    {contact.company || contact.source || "Origem não informada"}
                  </span>
                  {contact.responsavel && (
                    <>
                      <span className="text-neutral-400 dark:text-neutral-600">·</span>
                      <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                        <span>Resp: <strong className="font-semibold text-neutral-700 dark:text-neutral-200">{contact.responsavel.name}</strong></span>
                      </span>
                    </>
                  )}
                </p>
              </div>
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
              triggerClassName="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-800/80 px-3.5 text-xs font-semibold text-neutral-200 shadow-sm transition-all hover:bg-neutral-700 hover:text-white active:scale-95"
            />
          </div>

          {/* Atalhos de ação rápida do contato */}
          {(contact.phone || contact.whatsapp || contact.email) && (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-neutral-800/80">
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors"
                >
                  <Phone className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>Ligar</span>
                </a>
              )}
              {contact.whatsapp && (
                <Link
                  href={`/whatsapp/conversas?contactId=${contact.id}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors"
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>WhatsApp</span>
                </Link>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-purple-500/10 py-2 text-xs font-semibold text-purple-600 hover:bg-purple-500/20 dark:text-purple-400 transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" strokeWidth={2.2} />
                  <span>E-mail</span>
                </a>
              )}
            </div>
          )}
        </div>

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
