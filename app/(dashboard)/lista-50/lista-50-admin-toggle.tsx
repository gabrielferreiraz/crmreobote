"use client";

import { useState } from "react";
import { Power, PowerOff } from "lucide-react";

/**
 * Ligar/desligar a campanha sazonal — só o Dono vê isto (ver canManageCampaign
 * na página). Desligar não apaga nada: só recarrega a página pra refletir o
 * novo estado (o próximo ano religa com uma nova data de início).
 */
export function Lista50AdminToggle({ enabled }: { enabled: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alterar(novoEnabled: boolean) {
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/lista-50/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: novoEnabled, startsOn: novoEnabled ? data : undefined }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => null);
        setErro(corpo?.error ?? "Não foi possível salvar.");
        setEnviando(false);
        return;
      }
      window.location.reload();
    } catch {
      setErro("Falha de conexão — tente novamente.");
      setEnviando(false);
    }
  }

  if (enabled) {
    return (
      <div className="text-right">
        {!aberto ? (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-red-400"
          >
            <PowerOff className="h-3.5 w-3.5" strokeWidth={2} />
            Desligar campanha
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
            <span>Desligar a Lista dos 50? A etapa e os negócios já criados ficam guardados.</span>
            <button type="button" disabled={enviando} onClick={() => alterar(false)} className="font-bold text-red-300 underline disabled:opacity-50">
              Confirmar
            </button>
            <button type="button" onClick={() => setAberto(false)} className="text-gray-400 hover:text-gray-200">
              Cancelar
            </button>
          </div>
        )}
        {erro && <p className="mt-1 text-xs text-red-400">{erro}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#ffcc00]/30 bg-[#ffcc00]/5 p-4 text-center">
      <p className="mb-3 text-sm text-gray-300">A campanha está desligada por agora — ninguém vê o formulário até você religar.</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <label className="text-xs text-gray-400">
          Início da temporada:{" "}
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="ml-1 rounded border border-[#2e3340] bg-[#181a20] px-2 py-1 text-xs text-gray-100 outline-none focus:border-[#ffcc00]"
          />
        </label>
        <button
          type="button"
          disabled={enviando}
          onClick={() => alterar(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#ffcc00] px-3 py-1.5 text-xs font-black uppercase text-black transition hover:bg-[#e6b800] disabled:opacity-50"
        >
          <Power className="h-3.5 w-3.5" strokeWidth={2.5} />
          Ligar campanha
        </button>
      </div>
      {erro && <p className="mt-2 text-xs text-red-400">{erro}</p>}
    </div>
  );
}
