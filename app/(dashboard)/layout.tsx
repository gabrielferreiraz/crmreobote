import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { resolveAvatarUrl } from "@/lib/r2";
import { runWithTenant } from "@/lib/tenant-context";
import { TopNavLinks } from "./top-nav-links";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { UserMenu } from "@/components/user-menu";
import { MobileHeader } from "./mobile-header";
import { MobileNav } from "./mobile-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Roda a checagem de bootstrap dentro de runWithTenant (storage.run), não
  // setTenant/enterWith — enterWith não garante que o contexto sobreviva até
  // esta consulta ser de fato executada, o que já causou usuários ativos
  // serem derrubados por engano (RLS bloqueia tudo sem contexto).
  //
  // Reconfere no banco (não confia só no JWT) — uma desativação precisa derrubar
  // sessões já emitidas, não só bloquear logins novos.
  const membership = session.user.organizationId
    ? await runWithTenant(session.user.organizationId, () =>
        prisma.organizationUser.findUnique({
          where: {
            organizationId_userId: {
              organizationId: session.user.organizationId!,
              userId: session.user.id,
            },
          },
          select: { active: true, user: { select: { image: true } } },
        }),
      )
    : null;
  if (!membership?.active) redirect("/api/auth/deactivated");

  const photoUrl = await resolveAvatarUrl(membership.user.image);

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <MobileHeader photoUrl={photoUrl} name={session.user.name ?? session.user.email ?? "?"} />

      <header className="hidden h-14 shrink-0 items-center gap-6 border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-900 lg:flex">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900">
            C
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
        </Link>

        <TopNavLinks />

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <CommandPalette />
          <Link href="/pipeline?novo=1" className="btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Novo negócio
          </Link>
          <NotificationBell />
          <ThemeToggle />
          <UserMenu
            name={session.user.name ?? session.user.email ?? "?"}
            email={session.user.email ?? ""}
            photoUrl={photoUrl}
            signOutAction={handleSignOut}
          />
        </div>
      </header>

      {/* scrollbar-gutter reserva o espaço da barra de rolagem o tempo todo —
          sem isso, trocar o filtro de período no Relatórios (ou qualquer
          outra navegação que mude a altura do conteúdo) faz a barra
          aparecer/sumir e o conteúdo inteiro "pular" alguns pixels pro lado. */}
      <main className="flex-1 overflow-y-auto p-4 pb-24 [scrollbar-gutter:stable] lg:p-8">
        <div className="mx-auto h-full w-full max-w-[1500px]">{children}</div>
      </main>

      <MobileNav signOutAction={handleSignOut} />
    </div>
  );
}
