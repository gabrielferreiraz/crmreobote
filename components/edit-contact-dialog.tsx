"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { PhoneInput } from "@/components/phone-input";
import { BirthDateInput } from "@/components/birth-date-input";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { ESTADOS_BR } from "@/lib/contacts/constants";
import { validatePhoneField } from "@/lib/phone-normalize";
import { isBirthDateInputInvalid, isoToBirthDateMask, parseBirthDateInput } from "@/lib/birth-date";
import { useCepAutofill } from "@/lib/use-cep-autofill";

import { ErrorDialog, type ErrorType } from "@/components/error-dialog";
import { ContactConflictNotice, type ContactConflict } from "@/components/contact-conflict-notice";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  company?: string | null;
  jobTitle?: string | null;
  birthDate?: string | Date | null;
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
  const [birthDate, setBirthDate] = useState(isoToBirthDateMask(contact.birthDate));
  const [birthDateError, setBirthDateError] = useState<string | null>(null);
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
  // 409 de telefone/WhatsApp já usado por OUTRO contato (ver PUT
  // /api/contacts/[id]) — antes caía no ErrorDialog genérico "Erro de
  // servidor" sem nenhuma saída. Agora abre o aviso de conflito, que deixa
  // solicitar o lead (dono ativo) ou assumir na hora (dono inativo/sem dono/
  // lead perdido há +3 meses) — ver ContactConflictNotice.
  const [conflictData, setConflictData] = useState<{ message: string; conflict: ContactConflict } | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const cepAutofillFields = useMemo(
    () => ({
      setZipCode,
      address,
      setAddress,
      neighborhood,
      setNeighborhood,
      city,
      setCity,
      state,
      setState,
    }),
    [address, neighborhood, city, state],
  );
  const cepAutofill = useCepAutofill(zipCode, cepAutofillFields);
  // "Mostrar como ajustar" (erro de permissão por contato de outro
  // consultor) — o campo Responsável já está nesta mesma tela (diferente do
  // card "Dados do contato" do negócio, que precisa rolar até outra linha),
  // então aqui basta rolar até ele e piscar um destaque, sem trocar de
  // lugar nenhum.
  const [highlightResponsavel, setHighlightResponsavel] = useState(false);
  const responsavelFieldRef = useRef<HTMLDivElement>(null);

  function showResponsavelFix() {
    setErrorData(null);
    responsavelFieldRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightResponsavel(true);
    setTimeout(() => setHighlightResponsavel(false), 2200);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Valida formato dos campos de telefone/data de nascimento antes de bater na API.
    // Telefone/WhatsApp só é validado se a pessoa MUDOU o valor — o formulário
    // devolve o número antigo ao salvar, e um contato com número legado
    // inválido (ex.: fixo no WhatsApp) não pode ficar impedido de trocar cargo
    // ou responsável por causa disso; o servidor faz a mesma exceção.
    const phoneErr = phone !== (contact.phone ?? "") ? validatePhoneField(phone, "phone") : null;
    const waErr = whatsapp !== (contact.whatsapp ?? "") ? validatePhoneField(whatsapp, "whatsapp") : null;
    const birthDateErr = isBirthDateInputInvalid(birthDate) ? "Data inválida. Use o formato DD/MM/AAAA." : null;
    setPhoneError(phoneErr);
    setWhatsappError(waErr);
    setBirthDateError(birthDateErr);
    if (phoneErr || waErr || birthDateErr) return;

    setLoading(true);
    setErrorData(null);

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
        birthDate: parseBirthDateInput(birthDate) || undefined,
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
      if (res.status === 409 && data.conflict) {
        setConflictData({ message: data.error ?? "Este número já está cadastrado em outro contato.", conflict: data.conflict as ContactConflict });
        return;
      }
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
          <PhoneInput
            label="Celular"
            value={phone}
            onChange={(v) => { setPhone(v); setPhoneError(null); }}
            error={phoneError}
          />
          <PhoneInput
            label="WhatsApp"
            value={whatsapp}
            onChange={(v) => { setWhatsapp(v); setWhatsappError(null); }}
            error={whatsappError}
          />
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
          <div
            ref={responsavelFieldRef}
            className={`-m-1.5 space-y-1 rounded-lg p-1.5 transition-colors duration-700 ${
              highlightResponsavel ? "bg-brand/10 ring-2 ring-brand/40 dark:bg-brand/15" : "ring-2 ring-transparent"
            }`}
          >
            <label className="field-label">Responsável</label>
            <Select
              value={responsavelId}
              onChange={setResponsavelId}
              options={[{ value: "", label: "Ninguém" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
          <BirthDateInput
            value={birthDate}
            onChange={(v) => { setBirthDate(v); setBirthDateError(null); }}
            error={birthDateError}
          />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="field-label">CEP</label>
              {cepAutofill.loading && (
                <span className="inline-flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                  Buscando
                </span>
              )}
            </div>
            <input value={zipCode} onChange={(e) => setZipCode(e.target.value)} className="field-input" />
            {cepAutofill.error && <p className="text-xs text-amber-600 dark:text-amber-400">{cepAutofill.error}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Cidade" value={city} onChange={setCity} />
          <Field label="Endereço" value={address} onChange={setAddress} />
          <div className="space-y-1">
            <label className="field-label">Estado</label>
            <Select value={state} onChange={setState} placeholder="Selecione o estado" options={[{ value: "", label: "—" }, ...ESTADOS_BR]} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Número" value={addressNumber} onChange={setAddressNumber} />
          <Field label="Complemento" value={addressComplement} onChange={setAddressComplement} />
          <Field label="Bairro" value={neighborhood} onChange={setNeighborhood} />
        </div>
        <Field label="Tags (separadas por vírgula)" value={tags} onChange={setTags} />
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

      {conflictData && (
        <Modal onClose={() => setConflictData(null)} maxWidth="max-w-md">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Número já cadastrado</h2>
          <p className="mt-1 mb-3 text-sm text-neutral-600 dark:text-neutral-300">
            {conflictData.message} As alterações deste contato não foram salvas.
          </p>
          <ContactConflictNotice conflict={conflictData.conflict} />
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setConflictData(null)} className="btn-ghost">
              Fechar
            </button>
          </div>
        </Modal>
      )}

      {errorData && (
        <ErrorDialog
          message={errorData.message}
          type={errorData.type}
          details={errorData.details}
          onClose={() => setErrorData(null)}
          actionLabel={errorData.type === "PERMISSION" ? "Mostrar como ajustar" : undefined}
          onAction={errorData.type === "PERMISSION" ? showResponsavelFix : undefined}
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
