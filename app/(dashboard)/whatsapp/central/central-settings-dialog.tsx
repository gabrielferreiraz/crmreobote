"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Scale, UserMinus, UserPlus, Wifi, WifiOff, X } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { requestJson } from "@/lib/client-request";

type Mode = "off" | "on" | "paused";

type SettingsResponse = {
  enabled: boolean;
  instance: {
    id: string;
    status: "CONNECTED" | "CONNECTING" | "DISCONNECTED";
    phoneNumber: string | null;
    distributionPool: {
      members: { userId: string; pausedAt: string | null; distributionPercent: number }[];
    } | null;
  } | null;
  availableMembers: { userId: string; user: { name: string } }[];
};

type Row = { userId: string; name: string; mode: Mode; distributionPercent: number };

/** Retrato da distribuição — compara com o salvo para saber se há alteração pendente. */
function poolKey(rows: Row[]): string {
  return rows
    .filter((row) => row.mode !== "off")
    .map((row) => `${row.userId}:${row.mode}:${row.distributionPercent}`)
    .join(",");
}

function equallyDistributed(rows: Row[]): Row[] {
  const selected = rows.filter((row) => row.mode !== "off");
  if (selected.length === 0) return rows;
  const base = Math.floor(100 / selected.length);
  const remainder = 100 % selected.length;
  const percentages = new Map(
    selected.map((row, index) => [row.userId, base + (index < remainder ? 1 : 0)]),
  );
  return rows.map((row) => ({
    ...row,
    distributionPercent: percentages.get(row.userId) ?? row.distributionPercent,
  }));
}

/**
 * Configuração da Central (só Dono): quem recebe leads, qual a participação
 * percentual, quem está pausado e a conexão do número.
 */
export function CentralSettingsDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Diálogo fechado = para tudo: uma busca de QR em voo não pode agendar
  // outra depois do fechamento (ficaria consultando para sempre).
  const aliveRef = useRef(true);
  const qrAttemptsRef = useRef(0);
  const qrErrorsRef = useRef(0);
  const [savedKey, setSavedKey] = useState("");
  const [memberQuery, setMemberQuery] = useState("");

  function fetchSettings(signal?: AbortSignal) {
    return requestJson<SettingsResponse>("/api/whatsapp/central/settings", { signal }, { silent: true });
  }

  function applySettings(res: Awaited<ReturnType<typeof fetchSettings>>) {
    if (!res.ok) {
      if (!res.aborted) setMessage({ tone: "error", text: res.error });
      return;
    }
    setData(res.data);
    const members = res.data.instance?.distributionPool?.members ?? [];
    const names = new Map(res.data.availableMembers.map((member) => [member.userId, member.user.name]));
    const inPool = members
      .filter((member) => names.has(member.userId))
      .map((member): Row => ({
        userId: member.userId,
        name: names.get(member.userId)!,
        mode: member.pausedAt ? "paused" : "on",
        distributionPercent: member.distributionPercent,
      }));
    const poolIds = new Set(inPool.map((row) => row.userId));
    const others = res.data.availableMembers
      .filter((member) => !poolIds.has(member.userId))
      .map((member): Row => ({
        userId: member.userId,
        name: member.user.name,
        mode: "off",
        distributionPercent: 0,
      }));
    const next = [...inPool, ...others];
    setRows(next);
    setSavedKey(poolKey(next));
    // Abriu enquanto o número ainda está pareando: já mostra o QR.
    if (res.data.instance?.status === "CONNECTING" && !qrTimerRef.current) startQrPolling();
  }

  async function loadSettings() {
    applySettings(await fetchSettings());
  }

  useEffect(() => {
    const controller = new AbortController();
    // Carga inicial do diálogo — o estado só muda no retorno da busca.
    void fetchSettings(controller.signal).then(applySettings);
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      controller.abort();
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
    // Carga única ao abrir; applySettings só usa setters (estáveis).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lista em dois blocos: quem participa da distribuição em cima e "Fora" embaixo.
  function setMode(userId: string, mode: Mode) {
    setMessage(null);
    setRows((current) => {
      const row = current.find((item) => item.userId === userId);
      if (!row) return current;
      const rest = current.filter((item) => item.userId !== userId);
      const inPool = rest.filter((item) => item.mode !== "off");
      const out = rest.filter((item) => item.mode === "off");

      if (mode === "off") {
        if (row.mode === "off") return current;
        const recipient = inPool.reduce<Row | null>(
          (largest, item) => (!largest || item.distributionPercent > largest.distributionPercent ? item : largest),
          null,
        );
        const adjusted = inPool.map((item) =>
          item.userId === recipient?.userId
            ? { ...item, distributionPercent: item.distributionPercent + row.distributionPercent }
            : item,
        );
        return [...adjusted, { ...row, mode, distributionPercent: 0 }, ...out];
      }

      if (row.mode !== "off") {
        return current.map((item) => (item.userId === userId ? { ...item, mode } : item));
      }

      if (inPool.length === 0) return [{ ...row, mode, distributionPercent: 100 }, ...out];
      const total = inPool.reduce((sum, item) => sum + item.distributionPercent, 0);
      const largest = inPool.reduce((currentLargest, item) =>
        item.distributionPercent > currentLargest.distributionPercent ? item : currentLargest,
      );
      const newPercent = total < 100 ? 100 - total : 1;
      const adjusted = inPool.map((item) =>
        total === 100 && item.userId === largest.userId && item.distributionPercent > 1
          ? { ...item, distributionPercent: item.distributionPercent - 1 }
          : item,
      );
      return [...adjusted, { ...row, mode, distributionPercent: newPercent }, ...out];
    });
  }

  function setDistributionPercent(userId: string, value: number) {
    setMessage(null);
    setRows((current) =>
      current.map((row) =>
        row.userId === userId ? { ...row, distributionPercent: Math.min(100, Math.max(0, value)) } : row,
      ),
    );
  }

  const selected = rows.filter((row) => row.mode !== "off");
  const distributionTotal = selected.reduce((sum, row) => sum + row.distributionPercent, 0);
  const percentagesValid =
    selected.length > 0 &&
    distributionTotal === 100 &&
    selected.every((row) => Number.isInteger(row.distributionPercent) && row.distributionPercent >= 1);
  const hasReceivingMember = selected.some((row) => row.mode === "on");
  const distributionValid = percentagesValid && hasReceivingMember;
  const dirty = data !== null && poolKey(rows) !== savedKey;

  // Mesmo formato no "Salvar" e no "Conectar" (que cria a distribuição junto).
  function poolPayload(pool: Row[]) {
    return {
      memberUserIds: pool.map((row) => row.userId),
      pausedUserIds: pool.filter((row) => row.mode === "paused").map((row) => row.userId),
      memberPercentages: pool.map((row) => ({ userId: row.userId, percent: row.distributionPercent })),
    };
  }

  async function savePool() {
    setSaving(true);
    setMessage(null);
    const res = await requestJson(
      "/api/whatsapp/central/settings",
      {
        method: "PUT",
        json: poolPayload(selected),
      },
      { silent: true },
    );
    setSaving(false);
    if (res.ok) {
      setSavedKey(poolKey(rows));
      setMessage({ tone: "ok", text: "Salvo" });
    } else {
      setMessage({ tone: "error", text: res.error });
    }
  }

  function startQrPolling() {
    qrAttemptsRef.current = 0;
    qrErrorsRef.current = 0;
    setConnecting(true);
    void pollQr();
  }

  async function pollQr() {
    qrTimerRef.current = null;
    const res = await requestJson<{ connected?: boolean; qrCode?: string | null; pending?: boolean }>(
      "/api/whatsapp/central/instance/qr",
      undefined,
      { silent: true },
    );
    if (!aliveRef.current) return;
    if (res.ok && res.data.connected) {
      setQrCode(null);
      setConnecting(false);
      void loadSettings();
      return;
    }
    qrAttemptsRef.current += 1;
    if (!res.ok) qrErrorsRef.current += 1;
    // 3 erros seguidos ou ~2 min sem QR: para e deixa a pessoa tentar de novo.
    const gaveUp = qrErrorsRef.current >= 3 || (res.ok && !res.data.qrCode && qrAttemptsRef.current > 60);
    if (gaveUp) {
      setConnecting(false);
      setQrCode(null);
      setMessage({ tone: "error", text: res.ok ? "O QR não chegou. Tente reconectar." : res.error });
      return;
    }
    if (res.ok) qrErrorsRef.current = 0;
    if (res.ok && res.data.qrCode) setQrCode(res.data.qrCode);
    qrTimerRef.current = setTimeout(() => void pollQr(), res.ok && res.data.qrCode ? 15_000 : 2_000);
  }

  async function connect() {
    setConnecting(true);
    setMessage(null);
    const res = await requestJson(
      "/api/whatsapp/central/instance",
      {
        method: "POST",
        json: poolPayload(selected),
      },
      { silent: true },
    );
    if (!res.ok) {
      setConnecting(false);
      setMessage({ tone: "error", text: res.error });
      return;
    }
    startQrPolling();
  }

  async function disconnect() {
    setDisconnectError(null);
    const res = await requestJson("/api/whatsapp/central/instance", { method: "DELETE" }, { silent: true });
    if (!res.ok) {
      setDisconnectError(res.error);
      return;
    }
    setConfirmDisconnect(false);
    // Removida no meio do pareamento: para de buscar QR de um número que não existe mais.
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    qrTimerRef.current = null;
    setConnecting(false);
    setQrCode(null);
    void loadSettings();
  }

  const instance = data?.instance ?? null;
  const connected = instance?.status === "CONNECTED";
  const available = rows.filter(
    (row) => row.mode === "off" && row.name.toLocaleLowerCase("pt-BR").includes(memberQuery.trim().toLocaleLowerCase("pt-BR")),
  );
  const distributionSummary =
    selected.length === 0
      ? "Inclua ao menos um consultor"
      : !hasReceivingMember
        ? "Ative ao menos um consultor"
        : distributionTotal < 100
          ? `Faltam ${100 - distributionTotal}%`
          : distributionTotal > 100
            ? `Excede em ${distributionTotal - 100}%`
            : "Distribuição pronta";

  return (
    <Modal onClose={onClose} maxWidth="max-w-5xl" mobileSheet panelClassName="!overflow-hidden !p-0 !pb-0">
      <div className="flex h-[88dvh] max-h-[860px] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800 sm:px-6 sm:py-5">
          <div>
            <h2 className="text-xl font-semibold text-neutral-950 dark:text-white">Central de Leads</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Conexão do WhatsApp e distribuição dos novos leads.</p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn shrink-0" aria-label="Fechar" title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </header>

        {!data ? (
          <div className="m-6 min-h-64 flex-1 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
        ) : (
          <>
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[18rem_minmax(0,1fr)] lg:overflow-hidden">
              <aside className="border-b border-neutral-200 bg-neutral-50/70 p-5 dark:border-neutral-800 dark:bg-neutral-900/30 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-6">
                <section aria-labelledby="central-connection-title">
                  <h3 id="central-connection-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp da central</h3>

                  <div className="mt-4 flex items-start gap-3">
                    {connected ? (
                      <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={2} />
                    ) : (
                      <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" strokeWidth={2} />
                    )}
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${connected ? "text-emerald-700 dark:text-emerald-400" : "text-neutral-500 dark:text-neutral-400"}`}>
                        {connected ? "Conectado" : instance ? "Desconectado" : "Não conectado"}
                      </p>
                      <p className="mt-0.5 truncate text-base text-neutral-800 dark:text-neutral-200">
                        {connected ? instance?.phoneNumber ?? "Número ativo" : "Nenhum número ativo"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {!connected && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={connecting || (!instance && !distributionValid)}
                        onClick={connect}
                      >
                        {connecting ? "Aguardando QR…" : instance ? "Reconectar" : "Conectar número"}
                      </button>
                    )}
                    {instance && (
                      <button type="button" className="btn-secondary text-red-600 dark:text-red-400" onClick={() => setConfirmDisconnect(true)}>
                        Remover
                      </button>
                    )}
                  </div>

                  {!instance && !distributionValid && (
                    <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Monte uma distribuição válida para conectar o número.</p>
                  )}

                  {qrCode && !connected && (
                    <div className="mt-5 border-t border-neutral-200 pt-5 dark:border-neutral-800">
                      <p className="mb-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">Leia o QR Code no WhatsApp</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrCode} alt="QR Code da Central" className="mx-auto aspect-square w-full max-w-52 rounded-md bg-white p-2" />
                      <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Aparelhos conectados → Conectar aparelho</p>
                    </div>
                  )}
                </section>
              </aside>

              <div className="min-w-0 p-5 sm:p-6 lg:overflow-y-auto">
                <section aria-labelledby="central-distribution-title">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 id="central-distribution-title" className="text-lg font-semibold text-neutral-950 dark:text-white">Distribuição de leads</h3>
                      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Escolha quem participa e defina a porcentagem de cada consultor.</p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      disabled={selected.length === 0}
                      onClick={() => {
                        setMessage(null);
                        setRows((current) => equallyDistributed(current));
                      }}
                    >
                      <Scale className="h-4 w-4" />
                      Dividir igualmente
                    </button>
                  </div>

                  <div className="mt-5 border-y border-neutral-200 py-4 dark:border-neutral-800">
                    <div className="flex items-center justify-between gap-4">
                      <span className={`text-sm font-medium ${distributionValid ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                        {distributionSummary}
                      </span>
                      <strong className={`text-lg tabular-nums ${percentagesValid ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                        {distributionTotal}%
                      </strong>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <div
                        className={`h-full rounded-full transition-[width] ${percentagesValid ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: `${Math.min(100, distributionTotal)}%` }}
                      />
                    </div>
                  </div>

                  <section className="mt-6" aria-labelledby="selected-consultants-title">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 id="selected-consultants-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Recebem leads</h4>
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">{selected.length} consultor{selected.length === 1 ? "" : "es"}</span>
                    </div>

                    {selected.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center dark:border-neutral-700">
                        <p className="text-base font-medium text-neutral-700 dark:text-neutral-300">Nenhum consultor incluído</p>
                        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Use “Incluir” na lista abaixo.</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                        <div className="hidden grid-cols-[minmax(12rem,1fr)_8rem_13rem_2.5rem] gap-3 bg-neutral-50 px-4 py-2.5 text-sm font-medium text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400 md:grid">
                          <span>Consultor</span>
                          <span>Participação</span>
                          <span>Situação</span>
                          <span className="sr-only">Remover</span>
                        </div>
                        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                          {selected.map((row) => (
                            <li key={row.userId} className="grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-end gap-3 p-4 md:grid-cols-[minmax(12rem,1fr)_8rem_13rem_2.5rem] md:items-center">
                              <div className="col-span-3 min-w-0 md:col-span-1">
                                <p className="truncate text-base font-medium text-neutral-900 dark:text-neutral-100">{row.name}</p>
                                <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                                  {row.mode === "on" ? "Recebendo novos leads" : "Pausado temporariamente"}
                                </p>
                              </div>

                              <label className="block">
                                <span className="mb-1 block text-sm font-medium text-neutral-500 dark:text-neutral-400 md:sr-only">Participação</span>
                                <span className="relative block w-full md:w-24">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    max={100}
                                    step={1}
                                    className="field-input h-10 w-full pr-8 text-right text-base tabular-nums"
                                    value={row.distributionPercent}
                                    onChange={(event) => setDistributionPercent(row.userId, Number(event.target.value))}
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">%</span>
                                </span>
                              </label>

                              <div>
                                <span className="mb-1 block text-sm font-medium text-neutral-500 dark:text-neutral-400 md:sr-only">Situação</span>
                                <div className="grid grid-cols-2 overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700" role="group" aria-label={`Situação de ${row.name}`}>
                                  <button
                                    type="button"
                                    onClick={() => setMode(row.userId, "on")}
                                    className={`border-r border-neutral-300 px-3 py-2 text-sm font-medium dark:border-neutral-700 ${row.mode === "on" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
                                  >
                                    Recebe
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMode(row.userId, "paused")}
                                    className={`px-3 py-2 text-sm font-medium ${row.mode === "paused" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
                                  >
                                    Pausado
                                  </button>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => setMode(row.userId, "off")}
                                className="icon-btn justify-self-end text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                                aria-label={`Remover ${row.name} da distribuição`}
                                title="Remover da distribuição"
                              >
                                <UserMinus className="h-4 w-4" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>

                  <section className="mt-7" aria-labelledby="available-consultants-title">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 id="available-consultants-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Disponíveis para incluir</h4>
                        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Consultores fora da distribuição.</p>
                      </div>
                      <div className="relative w-full sm:max-w-64">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                        <input
                          value={memberQuery}
                          onChange={(event) => setMemberQuery(event.target.value)}
                          className="field-input w-full pl-9 text-base"
                          placeholder="Buscar consultor"
                        />
                      </div>
                    </div>

                    {available.length === 0 ? (
                      <p className="rounded-lg border border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                        {rows.some((row) => row.mode === "off") ? "Nenhum consultor encontrado." : "Todos os consultores já estão na distribuição."}
                      </p>
                    ) : (
                      <ul className="grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 dark:border-neutral-800 dark:bg-neutral-800 sm:grid-cols-2">
                        {available.map((row) => (
                          <li key={row.userId} className="flex min-w-0 items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-neutral-950">
                            <span className="truncate text-base text-neutral-700 dark:text-neutral-300">{row.name}</span>
                            <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => setMode(row.userId, "on")}>
                              <UserPlus className="h-4 w-4" />
                              Incluir
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </section>
              </div>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-neutral-200 bg-white px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] dark:border-neutral-800 dark:bg-neutral-950 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:pb-4">
              <div className="min-h-5 text-sm">
                {dirty && !message && <span className="text-amber-700 dark:text-amber-400">Alterações não salvas</span>}
                {message && (
                  <span className={message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {message.text}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saving || !distributionValid || !dirty}
                  onClick={savePool}
                >
                  {saving ? "Salvando…" : "Salvar distribuição"}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>

      {confirmDisconnect && (
        <ConfirmDialog
          title="Remover a Central?"
          description="O número sai do CRM e os atendimentos abertos vão para Encerrados."
          confirmLabel="Remover"
          error={disconnectError}
          onConfirm={disconnect}
          onClose={() => setConfirmDisconnect(false)}
        />
      )}
    </Modal>
  );
}
