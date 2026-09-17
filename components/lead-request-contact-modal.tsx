"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Mail,
  Phone as PhoneIcon,
  MessageSquare,
  Building2,
  Briefcase,
  MapPin,
  Tag as TagIcon,
  User as UserIcon,
  CalendarClock,
} from "lucide-react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/badge";
import { formatCurrency } from "@/lib/format";

type DealPreview = {
  id: string;
  name: string;
  status: "OPEN" | "WON" | "LOST";
  value: string | number | null;
  stage: { name: string; color: string | null };
};

type ContactPreview = {
  id: string;
  name: string;
  source: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  company: string | null;
  jobTitle: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  tags: string[];
  createdAt: string;
  responsavel: { name: string } | null;
  deals: DealPreview[];
};

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

function formatAddress(contact: ContactPreview): string | null {
  const line1 = [contact.address, contact.addressNumber ? `nº ${contact.addressNumber}` : null, contact.addressComplement]
    .filter(Boolean)
    .join(", ");
  const line2 = [contact.neighborhood, [contact.city, contact.state].filter(Boolean).join(" - ")]
    .filter(Boolean)
    .join(", ");
  const line3 = contact.zipCode ? `CEP ${contact.zipCode}` : null;
  const lines = [line1, line2, line3].filter(Boolean);
  return lines.length > 0 ? lines.join(" · ") : null;
}

/**
 * Preview read-only de um contato, num popup — pedido explícito ao lado do
 * botão "Ver cliente" no pedido de lead (ver components/notification-bell.tsx):
 * antes de aprovar/recusar quem já é dono do lead, dá pra ver dados pessoais
 * + negócios do contato sem sair da tela atual pra ir procurar em Clientes.
 * Mesmo GET que a página de detalhe do contato usa (app/(dashboard)/clientes/
 * [id]/page.tsx), só que consumido aqui num modal — sem editar/apagar nada,
 * é só consulta.
 */
export function LeadRequestContactModal({
  contactId,
  onClose,
  onApprove,
  onDecline,
  resolving,
}: {
  contactId: string;
  onClose: () => void;
  /** Aprovar/recusar direto do popup — as duas juntas ou nenhuma (sem meio-termo: não faz sentido só uma aparecer). */
  onApprove?: () => void;
  onDecline?: () => void;
  resolving?: boolean;
}) {
  const [contact, setContact] = useState<ContactPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sem reset de estado aqui de propósito: este componente só existe
  // montado enquanto previewRequest != null (ver notification-bell.tsx), e
  // trocar de pedido sempre passa por fechar (unmount) antes de abrir outro
  // — contactId nunca muda "vivo" durante o ciclo de vida deste componente,
  // então useState(null) como valor inicial já é o reset que precisaria.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contacts/${contactId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (!cancelled) setContact(data);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar os dados desse cliente.");
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const canResolve = !!(onApprove && onDecline);

  return (
    <Modal onClose={onClose} maxWidth="max-w-md">
      {!contact && !error && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          Carregando cliente…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 py-6 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          {error}
        </div>
      )}

      {contact && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={contact.name} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{contact.name}</h2>
              <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{contact.source ?? "Origem não informada"}</p>
            </div>
          </div>

          <div className="card space-y-2 p-3 text-sm">
            <InfoRow icon={Mail} label="E-mail" value={contact.email} />
            <InfoRow icon={PhoneIcon} label="Celular" value={contact.phone} />
            <InfoRow icon={MessageSquare} label="WhatsApp" value={contact.whatsapp} />
            <InfoRow icon={Building2} label="Empresa" value={contact.company} />
            <InfoRow icon={Briefcase} label="Cargo" value={contact.jobTitle} />
            <InfoRow icon={MapPin} label="Endereço" value={formatAddress(contact)} />
            <InfoRow icon={UserIcon} label="Responsável atual" value={contact.responsavel?.name ?? null} />
            <InfoRow icon={CalendarClock} label="Cadastrado em" value={new Date(contact.createdAt).toLocaleDateString("pt-BR")} />
            {contact.tags.length > 0 && (
              <div className="flex items-start justify-between gap-2 pt-1">
                <span className="flex shrink-0 items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                  <TagIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  Tags
                </span>
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
            <p className="mb-1.5 px-0.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Negócios ({contact.deals.length})
            </p>
            {contact.deals.length === 0 ? (
              <p className="px-0.5 text-sm text-neutral-400 dark:text-neutral-500">Nenhum negócio vinculado.</p>
            ) : (
              <div className="space-y-1.5">
                {contact.deals.map((deal) => (
                  <div key={deal.id} className="card p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">{deal.name}</span>
                      <Badge tone={STATUS_LABEL[deal.status].tone} className="shrink-0">
                        {STATUS_LABEL[deal.status].label}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="flex min-w-0 items-center gap-1.5 truncate">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: deal.stage.color ?? "#a1a1aa" }} />
                        <span className="truncate">{deal.stage.name}</span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{formatCurrency(deal.value)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Fechar
            </button>
            {canResolve && (
              <>
                <button type="button" disabled={resolving} onClick={onDecline} className="btn-secondary">
                  Recusar
                </button>
                <button type="button" disabled={resolving} onClick={onApprove} className="btn-primary">
                  {resolving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : "Aprovar"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex shrink-0 items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-neutral-800 dark:text-neutral-200">{value ?? "—"}</span>
    </div>
  );
}
