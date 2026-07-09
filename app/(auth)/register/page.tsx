"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { LoadingDots } from "@/components/loading-dots";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, organizationName }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erro ao criar conta");
      setLoading(false);
      return;
    }

    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (signInRes?.error) {
      router.push("/login");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Criar conta</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Configure sua empresa no CRM</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="field-label">Nome da empresa</label>
          <input
            autoFocus
            required
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Seu nome</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
        </div>
        <div className="space-y-1">
          <label className="field-label">Senha</label>
          <PasswordInput value={password} onChange={setPassword} required minLength={8} />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Criando
              <LoadingDots />
            </span>
          ) : (
            "Criar conta"
          )}
        </button>
      </form>

      <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-neutral-900 dark:text-neutral-100 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
