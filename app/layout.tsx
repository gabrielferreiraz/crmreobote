import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeInitScript } from "@/components/theme-init-script";

// Aplica o tema escuro antes da primeira pintura (sem flash branco). Inline
// no <head>, não <Script> do next/script nem arquivo /theme-init.js (sem
// requisição extra). Renderizado por ThemeInitScript, não por um <script>
// direto aqui: mesmo vindo de Server Component, o React RECRIA a raiz no
// cliente quando ela remonta (recarga/HMR do dev, recuperação de erro) e o
// React 19 reclamava no console ("Encountered a script tag while rendering
// React component") — ver o comentário em components/theme-init-script.tsx.
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("theme");var t=s==="light"||s==="dark"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");if(t==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`;

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
      <head>
        <ThemeInitScript code={THEME_INIT_SCRIPT} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
