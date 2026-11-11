"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ClipboardCheck, Download, ShieldAlert } from "lucide-react";
import { Select } from "@/components/select";
import { DocumentThumb, DocumentViewer } from "@/components/deal-registration/document-preview";
import { formatCurrency } from "@/lib/format";
import { maskCpf } from "@/lib/cpf";
import { formatCnpj } from "@/lib/cnpj";
import { DOCUMENT_KIND_LABELS, PAYMENT_METHOD_OPTIONS, formatQuotaLabel } from "@/lib/deal-registration/rules";

type Summary = {
  contact: Record<string, string | null>;
  registration: Record<string, string | number | null>;
  documents: { id: string; kind: "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER" | "PAYMENT_PROOF"; fileName: string }[];
  requiresBankData: boolean;
  completedAt: string | null;
  waivedReason: string | null;
  quotaRegisteredAt: string | null;
  documentsPurgedAt: string | null;
  retentionDays: number;
  canBypass: boolean;
};

/**
 * Cadastro do cliente de um negócio JÁ ganho: o administrativo vê os dados e
 * abre os documentos aqui e marca "Cota cadastrada". Quem não tem acesso (a
 * rota responde 403) simplesmente não vê o cartão.
 */
export function RegistrationSummary({ dealId }: { dealId: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState({ groupNumber: "", quotaNumber: "", quotaDigit: "", termMonths: "", paymentMethod: "" });
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaSaved, setQuotaSaved] = useState(false);
  const [viewing, setViewing] = useState<Summary["documents"][number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/registration`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: Summary | null) => {
        if (cancelled) return;
        setData(json);
        if (json) {
          // O administrativo cai direto nos dados enquanto a cota não foi cadastrada.
          setOpen(json.canBypass && !json.quotaRegisteredAt);
          setQuota({
            groupNumber: String(json.registration.groupNumber ?? ""),
            quotaNumber: String(json.registration.quotaNumber ?? ""),
            quotaDigit: String(json.registration.quotaDigit ?? ""),
            termMonths: json.registration.termMonths != null ? String(json.registration.termMonths) : "",
            paymentMethod: String(json.registration.paymentMethod ?? ""),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (!data || (!data.completedAt && !data.waivedReason && data.documents.length === 0)) return null;

  async function toggleQuota() {
    if (!data) return;
    setBusy(true);
    setQuotaError(null);
    const done = !data.quotaRegisteredAt;
    const res = await fetch(`/api/deals/${dealId}/registration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaRegistered: done }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setData({ ...data, quotaRegisteredAt: done ? new Date().toISOString() : null });
      return;
    }
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setQuotaError(body.error ?? "Não foi possível salvar. Tente de novo.");
  }

  async function saveQuota() {
    setBusy(true);
    setQuotaSaved(false);
    setQuotaError(null);
    const res = await fetch(`/api/deals/${dealId}/registration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quota: {
          groupNumber: quota.groupNumber.trim() || null,
          quotaNumber: quota.quotaNumber.trim() || null,
          quotaDigit: quota.quotaDigit.trim() || null,
          termMonths: quota.termMonths ? Number(quota.termMonths) : null,
          paymentMethod: quota.paymentMethod || null,
        },
      }),
    });
    setBusy(false);
    if (res.ok) {
      setQuotaSaved(true);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setQuotaError(body.error ?? "Não foi possível salvar. Tente de novo.");
  }

  // Baixa um arquivo por vez (o navegador pode pedir para permitir vários downloads).
  async function downloadAll() {
    if (!data) return;
    for (const d of data.documents) {
      const a = document.createElement("a");
      a.href = `/api/deals/${dealId}/registration/documents/${d.id}?download=1`;
      a.download = d.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  const expiresAt = data.completedAt ? new Date(new Date(data.completedAt).getTime() + data.retentionDays * 24 * 60 * 60 * 1000) : null;
  const c = data.contact;
  const r = data.registration;
  const bank = [r.bankName, r.bankAgency && `ag. ${r.bankAgency}`, r.bankAccount && `conta ${r.bankAccount}`, r.bankAccountType].filter(Boolean).join(" · ");
  const rows: [string, string | null][] = [
    ["CPF", r.cpf ? maskCpf(String(r.cpf)) : null],
    ["CNPJ", r.cnpj ? formatCnpj(String(r.cnpj)) : null],
    ["E-mail", c.email],
    ["Celular", c.whatsapp],
    ["Endereço", [c.address, c.addressNumber, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city, c.zipCode].filter(Boolean).join(", ") || null],
    ["Profissão", (r.profession as string) ?? null],
    ["Estado civil", (r.maritalStatus as string) ?? null],
    ["Renda mensal", r.monthlyIncome != null ? formatCurrency(Number(r.monthlyIncome)) : null],
    ["Banco", bank || null],
  ];

  return (
    <section className="card mt-3 p-4">
      {viewing && <DocumentViewer src={`/api/deals/${dealId}/registration/documents/${viewing.id}`} fileName={viewing.fileName} onClose={() => setViewing(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left" aria-expanded={open}>
          <ClipboardCheck className="h-4 w-4 text-neutral-500" strokeWidth={2} />
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cadastro do cliente</span>
          <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {data.waivedReason && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5" /> Ganho sem cadastro: {data.waivedReason}
            </span>
          )}
          {data.quotaRegisteredAt ? (
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Cota cadastrada em {new Date(data.quotaRegisteredAt).toLocaleDateString("pt-BR")}
            </span>
          ) : (
            <span className="font-medium text-neutral-500">Cota ainda não cadastrada</span>
          )}
          {data.canBypass && (
            <button type="button" onClick={() => void toggleQuota()} disabled={busy} className="btn-ghost text-xs">
              {data.quotaRegisteredAt ? "Desfazer" : "Marcar cota cadastrada"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-neutral-200/80 pt-3 dark:border-white/[0.08]">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {rows
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <dt className="w-28 shrink-0 text-neutral-500 dark:text-neutral-400">{label}</dt>
                  <dd className="min-w-0 break-words text-neutral-900 dark:text-neutral-100">{value}</dd>
                </div>
              ))}
          </dl>
          {data.canBypass ? (
            <div className="space-y-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Cota e dígito (preenchidos pelo administrativo)</p>
              {(data.registration.groupNumber || data.registration.termMonths || data.registration.paymentMethod) && (
                <p className="text-sm text-neutral-700 dark:text-neutral-200">
                  <span className="text-neutral-500 dark:text-neutral-400">Informado pelo consultor: </span>
                  {[
                    data.registration.groupNumber && `grupo ${data.registration.groupNumber}`,
                    data.registration.termMonths && `${data.registration.termMonths} meses`,
                    data.registration.paymentMethod,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {!data.registration.groupNumber && (
                  <div className="space-y-1">
                    <label className="field-label">Grupo</label>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={quota.groupNumber}
                      onChange={(e) => {
                        setQuotaSaved(false);
                        setQuota((q) => ({ ...q, groupNumber: e.target.value }));
                      }}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="field-label">Cota</label>
                  <input
                    className="field-input"
                    inputMode="numeric"
                    value={quota.quotaNumber}
                    onChange={(e) => {
                      setQuotaSaved(false);
                      setQuota((q) => ({ ...q, quotaNumber: e.target.value.replace(/\D/g, "").slice(0, 6) }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="field-label">Dígito</label>
                  <input
                    className="field-input"
                    inputMode="numeric"
                    value={quota.quotaDigit}
                    onChange={(e) => {
                      setQuotaSaved(false);
                      setQuota((q) => ({ ...q, quotaDigit: e.target.value.replace(/\D/g, "").slice(0, 2) }));
                    }}
                  />
                </div>
                {!data.registration.termMonths && (
                  <div className="space-y-1">
                    <label className="field-label">Prazo (meses)</label>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={quota.termMonths}
                      onChange={(e) => {
                        setQuotaSaved(false);
                        setQuota((q) => ({ ...q, termMonths: e.target.value.replace(/\D/g, "").slice(0, 3) }));
                      }}
                    />
                  </div>
                )}
                {!data.registration.paymentMethod && (
                  <div className="space-y-1">
                    <label className="field-label">Forma de pagamento</label>
                    <Select
                      value={quota.paymentMethod}
                      onChange={(v) => {
                        setQuotaSaved(false);
                        setQuota((q) => ({ ...q, paymentMethod: v }));
                      }}
                      options={PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o, label: o }))}
                      placeholder="Escolha"
                      ariaLabel="Forma de pagamento"
                    />
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => void saveQuota()} disabled={busy} className="btn-primary">
                    Salvar
                  </button>
                  {quotaSaved && <span className="pb-2 text-xs text-emerald-600">Salvo</span>}
                  {quotaError && <span className="pb-2 text-xs text-red-600">{quotaError}</span>}
                </div>
              </div>
            </div>
          ) : (
            (r.groupNumber || r.quotaNumber || r.termMonths || r.paymentMethod) && (
              <p className="text-sm text-neutral-700 dark:text-neutral-200">
                Cota: {[formatQuotaLabel({ groupNumber: r.groupNumber as string | null, quotaNumber: r.quotaNumber as string | null, quotaDigit: r.quotaDigit as string | null }) || null, r.termMonths && `${r.termMonths} meses`, r.paymentMethod].filter(Boolean).join(" · ")}
              </p>
            )
          )}

          {data.documentsPurgedAt ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Documentos apagados do servidor em {new Date(data.documentsPurgedAt).toLocaleDateString("pt-BR")} (prazo de {data.retentionDays} dias após o ganho).
            </p>
          ) : (
            data.documents.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {expiresAt
                      ? `Baixe até ${expiresAt.toLocaleDateString("pt-BR")}: depois disso os documentos são apagados do servidor.`
                      : `Os documentos são apagados do servidor ${data.retentionDays} dias depois do ganho.`}
                  </p>
                  {data.canBypass && data.documents.length > 1 && (
                    <button type="button" onClick={() => void downloadAll()} className="btn-ghost text-xs">
                      <Download className="h-3.5 w-3.5" /> Baixar todos
                    </button>
                  )}
                </div>
                <ul className="flex flex-wrap gap-3">
                  {data.documents.map((d) => {
                    const src = `/api/deals/${dealId}/registration/documents/${d.id}`;
                    return (
                      <li key={d.id} className="flex w-full items-center gap-3 rounded-xl bg-neutral-50 p-2 sm:w-auto sm:min-w-[260px] dark:bg-neutral-800/60">
                        <DocumentThumb src={src} fileName={d.fileName} onClick={() => setViewing(d)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{DOCUMENT_KIND_LABELS[d.kind]}</p>
                          <p className="max-w-[200px] truncate text-xs text-neutral-500 dark:text-neutral-400">{d.fileName}</p>
                          <div className="mt-1 flex items-center gap-3 text-xs font-medium">
                            <button type="button" onClick={() => setViewing(d)} className="text-brand hover:underline">
                              Ver
                            </button>
                            <a href={`${src}?download=1`} download={d.fileName} className="inline-flex items-center gap-1 text-neutral-600 hover:underline dark:text-neutral-300" aria-label={`Baixar ${d.fileName}`}>
                              <Download className="h-3 w-3" /> Baixar
                            </a>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}
