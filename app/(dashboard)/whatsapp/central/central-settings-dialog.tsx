"use client";

import { useEffect, useRef, useState } from "react";
import { Scale, X } from "lucide-react";
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

const MODE_LABEL: Record<Mode, string> = { on: "Recebe", paused: "Pausado", off: "Fora" };

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

  async function savePool() {
    setSaving(true);
    setMessage(null);
    const res = await requestJson(
      "/api/whatsapp/central/settings",
      {
        method: "PUT",
        json: {
          memberUserIds: selected.map((row) => row.userId),
          pausedUserIds: selected.filter((row) => row.mode === "paused").map((row) => row.userId),
          memberPercentages: selected.map((row) => ({
            userId: row.userId,
            percent: row.distributionPercent,
          })),
        },
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
        json: {
          memberUserIds: selected.map((row) => row.userId),
          pausedUserIds: selected.filter((row) => row.mode === "paused").map((row) => row.userId),
          memberPercentages: selected.map((row) => ({
            userId: row.userId,
            percent: row.distributionPercent,
          })),
        },
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
    setQrCode(null);
    void loadSettings();
  }

  const instance = data?.instance ?? null;
  const connected = instance?.status === "CONNECTED";

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg" mobileSheet>
      <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">Central de Leads</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:text-neutral-700" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!data ? (
          <div className="h-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Número</h3>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-neutral-300"}`} />
                <span className="text-neutral-700 dark:text-neutral-200">
                  {connected ? instance?.phoneNumber ?? "Conectado" : instance ? "Desconectado" : "Não conectado"}
                </span>
                <span className="ml-auto flex gap-2">
                  {!connected && (
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      disabled={connecting || (!instance && !distributionValid)}
                      onClick={connect}
                    >
                      {connecting ? "Aguardando QR…" : instance ? "Reconectar" : "Conectar"}
                    </button>
                  )}
                  {instance && (
                    <button type="button" className="btn-secondary text-xs" onClick={() => setConfirmDisconnect(true)}>
                      Remover
                    </button>
                  )}
                </span>
              </div>
              {!instance && selected.length === 0 && (
                <p className="text-xs text-neutral-500">Escolha os atendentes abaixo antes de conectar.</p>
              )}
              {qrCode && !connected && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrCode} alt="QR Code da Central" className="h-48 w-48" />
                  <p className="text-xs text-neutral-500">WhatsApp → Aparelhos conectados → Conectar</p>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Distribuição</h3>
                  <p className="mt-1 text-xs text-neutral-500">Defina quanto cada consultor recebe. A soma deve fechar 100%.</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm shrink-0 text-xs"
                  disabled={selected.length === 0}
                  onClick={() => {
                    setMessage(null);
                    setRows((current) => equallyDistributed(current));
                  }}
                >
                  <Scale className="h-3.5 w-3.5" />
                  Dividir igualmente
                </button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className={hasReceivingMember || selected.length === 0 ? "text-neutral-500" : "text-amber-600 dark:text-amber-400"}>
                  {hasReceivingMember || selected.length === 0
                    ? "Pausado mantém sua porcentagem, mas não recebe novos leads."
                    : "Ative ao menos um consultor."}
                </span>
                <span
                  className={`shrink-0 font-semibold tabular-nums ${
                    percentagesValid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  Total {distributionTotal}%
                </span>
              </div>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
                {rows.map((row, index) => (
                  <li
                    key={row.userId}
                    className={`flex items-center gap-2 px-3 py-2 ${
                      // Linha divisória entre a distribuição e quem está fora.
                      row.mode === "off" && index === selected.length && index > 0 ? "border-t-2 border-neutral-200 dark:border-neutral-700" : ""
                    }`}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        row.mode === "off" ? "text-neutral-400" : "text-neutral-800 dark:text-neutral-100"
                      }`}
                    >
                      {row.name}
                    </span>
                    {row.mode !== "off" && (
                      <label className="relative shrink-0">
                        <span className="sr-only">Porcentagem de {row.name}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={100}
                          step={1}
                          className="field-input h-8 w-16 pr-6 text-right text-xs tabular-nums"
                          value={row.distributionPercent}
                          onChange={(event) => setDistributionPercent(row.userId, Number(event.target.value))}
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">%</span>
                      </label>
                    )}
                    <select
                      className="field-input w-28 py-1 text-xs"
                      value={row.mode}
                      onChange={(event) => setMode(row.userId, event.target.value as Mode)}
                      aria-label={`Situação de ${row.name}`}
                    >
                      {(["on", "paused", "off"] as const).map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_LABEL[mode]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-3">
                {dirty && !message && <span className="text-xs text-amber-600 dark:text-amber-400">Alterações não salvas</span>}
                {message && (
                  <span className={`text-xs ${message.tone === "ok" ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>
                    {message.text}
                  </span>
                )}
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={saving || !distributionValid || !dirty}
                  onClick={savePool}
                >
                  {saving ? "Salvando…" : "Salvar distribuição"}
                </button>
              </div>
            </section>
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
