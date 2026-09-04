"use client";

import { AlertTriangle, UserCheck } from "lucide-react";

/**
 * Corpo do 409 de POST /api/contacts quando o telefone/WhatsApp já bate com
 * um contato existente (ver lib/contact-duplicate.ts). `claimable` decide
 * qual dos dois avisos abaixo mostrar — nunca os dois.
 */
export type ContactConflict = {
  contactId: string;
  contactName: string;
  createdAt: string;
  responsavelName: string | null;
  claimable: boolean;
};

function formatCreatedAt(raw: string): string {
  return new Date(raw).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Mostrado no lugar do formulário/erro genérico quando POST /api/contacts
 * responde 409 com `conflict` — duas situações bem diferentes:
 *
 * - claimable=false (responsável ATIVO cuidando do lead): só informa, sem
 *   ação nenhuma — nunca deixa passar por cima de um consultor ativo.
 * - claimable=true (sem responsável, ou responsável desativado): oferece
 *   "Assumir este contato", que reenvia o mesmo formulário com
 *   claimContactId — vira UPDATE (responsável passa a ser quem está
 *   criando) em vez de bloquear pra sempre.
 */
export function ContactConflictNotice({
  conflict,
  onClaim,
  claiming,
}: {
  conflict: ContactConflict;
  onClaim?: () => void;
  claiming?: boolean;
}) {
  const createdLabel = formatCreatedAt(conflict.createdAt);

  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
      <p className="flex items-start gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
        &ldquo;{conflict.contactName}&rdquo; já está cadastrado
      </p>
      <p className="text-xs text-amber-800 dark:text-amber-400">
        Responsável: {conflict.responsavelName ?? "sem responsável"} · Criado em {createdLabel}
      </p>

      {conflict.claimable ? (
        <>
          <p className="text-xs text-amber-800 dark:text-amber-400">
            {conflict.responsavelName
              ? "O responsável anterior não está mais ativo — você pode assumir este contato."
              : "Este contato não tem responsável — você pode assumi-lo."}
          </p>
          {onClaim && (
            <button
              type="button"
              onClick={onClaim}
              disabled={claiming}
              className="btn-secondary !py-1 text-xs"
            >
              <UserCheck className="h-3.5 w-3.5" strokeWidth={2} />
              {claiming ? "Assumindo…" : "Assumir este contato"}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-amber-800 dark:text-amber-400">
          Entre em contato com {conflict.responsavelName ?? "o responsável"} para verificar disponibilidade do lead.
        </p>
      )}
    </div>
  );
}
