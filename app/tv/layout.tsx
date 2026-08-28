import "../../app/globals.css";
import { ReactNode } from "react";
import { TvShell } from "@/components/tv-shell";

export const metadata = {
  title: "TV Dashboard",
};

/**
 * Sem fonte própria (Inter) — a raiz real do app (app/layout.tsx) já define
 * `--font-dm-sans` no `<html>` e o Tailwind aplica como fonte padrão via
 * Preflight; essa página herda a mesma identidade tipográfica do resto do
 * produto automaticamente. A moldura visual em si (fundo escuro, margem de
 * segurança contra overscan) vive em components/tv-shell.tsx — reaproveitada
 * também por app/t/[code]/page.tsx (link público curto), que fica fora
 * deste segmento de propósito.
 */
export default function TvLayout({ children }: { children: ReactNode }) {
  return <TvShell>{children}</TvShell>;
}
