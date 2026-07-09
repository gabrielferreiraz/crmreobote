import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-900 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900">
            C
          </div>
          <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
          <ThemeToggle className="ml-2" />
        </div>
        <div className="card p-8 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
