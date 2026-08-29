import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, MessageSquare, Phone } from "lucide-react";
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

      {/* Cabeçalho e abas compartilham a mesma largura/centro (max-w-xl
          mx-auto, acompanha o max-w-xl do cartão de "Dados de contato" em
          contact-tabs.tsx) — antes o cabeçalho ocupava a página inteira
          enquanto o cartão de baixo ficava estreito e colado à esquerda,
          deixando o lápis de editar solto, longe do cartão. Agora os dois
          formam uma coluna só, centralizada. */}
      <div className="mx-auto max-w-xl space-y-6">
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
            // Mais chamativo que o .icon-btn discreto padrão — pedido
            // explícito pra esse lápis ficar mais visível aqui no topo do
            // Cliente-detalhe (é a única forma de editar nesta tela).
            triggerClassName="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-all duration-200 ease-spring hover:border-neutral-300 hover:text-neutral-900 hover:shadow-md active:scale-90 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
          />
        </div>

        {/* Atalhos de contato — mesmo idioma visual (pill colorida, ícone +
            rótulo) já usado nos botões de ação rápida do modal de tarefa
            (ver agenda/task-detail-modal.tsx: Ligar/E-mail/Chat), não um
            estilo novo. Só aparece o que o contato de fato tem preenchido —
            um contato sem e-mail não ganha um botão de e-mail desabilitado. */}
        {(contact.phone || contact.whatsapp || contact.email) && (
          <div className="flex flex-wrap gap-2">
            {contact.phone && (
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
              >
                <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                Ligar
              </a>
            )}
            {contact.whatsapp && (
              <Link
                href={`/whatsapp/conversas?contactId=${contact.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
              >
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                WhatsApp
              </Link>
            )}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20"
              >
                <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                E-mail
              </a>
            )}
          </div>
        )}

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
                  currentUserName: session!.user.name ?? undefined,
                  currentUserPhotoUrl,
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
