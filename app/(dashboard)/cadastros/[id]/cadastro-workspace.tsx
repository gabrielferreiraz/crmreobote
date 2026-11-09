"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCopy, Copy, Download, FileX2, ShieldAlert, Check } from "lucide-react";
import { Select } from "@/components/select";
import { DocumentThumb, DocumentViewer, formatFileSize } from "@/components/deal-registration/document-preview";
import { RequestComposer, RequestHistory } from "@/components/deal-registration/document-requests";
import { DOCUMENT_KIND_LABELS, PAYMENT_METHOD_OPTIONS } from "@/lib/deal-registration/rules";
import type { DocumentRequestDTO } from "@/lib/deal-registration/requests";
import { formatCurrency } from "@/lib/format";
import { maskCpf } from "@/lib/cpf";
import { formatCnpj } from "@/lib/cnpj";

type Doc = { id: string; kind: "PHOTO_ID" | "SOCIAL_CONTRACT" | "OTHER"; fileName: string; size: number; createdAt: string };

export type WorkspaceProps = {
  dealId: string;
  clientName: string;
  consultantName: string;
  administratorName: string | null;
  credit: number | null;
  closedAt: string | null;
  contact: Record<string, string | null>;
  registration: Record<string, string | number | null>;
  documents: Doc[];
  missing: { key: string; label: string }[];
  documentsPurgedAt: string | null;
  completedAt: string | null;
  retentionDays: number;
  waivedReason: string | null;
  quotaRegisteredAt: string | null;
  requests: DocumentRequestDTO[];
};

function CopyRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <dt className="w-28 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{label}</dt>
        <dd className="text-sm text-red-500">não informado</dd>
      </div>
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(value ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sem permissão da área de transferência: o texto continua selecionável */
    }
  }
  return (
    <div className="group flex items-center gap-2 py-1.5">
      <dt className="w-28 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-sm font-medium text-neutral-900 dark:text-neutral-100">{value}</dd>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-md p-1 text-neutral-400 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-700 focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100 dark:hover:bg-neutral-800"
        aria-label={`Copiar ${label}`}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function CadastroWorkspace(props: WorkspaceProps) {
  const { dealId, contact: c, registration: r } = props;
  const [requests, setRequests] = useState(props.requests);
  const [quotaAt, setQuotaAt] = useState(props.quotaRegisteredAt);
  const [quota, setQuota] = useState({
    groupNumber: String(r.groupNumber ?? ""),
    termMonths: r.termMonths != null ? String(r.termMonths) : "",
    paymentMethod: String(r.paymentMethod ?? ""),
  });
  const [busy, setBusy] = useState(false);
  const [quotaSaved, setQuotaSaved] = useState(false);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [presetKeys, setPresetKeys] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);

  const docSrc = (id: string) => `/api/deals/${dealId}/registration/documents/${id}`;
  const openRequest = requests.find((x) => x.status === "OPEN");
  const hasPhotoId = props.documents.some((d) => d.kind === "PHOTO_ID");
  const bank = [r.bankName, r.bankAgency && `ag. ${r.bankAgency}`, r.bankAccount && `conta ${r.bankAccount}`, r.bankAccountType].filter(Boolean).join(" · ");
  const address = [c.address, c.addressNumber, c.neighborhood, c.city && c.state ? `${c.city}/${c.state}` : c.city, c.zipCode].filter(Boolean).join(", ");

  function askFor(keys: string[]) {
    setPresetKeys(keys);
    setComposerKey((k) => k + 1);
    document.getElementById("pedir-ao-consultor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function patch(body: unknown) {
    setBusy(true);
    try {
      return await fetch(`/api/deals/${dealId}/registration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveQuota() {
    setQuotaSaved(false);
    const res = await patch({
      quota: {
        groupNumber: quota.groupNumber.trim() || null,
        termMonths: quota.termMonths ? Number(quota.termMonths) : null,
        paymentMethod: quota.paymentMethod || null,
      },
    });
    if (res.ok) setQuotaSaved(true);
  }

  async function toggleQuota() {
    const done = !quotaAt;
    const res = await patch({ quotaRegistered: done });
    if (res.ok) setQuotaAt(done ? new Date().toISOString() : null);
  }

  async function downloadAll() {
    for (const d of props.documents) {
      const a = document.createElement("a");
      a.href = `${docSrc(d.id)}?download=1`;
      a.download = d.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  const rows: [string, string | null][] = [
    ["Nome", props.clientName],
    ["CPF", r.cpf ? maskCpf(String(r.cpf)) : null],
    ...(r.personType === "PJ" ? ([["CNPJ", r.cnpj ? formatCnpj(String(r.cnpj)) : null], ["Empresa", c.company]] as [string, string | null][]) : []),
    ["E-mail", c.email],
    ["Celular", c.whatsapp],
    ["CEP", c.zipCode],
    ["Endereço", [c.address, c.addressNumber].filter(Boolean).join(", ") || null],
    ["Bairro", c.neighborhood],
    ["Cidade / UF", c.city && c.state ? `${c.city}/${c.state}` : c.city],
    ["Profissão", (r.profession as string) ?? null],
    ["Estado civil", (r.maritalStatus as string) ?? null],
    ["Renda mensal", r.monthlyIncome != null ? formatCurrency(Number(r.monthlyIncome)) : null],
    ...(bank ? ([["Banco", bank]] as [string, string | null][]) : []),
  ];

  async function copyAll() {
    const text = rows.map(([k, v]) => `${k}: ${v ?? "-"}`).join("\n") + (address ? `\nEndereço completo: ${address}` : "");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      /* ignora */
    }
  }

  const expiry = (d: Doc) => {
    const base = Math.max(new Date(d.createdAt).getTime(), props.completedAt ? new Date(props.completedAt).getTime() : 0);
    return new Date(base + props.retentionDays * 86_400_000).toLocaleDateString("pt-BR");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {viewing && <DocumentViewer src={docSrc(viewing.id)} fileName={viewing.fileName} onClose={() => setViewing(null)} />}

      <div>
        <Link href="/cadastros" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          <ArrowLeft className="h-3.5 w-3.5" /> Cadastros
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{props.clientName}</h1>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
              {props.administratorName && <span>{props.administratorName}</span>}
              {props.credit != null && <span>Crédito {formatCurrency(props.credit)}</span>}
              <span>Consultor: {props.consultantName}</span>
              {props.closedAt && <span>Ganho em {new Date(props.closedAt).toLocaleDateString("pt-BR", { timeZone: "America/Campo_Grande" })}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {quotaAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Cota cadastrada em {new Date(quotaAt).toLocaleDateString("pt-BR")}
              </span>
            ) : openRequest ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">Aguardando o consultor</span>
            ) : (
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Cota ainda não cadastrada</span>
            )}
            <button type="button" onClick={() => void toggleQuota()} disabled={busy} className={quotaAt ? "btn-ghost" : "btn-primary"}>
              {quotaAt ? "Desfazer" : "Marcar cota cadastrada"}
            </button>
          </div>
        </div>
      </div>

      {props.waivedReason && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" /> Ganho marcado sem o cadastro completo: {props.waivedReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {props.missing.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10">
              <p className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Falta no cadastro: {props.missing.map((m) => m.label).join(", ")}
              </p>
              <button type="button" onClick={() => askFor(hasPhotoId || props.documentsPurgedAt ? ["fix_data"] : ["photo_id"])} className="btn-secondary btn-sm">
                Pedir ao consultor
              </button>
            </div>
          )}

          <Card
            title="Dados do cliente"
            aside={
              <button type="button" onClick={() => void copyAll()} className="btn-ghost text-xs">
                {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {copiedAll ? "Copiado" : "Copiar tudo"}
              </button>
            }
          >
            <dl className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rows.map(([label, value]) => (
                <CopyRow key={label} label={label} value={value} />
              ))}
            </dl>
          </Card>

          <Card
            title={`Documentos${props.documents.length ? ` (${props.documents.length})` : ""}`}
            aside={
              props.documents.length > 1 ? (
                <button type="button" onClick={() => void downloadAll()} className="btn-ghost text-xs">
                  <Download className="h-3.5 w-3.5" /> Baixar todos
                </button>
              ) : undefined
            }
          >
            {props.documents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <FileX2 className="h-6 w-6 text-neutral-400" />
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  {props.documentsPurgedAt
                    ? `Documentos apagados do servidor em ${new Date(props.documentsPurgedAt).toLocaleDateString("pt-BR")} (prazo de ${props.retentionDays} dias).`
                    : "Nenhum documento enviado."}
                </p>
                <button type="button" onClick={() => askFor(["photo_id"])} className="btn-secondary btn-sm">
                  Pedir documento ao consultor
                </button>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {props.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-800/60">
                    <DocumentThumb src={docSrc(d.id)} fileName={d.fileName} onClick={() => setViewing(d)} className="h-16 w-16" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{DOCUMENT_KIND_LABELS[d.kind]}</p>
                      <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {d.fileName}
                        {formatFileSize(d.size) && ` · ${formatFileSize(d.size)}`}
                      </p>
                      <p className="text-[11px] text-neutral-400">Apagado do servidor em {expiry(d)}</p>
                      <div className="mt-1 flex items-center gap-3 text-xs font-medium">
                        <button type="button" onClick={() => setViewing(d)} className="text-brand hover:underline">
                          Ver
                        </button>
                        <a href={`${docSrc(d.id)}?download=1`} download={d.fileName} className="inline-flex items-center gap-1 text-neutral-600 hover:underline dark:text-neutral-300">
                          <Download className="h-3 w-3" /> Baixar
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {props.documents.length > 0 && (
              <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Baixe antes do prazo: depois disso o arquivo é apagado do servidor (LGPD).</p>
            )}
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="Cota (você preenche)">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
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
              </div>
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
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void saveQuota()} disabled={busy} className="btn-primary">
                  Salvar cota
                </button>
                {quotaSaved && <span className="text-xs text-emerald-600">Salvo</span>}
              </div>
            </div>
          </Card>

          <div id="pedir-ao-consultor" className="scroll-mt-4">
            <Card title="Pedir ao consultor">
              <RequestComposer
                key={composerKey}
                dealId={dealId}
                consultantName={props.consultantName}
                initialKeys={presetKeys}
                onCreated={(req) => setRequests((prev) => [req, ...prev])}
              />
            </Card>
          </div>

          {requests.length > 0 && (
            <Card title="Pedidos feitos">
              <RequestHistory
                dealId={dealId}
                requests={requests}
                documents={props.documents}
                onChange={(req) => setRequests((prev) => prev.map((x) => (x.id === req.id ? req : x)))}
                onView={(id) => setViewing(props.documents.find((d) => d.id === id) ?? null)}
              />
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
