"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, UserPlus, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";

type ContactOption = { id: string; name: string; email?: string | null; phone?: string | null };
type JobTitleOption = { id: string; label: string };

function detectQueryKind(query: string): "email" | "phone" | "name" {
  const trimmed = query.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "email";
  const digits = trimmed.replace(/\D/g, "");
  const nonDigitNonPhoneChars = trimmed.replace(/[\d\s()+\-.]/g, "");
  if (digits.length >= 8 && nonDigitNonPhoneChars.length === 0) return "phone";
  return "name";
}

export function ContactSearchInput({
  value,
  selectedLabel,
  onChange,
  placeholder = "Buscar por nome, e-mail ou celular",
  autoFocus,
}: {
  value: string;
  selectedLabel?: string;
  onChange: (id: string, contact?: ContactOption) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [pickedLabel, setPickedLabel] = useState(selectedLabel ?? "");
  const [results, setResults] = useState<ContactOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quickCreateQuery, setQuickCreateQuery] = useState<string | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownOpen = open && !!query.trim();

  const coords = useFloatingDropdown({
    open: dropdownOpen,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
  });

  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(query)}`);
        if (res.ok && !cancelled) setResults(await res.json());
      } catch {
        // Falha de rede: cai no estado "nenhum contato encontrado" em vez de
        // travar em "Buscando..." pra sempre.
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  function select(c: ContactOption) {
    onChange(c.id, c);
    setPickedLabel(c.name);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function clear() {
    onChange("");
    setPickedLabel("");
    setQuery("");
  }

  if (value && pickedLabel) {
    return (
      <div className="field-input flex items-center justify-between gap-2">
        <span className="truncate text-neutral-900 dark:text-neutral-100">{pickedLabel}</span>
        <button
          type="button"
          onClick={clear}
          className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label="Trocar contato"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div ref={triggerRef} className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
        strokeWidth={2}
      />
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          const val = e.target.value;
          setQuery(val);
          if (!val.trim()) {
            setResults([]);
          }
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="field-input pl-8"
      />

      {dropdownOpen &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            // z-[60], não z-40: este dropdown é usado dentro de Modal (ex.:
            // "Novo negócio"), que tem seu próprio backdrop em z-50 — com
            // z-40 o dropdown (incluindo o botão "Adicionar") ficava coberto
            // pelo fundo do modal, e o clique caía no backdrop e fechava o
            // modal inteiro em vez de abrir a criação rápida de contato.
            className="surface-glass animate-pop-in scrollbar-thin fixed z-[60] max-h-56 overflow-y-auto rounded-md shadow-lg"
            style={{ top: coords.top, left: coords.left, width: coords.width }}
          >
            {loading ? (
              <p className="px-3 py-2 text-sm text-neutral-400 dark:text-neutral-500">Buscando...</p>
            ) : (
              <>
                {results.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-neutral-400 dark:text-neutral-500">
                    Nenhum contato encontrado.
                  </p>
                ) : (
                  results.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => select(c)}
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{c.name}</span>
                      {(c.email || c.phone) && (
                        <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {c.email ?? c.phone}
                        </span>
                      )}
                    </button>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => {
                    // Fecha o dropdown junto — senão ele fica flutuando por
                    // cima do modal de criação rápida que abre em seguida.
                    setOpen(false);
                    setQuickCreateQuery(query.trim());
                  }}
                  className="flex w-full items-center gap-2 border-t border-neutral-200 dark:border-neutral-800 px-3 py-2 text-left text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <UserPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  <span className="truncate">Adicionar &quot;{query.trim()}&quot;</span>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}

      {quickCreateQuery !== null && (
        <QuickCreateContactModal
          initialQuery={quickCreateQuery}
          onClose={() => setQuickCreateQuery(null)}
          onCreated={(c) => {
            setQuickCreateQuery(null);
            select(c);
          }}
        />
      )}
    </div>
  );
}

function QuickCreateContactModal({
  initialQuery,
  onClose,
  onCreated,
}: {
  initialQuery: string;
  onClose: () => void;
  onCreated: (contact: ContactOption) => void;
}) {
  const kind = detectQueryKind(initialQuery);
  const [name, setName] = useState(kind === "name" ? initialQuery : "");
  const [email, setEmail] = useState(kind === "email" ? initialQuery : "");
  const [whatsapp, setWhatsapp] = useState(kind === "phone" ? initialQuery : "");
  const [phone, setPhone] = useState("");
  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([]);
  const [jobTitle, setJobTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/job-titles");
        if (!res.ok) return;
        const data: JobTitleOption[] = await res.json();
        if (!cancelled) setJobTitles(data);
      } catch {
        // sem lista carregada, o Select some vazio — POST /api/contacts ainda
        // barra no servidor se o cargo não vier preenchido
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    if (loading || !name.trim() || !jobTitle) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone: phone || undefined,
          whatsapp: whatsapp || undefined,
          jobTitle,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Erro ao criar contato");
        return;
      }

      onCreated({ id: data.id, name: data.name, email: data.email, phone: data.phone });
    } catch {
      setError("Falha de conexão ao criar contato. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  // Esse modal renderiza dentro de <Modal>, que não usa portal — o DOM real
  // fica aninhado dentro do <form> de quem abriu a busca (negócio/tarefa).
  // Um <form> aqui dentro seria HTML inválido (form dentro de form) e o
  // submit por Enter/clique acabava também disparando o form de fora. Por
  // isso isto é um <div> com envio manual (clique + Enter via onKeyDown),
  // nunca um <form onSubmit>.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo contato</h2>
      <div onKeyDown={handleKeyDown} className="space-y-3">
        <div className="space-y-1">
          <label className="field-label">Nome</label>
          <input
            autoFocus={kind !== "name"}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="field-label">WhatsApp</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="field-input"
            />
          </div>
          <div className="space-y-1">
            <label className="field-label">Celular (nº 2)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="field-input" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="field-label">E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Cargo *</label>
          <Select
            value={jobTitle}
            onChange={setJobTitle}
            placeholder="Selecione o cargo"
            options={jobTitles.map((j) => ({ value: j.label, label: j.label }))}
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !jobTitle}
            className="btn-primary"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {loading ? (
              <span className="inline-flex items-center gap-1">
                Criando
                <LoadingDots />
              </span>
            ) : (
              "Criar"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
