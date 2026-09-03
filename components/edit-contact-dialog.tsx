"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { ESTADOS_BR } from "@/lib/contacts/constants";

import { ErrorDialog, type ErrorType } from "@/components/error-dialog";

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
  responsavelId?: string | null;
  customFieldValues?: CustomFieldFormValues | null;
};

/** Opções do Select incluindo o valor atual como item extra ("antigo") quando ele
 * não bate com nenhuma opção da lista — pra nunca esconder um valor já cadastrado
 * em texto livre antes de existir uma lista editável (mesma ideia já usada pra Origem). */
function optionsWithLegacyValue(list: { label: string }[], currentValue?: string | null) {
  const options = list.map((v) => ({ value: v.label, label: v.label }));
  if (currentValue && !list.some((v) => v.label === currentValue)) {
    return [{ value: currentValue, label: `${currentValue} (antigo)` }, ...options];
  }
  return options;
}

/**
 * Só o formulário, sem <Modal> próprio — pra poder ser usado tanto dentro de
 * um Modal dedicado (EditContactDialog, abaixo) quanto substituindo o
 * conteúdo de um Modal que já esteja aberto em outro lugar, sem precisar
 * empilhar dois Modal (dois fundos escurecidos/borrados um sobre o outro).
 */
export function ContactEditForm({
  contact,
  sources,
  jobTitles,
  members,
  customFields,
  onCancel,
  onSaved,
}: {
  contact: Contact;
  sources: { id: string; label: string }[];
  jobTitles: { id: string; label: string }[];
  members: { id: string; name: string }[];
  customFields: CustomFieldDefinitionInput[];
  onCancel: () => void;
  onSaved: () => void;
}) {
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
  const [responsavelId, setResponsavelId] = useState(contact.responsavelId ?? "");
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldFormValues>(contact.customFieldValues ?? {});
  const [loading, setLoading] = useState(false);
  const [errorData, setErrorData] = useState<{ message: string; type?: ErrorType; details?: string } | null>(null);

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
        responsavelId: responsavelId || null,
        customFieldValues,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorData({
        message: data.error ?? "Não foi possível salvar as alterações do contato.",
        type: data.type || (res.status === 403 ? "PERMISSION" : res.status === 404 ? "NOT_FOUND" : "SERVER"),
        details: data.details,
      });
      return;
    }

    onSaved();
  }

  return (
    <>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Editar contato</h2>
      {/* 3 colunas em vez de 2 (modal ficou mais largo, ver maxWidth no
          EditContactDialog abaixo) — a mesma quantidade de campos cabe em
          bem menos linhas, então o formulário cresce pros lados em vez de
          rolar tanto pra baixo. */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Nome" value={name} onChange={setName} required autoFocus />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="E-mail" value={email} onChange={setEmail} type="email" />
          <Field label="Celular" value={phone} onChange={setPhone} />
          <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Empresa" value={company} onChange={setCompany} />
          <div className="space-y-1">
            <label className="field-label">Cargo *</label>
            <Select
              value={jobTitle}
              onChange={setJobTitle}
              placeholder="Selecione o cargo"
              options={optionsWithLegacyValue(jobTitles, contact.jobTitle)}
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Origem</label>
            <Select
              value={source}
              onChange={setSource}
              options={[{ value: "", label: "—" }, ...sources.map((s) => ({ value: s.label, label: s.label }))]}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={responsavelId}
              onChange={setResponsavelId}
              options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
          <Field label="CEP" value={zipCode} onChange={setZipCode} />
          <Field label="Cidade" value={city} onChange={setCity} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Endereço" value={address} onChange={setAddress} />
          <div className="space-y-1">
            <label className="field-label">Estado</label>
            <Select value={state} onChange={setState} placeholder="Selecione o estado" options={[{ value: "", label: "—" }, ...ESTADOS_BR]} />
          </div>
          <Field label="Número" value={addressNumber} onChange={setAddressNumber} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Complemento" value={addressComplement} onChange={setAddressComplement} />
          <Field label="Bairro" value={neighborhood} onChange={setNeighborhood} />
          <Field label="Tags (separadas por vírgula)" value={tags} onChange={setTags} />
        </div>
        <CustomFieldsFieldset definitions={customFields} values={customFieldValues} onChange={setCustomFieldValues} />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
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

      {errorData && (
        <ErrorDialog
          message={errorData.message}
          type={errorData.type}
          details={errorData.details}
          onClose={() => setErrorData(null)}
        />
      )}
    </>
  );
}

/** Botão de lápis + Modal próprio — uso "solto" (não dentro de outro Modal já aberto). */
export function EditContactDialog({
  contact,
  sources,
  jobTitles,
  members,
  customFields,
  triggerClassName,
}: {
  contact: Contact;
  sources: { id: string; label: string }[];
  jobTitles: { id: string; label: string }[];
  members: { id: string; name: string }[];
  customFields: CustomFieldDefinitionInput[];
  /** Estilo do botão-gatilho — padrão é o `.icon-btn-labeled` (ícone + texto
   * "Editar", discreto, de linha de tabela). Passe algo mais chamativo
   * (borda, fundo) em contextos onde o botão precisa se destacar mais, ex.:
   * topo do Cliente-detalhe — nesse caso o texto "Editar" também precisa vir
   * escrito na className customizada (children sempre inclui o texto). */
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={triggerClassName ?? "icon-btn-labeled"}
        aria-label="Editar contato"
      >
        <Pencil className="h-4 w-4" strokeWidth={2} />
        Editar
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} maxWidth="max-w-2xl">
          <ContactEditForm
            contact={contact}
            sources={sources}
            jobTitles={jobTitles}
            members={members}
            customFields={customFields}
            onCancel={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
          />
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
