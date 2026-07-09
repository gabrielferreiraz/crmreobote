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
import { runWithTenant } from "@/lib/tenant-context";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const { id } = await params;

  return runWithTenant(organizationId, async () => {
  const contact = await prisma.contact.findFirst({
    where: { id, organizationId },
    include: {
      deals: { include: { stage: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!contact) notFound();

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
            tags: contact.tags,
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-2">
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
          <Row label="Origem" value={contact.source ?? "—"} />
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
