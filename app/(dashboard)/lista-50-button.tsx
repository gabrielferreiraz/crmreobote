"use client";

import { usePathname, useRouter } from "next/navigation";
import { ListOrdered } from "lucide-react";

/**
 * Ponto de entrada da Lista dos 50 no cabeçalho do CRM.
 *
 * O visual é a fita de alerta da campanha (as listras amarelo e preto da
 * própria página), aqui como moldura do botão: o rótulo fica numa tarja sólida
 * por cima, porque texto direto sobre as listras não se lê.
 *
 * Componente de cliente porque o layout do dashboard é servidor e não pode
 * carregar onClick.
 */
const FITA = "repeating-linear-gradient(-45deg, #ffcc00, #ffcc00 6px, #111111 6px, #111111 12px)";

export function Lista50Button() {
  const router = useRouter();
  const naLista = usePathname() === "/lista-50";

  return (
    <button
      type="button"
      onClick={() => router.push("/lista-50")}
      aria-current={naLista ? "page" : undefined}
      title="Lista dos 50 — Novembro Black"
      className="shrink-0 rounded-lg p-[3px] transition-transform duration-150 hover:scale-[1.03]"
      style={{ background: FITA }}
    >
      <span
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 py-1 text-sm font-bold ${
          naLista ? "bg-[#ffcc00] text-black" : "bg-neutral-950 text-[#ffcc00]"
        }`}
      >
        <ListOrdered className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
        Lista dos 50
      </span>
    </button>
  );
}
