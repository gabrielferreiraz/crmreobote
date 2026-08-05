import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Left: brand panel — clean, no blur circles (those scream "AI") */}
      <div className="relative hidden w-[42%] shrink-0 overflow-hidden lg:block">
        <div className="absolute inset-0 bg-brand" />
        {/* Subtle dot grid — barely visible, adds texture without noise */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }} />

        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-bold text-white">
              C
            </div>
            <span className="text-xl font-semibold tracking-tight text-white">CRM</span>
          </div>

          <div className="space-y-3">
            <p className="text-3xl font-semibold leading-tight tracking-tight text-white">
              Gerencie suas vendas<br />com inteligência.
            </p>
            <p className="max-w-sm text-base leading-relaxed text-white/60">
              Pipeline visual, integração com WhatsApp, automações e relatórios — tudo em um só lugar para seu time vender mais.
            </p>
          </div>

          {/* Feature pills — simple, no backdrop-blur (performance + cleaner look) */}
          <div className="flex flex-wrap gap-2">
            {["Pipeline Kanban", "WhatsApp integrado", "Automações", "Relatórios"].map((tag) => (
              <span key={tag} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/70">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-end px-6 pt-6">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-12">
          <div className="w-full max-w-sm">
            {/* Mobile logo — only visible on small screens */}
            <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
                C
              </div>
              <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
