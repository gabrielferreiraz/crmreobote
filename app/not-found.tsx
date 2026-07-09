import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-900 text-sm font-semibold text-white dark:bg-white dark:text-neutral-900">
            C
          </div>
          <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
        </div>

        <div className="card p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
            <Compass className="h-6 w-6 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
          </div>
          <p className="text-sm font-medium text-neutral-400 dark:text-neutral-500">Erro 404</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Página não encontrada
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            O endereço não existe ou foi movido.
          </p>
          <Link href="/" className="btn-primary mt-6 w-full">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
