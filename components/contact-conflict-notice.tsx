"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, Send, UserCheck } from "lucide-react";
import { trackUse } from "@/lib/feature-usage/track";

/**
 * Corpo do 409 de POST/PUT /api/contacts quando o telefone/WhatsApp já bate
 * com um contato existente (ver buildConflictPayload em
 * lib/contact-duplicate.ts). Três situações, nunca mais de uma:
 *
 * - claimable: pode ASSUMIR na hora, sem aprovação (`claimReason` diz por
 *   quê: sem responsável / responsável inativo / lead perdido há +3 meses —
 *   regra única em lib/lead-claim.ts).
 * - requestable: dono ATIVO cuidando do lead → só dá pra SOLICITAR (o dono
 *   recebe o pedido e aprova/recusa).
 * - ownedByMe: já é seu — nada pra assumir/solicitar, mas dá pra ATUALIZAR
 *   direto o OUTRO contato que está com esse número com os dados que a
 *   pessoa acabou de digitar (ver `onUpdateExisting` e o ramo isolado logo
 *   no início da função, com uma UI bem mais enxuta que os outros dois
 *   casos).
 *
 * Os campos além de `claimable` são opcionais só por compatibilidade com
 * respostas antigas; o servidor sempre manda todos.
 */
export type ContactConflict = {
  contactId: string;
  contactName: string;
  createdAt: string;
  responsavelName: string | null;
  claimable: boolean;
  claimReason?: "NO_OWNER" | "OWNER_INACTIVE" | "LOST_OVER_3_MONTHS" | null;
  lostAt?: string | null;
  requestable?: boolean;
  ownedByMe?: boolean;
};

type ActionResult =
  | { kind: "claimed"; reason: string | null }
  | { kind: "requested" }
  | { kind: "already-requested" }
  | { kind: "already-yours" }
  | { kind: "error"; message: string };

function formatDate(raw: string): string {
  return new Date(raw).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Frase que explica POR QUE o lead pode ser assumido (ou por que só dá pra solicitar). */
function explanation(conflict: ContactConflict): string {
  if (conflict.claimable) {
    if (conflict.claimReason === "LOST_OVER_3_MONTHS") {
      return conflict.lostAt
        ? `Este lead está perdido desde ${formatDate(conflict.lostAt)} (mais de 3 meses) — você pode assumi-lo.`
        : "Este lead está perdido há mais de 3 meses — você pode assumi-lo.";
    }
    if (conflict.claimReason === "OWNER_INACTIVE" || (!conflict.claimReason && conflict.responsavelName)) {
      return "O responsável anterior não está mais ativo — você pode assumir este contato.";
    }
    return "Este contato não tem responsável — você pode assumi-lo.";
  }
  const owner = conflict.responsavelName ?? "o responsável";
  return `Este lead está com ${owner}, que ainda cuida dele. Você pode solicitá-lo — ${owner} recebe o pedido e decide.`;
}

/**
 * Mostrado no lugar do formulário/erro genérico quando POST ou PUT de
 * /api/contacts responde 409 com `conflict`.
 *
 * `onClaim` (opcional) só existe nos formulários de CADASTRO: assumir ali
 * significa reenviar o mesmo formulário com claimContactId (vira UPDATE do
 * contato existente, ver POST /api/contacts). Sem ele — caso da EDIÇÃO de um
 * contato, onde os dados do formulário pertencem a OUTRO contato — assumir é
 * só reatribuir o lead: POST /api/lead-requests, que decide sozinho, pelo
 * estado atual no banco, se assume na hora ou cria um pedido (nunca confia
 * no que esta tela achava).
 */
export function ContactConflictNotice({
  conflict,
  onClaim,
  claiming,
  onUpdateExisting,
  updatingExisting,
}: {
  conflict: ContactConflict;
  onClaim?: () => void;
  claiming?: boolean;
  /** Só usado no ramo ownedByMe (ver abaixo) — reenvia os dados que a pessoa
   * acabou de digitar pro contato EXISTENTE (o dono do número), em vez de só
   * apontar um link. Em telas de CADASTRO, é o MESMO handler de `onClaim`
   * (a operação já é essa: POST com claimContactId vira UPDATE do contato
   * existente — reivindicar ownership é só um no-op quando já é seu). Em
   * telas de EDIÇÃO, é um handler próprio (PUT no id do contato existente
   * com os dados do formulário, não no id que estava sendo editado). */
  onUpdateExisting?: () => void;
  updatingExisting?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  // ownedByMe é um caso à parte, bem mais simples que os outros dois: nada
  // pra assumir/solicitar (já é dela). Pedido explícito do usuário: em vez
  // de só informar e deixar a pessoa se virar, oferece direto "Atualizar
  // contato?" — reenvia o que ela digitou pro contato que JÁ tem esse
  // número, em vez de só um link "vá lá e resolva você mesma" (beco sem
  // saída antes: "já é seu" e nenhuma ação possível, relato real de
  // consultora tentando corrigir um WhatsApp digitado errado). Quando o
  // chamador não implementa onUpdateExisting ainda, cai pro link sozinho.
  if (conflict.ownedByMe) {
    return (
      <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
        <p className="flex items-start gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          Esse número já é de{" "}
          <Link href={`/clientes/${conflict.contactId}`} className="underline">
            {conflict.contactName}
          </Link>
          , outro contato seu
        </p>
        {onUpdateExisting ? (
          <>
            <p className="text-xs text-amber-800 dark:text-amber-400">Atualizar esse contato com os dados que você digitou?</p>
            <button type="button" onClick={onUpdateExisting} disabled={!!updatingExisting} className="btn-secondary !py-1 text-xs">
              {updatingExisting ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />}
              {updatingExisting ? "Atualizando…" : "Atualizar contato"}
            </button>
          </>
        ) : (
          <p className="text-xs text-amber-800 dark:text-amber-400">Já está cadastrado com esse número.</p>
        )}
      </div>
    );
  }

  async function callLeadRequest() {
    setBusy(true);
    try {
      const res = await fetch("/api/lead-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: conflict.contactId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ kind: "error", message: data.error ?? `Erro ${res.status}` });
        return;
      }
      if (data.alreadyYours) setResult({ kind: "already-yours" });
      else if (data.alreadyRequested) setResult({ kind: "already-requested" });
      else if (data.claimed) {
        trackUse("leads.assumir");
        setResult({ kind: "claimed", reason: data.reason ?? null });
      } else {
        trackUse("leads.solicitar");
        setResult({ kind: "requested" });
      }
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : "Falha de conexão" });
    } finally {
      setBusy(false);
    }
  }

  // Erro não "consome" o botão — a pessoa pode tentar de novo. Só um
  // resultado de sucesso (assumiu/pediu/já é dela) esconde as ações.
  const done = !!result && result.kind !== "error";
  const showClaim = conflict.claimable && !done;
  const showRequest = !conflict.claimable && conflict.requestable !== false && !done;
  const claimBusy = onClaim ? !!claiming : busy;

  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
      <p className="flex items-start gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
        &ldquo;{conflict.contactName}&rdquo; já está cadastrado
      </p>
      <p className="text-xs text-amber-800 dark:text-amber-400">
        Responsável: {conflict.responsavelName ?? "sem responsável"} · Criado em {formatDate(conflict.createdAt)}
      </p>

      {!done && <p className="text-xs text-amber-800 dark:text-amber-400">{explanation(conflict)}</p>}

      {showClaim && (
        <button type="button" onClick={onClaim ?? callLeadRequest} disabled={claimBusy} className="btn-secondary !py-1 text-xs">
          {claimBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />}
          {claimBusy ? "Assumindo…" : "Assumir este lead"}
        </button>
      )}

      {showRequest && (
        <button type="button" onClick={callLeadRequest} disabled={busy} className="btn-secondary !py-1 text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Send className="h-3.5 w-3.5" strokeWidth={2} />}
          {busy ? "Enviando…" : "Solicitar lead"}
        </button>
      )}

      {result && done && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
          <span>
            {result.kind === "claimed" && "Pronto — o lead agora é seu."}
            {result.kind === "requested" && `Pedido enviado — ${conflict.responsavelName ?? "o responsável"} vai aprovar ou recusar.`}
            {result.kind === "already-requested" && "Você já tem um pedido pendente pra este lead — aguarde a resposta."}
            {result.kind === "already-yours" && "Este lead já é seu."}
            {(result.kind === "claimed" || result.kind === "already-yours") && (
              <>
                {" "}
                <Link href={`/clientes/${conflict.contactId}`} className="underline">
                  Ver contato
                </Link>
              </>
            )}
          </span>
        </p>
      )}

      {result?.kind === "error" && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">{result.message}</p>
      )}
    </div>
  );
}
