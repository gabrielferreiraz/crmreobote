"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Inbox,
  Loader2,
  Upload,
  Download,
  Search,
  SearchX,
  User,
  Mail,
  Phone,
  Tag,
  Tags,
  Briefcase,
  IdCard,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ImportDialog } from "@/components/import-dialog";
import { EditContactDialog } from "@/components/edit-contact-dialog";
import { FilterPopover } from "@/components/filter-popover";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { DateRangeField } from "@/components/date-range-calendar";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { SelectionBar } from "@/components/selection-bar";
import { BulkActionPopover } from "@/components/bulk-action-popover";
import { SelectPopoverBody } from "@/components/select-popover-body";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { buildListQuickRanges } from "@/lib/date-ranges";
import { brazilDateStringToUTC, brazilEndOfDayUTC } from "@/lib/timezone";
import { countBulkFailures } from "@/lib/bulk-fetch";

const QUICK_RANGES = buildListQuickRanges();

const NO_JOB_TITLE = "__NONE__";
const NO_RESPONSAVEL = "__NONE__";

const SOURCE_BADGE: Record<string, string> = {
  FACEBOOK:
    "border-blue-200/60 bg-blue-50/60 text-blue-700/80 dark:border-blue-800/40 dark:bg-blue-500/5 dark:text-blue-400/70",
  INSTAGRAM:
    "border-pink-200/60 bg-pink-50/60 text-pink-700/80 dark:border-pink-800/40 dark:bg-pink-500/5 dark:text-pink-400/70",
  "INDICAÇÃO":
    "border-emerald-200/60 bg-emerald-50/60 text-emerald-700/80 dark:border-emerald-800/40 dark:bg-emerald-500/5 dark:text-emerald-400/70",
};
const SOURCE_BADGE_DEFAULT =
  "border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400";
const SOURCE_DOT: Record<string, string> = {
  FACEBOOK: "bg-blue-500",
  INSTAGRAM: "bg-pink-500",
  "INDICAÇÃO": "bg-emerald-500",
};
const SOURCE_DOT_DEFAULT = "bg-neutral-400";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
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
  responsavelId: string | null;
  responsavel: { id: string; name: string } | null;
  createdAt: string | Date;
  customFieldValues: CustomFieldFormValues | null;
  _count: { deals: number };
};

type MemberOption = { id: string; name: string };

type PipelineOption = { id: string; name: string; isDefault: boolean; firstStageId: string };

export function ContactsTable({
  initialContacts,
  isOwner,
  isManager,
  sources,
  jobTitles,
  members,
  pipelines,
  customFields,
}: {
  initialContacts: Contact[];
  isOwner: boolean;
  isManager: boolean;
  sources: { id: string; label: string }[];
  jobTitles: { id: string; label: string }[];
  members: MemberOption[];
  pipelines: PipelineOption[];
  customFields: CustomFieldDefinitionInput[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [source, setSource] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressComplement, setAddressComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [tags, setTags] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldFormValues>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [jobTitleFilter, setJobTitleFilter] = useState("");
  const [responsavelFilter, setResponsavelFilter] = useState("");
  const [onlyWithDeals, setOnlyWithDeals] = useState(false);
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of initialContacts) if (c.source) set.add(c.source);
    return Array.from(set).sort();
  }, [initialContacts]);

  // Junta a lista editável (Configurações → Cargos) com qualquer valor
  // "antigo" (texto livre de antes dessa lista existir) que ainda esteja em
  // uso — senão o filtro não encontraria contatos com cargo fora da lista.
  const jobTitleOptions = useMemo(() => {
    const set = new Set(jobTitles.map((j) => j.label));
    for (const c of initialContacts) if (c.jobTitle) set.add(c.jobTitle);
    return Array.from(set);
  }, [initialContacts, jobTitles]);

  const hasFilters =
    !!search ||
    !!sourceFilter ||
    !!jobTitleFilter ||
    !!responsavelFilter ||
    onlyWithDeals ||
    !!registeredFrom ||
    !!registeredTo;

  function clearFilters() {
    setSearch("");
    setSourceFilter("");
    setJobTitleFilter("");
    setResponsavelFilter("");
    setOnlyWithDeals(false);
    setRegisteredFrom("");
    setRegisteredTo("");
  }

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = registeredFrom ? brazilDateStringToUTC(registeredFrom) : null;
    const to = registeredTo ? brazilEndOfDayUTC(registeredTo) : null;
    return initialContacts.filter((c) => {
      if (
        term &&
        !c.name.toLowerCase().includes(term) &&
        !(c.email ?? "").toLowerCase().includes(term) &&
        !(c.phone ?? "").includes(term)
      ) {
        return false;
      }
      if (sourceFilter && c.source !== sourceFilter) return false;
      if (jobTitleFilter === NO_JOB_TITLE && c.jobTitle) return false;
      if (jobTitleFilter && jobTitleFilter !== NO_JOB_TITLE && c.jobTitle !== jobTitleFilter) return false;
      if (responsavelFilter === NO_RESPONSAVEL && c.responsavelId) return false;
      if (responsavelFilter && responsavelFilter !== NO_RESPONSAVEL && c.responsavelId !== responsavelFilter) return false;
      if (onlyWithDeals && c._count.deals === 0) return false;
      if (from || to) {
        const createdAt = new Date(c.createdAt);
        if (from && createdAt < from) return false;
        if (to && createdAt > to) return false;
      }
      return true;
    });
  }, [
    initialContacts,
    search,
    sourceFilter,
    jobTitleFilter,
    responsavelFilter,
    onlyWithDeals,
    registeredFrom,
    registeredTo,
  ]);

  const selectedContactIds = useMemo(
    () => filteredContacts.filter((c) => selectedIds.has(c.id)).map((c) => c.id),
    [filteredContacts, selectedIds],
  );
  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every((c) => selectedIds.has(c.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const c of filteredContacts) next.delete(c.id);
        return next;
      }
      const next = new Set(prev);
      for (const c of filteredContacts) next.add(c.id);
      return next;
    });
  }

  function toggleSelect(id: string, shiftKey?: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isSelecting = !next.has(id);

      if (isSelecting) {
        next.add(id);
      } else {
        next.delete(id);
      }

      if (shiftKey && lastSelectedId && lastSelectedId !== id) {
        const lastIndex = filteredContacts.findIndex((c) => c.id === lastSelectedId);
        const currentIndex = filteredContacts.findIndex((c) => c.id === id);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          
          for (let i = start; i <= end; i++) {
            const contactId = filteredContacts[i].id;
            if (isSelecting) {
              next.add(contactId);
            } else {
              next.delete(contactId);
            }
          }
        }
      }

      if (isSelecting) {
        setLastSelectedId(id);
      } else if (lastSelectedId === id) {
        setLastSelectedId(null);
      }

      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setBulkError(null);
  }

  async function applyBulkField(field: "jobTitle" | "source" | "responsavelId", value: string) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        selectedContactIds.map((id) =>
          fetch(`/api/contacts/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: field === "responsavelId" ? value || null : value }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns contatos não puderam ser atualizados.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkTag(tag: string) {
    const clean = tag.trim();
    if (!clean) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        filteredContacts
          .filter((c) => selectedIds.has(c.id))
          .map((c) =>
            fetch(`/api/contacts/${c.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tags: c.tags.includes(clean) ? c.tags : [...c.tags, clean] }),
            }),
          ),
      );
      if (failures > 0) {
        setBulkError("Alguns contatos não puderam ser atualizados.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        selectedContactIds.map((id) => fetch(`/api/contacts/${id}`, { method: "DELETE" })),
      );
      if (failures > 0) {
        setBulkError("Alguns contatos não puderam ser apagados.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Um negócio por contato selecionado, na primeira etapa do funil escolhido —
  // sem responsável/valor (fica pra editar depois), mesmo comportamento de
  // "Atribuição automática" do NewDealDialog (ownerId omitido = auto-assign).
  async function applyCreateDeals(pipelineId: string) {
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const failures = await countBulkFailures(
        selectedContactIds.map((id) =>
          fetch("/api/deals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pipelineId, stageId: pipeline.firstStageId, contactId: id }),
          }),
        ),
      );
      if (failures > 0) {
        setBulkError("Alguns negócios não puderam ser criados.");
      }
      clearSelection();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email || undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        source: source || undefined,
        company: company || undefined,
        jobTitle: jobTitle || undefined,
        zipCode: zipCode || undefined,
        address: address || undefined,
        addressNumber: addressNumber || undefined,
        addressComplement: addressComplement || undefined,
        neighborhood: neighborhood || undefined,
        city: city || undefined,
        state: state || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        responsavelId: responsavelId || undefined,
        customFieldValues,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar contato");
      return;
    }

    setOpen(false);
    setName("");
    setEmail("");
    setPhone("");
    setWhatsapp("");
    setSource("");
    setCompany("");
    setJobTitle("");
    setZipCode("");
    setAddress("");
    setAddressNumber("");
    setAddressComplement("");
    setNeighborhood("");
    setCity("");
    setState("");
    setTags("");
    setResponsavelId("");
    setCustomFieldValues({});
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Novo contato
        </button>
        <button onClick={() => setImportOpen(true)} className="btn-secondary">
          <Upload className="h-4 w-4" strokeWidth={2} />
          Importar
        </button>
        {isOwner && (
          <a href="/api/contacts/export" className="btn-secondary">
            <Download className="h-4 w-4" strokeWidth={2} />
            Exportar
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail ou celular"
            className="field-input w-full py-1.5 pl-8 text-sm"
          />
        </div>
        <FilterPopover active={hasFilters} onClear={clearFilters}>
          {sourceOptions.length > 0 && (
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select
                value={sourceFilter}
                onChange={setSourceFilter}
                className="w-full py-1.5 text-sm"
                options={[
                  { value: "", label: "Todas as origens" },
                  ...sourceOptions.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="field-label">Cargo</label>
            <Select
              value={jobTitleFilter}
              onChange={setJobTitleFilter}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos os cargos" },
                { value: NO_JOB_TITLE, label: "Sem cargo cadastrado" },
                ...jobTitleOptions.map((j) => ({ value: j, label: j })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={responsavelFilter}
              onChange={setResponsavelFilter}
              className="w-full py-1.5 text-sm"
              options={[
                { value: "", label: "Todos os responsáveis" },
                { value: NO_RESPONSAVEL, label: "Sem responsável" },
                ...members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </div>
          <button
            onClick={() => setOnlyWithDeals((v) => !v)}
            className={`w-full rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              onlyWithDeals
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            }`}
          >
            Só com negócios
          </button>
          <div className="space-y-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
            <label className="field-label">Cadastrado em</label>
            <DateRangeField
              from={registeredFrom}
              to={registeredTo}
              className="w-full py-1.5 text-sm"
              quickRanges={QUICK_RANGES}
              onSelect={(r) => {
                setRegisteredFrom(r.from);
                setRegisteredTo(r.to);
              }}
            />
          </div>
        </FilterPopover>
        {selectedIds.size > 0 && (
          <div className="ml-auto">
            <SelectionBar count={selectedIds.size} onClear={clearSelection}>
              <BulkActionPopover icon={Tags} label="Etiquetar">
                {(close) => <TagPopoverBody busy={bulkBusy} onApply={async (v) => { await applyBulkTag(v); close(); }} />}
              </BulkActionPopover>
              <BulkActionPopover icon={IdCard} label="Cargo">
                {(close) => (
                  <SelectPopoverBody
                    busy={bulkBusy}
                    options={jobTitleOptions.map((j) => ({ value: j, label: j }))}
                    onApply={async (v) => { await applyBulkField("jobTitle", v); close(); }}
                  />
                )}
              </BulkActionPopover>
              <BulkActionPopover icon={Tag} label="Origem">
                {(close) => (
                  <SelectPopoverBody
                    busy={bulkBusy}
                    options={sources.map((s) => ({ value: s.label, label: s.label }))}
                    onApply={async (v) => { await applyBulkField("source", v); close(); }}
                  />
                )}
              </BulkActionPopover>
              <BulkActionPopover icon={User} label="Responsável">
                {(close) => (
                  <SelectPopoverBody
                    busy={bulkBusy}
                    allowEmpty
                    options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
                    onApply={async (v) => { await applyBulkField("responsavelId", v); close(); }}
                  />
                )}
              </BulkActionPopover>
              {pipelines.length > 0 && (
                <BulkActionPopover icon={Plus} label="Criar negócio">
                  {(close) => (
                    <SelectPopoverBody
                      busy={bulkBusy}
                      initialValue={(pipelines.find((p) => p.isDefault) ?? pipelines[0]).id}
                      applyLabel="Criar"
                      options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
                      onApply={async (v) => { await applyCreateDeals(v); close(); }}
                    />
                  )}
                </BulkActionPopover>
              )}
              {isManager && (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Apagar
                </button>
              )}
            </SelectionBar>
          </div>
        )}
      </div>
      {bulkError && <p className="text-sm text-red-600 dark:text-red-400">{bulkError}</p>}

      {hasFilters && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          {filteredContacts.length} de {initialContacts.length} contatos
        </p>
      )}


      {initialContacts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Inbox}
            title="Nenhum contato cadastrado"
            description="Cadastre clientes para vincular a negócios e tarefas."
          />
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="Nenhum contato encontrado"
            description="Ajuste a busca ou limpe os filtros."
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-2 lg:hidden">
            {filteredContacts.map((c) => (
              <div key={c.id} className="group card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onClick={(e) => toggleSelect(c.id, e.shiftKey)}
                      onChange={() => {}}
                      className={`accent-neutral-900 dark:accent-white ${
                        selectedIds.has(c.id) ? "" : "opacity-0 group-hover:opacity-100"
                      }`}
                    />
                    <Link
                      href={`/clientes/${c.id}`}
                      className="flex min-w-0 items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                    >
                      <Avatar name={c.name} size="xs" />
                      <span className="truncate">{c.name}</span>
                    </Link>
                  </div>
                  <EditContactDialog contact={c} sources={sources} jobTitles={jobTitles} members={members} customFields={customFields} />
                </div>
                <div className="mt-2 space-y-1 text-sm text-neutral-500 dark:text-neutral-400">
                  <p className="flex items-center gap-1.5 truncate">
                    <Mail className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
                    {c.email ?? "—"}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
                    {c.phone ?? "—"}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <IdCard className="h-3.5 w-3.5 shrink-0 opacity-50" strokeWidth={2} />
                    {c.jobTitle ?? "—"}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {c.source ? (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
                        SOURCE_BADGE[c.source] ?? SOURCE_BADGE_DEFAULT
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_DOT[c.source] ?? SOURCE_DOT_DEFAULT}`} />
                      {c.source}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">Origem não informada</span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <Briefcase className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                    {c._count.deals} {c._count.deals === 1 ? "negócio" : "negócios"}
                  </span>
                </div>
                {c.responsavel && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                    <Avatar name={c.responsavel.name} size="xs" />
                    {c.responsavel.name}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="card hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/50 text-left text-xs font-medium text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/20 dark:text-neutral-500">
                  <th className="border-r border-neutral-100 px-3 py-2.5 dark:border-neutral-800">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="accent-neutral-900 dark:accent-white"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      Nome
                    </span>
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      E-mail
                    </span>
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      Celular
                    </span>
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <IdCard className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      Cargo
                    </span>
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      Origem
                    </span>
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      Responsável
                    </span>
                  </th>
                  <th className="border-r border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                      Negócios
                    </span>
                  </th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c) => (
                  <tr key={c.id} className="group border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40">
                    <td className="border-r border-neutral-100 px-3 py-3 dark:border-neutral-800">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onClick={(e) => toggleSelect(c.id, e.shiftKey)}
                        onChange={() => {}}
                        className={`accent-neutral-900 dark:accent-white ${
                          selectedIds.has(c.id) ? "" : "opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 dark:border-neutral-800">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                      >
                        <Avatar name={c.name} size="xs" />
                        <span>{c.name}</span>
                      </Link>
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                      {c.email ?? "—"}
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                      {c.phone ?? "—"}
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                      {c.jobTitle ?? "—"}
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 dark:border-neutral-800">
                      {c.source ? (
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
                            SOURCE_BADGE[c.source] ?? SOURCE_BADGE_DEFAULT
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_DOT[c.source] ?? SOURCE_DOT_DEFAULT}`} />
                          {c.source}
                        </span>
                      ) : (
                        <span className="text-neutral-400 dark:text-neutral-500">—</span>
                      )}
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                      {c.responsavel ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar name={c.responsavel.name} size="xs" />
                          {c.responsavel.name}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                      {c._count.deals}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <EditContactDialog contact={c} sources={sources} jobTitles={jobTitles} members={members} customFields={customFields} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Apagar ${selectedIds.size} contato${selectedIds.size === 1 ? "" : "s"}?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Apagar"
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={async () => {
            await bulkDelete();
            setConfirmBulkDelete(false);
          }}
        />
      )}

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo contato</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Nome" value={name} onChange={setName} required autoFocus />
            <Field label="E-mail" value={email} onChange={setEmail} type="email" />
            <Field label="Celular" value={phone} onChange={setPhone} />
            <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
            <Field label="Empresa" value={company} onChange={setCompany} />
            <div className="space-y-1">
              <label className="field-label">Cargo *</label>
              <Select
                value={jobTitle}
                onChange={setJobTitle}
                placeholder="Selecione o cargo"
                options={jobTitles.map((j) => ({ value: j.label, label: j.label }))}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Essencial pra achar o lead certo depois em filtros e relatórios.
              </p>
            </div>
            <div className="space-y-1">
              <label className="field-label">Responsável</label>
              <Select
                value={responsavelId}
                onChange={setResponsavelId}
                options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="CEP" value={zipCode} onChange={setZipCode} />
              <Field label="Cidade" value={city} onChange={setCity} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Endereço" value={address} onChange={setAddress} />
              <Field label="Estado" value={state} onChange={setState} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Número" value={addressNumber} onChange={setAddressNumber} />
              <Field label="Complemento" value={addressComplement} onChange={setAddressComplement} />
              <Field label="Bairro" value={neighborhood} onChange={setNeighborhood} />
            </div>
            <Field label="Tags (separadas por vírgula)" value={tags} onChange={setTags} />
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select
                value={source}
                onChange={setSource}
                options={[{ value: "", label: "—" }, ...sources.map((s) => ({ value: s.label, label: s.label }))]}
              />
            </div>
            <CustomFieldsFieldset definitions={customFields} values={customFieldValues} onChange={setCustomFieldValues} />

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading || !name.trim() || !jobTitle} className="btn-primary">
                {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    Criando
                    <LoadingDots />
                  </span>
                ) : (
                  "Criar"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {importOpen && (
        <ImportDialog
          title="Importar contatos"
          hint="Arquivo .csv ou .xlsx com colunas: nome (obrigatório), cargo (obrigatório), email, whatsapp, celular (número 2, usado se o WhatsApp não funcionar), origem, empresa, tags."
          endpoint="/api/contacts/import"
          onClose={() => setImportOpen(false)}
          onImported={() => router.refresh()}
          renderSummary={(r) => {
            const withoutJobTitle = r.withoutJobTitle ?? 0;
            const otherSkipped = r.skipped - withoutJobTitle;
            const parts: string[] = [];
            if (otherSkipped > 0) parts.push(`${otherSkipped} ignorados por já existirem (celular duplicado)`);
            if (withoutJobTitle > 0) parts.push(`${withoutJobTitle} ignorados por não terem cargo preenchido`);
            return `${r.created} de ${r.total} contatos importados.${parts.length > 0 ? ` ${parts.join("; ")}.` : ""}`;
          }}
        />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="field-label">{label}</label>
      <input
        type={type}
        required={required}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </div>
  );
}

/** Corpo do popover de "Etiquetar" em massa — texto livre + aplicar (adiciona a tag, não substitui as existentes). */
function TagPopoverBody({ busy, onApply }: { busy: boolean; onApply: (value: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Nome da tag"
        className="field-input w-full py-1.5 text-sm"
      />
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={() => onApply(value)}
        className="btn-primary w-full py-1.5 text-xs"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} /> : "Aplicar"}
      </button>
    </div>
  );
}

