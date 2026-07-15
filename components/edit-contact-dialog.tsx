"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { jobTitleSelectOptions } from "@/lib/job-titles";

const SOURCE_OPTIONS = [
  { value: "", label: "—" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "INDICAÇÃO", label: "Indicação" },
  { value: "OUTROS", label: "Outros" },
];

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  company?: string | null;
  jobTitle?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  tags?: string[];
};

export function EditContactDialog({ contact }: { contact: Contact }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(contact.whatsapp ?? "");
  const [source, setSource] = useState(contact.source ?? "");
  const [company, setCompany] = useState(contact.company ?? "");
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? "");
  const [zipCode, setZipCode] = useState(contact.zipCode ?? "");
  const [address, setAddress] = useState(contact.address ?? "");
  const [addressNumber, setAddressNumber] = useState(contact.addressNumber ?? "");
  const [addressComplement, setAddressComplement] = useState(contact.addressComplement ?? "");
  const [neighborhood, setNeighborhood] = useState(contact.neighborhood ?? "");
  const [city, setCity] = useState(contact.city ?? "");
  const [state, setState] = useState(contact.state ?? "");
  const [tags, setTags] = useState((contact.tags ?? []).join(", "));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setName(contact.name);
    setEmail(contact.email ?? "");
    setPhone(contact.phone ?? "");
    setWhatsapp(contact.whatsapp ?? "");
    setSource(contact.source ?? "");
    setCompany(contact.company ?? "");
    setJobTitle(contact.jobTitle ?? "");
    setZipCode(contact.zipCode ?? "");
    setAddress(contact.address ?? "");
    setAddressNumber(contact.addressNumber ?? "");
    setAddressComplement(contact.addressComplement ?? "");
    setNeighborhood(contact.neighborhood ?? "");
    setCity(contact.city ?? "");
    setState(contact.state ?? "");
    setTags((contact.tags ?? []).join(", "));
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PUT",
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
      setError(data.error ?? "Erro ao salvar contato");
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openDialog();
        }}
        className="icon-btn"
        aria-label="Editar contato"
      >
        <Pencil className="h-4 w-4" strokeWidth={2} />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Editar contato</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Nome" value={name} onChange={setName} required autoFocus />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="E-mail" value={email} onChange={setEmail} type="email" />
              <Field label="Celular" value={phone} onChange={setPhone} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
              <Field label="Empresa" value={company} onChange={setCompany} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="field-label">Cargo *</label>
                <Select
                  value={jobTitle}
                  onChange={setJobTitle}
                  placeholder="Selecione o cargo"
                  options={jobTitleSelectOptions(contact.jobTitle)}
                />
              </div>
              <div className="space-y-1">
                <label className="field-label">Origem</label>
                <Select value={source} onChange={setSource} options={SOURCE_OPTIONS} />
              </div>
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

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                Cancelar
              </button>
              <button type="submit" disabled={loading || !name.trim() || !jobTitle} className="btn-primary">
                {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    Salvando
                    <LoadingDots />
                  </span>
                ) : (
                  "Salvar"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
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
