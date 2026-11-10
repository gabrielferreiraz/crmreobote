"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeDollarSign,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Copy,
  Download,
  FileX2,
  Hash,
  Landmark,
  MapPin,
  Phone,
  ShieldAlert,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Select } from "@/components/select";
import { DocumentThumb, DocumentViewer, formatFileSize } from "@/components/deal-registration/document-preview";
import { RequestComposer, RequestHistory } from "@/components/deal-registration/document-requests";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { DOCUMENT_KIND_LABELS, PAYMENT_METHOD_OPTIONS, formatQuotaLabel } from "@/lib/deal-registration/rules";
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

function SummaryItem({
  icon: Icon,
  label,
  value,
  emphasis = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 bg-white px-3 py-3 sm:gap-3 sm:px-4 dark:bg-neutral-950">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 sm:h-9 sm:w-9 sm:rounded-lg dark:bg-neutral-800 dark:text-neutral-300">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-neutral-500 dark:text-neutral-400" title={label}>{label}</p>
        <p className={`truncate tabular-nums ${emphasis ? "text-sm font-semibold text-neutral-950 sm:text-base dark:text-white" : "text-sm font-medium text-neutral-800 dark:text-neutral-100"}`} title={value}>
          {value}
        </p>
      </div>
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
  const initialQuota = {
    groupNumber: String(r.groupNumber ?? ""),
    quotaNumber: String(r.quotaNumber ?? ""),
    quotaDigit: String(r.quotaDigit ?? ""),
    termMonths: r.termMonths != null ? String(r.termMonths) : "",
    paymentMethod: String(r.paymentMethod ?? ""),
  };
  const [quota, setQuota] = useState(initialQuota);
  // O que já está salvo no servidor: serve para saber se há alteração pendente e para o título da página.
  const [savedQuota, setSavedQuota] = useState(initialQuota);
  const quotaDirty = JSON.stringify(quota) !== JSON.stringify(savedQuota);
  const quotaFilled = Boolean(quota.groupNumber.trim() && quota.quotaNumber.trim() && quota.quotaDigit.trim());
  const [busy, setBusy] = useState(false);
  const [quotaSaved, setQuotaSaved] = useState(false);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [presetKeys, setPresetKeys] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Sobe a cada ação: o histórico de auditoria abaixo recarrega e mostra o que acabou de acontecer.
  const [auditKey, setAuditKey] = useState(0);
  const refreshAudit = () => setAuditKey((k) => k + 1);

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

  /** Chama o PATCH do cadastro; devolve true se deu certo e mostra o motivo se não deu. */
  async function patch(body: unknown): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/registration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(data.error ?? "Não foi possível salvar. Tente de novo.");
      return false;
    } catch {
      setActionError("Sem conexão. Tente de novo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveQuota(): Promise<boolean> {
    setQuotaSaved(false);
    const ok = await patch({
      quota: {
        groupNumber: quota.groupNumber.trim() || null,
        quotaNumber: quota.quotaNumber.trim() || null,
        quotaDigit: quota.quotaDigit.trim() || null,
        termMonths: quota.termMonths ? Number(quota.termMonths) : null,
        paymentMethod: quota.paymentMethod || null,
      },
    });
    if (ok) {
      setQuotaSaved(true);
      setSavedQuota(quota);
      refreshAudit();
    }
    return ok;
  }

  async function toggleQuota() {
    const done = !quotaAt;
    if (done) {
      if (!quotaFilled) {
        setActionError(
          !quota.groupNumber.trim()
            ? "Falta o grupo: o consultor informa no cadastro do Ganho. Peça a ele pelo botão ao lado da cota."
            : "Preencha a cota e o dígito antes de marcar a cota como cadastrada.",
        );
        document.getElementById("cota-da-venda")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      // O que foi digitado e ainda não foi salvo entra junto: nada se perde ao marcar.
      if (quotaDirty && !(await saveQuota())) return;
    }
    const ok = await patch({ quotaRegistered: done });
    if (ok) {
      setQuotaAt(done ? new Date().toISOString() : null);
      refreshAudit();
    }
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
    window.setTimeout(refreshAudit, 1200);
  }

  type DataRow = [string, string | null];
  const dataGroups: { title: string; icon: LucideIcon; rows: DataRow[] }[] = [
    {
      title: "Identificação",
      icon: UserRound,
      rows: [
        ["Nome", props.clientName],
        ["CPF", r.cpf ? maskCpf(String(r.cpf)) : null],
        ...(r.personType === "PJ"
          ? ([["CNPJ", r.cnpj ? formatCnpj(String(r.cnpj)) : null], ["Empresa", c.company]] as DataRow[])
          : []),
        ["Profissão", (r.profession as string) ?? null],
        ["Estado civil", (r.maritalStatus as string) ?? null],
      ],
    },
    {
      title: "Contato",
      icon: Phone,
      rows: [
        ["E-mail", c.email],
        ["Celular", c.whatsapp],
      ],
    },
    {
      title: "Endereço",
      icon: MapPin,
      rows: [
        ["CEP", c.zipCode],
        ["Endereço", [c.address, c.addressNumber].filter(Boolean).join(", ") || null],
        ["Bairro", c.neighborhood],
        ["Cidade / UF", c.city && c.state ? `${c.city}/${c.state}` : c.city],
      ],
    },
    {
      title: "Financeiro",
      icon: WalletCards,
      rows: [
        ["Renda mensal", r.monthlyIncome != null ? formatCurrency(Number(r.monthlyIncome)) : null],
        ["Banco", bank || null],
      ],
    },
  ];
  const rows = dataGroups.flatMap((group) => group.rows);
  const quotaLabel = formatQuotaLabel({
    groupNumber: savedQuota.groupNumber,
    quotaNumber: savedQuota.quotaNumber,
    quotaDigit: savedQuota.quotaDigit,
  });

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
    <div className="mx-auto max-w-7xl space-y-4">
      {viewing && <DocumentViewer src={docSrc(viewing.id)} fileName={viewing.fileName} onClose={() => setViewing(null)} />}

      <div>
        <Link href="/cadastros" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
          <ArrowLeft className="h-3.5 w-3.5" /> Cadastros
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-neutral-900 sm:truncate dark:text-neutral-100">{props.clientName}</h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Cadastro da cota e conferência dos documentos</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
            {quotaAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 max-sm:justify-center dark:bg-emerald-500/10 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Cota cadastrada em {new Date(quotaAt).toLocaleDateString("pt-BR")}
              </span>
            ) : openRequest ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-center text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">Aguardando o consultor</span>
            ) : (
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-center text-sm font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Cota ainda não cadastrada</span>
            )}
            <button type="button" onClick={() => void toggleQuota()} disabled={busy} className={`${quotaAt ? "btn-ghost" : "btn-primary"} max-sm:w-full`}>
              {quotaAt ? "Desfazer" : "Marcar cota cadastrada"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1 dark:border-neutral-800 dark:bg-neutral-800">
          <SummaryItem icon={Landmark} label="Administradora" value={props.administratorName ?? "Não informada"} />
          <SummaryItem icon={BadgeDollarSign} label="Crédito" value={props.credit != null ? formatCurrency(props.credit) : "Não informado"} emphasis />
          <SummaryItem icon={UserRound} label="Consultor responsável" value={props.consultantName} />
          <SummaryItem
            icon={CalendarDays}
            label="Venda ganha em"
            value={props.closedAt ? new Date(props.closedAt).toLocaleDateString("pt-BR", { timeZone: "America/Campo_Grande" }) : "Não informado"}
          />
          <SummaryItem icon={Hash} label="Grupo e cota" value={quotaLabel || "Ainda não definidos"} />
        </div>
      </div>

      {actionError && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {actionError}
        </p>
      )}

      {props.waivedReason && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" /> Ganho marcado sem o cadastro completo: {props.waivedReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 space-y-4 lg:order-1">
          {props.missing.length > 0 && (
            <div className="flex flex-col items-stretch gap-3 rounded-lg border border-red-200 bg-red-50/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-red-500/30 dark:bg-red-500/10">
              <p className="flex min-w-0 items-start gap-2 text-sm leading-5 text-red-700 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span><span className="font-medium">Falta no cadastro:</span> {props.missing.map((m) => m.label).join(", ")}</span>
              </p>
              <button type="button" onClick={() =>
                askFor(
                  props.missing.some((m) => ["groupNumber", "termMonths", "paymentMethod"].includes(m.key))
                    ? ["quota_info"]
                    : hasPhotoId || props.documentsPurgedAt
                      ? ["fix_data"]
                      : ["photo_id"],
                )
              } className="btn-secondary btn-sm shrink-0 max-sm:w-full">
                Pedir ao consultor
              </button>
            </div>
          )}

          <Card
            title="Dados para cadastro"
            aside={
              <button type="button" onClick={() => void copyAll()} className="btn-ghost text-xs">
                {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {copiedAll ? "Copiado" : "Copiar tudo"}
              </button>
            }
          >
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {dataGroups.map((group) => {
                const Icon = group.icon;
                return (
                  <section key={group.title}>
                    <div className="flex items-center gap-2 border-b border-neutral-200 pb-2 dark:border-neutral-800">
                      <Icon className="h-4 w-4 text-brand" strokeWidth={2} />
                      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{group.title}</h3>
                    </div>
                    <dl className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {group.rows.map(([label, value]) => (
                        <CopyRow key={label} label={label} value={value} />
                      ))}
                    </dl>
                  </section>
                );
              })}
            </div>
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
                        <a
                          href={`${docSrc(d.id)}?download=1`}
                          download={d.fileName}
                          onClick={() => window.setTimeout(refreshAudit, 1200)}
                          className="inline-flex items-center gap-1 text-neutral-600 hover:underline dark:text-neutral-300"
                        >
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

          <Card title="Atividade recente">
            <AuditTimeline dealId={dealId} reloadKey={auditKey} />
          </Card>
        </div>

        <aside className="contents lg:order-2 lg:block lg:space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div id="cota-da-venda" className="order-1 scroll-mt-4 lg:order-none">
            <Card title="Cota e dígito">
              <div className="space-y-5">
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-3">
                  <div className="space-y-1.5">
                    <label className="field-label" htmlFor="quota-number">
                      Cota
                    </label>
                    <input
                      id="quota-number"
                      className="field-input"
                      inputMode="numeric"
                      autoComplete="off"
                      value={quota.quotaNumber}
                      onChange={(e) => {
                        setQuotaSaved(false);
                        setQuota((q) => ({ ...q, quotaNumber: e.target.value.replace(/\D/g, "").slice(0, 6) }));
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="field-label" htmlFor="quota-digit">
                      Dígito
                    </label>
                    <input
                      id="quota-digit"
                      className="field-input"
                      inputMode="numeric"
                      autoComplete="off"
                      value={quota.quotaDigit}
                      onChange={(e) => {
                        setQuotaSaved(false);
                        setQuota((q) => ({ ...q, quotaDigit: e.target.value.replace(/\D/g, "").slice(0, 2) }));
                      }}
                    />
                  </div>
                </div>

                <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
                  <p className="mb-3 text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Informado pelo consultor</p>
                  <dl className="space-y-3 text-sm">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(136px,160px)] items-center gap-4">
                      <dt className="text-neutral-500 dark:text-neutral-400">Grupo</dt>
                      <dd className="min-w-0 text-right">
                        {savedQuota.groupNumber ? (
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{savedQuota.groupNumber}</span>
                        ) : (
                          <input
                            className="field-input w-full py-2 text-right"
                            inputMode="numeric"
                            aria-label="Grupo (o consultor não informou)"
                            placeholder="não informado"
                            value={quota.groupNumber}
                            onChange={(e) => {
                              setQuotaSaved(false);
                              setQuota((q) => ({ ...q, groupNumber: e.target.value.replace(/\D/g, "").slice(0, 8) }));
                            }}
                          />
                        )}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(136px,160px)] items-center gap-4">
                      <dt className="text-neutral-500 dark:text-neutral-400">Prazo</dt>
                      <dd className="min-w-0 text-right">
                        {savedQuota.termMonths ? (
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{savedQuota.termMonths} meses</span>
                        ) : (
                          <input
                            className="field-input w-full py-2 text-right"
                            inputMode="numeric"
                            aria-label="Prazo em meses (o consultor não informou)"
                            placeholder="não informado"
                            value={quota.termMonths}
                            onChange={(e) => {
                              setQuotaSaved(false);
                              setQuota((q) => ({ ...q, termMonths: e.target.value.replace(/\D/g, "").slice(0, 3) }));
                            }}
                          />
                        )}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(136px,160px)] items-center gap-4">
                      <dt className="text-neutral-500 dark:text-neutral-400">Forma de pagamento</dt>
                      <dd className="min-w-0 text-right">
                        {savedQuota.paymentMethod ? (
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{savedQuota.paymentMethod}</span>
                        ) : (
                          <div className="w-full text-left">
                            <Select
                              value={quota.paymentMethod}
                              onChange={(v) => {
                                setQuotaSaved(false);
                                setQuota((q) => ({ ...q, paymentMethod: v }));
                              }}
                              options={PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o, label: o }))}
                              placeholder="não informado"
                              ariaLabel="Forma de pagamento (o consultor não informou)"
                            />
                          </div>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {(!savedQuota.groupNumber || !savedQuota.termMonths || !savedQuota.paymentMethod) && (
                    <button type="button" onClick={() => askFor(["quota_info"])} className="mt-4 text-left text-xs font-medium text-brand hover:underline">
                      Pedir ao consultor que informe o que falta
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                  <button type="button" onClick={() => void saveQuota()} disabled={busy || !quotaDirty} className="btn-primary">
                    Salvar cota
                  </button>
                  {quotaSaved && !quotaDirty && <span className="text-xs text-emerald-600">Salvo</span>}
                  {quotaDirty && <span className="text-xs text-amber-600 dark:text-amber-400">Alterações sem salvar</span>}
                </div>
                <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  Grupo, cota e dígito identificam a cota do cliente na administradora. Eles também aparecem no Processo da venda.
                </p>
              </div>
            </Card>
          </div>

          <div id="pedir-ao-consultor" className="order-3 scroll-mt-4 lg:order-none">
            <Card title="Pedir ao consultor">
              <RequestComposer
                key={composerKey}
                dealId={dealId}
                consultantName={props.consultantName}
                initialKeys={presetKeys}
                onCreated={(req) => {
                  setRequests((prev) => [req, ...prev]);
                  refreshAudit();
                }}
              />
            </Card>
          </div>

          {requests.length > 0 && (
            <div className="order-3 lg:order-none">
              <Card title="Pedidos feitos">
                <RequestHistory
                  dealId={dealId}
                  requests={requests}
                  documents={props.documents}
                  onChange={(req) => {
                    setRequests((prev) => prev.map((x) => (x.id === req.id ? req : x)));
                    refreshAudit();
                  }}
                  onView={(id) => setViewing(props.documents.find((d) => d.id === id) ?? null)}
                />
              </Card>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
