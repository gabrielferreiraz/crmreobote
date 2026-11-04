"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { CurrencyInput } from "@/components/currency-input";
import { ContactConflictNotice, type ContactConflict } from "@/components/contact-conflict-notice";
import { Select } from "@/components/select";
import { LoadingDots } from "@/components/loading-dots";

/** Mesmo formato do 409 de duplicidade (ver GET /api/contacts/[id]/ownership). */
type OwnershipConflict = ContactConflict;

type Stage = { id: string; name: string; order: number };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };
type CreditTypeOption = { id: string; label: string };
type JobTitleOption = { id: string; label: string };

/**
 * Cadastro rápido de negócio a partir de uma conversa de WhatsApp — dois
 * modos, decididos por `existingContactId`:
 *
 *  - AUSENTE ("WhatsApp Geral", thread ainda sem nenhum Contact): cria o
 *    Contact e, em seguida, o Deal na primeira etapa do funil — duas
 *    chamadas encadeadas, mesmo padrão já usado em QuickCreateContactModal +
 *    NewDealDialog. A conversa se vincula sozinha ao Contact recém-criado
 *    (linkOrphanThreadsForOrganization, disparado dentro de POST
 *    /api/contacts), então não precisamos repetir esse passo aqui.
 *  - PRESENTE (contato já existe, com ou sem negócio aberto): pula direto
 *    pra criação do negócio — nada de nome/WhatsApp/cargo pra preencher de
 *    novo, o contato já está completo. Existe porque um consultor pode
 *    querer registrar uma NOVA venda pro MESMO cliente que já tem negócio
 *    (relatado: "cliente já tem negócio, mas quer dar ganho em outro") —
 *    antes disso só existia o caminho "sem negócio nenhum ainda", então tudo
 *    que já tinha UM negócio ficava sem jeito de abrir um segundo direto do
 *    WhatsApp.
 *
 * Responsável do Contact/Deal criados aqui é SEMPRE quem está logado
 * (currentUserId), nunca derivado da conversa — achado real: o "Responsável"
 * que a lista de conversas calcula (ver ownerId em
 * lib/whatsapp/conversations.ts) é o dono de um negócio ABERTO qualquer já
 * existente do contato, que pode ser um consultor totalmente diferente de
 * quem está conversando agora (contato antigo, negócio de outro produto).
 * Usar esse valor aqui fazia o negócio NOVO nascer pro consultor errado, em
 * silêncio — quem clicava "Criar negócio" não desconfiava, só descobria
 * depois que o negócio "sumiu" (estava lá, só que com outro dono). Mesmo
 * padrão de responsável de todo outro cadastro rápido do CRM (ver ownerId em
 * new-deal-dialog.tsx / quick-register-deal-form.tsx: sempre quem está
 * logado por padrão).
 *
 * Quando o contato já existe e o responsável DELE é outra pessoa, mostra a
 * mesma notificação de "de quem é esse lead" usada no cadastro normal (ver
 * ContactConflictNotice) — só informa e oferece assumir/solicitar o
 * CONTATO; não bloqueia criar o negócio (que continua saindo sempre no nome
 * de quem está criando).
 */
export function QuickAddDealPanel({
  onClose,
  suggestedName,
  phoneFormatted,
  currentUserId,
  existingContactId,
  onCreated,
}: {
  onClose: () => void;
  suggestedName: string;
  phoneFormatted: string;
  /** Quem está logado — SEMPRE o responsável do negócio (e do contato, se for novo) criado aqui. */
  currentUserId: string;
  existingContactId?: string;
  onCreated: (result: { contactId: string; deal: { id: string; name: string } }) => void;
}) {
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [creditTypes, setCreditTypes] = useState<CreditTypeOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState(suggestedName);
  const [value, setValue] = useState("");
  const [creditType, setCreditType] = useState("");
  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([]);
  const [jobTitle, setJobTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ContactConflict | null>(null);
  const [claiming, setClaiming] = useState(false);
  // "De quem é esse contato?" (ver GET /api/contacts/[id]/ownership) —
  // só informativo, nunca trava "Criar negócio" (o negócio sempre nasce de
  // quem está criando, ver docstring do componente).
  const [ownershipConflict, setOwnershipConflict] = useState<OwnershipConflict | null>(null);

  useEffect(() => {
    if (!existingContactId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/contacts/${existingContactId}/ownership`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as OwnershipConflict;
        if (!data.ownedByMe) setOwnershipConflict(data);
      } catch {
        // Falhou? O painel segue funcionando sem o aviso — não é bloqueante.
      }
    })();
    return () => controller.abort();
  }, [existingContactId]);

  useEffect(() => {
    // Fechar o painel antes das listas chegarem cancela as buscas (mesmo
    // padrão do resto do app) — e abort nunca vira mensagem de erro.
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/pipelines", { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data: Pipeline[] = await res.json();
        setPipelines(data);
        const preferred = data.find((p) => p.isDefault) ?? data[0];
        if (preferred) setPipelineId(preferred.id);
      } catch {
        if (!controller.signal.aborted) setLoadError("Não foi possível carregar os funis.");
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/credit-types", { signal: controller.signal });
        if (!res.ok) return;
        setCreditTypes((await res.json()) as CreditTypeOption[]);
      } catch {
        // lista vazia é um degrau aceitável aqui — o campo continua opcional
        // (vale também pro abort, quando o painel fecha antes de carregar)
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // Contato já existe (existingContactId) = já tem cargo cadastrado, esse
    // campo nem aparece no formulário — não precisa buscar a lista.
    if (existingContactId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/job-titles", { signal: controller.signal });
        if (!res.ok) return;
        setJobTitles((await res.json()) as JobTitleOption[]);
      } catch {
        // sem lista carregada, o Select some vazio — POST /api/contacts ainda
        // barra no servidor se o cargo não vier preenchido
      }
    })();
    return () => controller.abort();
  }, [existingContactId]);

  const selectedPipeline = pipelines?.find((p) => p.id === pipelineId) ?? null;
  const firstStage = selectedPipeline?.stages.slice().sort((a, b) => a.order - b.order)[0] ?? null;

  async function createOrClaimContact(claimContactId?: string): Promise<{ id: string } | null> {
    const contactRes = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // responsavelId: currentUserId — mesmo dono já usado pro Deal logo
      // abaixo (sempre quem está logado, ver docstring do componente). Sem
      // isso o Contact nascia SEM responsável (POST /api/contacts grava null
      // quando a chave não vem), mesmo o Deal vinculado tendo o dono certo —
      // daí o relato "responsável não vem automático": o negócio aparecia
      // certo no Pipeline, mas o cliente sumia da lista de Clientes do
      // consultor (contactScopeWhere só mostra pra Membro os contatos onde
      // ele é responsavelId). Ignorado no branch de claimContactId (server
      // sempre força pra quem está reivindicando, ver comentário em
      // app/api/contacts/route.ts) — inofensivo mandar mesmo assim.
      body: JSON.stringify({
        name,
        whatsapp: phoneFormatted,
        jobTitle,
        responsavelId: currentUserId,
        ...(claimContactId ? { claimContactId } : {}),
      }),
    });
    const contact = await contactRes.json().catch(() => ({}));
    if (!contactRes.ok) {
      if (contact.conflict) {
        setConflict(contact.conflict as ContactConflict);
      } else {
        setError(contact.error ?? "Erro ao criar contato");
      }
      return null;
    }
    return contact as { id: string };
  }

  async function createDealForContact(contactId: string): Promise<void> {
    const dealRes = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId: selectedPipeline!.id,
        stageId: firstStage!.id,
        contactId,
        value: value ? Number(value) : undefined,
        creditType: creditType || undefined,
        ownerId: currentUserId,
      }),
    });
    const deal = await dealRes.json().catch(() => ({}));
    if (!dealRes.ok) {
      setError(deal.error ?? "Contato criado, mas houve erro ao criar o negócio");
      return;
    }

    onCreated({ contactId, deal: { id: deal.id, name: deal.name } });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstStage) return;
    setSubmitting(true);
    setError(null);
    setConflict(null);

    try {
      const contactId = existingContactId ?? (await createOrClaimContact())?.id;
      if (!contactId) return;
      await createDealForContact(contactId);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClaim() {
    if (!conflict || !firstStage) return;
    setClaiming(true);
    setError(null);
    try {
      const contact = await createOrClaimContact(conflict.contactId);
      if (!contact) return;
      setConflict(null);
      await createDealForContact(contact.id);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <SidePanel onClose={onClose} title={existingContactId ? "Novo negócio" : "Adicionar negócio"}>
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col space-y-3">
        {!existingContactId && (
          <>
            <div className="space-y-1">
              <label className="field-label">Nome</label>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input"
                placeholder="Nome do contato"
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">WhatsApp</label>
              <input value={phoneFormatted} disabled className="field-input opacity-70" />
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
          </>
        )}

        {pipelines && pipelines.length > 1 && (
          <div className="space-y-1">
            <label className="field-label">Funil</label>
            <Select
              value={pipelineId}
              onChange={setPipelineId}
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="field-label">Valor</label>
          <CurrencyInput value={value} onChange={setValue} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Tipo de crédito</label>
          <Select
            value={creditType}
            onChange={setCreditType}
            options={[
              { value: "", label: "—" },
              ...creditTypes.map((c) => ({ value: c.label, label: c.label })),
            ]}
          />
        </div>

        <p className="text-xs text-neutral-400 dark:text-neutral-500">Responsável: Você</p>

        {/* O contato já existia e já é de outra pessoa — só informa (e
            oferece assumir/solicitar o CONTATO); não impede criar o negócio,
            que sai sempre no seu nome (ver docstring do componente). */}
        {ownershipConflict && <ContactConflictNotice conflict={ownershipConflict} />}

        {conflict && (
          <ContactConflictNotice
            conflict={conflict}
            onClaim={conflict.claimable ? handleClaim : undefined}
            claiming={claiming}
            onUpdateExisting={handleClaim}
            updatingExisting={claiming}
          />
        )}
        {(error || loadError) && (
          <p className="text-sm text-red-600 dark:text-red-400">{error ?? loadError}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || (!existingContactId && (!name.trim() || !jobTitle)) || !firstStage}
            className="btn-primary"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
            {submitting ? (
              <span className="inline-flex items-center gap-1">
                Criando
                <LoadingDots />
              </span>
            ) : (
              "Criar negócio"
            )}
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
