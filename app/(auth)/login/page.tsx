"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { LoadingDots } from "@/components/loading-dots";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deactivated = searchParams.get("deactivated") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("E-mail ou senha inválidos");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Bem-vindo de volta</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Entre na sua conta do CRM</p>
      </div>

      {deactivated && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
          Seu acesso foi desativado. Fale com o administrador da sua organização.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="field-label">E-mail</label>
          <input
            autoFocus
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
            placeholder="seu@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <label className="field-label">Senha</label>
          <PasswordInput value={password} onChange={setPassword} required />
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Entrando
              <LoadingDots />
            </span>
          ) : (
            "Entrar"
          )}
        </button>
      </form>
    </div>
  );
}
