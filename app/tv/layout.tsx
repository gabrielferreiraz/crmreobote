import "../../app/globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "TV Dashboard",
};

/**
 * TV é uma tela de kiosk fixa, sempre escura — não segue o toggle
 * claro/escuro do resto do app (não tem usuário ali pra alternar, é uma
 * tela ligada na parede). `dark` direto na raiz ativa em cascata todo token
 * `.dark ...` (cor de marca, `.surface-glass-panel`, etc. — ver globals.css)
 * pro resto da árvore, sem precisar duplicar valor nenhum aqui.
 *
 * Sem fonte própria (Inter) — a raiz real do app (app/layout.tsx) já define
 * `--font-dm-sans` no `<html>` e o Tailwind aplica como fonte padrão via
 * Preflight; essa página herda a mesma identidade tipográfica do resto do
 * produto automaticamente.
 */
export default function TvLayout({ children }: { children: ReactNode }) {
  return (
    <div className="tv-gradient-bg dark relative h-screen w-screen overflow-hidden text-white">
      {/* Moldura de segurança contra overscan (ver --tv-safe-margin em
          globals.css) — fica NESTE wrapper interno, não no fundo (acima),
          de propósito: o gradiente de fundo precisa continuar cobrindo a
          tela inteira (se o painel da TV cortar uma faixa da borda, quem
          sobra visível ali ainda é fundo, nunca uma tarja preta/vazia
          diferente do resto). Só o CONTEÚDO (children) fica recuado pra
          dentro da área segura. */}
      <div className="absolute inset-0" style={{ padding: "var(--tv-safe-margin)" }}>
        {children}
      </div>
    </div>
  );
}
