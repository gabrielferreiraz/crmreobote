import Link from "next/link";
import { isPublicSignupEnabled } from "@/lib/signup";
import { RegisterForm } from "./register-form";

// Lê variável de ambiente em tempo de execução — sem isto o Next poderia
// pré-renderizar a página no build com o valor da máquina que fez o build.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  if (isPublicSignupEnabled()) return <RegisterForm />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Cadastro fechado</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          O acesso ao CRM é criado pelo administrador da sua empresa. Peça a ele para cadastrar você em Configurações →
          Usuários.
        </p>
      </div>
      <Link href="/login" className="btn-primary w-full">
        Ir para o login
      </Link>
    </div>
  );
}
