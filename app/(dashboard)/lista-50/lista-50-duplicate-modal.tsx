"use client";

import { useState } from "react";
import { AlertTriangle, Briefcase, X } from "lucide-react";

export type Lista50DuplicateInfo = {
  contact: { id: string; name: string };
  responsavelName: string | null;
  claimable: boolean;
  claimReason: "NO_OWNER" | "OWNER_INACTIVE" | "LOST_OVER_3_MONTHS" | null;
  requestable: boolean;
  lostAt: string | null;
  deal: {
    name: string;
    status: "OPEN" | "WON" | "LOST";
    stageName: string;
    value: number | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

const STATUS_LABEL: Record<"OPEN" | "WON" | "LOST", string> = { OPEN: "Em andamento", WON: "Ganho", LOST: "Perdido" };

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Campo_Grande" });
}

function motivoTexto(info: Lista50DuplicateInfo): string {
  if (info.requestable) return `Esse lead já é de ${info.responsavelName ?? "outro consultor"}.`;
  switch (info.claimReason) {
    case "NO_OWNER":
      return "Esse contato não tem responsável.";
    case "OWNER_INACTIVE":
      return "O responsável não faz mais parte da equipe.";
    case "LOST_OVER_3_MONTHS":
      return info.lostAt ? `Parado desde ${formatarData(info.lostAt)} — mais de 3 meses sem nenhum movimento.` : "Parado há mais de 3 meses, sem nenhum movimento.";
    default:
      return "";
  }
}

/**
 * Aviso de duplicidade na Lista dos 50 — SÓ aparece quando
 * GET /api/lista-50/check-duplicate de fato encontra algo (chamado no blur
 * do WhatsApp, nunca durante a digitação). Reaproveita a MESMA ação de
 * sempre (POST /api/lead-requests) usada em Clientes/importação — nada de
 * regra nova aqui, só um lugar a mais que mostra o mesmo aviso.
 */
export function Lista50DuplicateModal({
  info,
  onClose,
  onResolved,
}: {
  info: Lista50DuplicateInfo;
  onClose: () => void;
  /** Chamado quando o lead foi assumido com sucesso — a tela pode preencher o nome do contato na linha, por exemplo. */
  onResolved?: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<"claimed" | "pending" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function agir() {
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/lead-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: info.contact.id }),
      });
      const dados = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        setErro(dados?.error ?? "Não foi possível agora. Tente de novo.");
        return;
      }
      if (dados.claimed) {
        setResultado("claimed");
        onResolved?.();
      } else {
        setResultado("pending");
      }
    } catch {
      setErro("Falha de conexão — tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-[#262933] bg-[#121318] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[#ffcc00]" strokeWidth={2.5} />
            <h2 className="text-sm font-black uppercase tracking-wider text-[#ffcc00]">Esse lead já está no CRM</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-gray-500 transition hover:text-gray-200">
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        {resultado === null && (
          <>
            <p className="mb-1 text-sm font-bold text-white">{info.contact.name}</p>
            <p className="mb-4 text-xs text-gray-400">{motivoTexto(info)}</p>

            {info.deal && (
              <div className="mb-4 rounded-xl border border-gray-800 bg-[#0a0a0c]/80 p-3 text-xs">
                <div className="mb-1 flex items-center gap-1.5 text-gray-400">
                  <Briefcase className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="font-semibold uppercase tracking-wide">Negócio encontrado</span>
                </div>
                <p className="font-medium text-gray-200">{info.deal.name}</p>
                <p className="mt-0.5 text-gray-500">
                  {STATUS_LABEL[info.deal.status]} · {info.deal.stageName} · atualizado em {formatarData(info.deal.updatedAt)}
                </p>
              </div>
            )}

            {erro && <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erro}</p>}

            <div className="flex flex-wrap gap-2">
              {(info.claimable || info.requestable) && (
                <button
                  type="button"
                  disabled={enviando}
                  onClick={agir}
                  className="rounded-lg bg-[#ffcc00] px-4 py-2 text-xs font-black uppercase tracking-wide text-black transition hover:bg-[#e6b800] disabled:opacity-50"
                >
                  {enviando ? "Enviando…" : info.claimable ? "Assumir este lead agora" : "Solicitar este lead"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-700 px-4 py-2 text-xs font-semibold text-gray-300 transition hover:bg-gray-800"
              >
                Continuar preenchendo
              </button>
            </div>
          </>
        )}

        {resultado === "claimed" && (
          <div className="py-2 text-center">
            <p className="mb-4 text-sm font-bold text-green-400">Lead assumido! Já está na sua carteira.</p>
            <button type="button" onClick={onClose} className="rounded-lg bg-[#ffcc00] px-4 py-2 text-xs font-black uppercase text-black hover:bg-[#e6b800]">
              Fechar
            </button>
          </div>
        )}

        {resultado === "pending" && (
          <div className="py-2 text-center">
            <p className="mb-4 text-sm font-bold text-[#ffcc00]">Pedido enviado — aguarde quem é responsável aprovar.</p>
            <button type="button" onClick={onClose} className="rounded-lg bg-[#ffcc00] px-4 py-2 text-xs font-black uppercase text-black hover:bg-[#e6b800]">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
