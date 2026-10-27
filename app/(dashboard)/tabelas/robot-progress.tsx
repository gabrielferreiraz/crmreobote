"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, X, XCircle } from "lucide-react";

/**
 * Painel flutuante que acompanha o robô enquanto ele atualiza as tabelas.
 *
 * As ETAPAS são reais (vêm do heartbeat do robô: STARTING → AUTHENTICATING →
 * LISTING_GROUPS → FETCHING_GROUPS → VALIDATING). As FRASES dentro de cada
 * etapa giram a cada ~2,6 s e a barra avança devagar entre um sinal e outro:
 * é de propósito, para a pessoa sentir o sistema trabalhando sem ter de
 * entender a fila — nunca mostra uma etapa que ainda não começou nem volta
 * a barra para trás.
 */

export type RobotRun = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  attempts: number;
  nextAttemptAt?: string | Date | null;
  progress?: unknown;
  startedAt?: string | Date | null;
  createdAt: string | Date;
};

export type RobotResult = { tone: "success" | "brand" | "danger" | "neutral" | "warning"; headline: string; chips: string[] };

type Phase = "PENDING" | "STARTING" | "AUTHENTICATING" | "LISTING_GROUPS" | "FETCHING_GROUPS" | "VALIDATING" | "UPLOADING";

const STEPS: Array<{ title: string; phases: Phase[] }> = [
  { title: "Preparando o computador", phases: ["PENDING", "STARTING"] },
  { title: "Entrando na Servopa", phases: ["AUTHENTICATING"] },
  { title: "Pesquisando os grupos", phases: ["LISTING_GROUPS"] },
  { title: "Extraindo as tabelas", phases: ["FETCHING_GROUPS"] },
  { title: "Conferindo e publicando", phases: ["VALIDATING", "UPLOADING"] },
];

/** Faixa da barra (em %) de cada etapa: começo e teto até o próximo sinal real. */
const RANGES: Record<Phase, [number, number]> = {
  PENDING: [0, 4],
  STARTING: [4, 9],
  AUTHENTICATING: [9, 17],
  LISTING_GROUPS: [17, 24],
  FETCHING_GROUPS: [24, 92],
  VALIDATING: [92, 99],
  UPLOADING: [95, 99],
};

function readProgress(run: RobotRun): { phase: Phase; completed: number; total: number; message?: string } {
  if (run.status === "PENDING") return { phase: "PENDING", completed: 0, total: 0 };
  const value = run.progress && typeof run.progress === "object" ? (run.progress as Record<string, unknown>) : {};
  const phase = typeof value.phase === "string" && value.phase in RANGES ? (value.phase as Phase) : "STARTING";
  return {
    phase,
    completed: typeof value.completed === "number" ? value.completed : 0,
    total: typeof value.total === "number" ? value.total : 0,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

function groupNumber(message: string | undefined) {
  return message?.match(/(\d{3,5})/)?.[1];
}

function activityMessages(run: RobotRun, workerOnline: boolean): string[] {
  const progress = readProgress(run);
  switch (progress.phase) {
    case "PENDING":
      if (!workerOnline) return ["Nenhum computador com o robô ligado agora", "A atualização começa assim que um computador ligar"];
      if (run.attempts > 0 && run.nextAttemptAt) {
        const at = new Date(run.nextAttemptAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return [`Nova tentativa às ${at}`, "A Servopa não respondeu como esperado na última vez", "O robô tenta de novo sozinho"];
      }
      return ["Chamando um computador disponível…", "Aguardando o robô responder…", "Reservando a atualização para um computador…"];
    case "STARTING":
      return ["Computador conectado, abrindo o robô…", "Preparando o navegador…", "Carregando a sessão da Servopa…"];
    case "AUTHENTICATING":
      return ["Abrindo o painel de vendas da Servopa…", "Passando pela verificação de segurança…", "Entrando com o acesso da Reobote…", "Carregando o menu de grupos…"];
    case "LISTING_GROUPS":
      return progress.completed === 0
        ? ["Pesquisando grupos de imóveis…", "Lendo a lista de grupos…"]
        : ["Pesquisando grupos de veículos e móveis…", "Lendo a quantidade de grupos…", "Separando os grupos com vagas…"];
    case "FETCHING_GROUPS": {
      const group = groupNumber(progress.message);
      const counter = progress.total ? ` (${progress.completed} de ${progress.total})` : "";
      return [
        group ? `Lendo o grupo ${group}${counter}…` : `Lendo os grupos${counter}…`,
        "Copiando as taxas de administração…",
        group ? `Extraindo as parcelas do grupo ${group}…` : "Extraindo as parcelas…",
        "Conferindo créditos e seguros…",
        "Anotando vagas e próxima assembleia…",
      ];
    }
    case "VALIDATING":
    case "UPLOADING":
      return ["Conferindo cada valor com as regras da Servopa…", "Comparando com as tabelas atuais…", "Publicando as tabelas no CRM…", "Quase lá…"];
  }
}

function realPercent(run: RobotRun) {
  const progress = readProgress(run);
  const [start, end] = RANGES[progress.phase];
  if (progress.phase === "FETCHING_GROUPS" && progress.total > 0) {
    return start + ((end - start) * progress.completed) / progress.total;
  }
  return start;
}

/** Até onde a barra pode "andar sozinha" antes do próximo sinal real. */
function capPercent(run: RobotRun) {
  const progress = readProgress(run);
  const [start, end] = RANGES[progress.phase];
  if (progress.phase === "FETCHING_GROUPS" && progress.total > 0) {
    return Math.min(end, start + ((end - start) * (progress.completed + 4)) / progress.total);
  }
  return end - 0.5;
}

function elapsedLabel(from: string | Date | number, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(from).getTime()) / 1_000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

/** Frase da atividade atual: troca a cada ~2,6 s, com os "três pontinhos" de quem está trabalhando. */
function ActivityLine({ messages }: { messages: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const rotate = window.setInterval(() => setIndex((value) => value + 1), 2_600);
    return () => window.clearInterval(rotate);
  }, []);
  const message = messages.length ? messages[index % messages.length].replace(/…$/, "") : "";
  return (
    <p className="mb-3 flex min-h-5 items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
      <span key={index % messages.length} className="animate-step-slide-in">{message}</span>
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="animate-typing-bounce h-1 w-1 rounded-full bg-brand" style={{ "--dot-delay": `${delay}ms` } as CSSProperties} />
        ))}
      </span>
    </p>
  );
}

export function RobotProgress({
  run,
  workerOnline,
  result,
  onDismiss,
  onCancel,
}: {
  /** Execução em andamento (PENDING/RUNNING) — ou null quando só mostra o resultado. */
  run: RobotRun | null;
  workerOnline: boolean;
  /** Resultado da execução que acabou de terminar nesta tela. */
  result: RobotResult | null;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [shown, setShown] = useState(() => (run ? realPercent(run) : 100));
  const [now, setNow] = useState(() => Date.now());
  const progress = run ? readProgress(run) : null;
  const phase = progress?.phase ?? null;

  useEffect(() => {
    if (!run) return;
    const tick = window.setInterval(() => {
      setNow(Date.now());
      // A barra nunca volta e nunca passa do teto da etapa atual.
      setShown((previous) => {
        const floor = realPercent(run);
        const cap = capPercent(run);
        const base = Math.max(previous, floor);
        return base >= cap ? base : Math.min(cap, base + Math.max(0.05, (cap - base) * 0.04));
      });
    }, 500);
    return () => window.clearInterval(tick);
  }, [run]);

  const percent = run ? Math.round(shown) : 100;
  const messages = run ? activityMessages(run, workerOnline) : [];
  const currentStep = phase ? STEPS.findIndex((step) => step.phases.includes(phase)) : STEPS.length;
  const failed = result?.tone === "danger";

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[23rem]" role="status" aria-live="polite">
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${result ? (failed ? "bg-red-50 text-red-600 dark:bg-red-950/50" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50") : "bg-brand/10 text-brand"}`}>
            {result ? (failed ? <XCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />) : <Bot className="h-5 w-5" />}
            {!result && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-brand/60" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {result ? (failed ? "A atualização não terminou" : "Tabelas atualizadas") : "Robô atualizando as tabelas"}
            </p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {result
                ? result.headline
                : run?.status === "PENDING"
                  ? "Na fila"
                  : `${percent}% · ${elapsedLabel(run?.startedAt ?? run?.createdAt ?? now, now)}`}
            </p>
          </div>
          {result ? (
            <button type="button" onClick={onDismiss} className="icon-btn" aria-label="Fechar"><X className="h-4 w-4" /></button>
          ) : (
            <button type="button" onClick={() => setCollapsed((value) => !value)} className="icon-btn" aria-label={collapsed ? "Mostrar detalhes" : "Recolher"}>
              {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>

        {!result && (
          <div className="h-1 bg-neutral-100 dark:bg-neutral-800">
            <div className="h-full bg-brand transition-[width] duration-500 ease-out" style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
        )}

        {result && result.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
            {result.chips.map((chip) => (
              <span key={chip} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{chip}</span>
            ))}
          </div>
        )}

        {!result && !collapsed && (
          <div className="px-4 pb-4 pt-3">
            {/* `key` pela etapa: a frase volta para a primeira quando a etapa muda. */}
            <ActivityLine key={phase} messages={messages} />

            <ol className="space-y-2">
              {STEPS.map((step, index) => {
                const done = index < currentStep;
                const active = index === currentStep;
                return (
                  <li key={step.title} className="flex items-center gap-2.5 text-sm">
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-700" />
                    )}
                    <span className={done ? "text-neutral-500 dark:text-neutral-400" : active ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-400 dark:text-neutral-500"}>
                      {step.title}
                    </span>
                    {active && phase === "FETCHING_GROUPS" && progress && progress.total > 0 && (
                      <span className="ml-auto text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{progress.completed} de {progress.total} grupos</span>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <span>Pode continuar usando o CRM normalmente.</span>
              <button type="button" onClick={onCancel} className="font-medium text-red-600 hover:underline dark:text-red-400">Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
