"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, ChevronDown, Loader2, MapPin, MessageCircle, Pencil, Tag, UserRound, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { Field } from "@/components/form-field";
import { FieldError, focusField } from "@/components/field-error";
import { PhoneInput } from "@/components/phone-input";
import { BirthDateInput } from "@/components/birth-date-input";
import { CustomFieldsFieldset, type CustomFieldDefinitionInput, type CustomFieldFormValues } from "@/components/custom-fields-fieldset";
import { ESTADOS_BR } from "@/lib/contacts/constants";
import { validatePhoneField } from "@/lib/phone-normalize";
import { birthDateInputError, isoToBirthDateMask, parseBirthDateInput } from "@/lib/birth-date";
import { useCepAutofill } from "@/lib/use-cep-autofill";

import { ErrorDialog, type ErrorType } from "@/components/error-dialog";
import { ContactConflictNotice, type ContactConflict } from "@/components/contact-conflict-notice";
import { trackUse } from "@/lib/feature-usage/track";

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
  const [addressOpen, setAddressOpen] = useState(
    Boolean(contact.zipCode || contact.address || contact.addressNumber || contact.addressComplement || contact.neighborhood || contact.city || contact.state),
  );
  const [loading, setLoading] = useState(false);
  const [errorData, setErrorData] = useState<{ message: string; type?: ErrorType; details?: string } | null>(null);
  // 409 de telefone/WhatsApp já usado por OUTRO contato (ver PUT
  // /api/contacts/[id]) — antes caía no ErrorDialog genérico "Erro de
  // servidor" sem nenhuma saída. Agora mostra o aviso de conflito (ver
  // ContactConflictNotice) DENTRO do próprio formulário, sem empilhar um 2º
  // Modal por cima do que já está aberto — pedido explícito: "extremamente
  // intuitivo sem muitas falas, o próprio design deve conversar com o
  // usuário de forma direta". Deixa solicitar o lead (dono ativo), assumir
  // na hora (dono inativo/sem dono/lead perdido há +3 meses) ou, se o número
  // já é de OUTRO contato seu, ir direto pra ele (antes era beco sem saída:
  // "já é seu" e nenhum jeito de seguir em frente — relato real).
  const [conflictData, setConflictData] = useState<ContactConflict | null>(null);
  const [updatingExisting, setUpdatingExisting] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  // Obrigatórios validados ao enviar (botão Salvar não fica mais desabilitado em silêncio — achado M3 do QA).
  const [nameError, setNameError] = useState<string | null>(null);
  const [jobTitleError, setJobTitleError] = useState<string | null>(null);
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

  // Extraído pra ser reaproveitado por handleSubmit e handleUpdateExisting
  // (o "Atualizar contato" da ContactConflictNotice reenvia exatamente os
  // mesmos dados do formulário, só que pro id do contato EXISTENTE — ver
  // handleUpdateExisting abaixo).
  function buildPayload() {
    return {
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
    };
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
    const birthDateErr = birthDateInputError(birthDate);
    setPhoneError(phoneErr);
    setWhatsappError(waErr);
    setBirthDateError(birthDateErr);
    const nameErr = name.trim() ? null : "Informe o nome do contato.";
    const jobTitleErr = jobTitle ? null : "Selecione o cargo — é essencial pra achar o lead certo depois.";
    setNameError(nameErr);
    setJobTitleError(jobTitleErr);
    if (nameErr) return focusField("edit-contact-name");
    if (jobTitleErr) return focusField("edit-contact-job-title");
    if (phoneErr || waErr || birthDateErr) return;

    setLoading(true);
    setErrorData(null);
    setConflictData(null);

    const res = await fetch(`/api/contacts/${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.conflict) {
        setConflictData(data.conflict as ContactConflict);
        return;
      }
      setErrorData({
        message: data.error ?? "Não foi possível salvar as alterações do contato.",
        type: data.type || (res.status === 403 ? "PERMISSION" : res.status === 404 ? "NOT_FOUND" : "SERVER"),
        details: data.details,
      });
      return;
    }

    trackUse("clientes.contato.editar");
    onSaved();
  }

  // "Atualizar contato" do ContactConflictNotice quando o número já é de
  // OUTRO contato seu (ownedByMe) — reenvia os MESMOS dados deste formulário
  // (buildPayload), só que pro id do contato EXISTENTE, não pro id que
  // estava sendo editado. Não precisa de nenhum endpoint novo: PUT
  // /api/contacts/[id] já aceita qualquer id do próprio consultor, e o
  // número que estamos mandando já é o que aquele contato tem (não muda
  // nada nele) — só os OUTROS campos do formulário (nome, cargo, endereço,
  // etc.) realmente se aplicam lá. Sucesso fecha a tela igual a um salvar
  // normal (onSaved) — o contato que estava sendo editado fica como estava,
  // intocado.
  async function handleUpdateExisting() {
    if (!conflictData) return;
    setUpdatingExisting(true);
    setErrorData(null);

    const res = await fetch(`/api/contacts/${conflictData.contactId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    setUpdatingExisting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // 409 aqui seria surpreendente (o próprio contato-alvo já tem esse
      // número) — mas não impede tentar de novo, mesmo tratamento de erro
      // genérico do resto da tela, nunca falha em silêncio.
      setErrorData({
        message: data.error ?? "Não foi possível atualizar o contato.",
        type: data.type || (res.status === 403 ? "PERMISSION" : res.status === 404 ? "NOT_FOUND" : "SERVER"),
        details: data.details,
      });
      return;
    }

    trackUse("clientes.contato.editar");
    setConflictData(null);
    onSaved();
  }

  return (
    <>
      <div className="flex max-h-[90dvh] min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Editar contato</h2>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{contact.name}</p>
          </div>
          <button type="button" onClick={onCancel} className="btn-ghost h-9 w-9 p-0" aria-label="Fechar edição">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="space-y-7">
              <section aria-labelledby="contact-identification-title" className="space-y-4">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-brand" aria-hidden="true" />
                  <h3 id="contact-identification-title" className="font-semibold text-neutral-900 dark:text-neutral-100">Identificação</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field
                      id="edit-contact-name"
                      label="Nome *"
                      value={name}
                      onChange={(value) => {
                        setName(value);
                        setNameError(null);
                      }}
                      error={nameError}
                      autoFocus
                    />
                  </div>
                  <div
                    ref={responsavelFieldRef}
                    className={`-m-1.5 space-y-1 rounded-md p-1.5 transition-colors duration-700 ${
                      highlightResponsavel ? "bg-brand/10 ring-2 ring-brand/40 dark:bg-brand/15" : "ring-2 ring-transparent"
                    }`}
                  >
                    <label className="field-label">Responsável</label>
                    <Select
                      value={responsavelId}
                      onChange={setResponsavelId}
                      options={[{ value: "", label: "Ninguém" }, ...members.map((member) => ({ value: member.id, label: member.name }))]}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="field-label">Origem</label>
                    <Select
                      value={source}
                      onChange={setSource}
                      options={[{ value: "", label: "—" }, ...sources.map((item) => ({ value: item.label, label: item.label }))]}
                    />
                  </div>
                </div>
              </section>

              <section aria-labelledby="contact-work-title" className="space-y-4 border-t border-neutral-200 pt-5 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <BriefcaseBusiness className="h-4 w-4 text-brand" aria-hidden="true" />
                  <h3 id="contact-work-title" className="font-semibold text-neutral-900 dark:text-neutral-100">Perfil profissional</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Empresa" value={company} onChange={setCompany} />
                  <div className="space-y-1">
                    <label className="field-label">Cargo *</label>
                    <Select
                      id="edit-contact-job-title"
                      value={jobTitle}
                      onChange={(value) => {
                        setJobTitle(value);
                        setJobTitleError(null);
                      }}
                      invalid={!!jobTitleError}
                      describedBy="edit-contact-job-title-error"
                      placeholder="Selecione o cargo"
                      options={optionsWithLegacyValue(jobTitles, contact.jobTitle)}
                    />
                    {jobTitleError && <FieldError id="edit-contact-job-title-error">{jobTitleError}</FieldError>}
                  </div>
                </div>
              </section>

              <section aria-labelledby="contact-channels-title" className="space-y-4 border-t border-neutral-200 pt-5 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-brand" aria-hidden="true" />
                  <h3 id="contact-channels-title" className="font-semibold text-neutral-900 dark:text-neutral-100">Contato</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <PhoneInput
                    label="WhatsApp"
                    value={whatsapp}
                    onChange={(value) => {
                      setWhatsapp(value);
                      setWhatsappError(null);
                    }}
                    error={whatsappError}
                  />
                  <PhoneInput
                    label="Celular"
                    value={phone}
                    onChange={(value) => {
                      setPhone(value);
                      setPhoneError(null);
                    }}
                    error={phoneError}
                  />
                  <Field label="E-mail" value={email} onChange={setEmail} type="email" />
                  <BirthDateInput
                    value={birthDate}
                    onChange={(value) => {
                      setBirthDate(value);
                      setBirthDateError(null);
                    }}
                    error={birthDateError}
                  />
                </div>
              </section>

              <section className="border-y border-neutral-200 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setAddressOpen((current) => !current)}
                  className="flex w-full items-center gap-3 py-4 text-left"
                  aria-expanded={addressOpen}
                  aria-controls="contact-address-fields"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">Endereço</span>
                  <span className="min-w-0 flex-1 truncate text-right text-sm text-neutral-500 dark:text-neutral-400">
                    {city ? `${city}${state ? ` · ${state}` : ""}` : "Não informado"}
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${addressOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>

                {addressOpen && (
                  <div id="contact-address-fields" className="grid grid-cols-1 gap-4 pb-5 sm:grid-cols-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <label className="field-label">CEP</label>
                        {cepAutofill.loading && (
                          <span className="inline-flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
                            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                            Buscando
                          </span>
                        )}
                      </div>
                      <input value={zipCode} onChange={(event) => setZipCode(event.target.value)} className="field-input" />
                      {cepAutofill.error && <p className="text-xs text-amber-600 dark:text-amber-400">{cepAutofill.error}</p>}
                    </div>
                    <Field label="Cidade" value={city} onChange={setCity} />
                    <div className="space-y-1">
                      <label className="field-label">Estado</label>
                      <Select value={state} onChange={setState} placeholder="Selecione o estado" options={[{ value: "", label: "—" }, ...ESTADOS_BR]} />
                    </div>
                    <Field label="Endereço" value={address} onChange={setAddress} />
                    <Field label="Número" value={addressNumber} onChange={setAddressNumber} />
                    <Field label="Bairro" value={neighborhood} onChange={setNeighborhood} />
                    <div className="sm:col-span-3">
                      <Field label="Complemento" value={addressComplement} onChange={setAddressComplement} />
                    </div>
                  </div>
                )}
              </section>

              <section aria-labelledby="contact-extra-title" className="space-y-4">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-brand" aria-hidden="true" />
                  <h3 id="contact-extra-title" className="font-semibold text-neutral-900 dark:text-neutral-100">Complementos</h3>
                </div>
                <Field label="Tags (separadas por vírgula)" value={tags} onChange={setTags} />
                {customFields.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <CustomFieldsFieldset definitions={customFields} values={customFieldValues} onChange={setCustomFieldValues} />
                  </div>
                )}
              </section>

              {conflictData && (
                <ContactConflictNotice conflict={conflictData} onUpdateExisting={handleUpdateExisting} updatingExisting={updatingExisting} />
              )}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950 sm:px-6">
            <button type="button" onClick={onCancel} className="btn-ghost">Cancelar</button>
            <button type="submit" disabled={loading} className="btn-primary min-w-28">
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
          </footer>
        </form>
      </div>

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
        <span>Editar</span>
      </button>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          maxWidth="max-w-4xl"
          panelClassName="!overflow-hidden !p-0 !pb-0"
        >
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

