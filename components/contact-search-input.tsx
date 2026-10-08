"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { Search, X, UserPlus, UserCheck, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";
import { ContactConflictNotice, type ContactConflict } from "@/components/contact-conflict-notice";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { useFloatingDropdown } from "@/lib/use-floating-dropdown";
import { readQuickContactDraft, writeQuickContactDraft, clearQuickContactDraft } from "@/lib/quick-contact-draft";

type ContactOption = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** undefined = endpoint não mandou (ex.: alguém selecionando um contato já
   * escolhido antes, fora da busca) — tratado igual a "não sei", nunca
   * mostra nem badge de dono nem de órfão. null = contato existe mas não tem
   * responsável (pode ser reivindicado ao selecionar, ver select() abaixo). */
  responsavelId?: string | null;
  responsavel?: { id: string; name: string } | null;
};
type JobTitleOption = { id: string; label: string };
type LeadSourceOption = { id: string; label: string };

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
  const { data: session } = useSession();
  const currentUserId = session?.user.id;

  const coords = useFloatingDropdown({
    open: dropdownOpen,
    onClose: () => setOpen(false),
    triggerRef,
    panelRef,
  });

  useEffect(() => {
    if (!query.trim()) return;
    // Mesmo raciocínio do command-palette: cancela a busca anterior ao
    // digitar de novo — economiza a consulta e evita a resposta atrasada de
    // um termo antigo sobrescrever o resultado do termo atual.
    const controller = new AbortController();
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        // includeOrphans: além dos próprios contatos, também acha contato
        // sem responsável nenhum — pra poder reivindicar ao selecionar (ver
        // select() abaixo). Só tem efeito de verdade pra quem já é limitado
        // aos próprios contatos (MEMBER); OWNER/MANAGER não mudam de
        // comportamento (ver app/api/contacts/route.ts).
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(query)}&includeOrphans=1`, { signal: controller.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        // Falha de rede: cai no estado "nenhum contato encontrado" em vez de
        // travar em "Buscando..." pra sempre. Cancelamento NÃO entra aqui —
        // limpar a lista por causa de um abort apagaria o resultado que a
        // busca seguinte ainda vai preencher.
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query]);

  async function select(c: ContactOption) {
    // Contato sem responsável, selecionado pra virar contato de um negócio/
    // tarefa novo: pedido explícito do usuário é que vire dele automaticamente
    // (senão fica órfão pra sempre — ninguém mais volta aqui só pra
    // "adotar" um contato à toa). PUT /api/contacts/[id] com responsavelId já
    // aceita isso de qualquer papel; pra MEMBER, além disso, QUALQUER edição
    // no contato já reivindica sozinho (ver rota) — mandar explícito aqui
    // funciona igual pros dois casos, sem precisar diferenciar papel no
    // cliente. Só dispara com currentUserId resolvido (useSession já
    // carregado) — sem isso, segue sem reivindicar (fica pra próxima edição).
    if (c.responsavelId === null && currentUserId) {
      try {
        await fetch(`/api/contacts/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responsavelId: currentUserId }),
        });
      } catch {
        // Falha ao reivindicar não pode travar a seleção do contato pro
        // negócio/tarefa — pior caso, o contato só continua órfão.
      }
    }
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
            //
            // surface-glass-dense (não surface-glass) — relato ao vivo: essa
            // lista abre flutuando por cima dos próprios campos do modal
            // "Novo negócio" atrás dela, e o .surface-glass comum (62% de
            // tinta) deixava o texto desses campos ("Valor", "Tipo de
            // crédito"...) vazando por trás dos nomes de contato, ilegível.
            // O <Select> padrão do sistema já resolveu exatamente esse mesmo
            // problema usando surface-glass-dense (90% de tinta) pra própria
            // lista de opções — este componente só tinha ficado de fora
            // quando aquele ajuste foi feito, por ser um dropdown escrito à
            // mão (não usa <Select>), não por decisão consciente de manter
            // mais transparente.
            className="surface-glass-dense animate-pop-in scrollbar-thin fixed z-[60] overflow-y-auto rounded-md pb-1 shadow-lg"
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
              maxHeight: Math.min(224, coords.maxHeight),
            }}
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
                  results.map((c) => {
                    // undefined = endpoint não mandou essa info (não deveria
                    // acontecer na busca de verdade, só por segurança) — nesse
                    // caso não afirma nada, nem dono nem órfão.
                    const belongsToOther = !!c.responsavelId && c.responsavelId !== currentUserId;
                    const isOrphan = c.responsavelId === null;
                    return (
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
                        {belongsToOther && (
                          <span className="mt-0.5 inline-flex items-center gap-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
                            <UserCheck className="h-3 w-3 shrink-0" strokeWidth={2} />
                            De {c.responsavel?.name ?? "outro consultor"}
                          </span>
                        )}
                        {isOrphan && (
                          <span className="mt-0.5 inline-flex items-center gap-1 truncate text-xs font-medium text-amber-600 dark:text-amber-400">
                            <UserPlus className="h-3 w-3 shrink-0" strokeWidth={2} />
                            Sem responsável — vira seu ao selecionar
                          </span>
                        )}
                      </button>
                    );
                  })
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
  // Rascunho de um fechamento acidental anterior tem PRIORIDADE sobre o
  // palpite inicial (kind/initialQuery) — quem já estava digitando algo
  // quando fechou sem querer importa mais que um palpite novo a partir da
  // busca atual. Lido uma vez só, na montagem (useState com função).
  const [draftRestored] = useState(() => readQuickContactDraft());
  const [name, setName] = useState(draftRestored?.name || (kind === "name" ? initialQuery : ""));
  const [email, setEmail] = useState(draftRestored?.email || (kind === "email" ? initialQuery : ""));
  const [whatsapp, setWhatsapp] = useState(draftRestored?.whatsapp || (kind === "phone" ? initialQuery : ""));
  const [phone, setPhone] = useState(draftRestored?.phone ?? "");
  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([]);
  const [jobTitle, setJobTitle] = useState(draftRestored?.jobTitle ?? "");
  const [sources, setSources] = useState<LeadSourceOption[]>([]);
  const [source, setSource] = useState(draftRestored?.source ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ContactConflict | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [jobTitlesRes, sourcesRes] = await Promise.all([
          fetch("/api/job-titles", { signal: controller.signal }),
          fetch("/api/lead-sources", { signal: controller.signal }),
        ]);
        if (jobTitlesRes.ok) setJobTitles((await jobTitlesRes.json()) as JobTitleOption[]);
        if (sourcesRes.ok) setSources((await sourcesRes.json()) as LeadSourceOption[]);
      } catch {
        // sem lista carregada, os Select somem vazios — POST /api/contacts ainda
        // barra no servidor se o cargo não vier preenchido (origem é opcional).
        // Vale também pro abort (fechou antes de carregar), que não é erro.
      }
    })();
    return () => controller.abort();
  }, []);

  // Salva a cada mudança — sem debounce (campos pequenos, sessionStorage é
  // local e instantâneo). É o que sobrevive se a pessoa fechar sem querer
  // (clique fora / Esc, ver dismissKeepingDraft abaixo).
  useEffect(() => {
    writeQuickContactDraft({ name, whatsapp, phone, email, jobTitle, source });
  }, [name, whatsapp, phone, email, jobTitle, source]);

  /** Fecha sem apagar o rascunho — Modal chama isto pra clique fora/Esc. */
  function dismissKeepingDraft() {
    onClose();
  }

  /** X e "Cancelar" — únicas ações que significam "não quero mais criar isto". */
  function dismissClearingDraft() {
    clearQuickContactDraft();
    onClose();
  }

  async function submitContact(claimContactId?: string) {
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email || undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        jobTitle,
        source: source || undefined,
        ...(claimContactId ? { claimContactId } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (data.conflict) {
        setConflict(data.conflict as ContactConflict);
      } else {
        setError(data.error ?? "Erro ao criar contato");
      }
      return;
    }

    setConflict(null);
    // Contato criado de verdade — o rascunho não serve mais pra próxima vez.
    clearQuickContactDraft();
    onCreated({ id: data.id, name: data.name, email: data.email, phone: data.phone });
  }

  async function handleSubmit() {
    if (loading || !name.trim() || !jobTitle) return;
    setLoading(true);
    setError(null);
    setConflict(null);
    try {
      await submitContact();
    } catch {
      setError("Falha de conexão ao criar contato. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    if (!conflict) return;
    setClaiming(true);
    setError(null);
    try {
      await submitContact(conflict.contactId);
    } catch {
      setError("Falha de conexão ao criar contato. Tente novamente.");
    } finally {
      setClaiming(false);
    }
  }

  // Modal porta pro <body> (ver components/modal.tsx), mas isso só muda o
  // DOM — na árvore REACT este componente continua filho de quem abriu a
  // busca (negócio/tarefa), que normalmente já é um <form onSubmit>. Um
  // <form> aqui dentro faria o evento de submit (sintético, segue a árvore
  // React, não o DOM) borbulhar pro form de fora também. Por isso isto é um
  // <div> com envio manual (clique + Enter via onKeyDown), nunca um <form onSubmit>.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
    }
  }

  return (
    // onClose aqui é dismissKeepingDraft — clique fora/Esc mantêm o
    // rascunho; só o X (abaixo) e "Cancelar" (no rodapé) apagam de verdade.
    <Modal onClose={dismissKeepingDraft}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Novo contato</h2>
        <button
          type="button"
          onClick={dismissClearingDraft}
          className="icon-btn -mt-1 -mr-1 h-8 w-8 shrink-0"
          aria-label="Fechar e descartar"
          title="Fechar e descartar o que foi digitado"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="field-label">Cargo *</label>
            <Select
              value={jobTitle}
              onChange={setJobTitle}
              placeholder="Selecione o cargo"
              options={jobTitles.map((j) => ({ value: j.label, label: j.label }))}
            />
          </div>
          <div className="space-y-1">
            {/* Origem opcional aqui, igual ao resto do app (Clientes, editar
                contato) — sem isso, um contato criado por aqui (fluxo de
                "Novo negócio") só ganhava origem se alguém lembrasse de
                voltar depois em Clientes e preencher, o que pedido explícito
                do usuário quer evitar. */}
            <label className="field-label">Origem</label>
            <Select
              value={source}
              onChange={setSource}
              placeholder="Selecione a origem"
              options={sources.map((s) => ({ value: s.label, label: s.label }))}
            />
          </div>
        </div>

        {conflict && (
          <ContactConflictNotice
            conflict={conflict}
            onClaim={conflict.claimable ? handleClaim : undefined}
            claiming={claiming}
            onUpdateExisting={handleClaim}
            updatingExisting={claiming}
          />
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={dismissClearingDraft} className="btn-ghost">
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
