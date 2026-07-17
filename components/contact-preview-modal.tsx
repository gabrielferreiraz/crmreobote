"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Inbox } from "lucide-react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { EditContactDialog } from "@/components/edit-contact-dialog";
import type { CustomFieldDefinitionInput, CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { formatCurrency } from "@/lib/format";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

type ContactDeal = {
  id: string;
  name: string;
  status: "OPEN" | "WON" | "LOST";
  value: number | string | null;
  stage: { name: string };
};

type ContactFull = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  company: string | null;
  jobTitle: string | null;
  responsavelId: string | null;
  tags: string[];
  customFieldValues?: CustomFieldFormValues | null;
  deals: ContactDeal[];
};

export function ContactPreviewModal({
  contactId,
  members,
  onClose,
}: {
  contactId: string;
  members: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [contact, setContact] = useState<ContactFull | null>(null);
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [jobTitles, setJobTitles] = useState<{ id: string; label: string }[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldDefinitionInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/contacts/${contactId}`).then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      }),
      fetch("/api/lead-sources").then((res) => (res.ok ? res.json() : [])),
      fetch("/api/job-titles").then((res) => (res.ok ? res.json() : [])),
      fetch("/api/custom-fields").then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([contactData, sourcesData, jobTitlesData, fieldsData]) => {
        if (cancelled) return;
        setContact(contactData);
        setSources(sourcesData);
        setJobTitles(jobTitlesData);
        setCustomFields(fieldsData.filter((f: CustomFieldDefinitionInput & { entityType: string }) => f.entityType === "CONTACT"));
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar o contato");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" strokeWidth={2} />
        </div>
      ) : error || !contact ? (
        <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
          {error ?? "Contato não encontrado"}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={contact.name} size="lg" />
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                  {contact.name}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                  {contact.jobTitle ? contact.jobTitle : (contact.source ?? "Origem não informada")}
                </p>
              </div>
            </div>
            <EditContactDialog contact={contact} sources={sources} jobTitles={jobTitles} members={members} customFields={customFields} />
          </div>

          <div className="space-y-2 text-sm">
            <Row label="E-mail" value={contact.email ?? "—"} />
            <Row label="Celular" value={contact.phone ?? "—"} />
            <Row label="WhatsApp" value={contact.whatsapp ?? "—"} />
            <Row label="Empresa" value={contact.company ?? "—"} />
            <Row label="Cargo" value={contact.jobTitle ?? "—"} />
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

          <div>
            <h3 className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">Negócios</h3>
            {contact.deals.length === 0 ? (
              <div className="card">
                <EmptyState icon={Inbox} title="Nenhum negócio vinculado" />
              </div>
            ) : (
              <div className="scrollbar-thin max-h-56 space-y-2 overflow-y-auto">
                {contact.deals.map((deal) => (
                  <Link
                    key={deal.id}
                    href={`/negocios/${deal.id}`}
                    onClick={onClose}
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
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <Link
              href={`/clientes/${contact.id}`}
              onClick={onClose}
              className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline"
            >
              Ver página completa
            </Link>
            <button onClick={onClose} className="btn-secondary btn-sm">
              Fechar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="text-right text-neutral-800 dark:text-neutral-200">{value}</span>
    </div>
  );
}
