import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

// Script movido pra public/theme-init.js — Next.js Script com src é mais limpo
// do que inline, evita o aviso de React sobre script tags renderizadas durante SSR

// Redesign (ver new-design-for-claude/README.md) — DM Sans no lugar da Geist
// Sans anterior, pesos 400-700 (a marcação do protótipo usa até 700 em
// título/KPI). Geist_Mono continua igual — nada no redesign pede
// monoespaçada, e o hint "⌘K" do command palette já usa font-mono de propósito.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CRM",
  description: "CRM para equipes de vendas de consórcio",
  appleWebApp: {
    capable: true,
    title: "CRM",
    statusBarStyle: "black-translucent",
  },
};

// viewport-fit=cover é o que faz `env(safe-area-inset-*)` funcionar de
// verdade nos cantos arredondados/notch do iPhone — sem isso a barra de
// navegação e o FAB do mobile ficam encostados na borda. themeColor pinta a
// barra de status/endereço do navegador com a cor do app em vez do branco
// padrão, tirando aquele "corte" visual entre o app e o resto do celular.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5a5be6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${dmSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Inicialização do tema — carrega do arquivo público (public/theme-init.js)
            pra evitar tentar renderizar inline scripts como JSX. strategy=
            "beforeInteractive" garante que o Next executa isso no <head> cedo
            o bastante pra nunca haver flash de tema errado. */}
        <Script id="theme-init" src="/theme-init.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
