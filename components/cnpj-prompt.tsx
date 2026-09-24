"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle2 } from "lucide-react";
import { Modal } from "./modal";
import { LoadingDots } from "./loading-dots";

/** Mesma chave/estratégia do aviso de notificações (push-notifications-prompt.tsx):
 * sessionStorage, não localStorage — "configurar depois" vale pra esta sessão,
 * e o aviso volta na próxima. É de propósito: a empresa quer o time inteiro
 * cadastrado, e quem dispensa uma vez não deveria sumir do radar pra sempre.
 * Quem cadastra de verdade nunca mais vê (o GET passa a devolver a PJ). */
const DISMISS_KEY = "cnpj_prompt_dismissed";

/** 00.000.000/0000-00 conforme digita — só visual, o que vai pra API é
 * sempre só dígito (a rota normaliza de novo do lado de lá). */
function maskCnpj(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

type Step = "ask" | "typing";

export function CnpjPrompt() {
  const [open, setOpen] = useState(false);
  /** "Configurar depois" não faz o assunto sumir: fecha o modal e deixa este
   * lembrete encostado no canto, que acompanha a pessoa pelo CRM inteiro até
   * o CNPJ ser cadastrado (pedido explícito). Some de vez no salvar. */
  const [reminder, setReminder] = useState(false);
  const [step, setStep] = useState<Step>("ask");
  const [input, setInput] = useState("");
  /** Nome fantasia devolvido pela Receita — é o que vai virar o nome da
   * pessoa no Ranking da TV, então aparece aqui pra conferência antes de
   * gravar. */
  const [foundName, setFoundName] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cnpj");
        if (!res.ok) return; // sem PJ cadastrada não é erro; erro de verdade = fica quieto
        const data = await res.json();
        // Já tem PJ: nada a pedir.
        if (data.company) return;
        if (!cancelled) {
          // Mesmo respiro do aviso de notificações — abrir junto com a página
          // atropela quem só queria abrir o CRM e olhar uma coisa.
          setTimeout(() => !cancelled && setOpen(true), 1500);
        }
      } catch {
        // Rede fora, rota com problema: este aviso é secundário, nunca deve
        // virar um erro na cara de quem só queria usar o CRM.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "true");
    setOpen(false);
    setReminder(true);
  }

  /** Volta do lembrete pro modal já no campo de digitar — quem clicou ali já
   * decidiu cadastrar, repetir a pergunta inicial seria um passo à toa. */
  function reopen() {
    setReminder(false);
    setStep("typing");
    setOpen(true);
  }

  /** Consulta assim que os 14 dígitos estão completos — evita um botão
   * "buscar" a mais no caminho de quem só quer colar o número e seguir. */
  async function handleChange(value: string) {
    setInput(maskCnpj(value));
    setFoundName(null);
    setError(null);

    const digits = value.replace(/\D/g, "");
    if (digits.length !== 14) return;

    setLooking(true);
    try {
      const res = await fetch(`/api/cnpj?cnpj=${digits}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível consultar esse CNPJ.");
        return;
      }
      setFoundName(data.name);
    } catch {
      setError("Falha de conexão ao consultar a Receita.");
    } finally {
      setLooking(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/cnpj", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: input.replace(/\D/g, "") }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível salvar.");
        return;
      }
      setOpen(false);
      // Cadastrou: o assunto se encerra nesta sessão, lembrete incluído.
      setReminder(false);
    } catch {
      setError("Falha de conexão ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (!open && reminder) {
    return (
      <div
        role="status"
        aria-live="polite"
        // Canto ESQUERDO de propósito: o direito já é disputado pela dica de
        // produtividade (components/productivity-tip.tsx, z-40) e pelos avisos
        // de desfazer (components/undo-provider.tsx, z-[70]) — os dois em
        // bottom-4 right-4. Como este lembrete fica na tela até a pessoa
        // cadastrar, encostar ali garantiria sobreposição em vez de um
        // encontro eventual. bottom maior no celular pra não cobrir a barra
        // de navegação, que só existe abaixo de sm.
        className="surface-glass-panel fixed bottom-20 left-4 z-40 w-[calc(100%-2rem)] max-w-xs rounded-2xl p-3 shadow-2xl ring-1 ring-black/5 sm:bottom-4 dark:ring-white/10"
        style={{ animation: "panel-pop-in 380ms var(--ease-spring)" }}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light dark:bg-[var(--brand-subtle)]">
            <Building2 className="h-4 w-4 text-brand" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">Falta cadastrar seu CNPJ</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Na TV você ainda aparece com seu nome pessoal.
            </p>
            <button type="button" onClick={reopen} className="btn-primary mt-2 w-full text-xs">
              Cadastrar agora
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <Modal onClose={dismiss}>
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light dark:bg-[var(--brand-subtle)]">
          <Building2 className="h-4 w-4 text-brand" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Cadastre o CNPJ da sua empresa
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            O nome da sua empresa passa a aparecer no lugar do seu nome no Ranking do mês da TV.
          </p>
        </div>
      </div>

      {step === "typing" && (
        <div className="mt-4">
          <label className="field-label" htmlFor="cnpj-prompt-input">
            CNPJ
          </label>
          <input
            id="cnpj-prompt-input"
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            inputMode="numeric"
            autoFocus
            placeholder="00.000.000/0000-00"
            className="field-input mt-1 w-full"
          />

          {looking && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              Consultando a Receita
              <LoadingDots />
            </p>
          )}

          {/* O nome que vai pra TV — mostrado antes de gravar pra pessoa
              conferir que é a empresa dela mesmo. */}
          {foundName && !looking && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2} />
              <div className="min-w-0">
                <p className="text-[11px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                  Vai aparecer na TV como
                </p>
                <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100" title={foundName}>
                  {foundName}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={dismiss} className="btn-ghost text-xs">
          Configurar depois
        </button>
        {step === "ask" ? (
          <button type="button" onClick={() => setStep("typing")} className="btn-primary text-xs">
            Colocar meu CNPJ
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={!foundName || saving || looking}
            className="btn-primary text-xs"
          >
            {saving ? (
              <span className="inline-flex items-center gap-1">
                Salvando
                <LoadingDots />
              </span>
            ) : (
              "Salvar"
            )}
          </button>
        )}
      </div>
    </Modal>
  );
}
