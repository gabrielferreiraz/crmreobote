"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Mail, Phone, Tag, User, Calendar, Megaphone, ExternalLink } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge, type BadgeTone } from "@/components/badge";
import { formatCurrency } from "@/lib/format";

type ContactDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  tags: string[];
  metaCampaignName: string | null;
  leadQualification: "QUALIFIED" | "UNQUALIFIED" | null;
  createdAt: string;
  responsavel: { name: string } | null;
  deals: {
    id: string;
    name: string;
    status: "OPEN" | "WON" | "LOST";
    value: string | number | null;
    stage: { name: string };
  }[];
};

const DEAL_STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Em andamento", tone: "neutral" },
  WON: { label: "Ganho", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

const QUALIFICATION_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  QUALIFIED: { label: "Qualificado", tone: "success" },
  UNQUALIFIED: { label: "Desqualificado", tone: "danger" },
};

/**
 * Painel "Informações" ao lado da conversa (ver conversations-view.tsx) —
 * fase 1 do pedido (referência: Zoho CRM). Só a aba de informações do
 * contato por enquanto — a "Linha do tempo" (mensagem automática vs manual,
 * notas do negócio, disparo de campanha, tudo junto numa timeline só) fica
 * pra uma 2ª etapa combinada à parte, é bem mais trabalho (junta MUITAS
 * fontes de dado diferentes, nenhuma delas pronta pra isso hoje).
 *
 * Busca /api/contacts/[id] por conta própria (não reaproveita o fetch que
 * ChatWindow já faz internamente pro badge de campanha do Facebook) — os
 * dois componentes não têm por que ficar acoplados só pra evitar uma 2ª
 * chamada barata a uma rota que já existe.
 *
 * Só desktop, de propósito (pedido explícito) — a versão mobile da tela de
 * conversas (conversations-view-mobile.tsx) fica de fora por enquanto.
 */
export function ContactInfoPanel({ contactId }: { contactId: string }) {
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContact(null);
    fetch(`/api/contacts/${contactId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setContact(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return (
    <div className="surface-glass-panel scrollbar-thin hidden w-72 shrink-0 flex-col overflow-y-auto rounded-lg xl:flex">
      {loading ? (
        <div className="animate-pulse space-y-3 p-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-neutral-200 dark:bg-neutral-800" />
          <div className="mx-auto h-3.5 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
      ) : !contact ? (
        // Falhou ao buscar (contato apagado, erro de rede) — melhor ficar em
        // branco do que mostrar um painel com dado errado/travado.
        <p className="p-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
          Não foi possível carregar as informações do contato.
        </p>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 border-b border-neutral-100 p-4 text-center dark:border-neutral-800">
            <Avatar name={contact.name} size="lg" />
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">{contact.name}</p>
            {contact.leadQualification && (
              <Badge tone={QUALIFICATION_LABEL[contact.leadQualification].tone}>
                {QUALIFICATION_LABEL[contact.leadQualification].label}
              </Badge>
            )}
            <Link
              href={`/clientes/${contact.id}`}
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              Ver ficha completa
              <ExternalLink className="h-3 w-3" strokeWidth={2} />
            </Link>
          </div>

          <div className="space-y-3 p-4 text-sm">
            {contact.phone && <InfoRow icon={Phone} label="Celular" value={contact.phone} />}
            {contact.whatsapp && <InfoRow icon={Phone} label="WhatsApp" value={contact.whatsapp} />}
            {contact.email && <InfoRow icon={Mail} label="E-mail" value={contact.email} />}
            {contact.responsavel && <InfoRow icon={User} label="Responsável" value={contact.responsavel.name} />}
            {contact.source && <InfoRow icon={Tag} label="Origem" value={contact.source} />}
            {contact.metaCampaignName && <InfoRow icon={Megaphone} label="Campanha" value={contact.metaCampaignName} />}
            <InfoRow
              icon={Calendar}
              label="Cadastrado em"
              value={new Date(contact.createdAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            />

            {contact.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {contact.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {contact.deals.length > 0 && (
            <div className="border-t border-neutral-100 p-4 dark:border-neutral-800">
              <p className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                Negócios ({contact.deals.length})
              </p>
              <div className="space-y-2">
                {contact.deals.map((deal) => (
                  <Link
                    key={deal.id}
                    href={`/negocios/${deal.id}`}
                    className="card block p-2.5 text-xs hover:border-neutral-300 dark:hover:border-neutral-700"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {deal.name}
                      </span>
                      <Badge tone={DEAL_STATUS_LABEL[deal.status].tone} className="shrink-0">
                        {DEAL_STATUS_LABEL[deal.status].label}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
                      <span className="min-w-0 truncate">{deal.stage.name}</span>
                      <span className="shrink-0 tabular-nums">{formatCurrency(deal.value)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
      <div className="min-w-0">
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{label}</p>
        <p className="truncate text-neutral-800 dark:text-neutral-200">{value}</p>
      </div>
    </div>
  );
}
