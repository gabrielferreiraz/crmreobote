import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function DashboardNotFound() {
  return (
    <div className="card py-4">
      <EmptyState
        icon={SearchX}
        title="Não encontrado"
        description="Este registro não existe ou foi removido."
        action={
          <Link href="/" className="btn-secondary">
            Voltar ao início
          </Link>
        }
      />
    </div>
  );
}
