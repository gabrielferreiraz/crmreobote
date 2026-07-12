"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Inbox, Loader2, Upload, Download, Search, SearchX, User, Mail, Phone, Tag, Briefcase } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/modal";
import { ImportDialog } from "@/components/import-dialog";
import { EditContactDialog } from "@/components/edit-contact-dialog";
import { FilterPopover } from "@/components/filter-popover";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";

const SOURCE_OPTIONS = [
  { value: "", label: "—" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "INDICAÇÃO", label: "Indicação" },
  { value: "OUTROS", label: "Outros" },
];

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
  _count: { deals: number };
};

export function ContactsTable({
  initialContacts,
  isOwner,
}: {
  initialContacts: Contact[];
  isOwner: boolean;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [onlyWithDeals, setOnlyWithDeals] = useState(false);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of initialContacts) if (c.source) set.add(c.source);
    return Array.from(set).sort();
  }, [initialContacts]);

  const hasFilters = !!search || !!sourceFilter || onlyWithDeals;

  function clearFilters() {
    setSearch("");
    setSourceFilter("");
    setOnlyWithDeals(false);
  }

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
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
      if (onlyWithDeals && c._count.deals === 0) return false;
      return true;
    });
  }, [initialContacts, search, sourceFilter, onlyWithDeals]);

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
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
            strokeWidth={2}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail ou celular"
            className="field-input w-64 py-1.5 pl-8 text-sm"
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
        </FilterPopover>
      </div>

      <div className="card overflow-x-auto">
        {initialContacts.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nenhum contato cadastrado"
            description="Cadastre clientes para vincular a negócios e tarefas."
          />
        ) : filteredContacts.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Nenhum contato encontrado"
            description="Ajuste a busca ou limpe os filtros."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/50 text-left text-xs font-medium text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/20 dark:text-neutral-500">
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
                    <Tag className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />
                    Origem
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
                <tr key={c.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40">
                  <td className="border-r border-neutral-100 px-4 py-3 dark:border-neutral-800">
                    <Link
                      href={`/clientes/${c.id}`}
                      className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
                    >
                      <Avatar name={c.name} size="xs" />
                      <span>
                        {c.name}
                        {c.jobTitle && (
                          <span className="block text-xs font-normal text-neutral-400 dark:text-neutral-500">
                            {c.jobTitle}
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    {c.email ?? "—"}
                  </td>
                  <td className="border-r border-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    {c.phone ?? "—"}
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
                    {c._count.deals}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EditContactDialog contact={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo contato</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Nome" value={name} onChange={setName} required autoFocus />
            <Field label="E-mail" value={email} onChange={setEmail} type="email" />
            <Field label="Celular" value={phone} onChange={setPhone} />
            <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
            <Field label="Empresa" value={company} onChange={setCompany} />
            <Field label="Cargo" value={jobTitle} onChange={setJobTitle} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="CEP" value={zipCode} onChange={setZipCode} />
              <Field label="Cidade" value={city} onChange={setCity} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Endereço" value={address} onChange={setAddress} />
              <Field label="Estado" value={state} onChange={setState} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Número" value={addressNumber} onChange={setAddressNumber} />
              <Field label="Complemento" value={addressComplement} onChange={setAddressComplement} />
              <Field label="Bairro" value={neighborhood} onChange={setNeighborhood} />
            </div>
            <Field label="Tags (separadas por vírgula)" value={tags} onChange={setTags} />
            <div className="space-y-1">
              <label className="field-label">Origem</label>
              <Select value={source} onChange={setSource} options={SOURCE_OPTIONS} />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading || !name.trim()} className="btn-primary">
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
          hint="Arquivo .csv ou .xlsx com colunas: nome (obrigatório), email, whatsapp, celular (número 2, usado se o WhatsApp não funcionar), origem, empresa, cargo, tags."
          endpoint="/api/contacts/import"
          onClose={() => setImportOpen(false)}
          onImported={() => router.refresh()}
          renderSummary={(r) =>
            `${r.created} de ${r.total} contatos importados.${
              r.skipped > 0 ? ` ${r.skipped} ignorados por já existirem (celular duplicado).` : ""
            }`
          }
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
