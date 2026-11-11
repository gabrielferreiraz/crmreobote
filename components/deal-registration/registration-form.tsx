"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eraser, Loader2, QrCode, Upload, X } from "lucide-react";
import { Select } from "@/components/select";
import { DocumentThumb, DocumentViewer, formatFileSize } from "@/components/deal-registration/document-preview";
import { CurrencyInput } from "@/components/currency-input";
import { PhoneInput } from "@/components/phone-input";
import { useCepAutofill } from "@/lib/use-cep-autofill";
import { formatCep, onlyCepDigits } from "@/lib/cep";
import { maskCpf } from "@/lib/cpf";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/cnpj";
import {
  BANK_ACCOUNT_TYPE_OPTIONS,
  DOCUMENT_KIND_LABELS,
  MARITAL_STATUS_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  DOCUMENT_RETENTION_DAYS,
  findMissingRegistrationItems,
  summarizeMissing,
  type MissingItem,
  type RegistrationSnapshot,
} from "@/lib/deal-registration/rules";

type DocKind = "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER" | "PAYMENT_PROOF";
type Doc = { id: string; kind: DocKind; fileName: string; size: number };

type Form = {
  email: string;
  whatsapp: string;
  zipCode: string;
  address: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  state: string;
  company: string;
  personType: "PF" | "PJ";
  holderName: string;
  cpf: string;
  cnpj: string;
  profession: string;
  maritalStatus: string;
  monthlyIncome: string;
  groupNumber: string;
  termMonths: string;
  paymentMethod: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  bankAccountType: string;
};

type ServerState = {
  contactName: string;
  contact: RegistrationSnapshot["contact"];
  registration: RegistrationSnapshot["registration"];
  documents: Doc[];
  requiresBankData: boolean;
  documentsWaived: boolean;
  canBypass: boolean;
  canWaive: boolean;
};

export type RegistrationStatus = {
  loading: boolean;
  ready: boolean;
  summary: string;
  canBypass: boolean;
  /** Itens já preenchidos / total que este cliente precisa (barra de progresso do rodapé). */
  done: number;
  total: number;
};

export type RegistrationApi = { flush: () => Promise<boolean>; focusFirstMissing: () => void };

const EMPTY_FORM: Form = {
  email: "", whatsapp: "", zipCode: "", address: "", addressNumber: "", neighborhood: "", city: "", state: "", company: "",
  personType: "PF", holderName: "", cpf: "", cnpj: "", profession: "", maritalStatus: "", monthlyIncome: "", groupNumber: "", termMonths: "",
  paymentMethod: "", bankName: "", bankAgency: "", bankAccount: "", bankAccountType: "",
};

function toForm(s: ServerState): Form {
  const { contact: c, registration: r } = s;
  return {
    email: c.email ?? "",
    whatsapp: c.whatsapp ?? "",
    zipCode: c.zipCode ?? "",
    address: c.address ?? "",
    addressNumber: c.addressNumber ?? "",
    neighborhood: c.neighborhood ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    company: c.company ?? "",
    personType: r.personType,
    holderName: r.holderName ?? "",
    cpf: r.cpf ? maskCpf(r.cpf) : "",
    cnpj: r.cnpj ? formatCnpj(r.cnpj) : "",
    profession: r.profession ?? "",
    maritalStatus: r.maritalStatus ?? "",
    monthlyIncome: r.monthlyIncome != null ? String(r.monthlyIncome) : "",
    groupNumber: r.groupNumber ?? "",
    termMonths: r.termMonths != null ? String(r.termMonths) : "",
    paymentMethod: r.paymentMethod ?? "",
    bankName: r.bankName ?? "",
    bankAgency: r.bankAgency ?? "",
    bankAccount: r.bankAccount ?? "",
    bankAccountType: r.bankAccountType ?? "",
  };
}

function toSnapshot(f: Form, documents: Doc[]): RegistrationSnapshot {
  const income = f.monthlyIncome ? Number(f.monthlyIncome) : null;
  const term = f.termMonths ? Number(f.termMonths) : null;
  return {
    contact: {
      email: f.email, whatsapp: f.whatsapp, phone: null, zipCode: f.zipCode, address: f.address,
      addressNumber: f.addressNumber, neighborhood: f.neighborhood, city: f.city, state: f.state, company: f.company,
    },
    registration: {
      personType: f.personType, holderName: f.holderName, cpf: f.cpf, cnpj: f.cnpj, profession: f.profession, maritalStatus: f.maritalStatus,
      monthlyIncome: income != null && Number.isFinite(income) ? income : null,
      groupNumber: f.groupNumber, termMonths: term != null && Number.isFinite(term) ? term : null,
      paymentMethod: f.paymentMethod, bankName: f.bankName, bankAgency: f.bankAgency, bankAccount: f.bankAccount,
      bankAccountType: f.bankAccountType,
    },
    documents: documents.map((d) => ({ kind: d.kind })),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPayload(f: Form) {
  const t = (v: string) => v.trim() || null;
  return {
    contact: {
      ...(f.email.trim() === "" || EMAIL_RE.test(f.email.trim()) ? { email: t(f.email) } : {}),
      whatsapp: t(f.whatsapp),
      zipCode: t(f.zipCode),
      address: t(f.address),
      addressNumber: t(f.addressNumber),
      neighborhood: t(f.neighborhood),
      city: t(f.city),
      state: t(f.state),
      company: t(f.company),
    },
    registration: {
      personType: f.personType,
      holderName: t(f.holderName),
      cpf: t(f.cpf),
      cnpj: t(f.cnpj),
      profession: t(f.profession),
      maritalStatus: t(f.maritalStatus),
      monthlyIncome: f.monthlyIncome ? Number(f.monthlyIncome) : null,
      groupNumber: t(f.groupNumber),
      termMonths: Number(f.termMonths) > 0 ? Number(f.termMonths) : null,
      paymentMethod: t(f.paymentMethod),
      bankName: t(f.bankName),
      bankAgency: t(f.bankAgency),
      bankAccount: t(f.bankAccount),
      bankAccountType: t(f.bankAccountType),
    },
  };
}

/**
 * Cadastro do cliente exigido pela administradora, dentro da janela do Ganho.
 * Guiado: documentos primeiro (arrastar e soltar), seções com selo "Completo",
 * barra de progresso e campos pendentes destacados só depois que a pessoa
 * passou por eles ou tentou concluir.
 * Salva sozinho (rascunho) enquanto o consultor digita — dá para fechar, juntar
 * os documentos e voltar depois. A lista "Falta: …" usa a MESMA regra do
 * servidor (lib/deal-registration/rules), então o botão só libera quando o
 * servidor também vai aceitar.
 */
export function RegistrationForm({
  dealId,
  administratorId,
  showErrors = false,
  onStatus,
  registerApi,
}: {
  dealId: string;
  administratorId: string | null;
  /** Depois de tentar concluir com algo faltando: destaca todos os campos pendentes. */
  showErrors?: boolean;
  onStatus: (status: RegistrationStatus) => void;
  registerApi: (api: RegistrationApi) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [contactName, setContactName] = useState("");
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [meta, setMeta] = useState({ requiresBankData: false, documentsWaived: false, canBypass: false });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<DocKind | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const dirty = useRef(false);
  // CEP que veio salvo do servidor (só dígitos): o preenchimento automático não o refaz ao abrir.
  const [savedCep, setSavedCep] = useState<string | undefined>(undefined);
  const formRef = useRef(form);
  const savePromise = useRef<Promise<boolean> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<DocKind | null>(null);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    const controller = new AbortController();
    const qs = administratorId ? `?administratorId=${encodeURIComponent(administratorId)}` : "";
    fetch(`/api/deals/${dealId}/registration${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Não foi possível carregar o cadastro");
        return data as ServerState;
      })
      .then((data) => {
        setContactName(data.contactName);
        setMeta({ requiresBankData: data.requiresBankData, documentsWaived: data.documentsWaived, canBypass: data.canWaive });
        // Trocar a administradora só atualiza as exigências — nunca sobrescreve o que a pessoa já digitou.
        if (!dirty.current) {
          setSavedCep(onlyCepDigits(data.contact.zipCode ?? "") || undefined);
          setForm((prev) => (prev === EMPTY_FORM ? toForm(data) : prev));
          setDocuments(data.documents);
        }
        setLoaded(true);
        setLoadError(null);
      })
      .catch((err) => {
        if ((err as DOMException).name !== "AbortError") setLoadError((err as Error).message);
      });
    return () => controller.abort();
  }, [dealId, administratorId]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty.current) return true;
    if (savePromise.current) await savePromise.current.catch(() => false);
    if (!dirty.current) return true;
    dirty.current = false;
    setSaving(true);
    const run = (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/registration`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(formRef.current)),
        });
        if (!res.ok) {
          dirty.current = true;
          return false;
        }
        return true;
      } catch {
        dirty.current = true;
        return false;
      } finally {
        setSaving(false);
        savePromise.current = null;
      }
    })();
    savePromise.current = run;
    return run;
  }, [dealId]);

  // Fechar a janela ou voltar ao passo anterior no meio da digitação não perde nada: o que ficou pendente é enviado ao desmontar.
  useEffect(() => {
    return () => {
      void save();
    };
  }, [save]);

  // Rascunho automático: salva ~0,8 s depois da última digitação.
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [form, loaded, save]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    dirty.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  }

  const cepFields = useMemo(
    () => ({
      setZipCode: (v: string) => set("zipCode", v),
      address: form.address,
      setAddress: (v: string) => set("address", v),
      neighborhood: form.neighborhood,
      setNeighborhood: (v: string) => set("neighborhood", v),
      city: form.city,
      setCity: (v: string) => set("city", v),
      state: form.state,
      setState: (v: string) => set("state", v),
    }),
    [form.address, form.neighborhood, form.city, form.state],
  );
  // O CEP digitado manda: um CEP novo troca rua, bairro, cidade e UF. O CEP que já veio salvo não é buscado de novo.
  const cep = useCepAutofill(form.zipCode, cepFields, { overwrite: true, skipDigits: savedCep });

  // CNPJ completo e válido: busca a razão social na Receita (mesma rota do restante do CRM) e preenche "Empresa" se estiver vazia.
  const [cnpjLookup, setCnpjLookup] = useState<{ loading: boolean; error: string | null; situacao: string | null }>({ loading: false, error: null, situacao: null });
  const lastCnpj = useRef<string | null>(null);
  useEffect(() => {
    if (form.personType !== "PJ") return;
    const digits = normalizeCnpj(form.cnpj);
    if (digits.length !== 14 || !isValidCnpj(digits) || lastCnpj.current === digits) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      lastCnpj.current = digits;
      setCnpjLookup({ loading: true, error: null, situacao: null });
      try {
        const res = await fetch(`/api/cnpj?cnpj=${digits}`, { signal: controller.signal });
        const data = (await res.json().catch(() => ({}))) as { name?: string; razaoSocial?: string; situacao?: string | null; error?: string };
        if (!res.ok) {
          setCnpjLookup({ loading: false, error: data.error ?? "Não foi possível consultar o CNPJ.", situacao: null });
          return;
        }
        setCnpjLookup({ loading: false, error: null, situacao: data.situacao ?? null });
        const name = data.razaoSocial ?? data.name;
        if (name && !formRef.current.company.trim()) set("company", name);
        const currentHolderName = formRef.current.holderName.trim();
        if (name && (!currentHolderName || currentHolderName === contactName.trim())) set("holderName", name);
      } catch (err) {
        if ((err as DOMException).name !== "AbortError") setCnpjLookup({ loading: false, error: "Falha ao consultar o CNPJ.", situacao: null });
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [form.cnpj, form.personType, contactName]);

  const missing: MissingItem[] = useMemo(
    () => (loaded ? findMissingRegistrationItems(toSnapshot(form, documents), meta) : []),
    [form, documents, meta, loaded],
  );
  const missingKeys = useMemo(() => new Set(missing.map((m) => m.key)), [missing]);
  const summary = summarizeMissing(missing);
  // Total de itens que ESTE cliente precisa (muda com PF/PJ e com a administradora) — base da barra de progresso.
  const total = useMemo(
    () => (loaded ? findMissingRegistrationItems(toSnapshot({ ...EMPTY_FORM, personType: form.personType }, []), meta).length : 0),
    [loaded, form.personType, meta],
  );
  const done = Math.max(0, total - missing.length);

  const missingKeysRef = useRef(missingKeys);
  useEffect(() => {
    missingKeysRef.current = missingKeys;
  }, [missingKeys]);

  // Leva a pessoa direto ao primeiro campo que falta (na ordem da tela).
  const focusFirstMissing = useCallback(() => {
    const nodes = rootRef.current?.querySelectorAll<HTMLElement>("[data-field]");
    const target = Array.from(nodes ?? []).find((el) => missingKeysRef.current.has(el.dataset.field ?? ""));
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.querySelector<HTMLElement>("input:not([type=file]), button, textarea")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    registerApi({ flush: save, focusFirstMissing });
  }, [registerApi, save, focusFirstMissing]);

  useEffect(() => {
    onStatus({ loading: !loaded && !loadError, ready: loaded && missing.length === 0, summary, canBypass: meta.canBypass, done, total });
  }, [loaded, loadError, missing.length, summary, meta.canBypass, done, total, onStatus]);

  async function upload(kind: DocKind, files: FileList | null) {
    if (!files?.length) return;
    setDocError(null);
    setUploading(kind);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        body.append("kind", kind);
        const res = await fetch(`/api/deals/${dealId}/registration/documents`, { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDocError((data as { error?: string }).error ?? "Não foi possível enviar o arquivo");
          break;
        }
        setDocuments((prev) => [...prev, (data as { document: Doc }).document]);
      }
    } finally {
      setUploading(null);
    }
  }

  // Limpa o que foi digitado para recomeçar. O WhatsApp fica (identifica o cliente e é por onde ele é contatado) e os documentos enviados não são apagados.
  const hasFilled = Object.entries(form).some(([k, v]) => k !== "whatsapp" && k !== "personType" && String(v).trim() !== "") || form.personType === "PJ";
  function clearFields() {
    dirty.current = true;
    setForm((f) => ({ ...EMPTY_FORM, whatsapp: f.whatsapp }));
    setTouched(new Set());
    setSavedCep(undefined);
    lastCnpj.current = null;
    setCnpjLookup({ loading: false, error: null, situacao: null });
    setConfirmClear(false);
  }

  async function removeDoc(doc: Doc) {
    setDocError(null);
    const res = await fetch(`/api/deals/${dealId}/registration/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok) setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    else setDocError((await res.json().catch(() => ({}))).error ?? "Não foi possível apagar");
  }

  if (loadError) {
    return <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">{loadError}</p>;
  }
  if (!loaded) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o cadastro do cliente…
      </div>
    );
  }

  // Campo com rótulo, destaque amarelo e recado curto — só depois que a pessoa passou por ele ou tentou concluir.
  const field = (k: string, label: string, control: React.ReactNode, className = "", note?: React.ReactNode) => {
    const bad = missingKeys.has(k) && (showErrors || touched.has(k));
    const filledButInvalid = bad && ((k === "cpf" && form.cpf) || (k === "cnpj" && form.cnpj));
    return (
      <div
        data-field={k}
        className={`space-y-1 ${className} ${bad ? "[&_.field-input]:border-amber-400 [&_.field-input]:ring-1 [&_.field-input]:ring-amber-300 dark:[&_.field-input]:border-amber-500/70" : ""}`}
      >
        <label className="field-label">{label}</label>
        {control}
        {note}
        {bad && <p className="text-xs text-amber-700 dark:text-amber-400">{filledButInvalid ? "Confira os números" : "Obrigatório"}</p>}
      </div>
    );
  };

  const isPix = form.paymentMethod === "PIX";
  const hasPixProof = documents.some((d) => d.kind === "PAYMENT_PROOF");

  const docSlot = (kind: DocKind, hint: string) => {
    const list = documents.filter((d) => d.kind === kind);
    const bad = missingKeys.has(`doc:${kind}`) && (showErrors || touched.has(`doc:${kind}`));
    return (
      <div data-field={`doc:${kind}`} className="space-y-2">
        <p className="field-label">{DOCUMENT_KIND_LABELS[kind]}</p>
        {list.map((d) => {
          const src = `/api/deals/${dealId}/registration/documents/${d.id}`;
          return (
            <div key={d.id} className="proof-file-in flex items-center gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-2 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <DocumentThumb src={src} fileName={d.fileName} onClick={() => setViewing(d)} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  <CheckCircle2 className="proof-check h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="truncate">{d.fileName}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {formatFileSize(d.size)}
                  <button type="button" onClick={() => setViewing(d)} className="font-medium text-brand hover:underline">
                    Ver documento
                  </button>
                </p>
              </div>
              <button type="button" onClick={() => void removeDoc(d)} className="rounded p-1 text-neutral-400 hover:text-red-600" aria-label={`Remover ${d.fileName}`}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(kind);
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            void upload(kind, e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 text-center transition-[border-color,background-color,transform,box-shadow,padding] duration-300 ease-smooth ${
            dragOver === kind ? "scale-[1.015] shadow-md" : ""
          } ${uploading === kind ? "animate-pulse" : ""} ${
            list.length ? "py-3" : "py-6"
          } ${
            dragOver === kind
              ? "border-brand bg-brand-light/40"
              : bad
                ? "border-amber-400 bg-amber-50/60 dark:border-amber-500/70 dark:bg-amber-500/10"
                : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500"
          }`}
        >
          {uploading === kind ? (
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          ) : (
            <Upload className={`h-5 w-5 text-neutral-400 transition-transform duration-300 ease-smooth ${dragOver === kind ? "-translate-y-1 scale-125 text-brand" : ""}`} />
          )}
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
            {uploading === kind ? "Enviando…" : list.length ? "Adicionar outro arquivo" : "Arraste o arquivo aqui ou clique para escolher"}
          </span>
          {!list.length && <span className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            className="sr-only"
            onChange={(e) => {
              void upload(kind, e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    );
  };

  const personKeys = ["holderName", "cnpj", "cpf", "email", "whatsapp", "profession", "maritalStatus", "monthlyIncome"];
  const addressKeys = ["zipCode", "address", "addressNumber", "neighborhood", "city", "state"];
  const bankKeys = ["bankName", "bankAgency", "bankAccount", "bankAccountType"];
  const quotaKeys = ["groupNumber", "termMonths", "paymentMethod"];
  const docKeys = ["doc:PHOTO_ID"];
  const percent = total > 0 ? Math.round((done / total) * 100) : 100;

  return (
    <div
      ref={rootRef}
      className="space-y-4"
      onBlurCapture={(e) => {
        const k = (e.target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset.field;
        if (k) setTouched((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
      }}
    >
      {viewing && (
        <DocumentViewer src={`/api/deals/${dealId}/registration/documents/${viewing.id}`} fileName={viewing.fileName} onClose={() => setViewing(null)} />
      )}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {missing.length === 0 ? "Tudo certo para marcar o ganho" : `${done} de ${total} itens preenchidos`}
          </span>
          <span className="flex items-center gap-3">
            {hasFilled && !confirmClear && (
              <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400">
                <Eraser className="h-3.5 w-3.5" strokeWidth={2} /> Limpar campos
              </button>
            )}
            <span className="text-xs text-neutral-400">{saving ? "Salvando…" : "Salvo automaticamente"}</span>
          </span>
        </div>
        {confirmClear && (
          <div role="alertdialog" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
            <span className="min-w-0 flex-1">Apagar tudo o que foi preenchido? O celular e os documentos enviados continuam.</span>
            <button type="button" onClick={clearFields} className="btn-danger btn-sm">
              Sim, limpar
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className="btn-ghost btn-sm">
              Cancelar
            </button>
          </div>
        )}
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all duration-300 ${missing.length === 0 ? "bg-emerald-500" : "bg-brand"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>

      <Section n={1} title="Documentos" keys={docKeys} missingKeys={missingKeys}>
        {meta.documentsWaived ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">Este cliente já tem uma venda ganha: os documentos dele já estão com a administradora.</p>
        ) : (
          <div className="space-y-3">
            {docSlot("PHOTO_ID", "CNH ou RG (com o CPF) em PDF, PNG ou JPG. No RG, envie frente e verso.")}
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Os documentos ficam guardados com o administrativo por {DOCUMENT_RETENTION_DAYS} dias depois do ganho e depois são apagados.
            </p>
            {docError && <p className="text-sm text-red-600">{docError}</p>}
          </div>
        )}
      </Section>

      <Section n={2} title="Dados do cliente" keys={personKeys} missingKeys={missingKeys}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <p className="field-label">Tipo de cliente</p>
            <div className="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800" role="group" aria-label="Tipo de cliente">
              {(["PF", "PJ"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    set("personType", type);
                    if (
                      type === "PJ" &&
                      form.company.trim() &&
                      (!form.holderName.trim() || form.holderName.trim() === contactName.trim())
                    ) {
                      set("holderName", form.company);
                    }
                  }}
                  aria-pressed={form.personType === type}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${form.personType === type ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-500"}`}
                >
                  {type === "PF" ? "Pessoa física" : "Pessoa jurídica"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="field-label">Nome no CRM</p>
            <div className="field-input flex items-center bg-neutral-50 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" aria-label="Nome no CRM">
              {contactName || "Não informado"}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Usado no pipeline, atendimento e busca.</p>
          </div>
          {field(
            "holderName",
            form.personType === "PJ" ? "Razão social do titular" : "Nome completo do titular",
            <input
              className="field-input"
              autoComplete="name"
              maxLength={180}
              value={form.holderName}
              onChange={(e) => set("holderName", e.target.value)}
              placeholder={form.personType === "PJ" ? "Como consta no CNPJ" : "Como consta no documento"}
            />,
            "",
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Usado somente no cadastro da administradora.</p>,
          )}

          {form.personType === "PJ" && (
            <>
              {field(
                "cnpj",
                "CNPJ da empresa",
                <input className="field-input" inputMode="numeric" autoComplete="off" value={form.cnpj} onChange={(e) => set("cnpj", formatCnpj(e.target.value))} placeholder="00.000.000/0000-00" />,
                "",
                <>
                  {cnpjLookup.loading && <p className="text-xs text-neutral-500">Consultando a Receita…</p>}
                  {cnpjLookup.error && <p className="text-xs text-amber-700 dark:text-amber-400">{cnpjLookup.error}</p>}
                  {cnpjLookup.situacao && cnpjLookup.situacao.toUpperCase() !== "ATIVA" && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">Situação na Receita: {cnpjLookup.situacao}</p>
                  )}
                </>,
              )}
              {field("company", "Empresa", <input className="field-input" value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="Preenchida pelo CNPJ" />)}
            </>
          )}
          {field(
            "cpf",
            form.personType === "PJ" ? "CPF do sócio" : "CPF",
            <input className="field-input" inputMode="numeric" autoComplete="off" value={form.cpf} onChange={(e) => set("cpf", maskCpf(e.target.value))} placeholder="000.000.000-00" />,
          )}
          {field("email", "E-mail", <input className="field-input" type="email" autoComplete="off" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="nome@email.com" />)}
          <div data-field="whatsapp">
            <PhoneInput label="Celular" value={form.whatsapp} onChange={(v) => set("whatsapp", v)} error={missingKeys.has("whatsapp") && (showErrors || touched.has("whatsapp")) ? "Obrigatório" : null} />
          </div>
          {field("profession", "Profissão", <input className="field-input" value={form.profession} onChange={(e) => set("profession", e.target.value)} />)}
          {field(
            "maritalStatus",
            "Estado civil",
            <Select value={form.maritalStatus} onChange={(v) => set("maritalStatus", v)} options={MARITAL_STATUS_OPTIONS.map((o) => ({ value: o, label: o }))} placeholder="Escolha" ariaLabel="Estado civil" />,
          )}
          {field("monthlyIncome", "Renda mensal", <CurrencyInput value={form.monthlyIncome} onChange={(v) => set("monthlyIncome", v)} />)}
        </div>
      </Section>

      <Section n={3} title="Endereço" keys={addressKeys} missingKeys={missingKeys}>
        <div className="grid gap-3 sm:grid-cols-6">
          {field(
            "zipCode",
            "CEP",
            <input className="field-input" inputMode="numeric" autoComplete="off" value={form.zipCode} onChange={(e) => set("zipCode", formatCep(e.target.value))} placeholder="00000-000" />,
            "sm:col-span-2",
            <>
              {cep.loading && <p className="text-xs text-neutral-500">Buscando o endereço…</p>}
              {cep.error && <p className="text-xs text-amber-700 dark:text-amber-400">{cep.error}</p>}
            </>,
          )}
          {field("address", "Rua", <input className="field-input" value={form.address} onChange={(e) => set("address", e.target.value)} />, "sm:col-span-3")}
          {field("addressNumber", "Número", <input className="field-input" value={form.addressNumber} onChange={(e) => set("addressNumber", e.target.value)} />)}
          {field("neighborhood", "Bairro", <input className="field-input" value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} />, "sm:col-span-2")}
          {field("city", "Cidade", <input className="field-input" value={form.city} onChange={(e) => set("city", e.target.value)} />, "sm:col-span-3")}
          {field("state", "UF", <input className="field-input uppercase" maxLength={2} value={form.state} onChange={(e) => set("state", e.target.value.toUpperCase())} />)}
        </div>
      </Section>

      <Section n={4} title="Cota vendida" keys={quotaKeys} missingKeys={missingKeys}>
        <div className="grid gap-3 sm:grid-cols-3">
          {field(
            "groupNumber",
            "Grupo",
            <input
              className="field-input"
              inputMode="numeric"
              autoComplete="off"
              value={form.groupNumber}
              onChange={(e) => set("groupNumber", e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="Ex.: 1568"
            />,
          )}
          {field(
            "termMonths",
            "Prazo (meses)",
            <input
              className="field-input"
              inputMode="numeric"
              autoComplete="off"
              value={form.termMonths}
              onChange={(e) => set("termMonths", e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="Ex.: 180"
            />,
          )}
          {field(
            "paymentMethod",
            "Forma de pagamento",
            <Select value={form.paymentMethod} onChange={(v) => set("paymentMethod", v)} options={PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o, label: o }))} placeholder="Escolha" ariaLabel="Forma de pagamento" />,
          )}
        </div>
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-500 ease-smooth ${isPix ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          aria-hidden={!isPix}
          inert={!isPix}
        >
          <div className="min-h-0 overflow-hidden">
            <div className={`pix-proof space-y-2 rounded-xl border border-brand/30 bg-brand-light/30 p-3 dark:border-brand/30 dark:bg-brand-light/10 ${isPix ? "pix-proof-open" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                  <QrCode className="h-3.5 w-3.5 text-brand" strokeWidth={2} /> Pagamento via PIX
                </p>
                <span
                  key={hasPixProof ? "ok" : "pending"}
                  className={`proof-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    hasPixProof ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  }`}
                >
                  {hasPixProof && <CheckCircle2 className="h-3 w-3" strokeWidth={2.25} />}
                  {hasPixProof ? "Comprovante anexado" : "Falta anexar o comprovante"}
                </span>
              </div>
              {docSlot("PAYMENT_PROOF", "Comprovante do Pix em PDF, PNG ou JPG (pode ser o print do app do banco).")}
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Recomendado: o financeiro confere o pagamento por este comprovante.</p>
              {docError && <p className="text-sm text-red-600">{docError}</p>}
            </div>
          </div>
        </div>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">A cota e o dígito quem preenche é o administrativo, quando cadastrar na administradora.</p>
      </Section>

      {meta.requiresBankData && (
        <Section n={5} title="Dados bancários" keys={bankKeys} missingKeys={missingKeys}>
          <div className="grid gap-3 sm:grid-cols-4">
            {field("bankName", "Banco", <input className="field-input" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />, "sm:col-span-2")}
            {field("bankAgency", "Agência", <input className="field-input" inputMode="numeric" value={form.bankAgency} onChange={(e) => set("bankAgency", e.target.value)} />)}
            {field("bankAccount", "Conta", <input className="field-input" inputMode="numeric" value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} />)}
            {field(
              "bankAccountType",
              "Tipo de conta",
              <Select value={form.bankAccountType} onChange={(v) => set("bankAccountType", v)} options={BANK_ACCOUNT_TYPE_OPTIONS.map((o) => ({ value: o, label: o }))} placeholder="Escolha" ariaLabel="Tipo de conta" />,
              "sm:col-span-2",
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Bloco numerado do cadastro, com o selo "Completo" ou "N faltando" para a pessoa saber onde ainda tem trabalho. */
function Section({
  n,
  title,
  keys,
  missingKeys,
  children,
}: {
  n: number;
  title: string;
  keys: string[];
  missingKeys: Set<string>;
  children: React.ReactNode;
}) {
  const left = keys.filter((k) => missingKeys.has(k)).length;
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
              left === 0 ? "bg-emerald-500 text-white" : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200"
            }`}
          >
            {left === 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
          </span>
          {title}
        </h3>
        {left === 0 ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Completo</span>
        ) : (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{left === 1 ? "1 faltando" : `${left} faltando`}</span>
        )}
      </div>
      {children}
    </section>
  );
}
