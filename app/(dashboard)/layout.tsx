import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Calculator } from "lucide-react";
import { resolveAvatarUrl } from "@/lib/r2";
import { getCurrentMembership } from "@/lib/current-membership";
import { TopNavLinks } from "./top-nav-links";
import { AdaptiveHeaderRow } from "./adaptive-header-row";
import { AppMain } from "./app-main";
import { NotificationBell } from "@/components/notification-bell";
import { CommandPalette } from "@/components/command-palette";
import { UserMenu } from "@/components/user-menu";
import { MobileHeader } from "./mobile-header";
import { MobileNav } from "./mobile-nav";
import { InstallPwaPrompt } from "@/components/install-pwa-prompt";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { PushNotificationsPrompt } from "@/components/push-notifications-prompt";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // getCurrentMembership() já reconfere no banco (não confia só no JWT) —
  // uma desativação precisa derrubar sessões já emitidas, não só bloquear
  // logins novos. Memoizada por requisição (React cache()), então as
  // páginas/componentes que chamam requireSession/requireRole/
  // getCurrentUserArea logo em seguida reaproveitam esta mesma consulta em
  // vez de repeti-la (ver lib/current-membership.ts).
  const membership = await getCurrentMembership();
  if (!membership?.active) redirect("/api/auth/deactivated");

  const photoUrl = await resolveAvatarUrl(membership.photoKey);
  const isAdministrativo = membership.area === "ADMINISTRATIVO";

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    // h-dvh (altura FIXA), não min-h-dvh — overflow-hidden só corta de
    // verdade quando a caixa tem um teto de altura real. Com min-h-dvh (só
    // um piso, sem teto) a caixa sempre crescia pro tamanho do conteúdo, o
    // overflow-hidden nunca tinha o que cortar, e isso deixava a porta
    // aberta pro <body> (compartilhado com Login/Docs, que PRECISAM crescer
    // e rolar — por isso não dá pra travar ele globalmente) crescer junto e
    // o navegador mostrar a rolagem de verdade da janela inteira, por cima
    // de tudo que já estava certo aqui dentro (ver AppMain.tsx).
    // dashboard-gradient-bg (ver globals.css) — malha de gradiente fixa do
    // redesign, escopada aqui (não no <body> global) de propósito. relative
    // é o que torna seguro o `position:absolute + z-index:-1` do `::before`
    // dessa classe: nada dentro desta div tem z-index negativo pra furar
    // por baixo, e overflow-hidden (já existia) contém a malha nos cantos.
    <div className="dashboard-gradient-bg relative flex h-dvh flex-col overflow-hidden text-neutral-900 dark:text-neutral-100">
      <MobileHeader
        photoUrl={photoUrl}
        name={session.user.name ?? session.user.email ?? "?"}
        email={session.user.email ?? ""}
        signOutAction={handleSignOut}
      />

      <header className="surface-glass relative z-30 hidden h-14 shrink-0 items-center gap-6 border-x-0 border-t-0 px-6 lg:flex">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white dark:text-white">
            C
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
        </Link>

        <AdaptiveHeaderRow
          nav={<TopNavLinks isAdministrativo={isAdministrativo} />}
          fullActions={
            <>
              <CommandPalette />
              {!isAdministrativo && (
                <Link href="/pipeline?novo=1" className="btn-primary btn-sm">
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Novo negócio
                </Link>
              )}
            </>
          }
          compactActions={
            <>
              <CommandPalette compact />
              {!isAdministrativo && (
                <Link href="/pipeline?novo=1" className="icon-btn" aria-label="Novo negócio" title="Novo negócio">
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                </Link>
              )}
            </>
          }
          fixedActions={
            <>
              <a href="/api/simulador-sso" target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
                <Calculator className="h-3.5 w-3.5" strokeWidth={2} />
                Simulador
              </a>
              <NotificationBell />
              <UserMenu
                name={session.user.name ?? session.user.email ?? "?"}
                email={session.user.email ?? ""}
                photoUrl={photoUrl}
                signOutAction={handleSignOut}
              />
            </>
          }
        />
      </header>

      <AppMain>{children}</AppMain>

      <MobileNav signOutAction={handleSignOut} isAdministrativo={isAdministrativo} />
      <InstallPwaPrompt />
      <PresenceHeartbeat />
      <PushNotificationsPrompt />
    </div>
  );
}
