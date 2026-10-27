"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, History, Laptop, Loader2, RefreshCw, Settings2, Square, Trash2, Wifi, WifiOff } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { requestJson } from "@/lib/client-request";

type SyncRun = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  trigger: string;
  attempts: number;
  nextAttemptAt?: string | Date | null;
  progress?: unknown;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  createdAt: string | Date;
  errorCode: string | null;
  error: string | null;
  summary?: unknown;
};

type Worker = {
  id: string;
  name: string;
  keyPrefix: string;
  lastSeenAt: string | Date | null;
  version: string | null;
  createdAt: string | Date;
  online: boolean;
};

type HistoryRun = SyncRun & {
  requestedByName: string;
  workerName: string | null;
};

export type ServopaOperationState = {
  activeRun: SyncRun | null;
  latestRun: SyncRun | null;
  /** Computadores com acesso ativo. Qualquer um deles online faz a fila andar. */
  workers: Worker[];
  workerOnline: boolean;
  /** O acesso da Servopa está configurado no servidor do CRM (só sim/não — o valor nunca chega aqui). */
  panelCredentialsConfigured: boolean;
  maxAttempts: number;
  maxWorkers: number;
};

function timeLabel(value: string | Date | null | undefined) {
  if (!value) return "Nunca conectado";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function readProgress(value: unknown): { completed: number; total: number; phase: string } | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.completed !== "number" || typeof item.total !== "number" || typeof item.phase !== "string") return null;
  return { completed: item.completed, total: item.total, phase: item.phase };
}

type ChangeCounts = { created: number; updated: number; deleted: number };
function readChanges(value: unknown): { groups: ChangeCounts; tables: ChangeCounts } | null {
  if (!value || typeof value !== "object") return null;
  const summary = value as Record<string, unknown>;
  function counts(input: unknown): ChangeCounts | null {
    if (!input || typeof input !== "object") return null;
    const item = input as Record<string, unknown>;
    if (![item.created, item.updated, item.deleted].every((number) => typeof number === "number")) return null;
    return { created: item.created as number, updated: item.updated as number, deleted: item.deleted as number };
  }
  const groups = counts(summary.groups);
  const tables = counts(summary.tables);
  return groups && tables ? { groups, tables } : null;
}

function durationLabel(run: HistoryRun) {
  const start = run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}min ${seconds % 60}s`;
}

/** Sinal mais recente entre todos os computadores. */
function lastSignal(workers: Worker[]): string | Date | null {
  let latest: string | Date | null = null;
  for (const worker of workers) {
    if (worker.lastSeenAt && (!latest || new Date(worker.lastSeenAt).getTime() > new Date(latest).getTime())) latest = worker.lastSeenAt;
  }
  return latest;
}

function operationStatus(state: ServopaOperationState): { label: string; detail: string; tone: BadgeTone } {
  const active = state.activeRun;
  if (!state.panelCredentialsConfigured) {
    return { label: "Acesso da Servopa pendente", detail: "Configure SERVOPA_USER e SERVOPA_PASS no servidor do CRM", tone: "warning" };
  }
  if (active?.status === "PENDING") {
    return {
      label: "Na fila",
      detail: !state.workerOnline
        ? "Aguardando um computador ficar online"
        : active.attempts > 0
          ? `Nova tentativa: ${timeLabel(active.nextAttemptAt)}`
          : "O robô vai iniciar em instantes",
      tone: "warning",
    };
  }
  if (active?.status === "RUNNING") {
    const progress = readProgress(active.progress);
    return {
      label: "Atualizando",
      detail: `${progress?.total ? `${progress.completed} de ${progress.total} grupos` : "Coleta em andamento"} · tentativa ${active.attempts}/${state.maxAttempts}`,
      tone: "brand",
    };
  }
  if (state.latestRun?.status === "FAILED") {
    return { label: "Falhou", detail: state.latestRun.error ?? "A atualização precisa de atenção", tone: "danger" };
  }
  if (!state.workers.length) return { label: "Não configurado", detail: "Conecte pelo menos um computador", tone: "warning" };
  if (!state.workerOnline) return { label: "Robô offline", detail: `Último sinal: ${timeLabel(lastSignal(state.workers))}`, tone: "neutral" };
  const online = state.workers.filter((worker) => worker.online).length;
  return { label: "Robô online", detail: online > 1 ? `${online} computadores prontos para atualizar` : "Pronto para atualizar", tone: "success" };
}

export function ServopaOperations({ initialState }: { initialState: ServopaOperationState }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Computadores que já existiam quando o instalador foi baixado; o primeiro id novo é o que acabou de se conectar. */
  const [installBaseline, setInstallBaseline] = useState<string[] | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Worker | null>(null);
  const [confirmAction, setConfirmAction] = useState<"REVOKE" | "CANCEL_RUN" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRun[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer = 0;
    async function poll() {
      const result = await requestJson<ServopaOperationState>(
        "/api/servopa-tables/operations",
        { signal: controller.signal },
        { silent: true },
      );
      if (result.ok) {
        const completedNow = Boolean(state.activeRun && !result.data.activeRun && result.data.latestRun?.status === "SUCCESS");
        setState(result.data);
        if (completedNow) router.refresh();
      }
      if (!stopped) timer = window.setTimeout(poll, state.activeRun ? 8_000 : settingsOpen ? 5_000 : 60_000);
    }
    timer = window.setTimeout(poll, state.activeRun ? 8_000 : settingsOpen ? 5_000 : 60_000);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [router, settingsOpen, state.activeRun]);

  async function runNow() {
    setRunning(true);
    const result = await requestJson<{ created: boolean; state: ServopaOperationState }>(
      "/api/servopa-tables/operations",
      { method: "POST" },
    );
    setRunning(false);
    if (result.ok) setState(result.data.state);
  }

  async function cancelRun() {
    setDialogError(null);
    const result = await requestJson<{ cancelled: boolean; state: ServopaOperationState }>(
      "/api/servopa-tables/operations",
      { method: "DELETE" },
      { silent: true },
    );
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setState(result.data.state);
    setConfirmAction(null);
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setDialogError(null);
    const result = await requestJson<{ history: HistoryRun[] }>(
      "/api/servopa-tables/operations/history",
      undefined,
      { silent: true },
    );
    setHistoryLoading(false);
    if (result.ok) setHistory(result.data.history);
    else setDialogError(result.error);
  }

  async function revokeKey() {
    if (!revokeTarget) return;
    setDialogError(null);
    const result = await requestJson<{ state: ServopaOperationState }>(
      "/api/servopa-tables/worker-credential",
      { method: "DELETE", json: { workerId: revokeTarget.id } },
      { silent: true },
    );
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setState(result.data.state);
    setConfirmAction(null);
    setRevokeTarget(null);
  }

  function closeSettings() {
    setSettingsOpen(false);
    setInstallBaseline(null);
    setDialogError(null);
  }

  const status = operationStatus(state);
  const newWorker = installBaseline ? state.workers.find((worker) => !installBaseline.includes(worker.id)) : undefined;
  // O instalador se apresenta como "instalando"; só quando o robô em si abre (com a versão real) está pronto.
  const newWorkerReady = Boolean(newWorker?.online && newWorker.version && newWorker.version !== "instalando");
  const limitReached = state.workers.length >= state.maxWorkers;
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="min-w-0 text-right">
          <Badge tone={status.tone} dot>{status.label}</Badge>
          <p className="mt-1 max-w-72 truncate text-xs text-neutral-500 dark:text-neutral-400" title={status.detail}>{status.detail}</p>
        </div>
        <button type="button" onClick={runNow} disabled={running || Boolean(state.activeRun) || !state.panelCredentialsConfigured} className="btn-primary">
          <RefreshCw className={`h-4 w-4 ${running || state.activeRun?.status === "RUNNING" ? "animate-spin" : ""}`} aria-hidden="true" />
          {state.activeRun ? "Atualizando" : "Rodar robô agora"}
        </button>
        {state.activeRun && (
          <button type="button" onClick={() => setConfirmAction("CANCEL_RUN")} className="btn-secondary text-red-600 dark:text-red-400">
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            Cancelar
          </button>
        )}
        <button type="button" onClick={openHistory} className="icon-btn" aria-label="Histórico de atualizações" title="Histórico">
          <History className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)} className="icon-btn" aria-label="Configurar robô" title="Configurar robô">
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {settingsOpen && (
        <Modal onClose={closeSettings} maxWidth="max-w-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand"><Laptop className="h-5 w-5" aria-hidden="true" /></div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Robô Servopa</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Computadores que atualizam as tabelas</p>
            </div>
          </div>

          {installBaseline ? (
            <div className="mt-5 space-y-5">
              {newWorker && newWorkerReady ? (
                <>
                  <div className="flex gap-3 rounded-md bg-emerald-50 p-4 dark:bg-emerald-950/40">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"><Check className="h-4 w-4" /></span>
                    <div>
                      <p className="font-medium text-emerald-900 dark:text-emerald-100">{newWorker.name} conectado</p>
                      <p className="mt-0.5 text-sm text-emerald-700 dark:text-emerald-300">Pronto. O robô abre sozinho sempre que este computador for ligado.</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button type="button" onClick={closeSettings} className="btn-primary">Concluir</button>
                  </div>
                </>
              ) : (
                <>
                  <ol className="space-y-4">
                    {[
                      <>Abra o arquivo baixado, <strong className="font-medium text-neutral-800 dark:text-neutral-100">Instalar Robo Servopa</strong>, na lista de downloads do navegador. Se o navegador perguntar, escolha <strong className="font-medium text-neutral-800 dark:text-neutral-100">Manter</strong>.</>,
                      <>Se o Windows pedir confirmação, clique em <strong className="font-medium text-neutral-800 dark:text-neutral-100">Executar</strong> (ou em <strong className="font-medium text-neutral-800 dark:text-neutral-100">Mais informações</strong> e depois <strong className="font-medium text-neutral-800 dark:text-neutral-100">Executar assim mesmo</strong>).</>,
                      <>Aguarde. Na primeira vez o robô baixa o que precisa, o que leva de 2 a 5 minutos. Não há senha nem nada para preencher.</>,
                    ].map((text, index) => (
                      <li key={index} className="flex gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">{index + 1}</span>
                        <p className="pt-1 text-sm text-neutral-600 dark:text-neutral-300">{text}</p>
                      </li>
                    ))}
                  </ol>
                  <div className="flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2.5 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
                    {newWorker ? `${newWorker.name} conectado ao CRM. Terminando a instalação…` : "Aguardando o computador se conectar…"}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">O arquivo vale por 1 hora e serve para um computador. Para instalar em outro, abra o CRM nele e clique em instalar.</p>
                  <div className="flex justify-end gap-2">
                    <a href="/api/servopa-tables/installer" className="btn-secondary" download>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Baixar de novo
                    </a>
                    <button type="button" onClick={closeSettings} className="btn-primary">Fechar</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {state.workers.length === 0 ? (
                  <p className="py-3 text-sm text-neutral-500 dark:text-neutral-400">Nenhum computador conectado ainda.</p>
                ) : (
                  state.workers.map((worker) => (
                    <div key={worker.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {worker.online ? <Wifi className="h-4 w-4 shrink-0 text-emerald-500" /> : <WifiOff className="h-4 w-4 shrink-0 text-neutral-400" />}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{worker.name}</p>
                          <p className="text-xs text-neutral-500">
                            {worker.version === "instalando" ? "Instalando…" : worker.online ? "Online" : `Último sinal: ${timeLabel(worker.lastSeenAt)}`}
                            {worker.version && worker.version !== "instalando" ? ` · v${worker.version}` : ""}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setRevokeTarget(worker); setConfirmAction("REVOKE"); }}
                        className="icon-btn text-red-600"
                        aria-label={`Remover ${worker.name}`}
                        title="Remover computador"
                      ><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))
                )}
              </div>
              {(state.activeRun || state.latestRun?.status === "FAILED") && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-neutral-200 pb-4 text-sm dark:border-neutral-800">
                  <div>
                    <p className="text-xs text-neutral-500">Execução</p>
                    <p className="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">{state.activeRun ? status.label : "Falhou"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500">Tentativa</p>
                    <p className="mt-0.5 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{(state.activeRun ?? state.latestRun)?.attempts ?? 0}/{state.maxAttempts}</p>
                  </div>
                  {state.activeRun?.status === "PENDING" && state.activeRun.attempts > 0 && (
                    <div className="col-span-2">
                      <p className="text-xs text-neutral-500">Próxima tentativa</p>
                      <p className="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">{timeLabel(state.activeRun.nextAttemptAt)}</p>
                    </div>
                  )}
                  {!state.activeRun && state.latestRun?.error && (
                    <p className="col-span-2 text-sm text-red-600 dark:text-red-400">{state.latestRun.error}</p>
                  )}
                </div>
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Instalar em um computador</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Abra esta tela no computador com Windows que vai rodar o robô e clique no botão abaixo. Não há senha nem configuração.
                  Até {state.maxWorkers} computadores; se um estiver desligado, outro assume.
                </p>
              </div>
              {dialogError && <p className="text-sm text-red-600 dark:text-red-400">{dialogError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeSettings} className="btn-secondary">Fechar</button>
                {limitReached ? (
                  <button type="button" disabled className="btn-primary" title="Remova um computador para instalar em outro">
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Instalar neste computador
                  </button>
                ) : (
                  <a
                    href="/api/servopa-tables/installer"
                    download
                    onClick={() => setInstallBaseline(state.workers.map((worker) => worker.id))}
                    className="btn-primary"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Instalar neste computador
                  </a>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {historyOpen && (
        <Modal onClose={() => { setHistoryOpen(false); setDialogError(null); }} maxWidth="max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"><History className="h-5 w-5" aria-hidden="true" /></div>
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Histórico do robô</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Últimas 30 execuções</p>
            </div>
          </div>
          {historyLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-brand" aria-label="Carregando" /></div>
          ) : dialogError ? (
            <p className="mt-5 text-sm text-red-600 dark:text-red-400">{dialogError}</p>
          ) : !history?.length ? (
            <p className="mt-8 text-center text-sm text-neutral-500">Nenhuma atualização executada.</p>
          ) : (
            <div className="scrollbar-thin mt-5 max-h-[60vh] divide-y divide-neutral-200 overflow-y-auto border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {history.map((run) => {
                const changes = readChanges(run.summary);
                const changed = changes ? Object.values(changes.groups).reduce((a, b) => a + b, 0) + Object.values(changes.tables).reduce((a, b) => a + b, 0) > 0 : false;
                const statusTone: BadgeTone = run.status === "SUCCESS" ? "success" : run.status === "FAILED" ? "danger" : run.status === "CANCELLED" ? "neutral" : "warning";
                const statusLabel = run.status === "SUCCESS" ? "Concluída" : run.status === "FAILED" ? "Falhou" : run.status === "CANCELLED" ? "Cancelada" : run.status === "RUNNING" ? "Executando" : "Na fila";
                return (
                  <div key={run.id} className="py-3 pr-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${changed ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"}`} />
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{timeLabel(run.createdAt)}</p>
                          <Badge tone={statusTone} size="sm">{statusLabel}</Badge>
                        </div>
                        <p className="mt-1 pl-4 text-xs text-neutral-500">{run.requestedByName} · {run.trigger === "SCHEDULED" ? "Automática" : run.trigger === "MANUAL" ? "Manual" : "Importação"}{run.workerName ? ` · ${run.workerName}` : ""} · {durationLabel(run)} · tentativa {run.attempts}/{state.maxAttempts}</p>
                      </div>
                    </div>
                    {changes && run.status === "SUCCESS" && (
                      <p className="mt-2 pl-4 text-xs text-neutral-600 dark:text-neutral-300">
                        {changed
                          ? `Grupos: +${changes.groups.created} alterados ${changes.groups.updated} removidos ${changes.groups.deleted} · Tabelas: +${changes.tables.created} alteradas ${changes.tables.updated} removidas ${changes.tables.deleted}`
                          : "Nenhuma mudança nos dados publicados"}
                      </p>
                    )}
                    {run.error && <p className="mt-2 pl-4 text-xs text-red-600 dark:text-red-400">{run.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex justify-end"><button type="button" onClick={() => setHistoryOpen(false)} className="btn-secondary">Fechar</button></div>
        </Modal>
      )}

      {confirmAction === "CANCEL_RUN" && (
        <ConfirmDialog
          title="Cancelar esta atualização?"
          description="A coleta atual será interrompida. Os computadores continuam conectados para as próximas atualizações."
          error={dialogError}
          confirmLabel="Cancelar atualização"
          onClose={() => { setConfirmAction(null); setDialogError(null); }}
          onConfirm={cancelRun}
        />
      )}
      {confirmAction === "REVOKE" && (
        <ConfirmDialog
          title={`Remover ${revokeTarget?.name ?? "este computador"}?`}
          description="Este computador para de atualizar as tabelas imediatamente. Os outros continuam funcionando."
          error={dialogError}
          confirmLabel="Remover computador"
          onClose={() => { setConfirmAction(null); setRevokeTarget(null); setDialogError(null); }}
          onConfirm={revokeKey}
        />
      )}
    </>
  );
}
